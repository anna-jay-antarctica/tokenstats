import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, test } from "node:test"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { dayWindows, fetchUsage, periodStart, usageRequest, type UsagePeriod } from "../usage.ts"

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 15, 12, 34, 56)
const directories: string[] = []

async function cacheDirectory() {
  const base = process.platform === "win32" ? join(tmpdir(), "opencode") : tmpdir()
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(join(base, "tokenstat-test-"))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

function stats(input = 100) {
  const tokens = { input, output: 10, reasoning: 2, cache: { read: 50, write: 5 } }
  return {
    sessions: 1, steps: 2, tokens, cost: 0.25,
    models: [{ model: { providerID: "openai", id: "test-model" }, steps: 2, tokens, cost: 0.25 }],
  }
}

function context(options: { project?: string; database?: string; url?: string; workspace?: string; load?: (input: any) => Promise<any> } = {}) {
  const calls: any[] = []
  return {
    calls,
    location: { directory: options.workspace ?? "/workspace-a" },
    data: { session: { get: () => ({ projectID: options.project ?? "project-a" }) } },
    client: {
      server: { info: async () => ({ urls: [options.url ?? "http://server:1234"], paths: { tmp: "/server/tmp" } }) },
      session: {
        list: async (input: any) => {
          assert.equal(input.limit, 1)
          assert.equal(input.order, "asc")
          return { data: [{ id: options.database ?? "oldest-session" }] }
        },
        stats: async (input: any) => {
          calls.push(input)
          assert.equal(input.tools, "none")
          assert.equal(input.timezone, "UTC")
          assert.ok(input.to - input.from <= DAY)
          return options.load ? options.load(input) : stats()
        },
      },
    },
  }
}

function load(ctx: any, root: string, options: any = {}, period: UsagePeriod = 7, scope: "project" | "all" = "all", update = (_: any) => {}) {
  return fetchUsage(ctx, "active-session", scope, period, () => {}, new AbortController().signal, update, { cacheRoot: root, now: NOW, ...options })
}

test("UTC day slices preserve the exact rolling range, with no overlap or DST dependence", () => {
  const windows = dayWindows(NOW - 7 * DAY, NOW).reverse()
  assert.equal(windows.length, 8)
  assert.equal(windows[0].from, NOW - 7 * DAY)
  assert.equal(windows.at(-1)!.to, NOW)
  assert.equal(windows.reduce((sum, window) => sum + window.to - window.from, 0), 7 * DAY)
  for (let i = 1; i < windows.length; i++) assert.equal(windows[i - 1].to, windows[i].from)
  const midnight = Date.UTC(2026, 9, 15)
  assert.equal(dayWindows(midnight - DAY, midnight).length, 1)
})

test("Current month begins at local midnight, including January and leap-year February", () => {
  for (const [year, month, day] of [[2026, 0, 15], [2024, 1, 29], [2026, 9, 31]]) {
    const now = new Date(year, month, day, 12, 34).getTime()
    assert.equal(periodStart("month", now), new Date(year, month, 1).getTime())
    assert.equal(periodStart(30, now), now - 30 * DAY)
  }
})

test("Current month requests cover the local month-to-date range and reuse shared cached slices", async () => {
  const root = await cacheDirectory()
  const now = new Date(2026, 9, 15, 12, 34).getTime()
  const ctx = context()
  const result = await load(ctx, root, { now }, "month")
  const windows = dayWindows(new Date(2026, 9, 1).getTime(), now)
  assert.equal(result.completedDays, windows.length)
  assert.equal(ctx.calls[0].to, now)
  assert.equal(ctx.calls.at(-1).from, new Date(2026, 9, 1).getTime())
  assert.equal(ctx.calls.reduce((sum, call) => sum + call.to - call.from, 0), now - new Date(2026, 9, 1).getTime())
  const other = context({ workspace: "/another-workspace" })
  assert.equal((await load(other, root, { now: now + 1_000 }, "month")).cacheHits, windows.length)
  assert.equal(other.calls.length, 0)
})

test("Current month never reuses the previous month's live snapshot after midnight", async () => {
  const root = await cacheDirectory()
  const before = new Date(2026, 9, 31, 23, 59, 50).getTime()
  const after = new Date(2026, 10, 1, 0, 0, 20).getTime()
  await load(context(), root, { now: before }, "month")
  const ctx = context()
  const result = await load(ctx, root, { now: after }, "month")
  assert.equal(result.asOf, after)
  assert.equal(ctx.calls.length, 1)
  assert.equal(ctx.calls[0].from, new Date(2026, 10, 1).getTime())
  assert.equal(ctx.calls[0].to, after)
})

test("daily aggregation is sequential, includes reasoning/cache, and never sums overlapping sessions", async () => {
  const root = await cacheDirectory()
  let active = 0
  let peak = 0
  const ctx = context({ load: async () => {
    peak = Math.max(peak, ++active)
    await new Promise((resolve) => setTimeout(resolve, 2))
    active--
    return stats()
  } })
  const updates: number[] = []
  const result = await load(ctx, root, {}, 7, "all", (value) => updates.push(value.completedDays))
  assert.equal(ctx.calls.length, 8)
  assert.equal(peak, 1)
  assert.equal(result.completedDays, 8)
  assert.equal(result.sessions, undefined)
  assert.equal(result.steps, 16)
  assert.equal(result.input, 800)
  assert.equal(result.output, 96)
  assert.equal(result.cacheRead, 400)
  assert.equal(result.cacheWrite, 40)
  assert.equal(result.cost, 2)
  assert.equal(result.models[0][0], "openai/test-model")
  assert.deepEqual(updates, [0, 1, 2, 3, 4, 5, 6, 7, 8, 8])
})

test("a single UTC-day interval can report its exact session count", async () => {
  const result = await load(context(), await cacheDirectory(), { now: Date.UTC(2026, 9, 15) }, 1)
  assert.equal(result.sessions, 1)
})

test("independent workspaces share persisted all-project cache and rolling snapshot", async () => {
  const root = await cacheDirectory()
  const first = context({ workspace: "/workspace-a", project: "a" })
  const second = context({ workspace: "/workspace-b", project: "b" })
  await load(first, root)
  const result = await load(second, root, { now: NOW + 30_000 })
  assert.equal(second.calls.length, 0)
  assert.equal(result.cacheHits, 8)
  assert.equal(result.asOf, NOW)
})

test("project cache is shared by workspaces of the same project, but isolated from other scopes", async () => {
  const root = await cacheDirectory()
  await load(context(), root, {}, 1, "project")
  const same = context({ workspace: "/other-workspace" })
  assert.equal((await load(same, root, {}, 1, "project")).cacheHits, 2)
  assert.equal(same.calls.length, 0)
  const other = context({ project: "different-project" })
  await load(other, root, {}, 1, "project")
  assert.equal(other.calls.length, 2)
  assert.equal(other.calls[0].project, "different-project")
  const all = context()
  await load(all, root, {}, 1, "all")
  assert.equal(all.calls.length, 2)
  assert.equal(all.calls[0].project, undefined)
})

test("different servers and replacement databases cannot reuse each other's cache", async () => {
  const root = await cacheDirectory()
  await load(context(), root, {}, 1)
  for (const ctx of [context({ url: "http://other:1234" }), context({ database: "another-database" })]) {
    await load(ctx, root, {}, 1)
    assert.equal(ctx.calls.length, 2)
  }
})

test("after live TTL, only the rolling edges reload while complete historical days are reused", async () => {
  const root = await cacheDirectory()
  await load(context(), root)
  const ctx = context()
  const result = await load(ctx, root, { now: NOW + 61_000 })
  assert.equal(ctx.calls.length, 2)
  assert.equal(result.cacheHits, 6)
  assert.equal(result.asOf, NOW + 61_000)
  assert.equal(ctx.calls.at(-1).from, NOW + 61_000 - 7 * DAY)
})

test("Refresh bypasses cache; subsequent opens reuse the refreshed data", async () => {
  const root = await cacheDirectory()
  await load(context(), root, {}, 1)
  const refresh = context({ load: async () => stats(200) })
  const refreshed = await load(refresh, root, { force: true }, 1)
  assert.equal(refresh.calls.length, 2)
  assert.equal(refreshed.input, 400)
  const cached = context()
  assert.equal((await load(cached, root, {}, 1)).input, 400)
  assert.equal(cached.calls.length, 0)
})

test("timeout preserves successful days, stops further requests, and Retry loads only missing days", async () => {
  const root = await cacheDirectory()
  let count = 0
  const broken = context({ load: async () => ++count === 3 ? new Promise(() => {}) : stats() })
  const partial = await load(broken, root, { timeoutMs: 10 })
  assert.equal(broken.calls.length, 3)
  assert.equal(partial.completedDays, 2)
  assert.equal(partial.totalDays, 8)
  assert.equal(partial.errors.length, 1)
  assert.match(partial.errors[0], /Loading 2026-10-13.*timed out/)
  const retry = context()
  const complete = await load(retry, root)
  assert.equal(retry.calls.length, 6)
  assert.equal(complete.cacheHits, 2)
  assert.equal(complete.completedDays, 8)
  assert.equal(complete.errors.length, 0)
})

test("cache is read in full before requesting a missing day, preserving older results on failure", async () => {
  const root = await cacheDirectory()
  await load(context(), root)
  const broken = context({ load: async () => { throw new Error("Server unavailable") } })
  const result = await load(broken, root, { now: NOW + 61_000 })
  assert.equal(broken.calls.length, 1)
  assert.equal(result.completedDays, 6)
  assert.equal(result.cacheHits, 6)
  assert.match(result.errors[0], /Server unavailable/)
})

test("simultaneous workspace loads coordinate through the disk lock and do not duplicate daily requests", async () => {
  const root = await cacheDirectory()
  let active = 0
  let peak = 0
  const slow = async () => {
    peak = Math.max(peak, ++active)
    await new Promise((resolve) => setTimeout(resolve, 5))
    active--
    return stats()
  }
  const a = context({ workspace: "/a", load: slow })
  const b = context({ workspace: "/b", load: slow })
  const results = await Promise.all([load(a, root, {}, 1), load(b, root, { now: NOW + 1 }, 1)])
  assert.equal(peak, 1)
  assert.equal(a.calls.length + b.calls.length, 2)
  assert.equal(results[0].input, results[1].input)
})

test("independent OS processes share cached days and serialize server requests", async () => {
  const root = await cacheDirectory()
  const worker = fileURLToPath(new URL("./cache-worker.mjs", import.meta.url))
  const run = () => promisify(execFile)(process.execPath, ["--experimental-strip-types", worker, root], { timeout: 15_000 })
  const results = await Promise.all([run(), run()])
  for (const result of results) assert.deepEqual(JSON.parse(result.stdout), { steps: 4, completed: 2 })
  const events = (await readFile(join(root, "events.log"), "utf8")).trim().split("\n")
  assert.equal(events.length, 4, "Only two daily requests should run across both processes")
  assert.match(events[0], /^start /)
  assert.match(events[1], /^end /)
  assert.match(events[2], /^start /)
  assert.match(events[3], /^end /)
})

test("historical days expire rather than being cached forever", async () => {
  const root = await cacheDirectory()
  await load(context(), root)
  const ctx = context()
  await load(ctx, root, { now: NOW + DAY + 1 })
  assert.equal(ctx.calls.length, 8)
})

test("corrupt cache is ignored instead of breaking the dialog", async () => {
  const root = await cacheDirectory()
  await load(context(), root, {}, 1)
  const directory = join(root, (await readdir(root))[0])
  const files = (await readdir(directory)).filter((name) => name.endsWith(".json") && !name.includes("snapshot"))
  await writeFile(join(directory, files[0]), "broken JSON")
  const ctx = context()
  const result = await load(ctx, root, {}, 1)
  assert.equal(ctx.calls.length, 1)
  assert.equal(result.completedDays, 2)
  assert.equal(result.errors.length, 0)
  const contents = await readFile(join(directory, files[0]), "utf8")
  assert.doesNotThrow(() => JSON.parse(contents))
})

test("abort and clients ignoring AbortSignal cannot leave requests pending forever", async () => {
  const controller = new AbortController()
  const pending = usageRequest(() => new Promise(() => {}), "Request", controller.signal)
  controller.abort(new Error("Dialog closed"))
  await assert.rejects(pending, /Dialog closed/)
  await assert.rejects(usageRequest(() => new Promise(() => {}), "Request", new AbortController().signal, 5), /timed out/)
})

test("invalid API data is not persisted as a successful day", async () => {
  const root = await cacheDirectory()
  const result = await load(context({ load: async () => ({ tokens: null }) }), root, {}, 1)
  assert.equal(result.completedDays, 0)
  assert.match(result.errors[0], /unexpected statistics response/)
})
