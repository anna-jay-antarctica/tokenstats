import { createHash, randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, stat, unlink, utimes, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export type UsagePeriod = 1 | 7 | 30 | "month"

export type ModelUsage = {
  steps: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

export type UsageSummary = ModelUsage & {
  sessions?: number
  models: Array<[string, ModelUsage]>
  completedDays: number
  totalDays: number
  cacheHits: number
  asOf: number
  errors: string[]
}

type Window = { from: number; to: number }
type Stats = {
  sessions: number
  steps: number
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  cost: number
  models: Array<{ model: { providerID: string; id: string }; steps: number; tokens: Stats["tokens"]; cost: number }>
}
type Entry = Window & { savedAt: number; stats: Stats }
type Options = { force?: boolean; cacheRoot?: string; now?: number; timeoutMs?: number }

const DAY = 86_400_000
const LIVE_TTL = 60_000
const HISTORY_TTL = DAY

export function periodStart(period: UsagePeriod, asOf: number): number {
  if (period !== "month") return asOf - period * DAY
  const date = new Date(asOf)
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
}

export function emptySummary(asOf = Date.now()): UsageSummary {
  return { steps: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, models: [], completedDays: 0, totalDays: 0, cacheHits: 0, asOf, errors: [] }
}

export function globalCacheDirectory() {
  const base = process.env.XDG_CACHE_HOME || (process.platform === "win32"
    ? process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
    : process.platform === "darwin" ? join(homedir(), "Library", "Caches") : join(homedir(), ".cache"))
  return join(base, "opencode-tokenstat", "usage-v1")
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

export function dayWindows(from: number, to: number): Window[] {
  const windows: Window[] = []
  while (from < to) {
    const end = Math.min(to, (Math.floor(from / DAY) + 1) * DAY)
    windows.push({ from, to: end })
    from = end
  }
  return windows.reverse()
}

export async function usageRequest<T>(request: (signal: AbortSignal) => Promise<T>, label: string, signal: AbortSignal, timeoutMs = 30_000): Promise<T> {
  signal.throwIfAborted()
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  const cancelled = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true })
  })
  signal.addEventListener("abort", abort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error(`${label} timed out. Check the OpenCode server connection and try again.`)), timeoutMs)
  try {
    return await Promise.race([Promise.resolve().then(() => {
      controller.signal.throwIfAborted()
      return request(controller.signal)
    }), cancelled])
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", abort)
  }
}

async function readJSON(path: string): Promise<any> {
  try {
    return JSON.parse(await readFile(path, "utf8"))
  } catch (error: any) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return undefined
    throw error
  }
}

async function writeJSON(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch(() => {})
  }
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve() }, ms)
    signal.addEventListener("abort", abort, { once: true })
  })
}

// One API request at a time per server, also across independent TUI processes.
async function exclusive<T>(directory: string, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  const path = join(directory, "request.lock")
  const owner = randomUUID()
  const started = Date.now()
  while (true) {
    signal.throwIfAborted()
    try {
      const handle = await open(path, "wx", 0o600)
      try { await handle.writeFile(owner) } finally { await handle.close() }
      break
    } catch (error: any) {
      if (error.code !== "EEXIST") throw error
      const existing = await stat(path).catch(() => undefined)
      if (existing && Date.now() - existing.mtimeMs > 120_000) {
        await unlink(path).catch(() => {})
        continue
      }
      if (Date.now() - started > 65_000) throw new Error("Another workspace is still loading usage. Please retry shortly.")
      await pause(100, signal)
    }
  }
  const heartbeat = setInterval(() => { const now = new Date(); void utimes(path, now, now).catch(() => {}) }, 5_000)
  try {
    signal.throwIfAborted()
    return await work()
  } finally {
    clearInterval(heartbeat)
    if (await readFile(path, "utf8").catch(() => undefined) === owner) await unlink(path).catch(() => {})
  }
}

function validStats(value: any): value is Stats {
  const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0
  const tokens = (value: any) => value && [value.input, value.output, value.reasoning, value.cache?.read, value.cache?.write].every(number)
  return !!value && number(value.sessions) && number(value.steps) && number(value.cost) && tokens(value.tokens) &&
    Array.isArray(value.models) && value.models.every((row: any) => row &&
      typeof row.model?.providerID === "string" && typeof row.model?.id === "string" &&
      number(row.steps) && number(row.cost) && tokens(row.tokens))
}

function fresh(entry: any, window: Window, now: number): entry is Entry {
  const ttl = window.to <= Math.floor(now / DAY) * DAY ? HISTORY_TTL : LIVE_TTL
  return !!entry && entry.from === window.from && entry.to === window.to &&
    typeof entry.savedAt === "number" && entry.savedAt <= now && now - entry.savedAt < ttl && validStats(entry.stats)
}

function amounts(steps: number, tokens: Stats["tokens"], cost: number): ModelUsage {
  return { steps, input: tokens.input, output: tokens.output + tokens.reasoning, cacheRead: tokens.cache.read, cacheWrite: tokens.cache.write, cost }
}

function summarize(entries: Entry[], totalDays: number, cacheHits: number, asOf: number, errors: string[]): UsageSummary {
  const result = emptySummary(asOf)
  const models = new Map<string, ModelUsage>()
  const add = (target: ModelUsage, source: ModelUsage) => {
    for (const key of ["steps", "input", "output", "cacheRead", "cacheWrite", "cost"] as const) target[key] += source[key]
  }
  for (const { stats } of entries) {
    add(result, amounts(stats.steps, stats.tokens, stats.cost))
    for (const row of stats.models) {
      const key = `${row.model.providerID}/${row.model.id}`
      const current = models.get(key) ?? { steps: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
      add(current, amounts(row.steps, row.tokens, row.cost))
      models.set(key, current)
    }
  }
  // Daily session counts overlap. Never present their sum as unique sessions.
  if (totalDays === 1 && entries.length === 1) result.sessions = entries[0].stats.sessions
  result.models = [...models].sort((a, b) =>
    b[1].input + b[1].output + b[1].cacheRead + b[1].cacheWrite - (a[1].input + a[1].output + a[1].cacheRead + a[1].cacheWrite))
  return { ...result, completedDays: entries.length, totalDays, cacheHits, errors: [...errors] }
}

export async function fetchUsage(
  context: any,
  sessionID: string,
  scope: "project" | "all",
  period: UsagePeriod,
  progress: (message: string) => void,
  signal: AbortSignal = new AbortController().signal,
  update: (summary: UsageSummary) => void = () => {},
  options: Options = {},
): Promise<UsageSummary> {
  const now = options.now ?? Date.now()
  const request = <T>(call: (signal: AbortSignal) => Promise<T>, label: string) => usageRequest(call, label, signal, options.timeoutMs)
  progress("Identifying the server and project…")
  const info = await request<any>((signal) => context.client.server.info({ signal }), "Identifying the OpenCode server")
  // The oldest session ID distinguishes databases, without using the workspace directory
  // or caching authentication data. Different databases on the same URL must not collide.
  const anchor = await request<any>((signal) => context.client.session.list({ limit: 1, order: "asc" }, { signal }), "Identifying the session database")
  if (!Array.isArray(anchor?.data) || (anchor.data.length && typeof anchor.data[0]?.id !== "string") || !Array.isArray(info?.urls) || typeof info.paths?.tmp !== "string") {
    throw new Error("Unexpected server identity response. Check your OpenCode version.")
  }
  let project: string | undefined
  if (scope === "project") {
    const session = context.data.session.get(sessionID) ?? await request<any>(
      (signal) => context.client.session.get({ sessionID }, { signal }), "Identifying the current project")
    project = session?.projectID
    if (!project) throw new Error("Could not identify the current project.")
  }
  if (!anchor.data.length) return emptySummary(now)
  const directory = join(options.cacheRoot ?? globalCacheDirectory(), hash({ urls: [...info.urls].sort(), tmp: info.paths.tmp, database: anchor.data[0].id }))
  await mkdir(directory, { recursive: true })
  const scopeKey = hash({ project: project ?? null })
  // A live snapshot from last month must never leak across a month boundary.
  const periodKey = period === "month" ? `month-${periodStart(period, now)}` : period
  const snapshotPath = join(directory, `${scopeKey}-${periodKey}-snapshot.json`)
  // A short-lived, shared snapshot keeps exact rolling boundaries consistent across
  // workspaces. No rounding of "last 24 hours" to calendar days or midnight.
  const asOf = await exclusive(directory, signal, async () => {
    const snapshot = options.force ? undefined : await readJSON(snapshotPath)
    const asOf = snapshot && typeof snapshot.asOf === "number" && snapshot.asOf <= now && now - snapshot.asOf < LIVE_TTL ? snapshot.asOf : now
    await writeJSON(snapshotPath, { asOf })
    return asOf
  })
  const windows = dayWindows(periodStart(period, asOf), asOf)
  const entries = new Map<number, Entry>()
  const errors: string[] = []
  let cacheHits = 0
  const report = () => {
    const result = summarize([...entries.values()], windows.length, cacheHits, asOf, errors)
    update(result)
    return result
  }
  const entryPath = (window: Window) => join(directory, `${scopeKey}-${Math.floor(window.from / DAY)}.json`)
  // Load all available days first, so a failed request cannot hide successful cached days.
  if (!options.force) for (const window of windows) {
    signal.throwIfAborted()
    const cached = await readJSON(entryPath(window))
    if (fresh(cached, window, now)) { entries.set(window.from, cached); cacheHits++ }
  }
  report()
  for (const [index, window] of windows.entries()) {
    signal.throwIfAborted()
    if (entries.has(window.from)) continue
    const date = new Date(window.from).toISOString().slice(0, 10)
    const label = `Loading ${date} (day ${index + 1}/${windows.length})`
    progress(`${label} · ${entries.size} ready · ${cacheHits} cached`)
    try {
      const entry = await exclusive(directory, signal, async () => {
        // Another workspace may have filled this day while we waited for the lock.
        const cached = options.force ? undefined : await readJSON(entryPath(window))
        if (fresh(cached, window, now)) { cacheHits++; return cached }
        const stats = await request<Stats>((signal) => context.client.session.stats({
          from: window.from, to: window.to, project, timezone: "UTC", tools: "none",
        }, { signal }), label)
        if (!validStats(stats)) throw new Error(`${label}: unexpected statistics response. Check your OpenCode version.`)
        signal.throwIfAborted()
        const entry: Entry = { ...window, savedAt: now, stats }
        await writeJSON(entryPath(window), entry)
        return entry
      })
      entries.set(window.from, entry)
      report()
    } catch (error) {
      signal.throwIfAborted()
      errors.push(error instanceof Error ? error.message : String(error))
      // A timed-out server may still be busy. Do not pile up further requests.
      break
    }
  }
  progress(`${entries.size}/${windows.length} days ready · ${cacheHits} cached`)
  return report()
}
