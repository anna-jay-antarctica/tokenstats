/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import type { MouseEvent } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { emptySummary, fetchUsage, type UsagePeriod, type UsageSummary } from "./usage.ts"

type Scope = "project" | "all"

const PERIODS: Array<{ value: UsagePeriod; label: string }> = [
  { value: 1, label: "24 h" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: "month", label: "Current month" },
]

function formatTokens(value: number) {
  const units = ["", "K", "M", "G"]
  let amount = Math.round(value)
  let unit = 0
  while (Math.abs(amount) >= 1000 && unit < units.length - 1) {
    amount /= 1000
    unit++
  }
  // Avoid showing 1000K or 1000M after rounding near a unit boundary.
  if (Math.abs(Number(amount.toFixed(1))) >= 1000 && unit < units.length - 1) {
    amount /= 1000
    unit++
  }
  return `${unit === 0 ? amount : Number(amount.toFixed(1))}${units[unit]}`
}

function formatCost(value: number) {
  return `$${value.toFixed(2)}`
}

function UsageDialog(props: { context: any; sessionID: string }) {
  const dimensions = useTerminalDimensions()
  // Leave room for the host dialog's outer spacing, including on resize.
  const dialogHeight = () => Math.max(1, Math.min(32, dimensions().height - 6))
  const [scope, setScope] = createSignal<Scope>("project")
  const [period, setPeriod] = createSignal<UsagePeriod>(1)
  const [loading, setLoading] = createSignal(true)
  const [progress, setProgress] = createSignal("Preparing…")
  const [error, setError] = createSignal("")
  const [summary, setSummary] = createSignal<UsageSummary>(emptySummary())
  const [reload, setReload] = createSignal({ revision: 0, force: false })
  const refresh = (force: boolean) => setReload((value) => ({ revision: value.revision + 1, force }))
  let generation = 0

  createEffect(on(() => [scope(), period(), reload()] as const, ([selectedScope, selectedPeriod, request], previous) => {
    const currentGeneration = ++generation
    const controller = new AbortController()
    onCleanup(() => controller.abort(new Error("Usage request cancelled.")))
    setLoading(true)
    setError("")
    if (!previous || previous[0] !== selectedScope || previous[1] !== selectedPeriod) setSummary(emptySummary())
    setProgress("Preparing…")

    void fetchUsage(props.context, props.sessionID, selectedScope, selectedPeriod, (message) => {
      if (currentGeneration === generation) setProgress(message)
    }, controller.signal, (result) => {
      if (currentGeneration === generation) setSummary(result)
    }, { force: !!previous && previous[2] !== request && request.force })
      .then((result) => {
        if (currentGeneration === generation) {
          setSummary(result)
          setError(result.errors.join("\n"))
        }
      })
      .catch((cause) => {
        if (currentGeneration === generation) setError(cause instanceof Error ? cause.message : String(cause))
        controller.abort(cause)
      })
      .finally(() => {
        if (currentGeneration === generation) setLoading(false)
      })
  }))

  onCleanup(() => { generation++ })

  const theme = () => props.context.theme
  const muted = () => theme().text.muted ?? theme().text.base
  const border = () => theme().border?.base ?? muted()
  const totalInput = () => summary().input + summary().cacheRead + summary().cacheWrite
  const cacheHit = () => {
    const input = summary().input + summary().cacheRead + summary().cacheWrite
    return input > 0 ? `${Math.round((summary().cacheRead / input) * 100)}%` : "—"
  }
  const table = createMemo(() => {
    const headers = ["Provider / Model", "IN", "OUT", "CH", "Cost (USD)", "Steps"]
    const rows = summary().models.map(([model, usage]) => {
      const input = usage.input + usage.cacheRead + usage.cacheWrite
      return [
        model,
        formatTokens(input),
        formatTokens(usage.output),
        input > 0 ? `${Math.round((usage.cacheRead / input) * 100)}%` : "—",
        formatCost(usage.cost),
        usage.steps.toLocaleString("en-US"),
      ]
    })
    const total = [summary().completedDays < summary().totalDays ? "Partial total" : "Total", formatTokens(totalInput()), formatTokens(summary().output), cacheHit(), formatCost(summary().cost), summary().steps.toLocaleString("en-US")]
    const widths = headers.map((header, index) =>
      rows.reduce((width, row) => Math.max(width, row[index].length), Math.max(header.length, total[index].length)),
    )
    const formatRow = (cells: string[]) => cells.map((cell, index) =>
      index === 0 ? cell.padEnd(widths[index]) : cell.padStart(widths[index]),
    ).join("  ")
    const header = formatRow(headers)
    return { header, separator: widths.map((width) => "─".repeat(width)).join("  "), rows: rows.map(formatRow), total: formatRow(total), width: header.length }
  })

  return (
    <box flexDirection="column" height={dialogHeight()} paddingX={2} paddingY={dimensions().height < 12 ? 0 : 1}>
      <box flexDirection="row" justifyContent="space-between" gap={2} flexShrink={0}>
        <text fg={theme().text.base}><b>Tokens usage breakdown</b></text>
        <text fg={muted()} onMouseDown={() => props.context.ui.dialog.clear()}>esc close</text>
      </box>
      <scrollbox flexGrow={1} minHeight={0} scrollX focused contentOptions={{ flexDirection: "column", flexShrink: 0 }}>
      <box flexDirection="row" flexWrap="wrap" gap={2} paddingTop={1} flexShrink={0}>
        <text fg={muted()} width={7}>Scope</text>
        <text
          fg={scope() === "project" ? theme().primary : muted()}
          onMouseDown={() => setScope("project")}
        >
          {scope() === "project" ? "[ Current project ]" : "  Current project  "}
        </text>
        <text
          fg={scope() === "all" ? theme().primary : muted()}
          onMouseDown={() => setScope("all")}
        >
          {scope() === "all" ? "[ All projects ]" : "  All projects  "}
        </text>
      </box>
      <box flexDirection="row" flexWrap="wrap" gap={2} paddingTop={1} flexShrink={0}>
        <text fg={muted()} width={7}>Period</text>
        <For each={PERIODS}>
          {(item) => (
            <text fg={period() === item.value ? theme().primary : muted()} onMouseDown={() => setPeriod(item.value)}>
              {period() === item.value ? `[ ${item.label} ]` : `  ${item.label}  `}
            </text>
          )}
        </For>
      </box>

      <Show when={loading()}>
        <box flexDirection="column" paddingY={2} flexShrink={0} alignItems="center" gap={1}>
          <text fg={theme().primary}>Loading daily token usage…</text>
          <text fg={muted()}>{progress()}</text>
          <text fg={muted()}>You can change the scope or period while loading.</text>
        </box>
      </Show>
      <Show when={error()}>
        <box flexDirection="column" paddingY={2} flexShrink={0} gap={1}>
          <text fg={theme().error}><b>{summary().totalDays > 0 ? "Incomplete usage statistics" : "Could not fetch usage statistics"}</b></text>
          <text fg={muted()}>{error()}</text>
          <text fg={theme().primary} onMouseDown={() => refresh(false)}>Retry missing days</text>
        </box>
      </Show>
      <Show when={summary().completedDays > 0 || (!loading() && !error())}>
        <box flexDirection="column" paddingTop={1} flexShrink={0}>
          <box flexDirection="row" justifyContent="space-between" flexWrap="wrap" gap={1} paddingTop={1}>
            <text fg={theme().text.base}><b>Models · {summary().models.length}</b></text>
            <text fg={muted()}>{summary().sessions !== undefined ? `${summary().sessions} sessions · ` : ""}{summary().steps} steps</text>
          </box>
          <text fg={muted()}>{summary().completedDays}/{summary().totalDays} day slices · {summary().cacheHits} cached · As of {new Date(summary().asOf).toLocaleString("en-US")}</text>
          <Show when={summary().models.length === 0}>
            <box flexDirection="column" paddingY={2} alignItems="center" gap={1}>
              <text fg={theme().text.base}>{summary().completedDays < summary().totalDays ? "No token usage in the loaded days" : "No token usage"}</text>
              <text fg={muted()}>Choose a longer period or all projects.</text>
            </box>
          </Show>
          <Show when={summary().models.length > 0}>
           <box flexDirection="column" paddingTop={1} width={table().width} flexShrink={0}>
             <text fg={muted()} wrapMode="none" height={1} width={table().width} flexShrink={0}><b>{table().header}</b></text>
             <text fg={border()} wrapMode="none" height={1} width={table().width} flexShrink={0}>{table().separator}</text>
             <For each={table().rows}>
               {(line) => <text fg={theme().text.base} wrapMode="none" height={1} width={table().width} flexShrink={0}>{line}</text>}
              </For>
              <text fg={border()} wrapMode="none" height={1} width={table().width} flexShrink={0}>{table().separator}</text>
              <text fg={theme().primary} wrapMode="none" height={1} width={table().width} flexShrink={0}><b>{table().total}</b></text>
          </box>
          </Show>
        </box>
      </Show>
       <box flexDirection="column" marginTop={1} flexShrink={0}>
         <text fg={muted()}>IN includes cache · OUT includes reasoning</text>
       </box>
      </scrollbox>
      <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
        <text fg={muted()}>↑↓ / ←→ scroll</text>
        <text fg={theme().primary} onMouseDown={() => refresh(true)}>Refresh</text>
      </box>
    </box>
  )
}

function showUsageDialog(context: any, sessionID: string) {
  context.ui.dialog.show(() => <UsageDialog context={context} sessionID={sessionID} />)
  context.ui.dialog.set({ size: "large", centered: true })
}

function TokenStatus(props: { context: any; sessionID?: string }) {
  const [revision, refresh] = createSignal(0)

  createEffect(on(() => props.sessionID, (sessionID) => {
    if (!sessionID) return

    let active = true
    const stop = props.context.data.on("session.execution.succeeded", (event: { data: { sessionID: string } }) => {
      if (event.data.sessionID !== sessionID) return

      props.context.data.session.invalidate(sessionID)
      void props.context.data.session.sync(sessionID)
        .then(() => {
          if (active) refresh((value) => value + 1)
        })
        .catch(console.error)
    })

    onCleanup(() => {
      active = false
      stop()
    })
  }))

  const label = () => {
    revision()
    if (!props.sessionID) return

    const tokens = props.context.data.session.get(props.sessionID)?.tokens
    if (!tokens) return

    const input = tokens.input ?? 0
    const output = (tokens.output ?? 0) + (tokens.reasoning ?? 0)
    const cacheRead = tokens.cache?.read ?? 0
    const cacheWrite = tokens.cache?.write ?? 0
    const totalInput = input + cacheRead + cacheWrite
    if (totalInput + output === 0) return

    const cacheHit = totalInput > 0 ? `${Math.round((cacheRead / totalInput) * 100)}%` : "—"
    return `IN ${formatTokens(totalInput)} · OUT ${formatTokens(output)} · CH ${cacheHit}`
  }

  const open = (event: MouseEvent) => {
    if (event.button !== 0 || !props.sessionID) return
    // Open after release so the initiating click cannot dismiss the new overlay.
    event.stopPropagation()
    event.preventDefault()
    showUsageDialog(props.context, props.sessionID)
  }

  return <text fg={props.context.theme.text.base} onMouseUp={open}>{label()}</text>
}

export default Plugin.define({
  id: "opencodelog.tokenstat",
  setup(context) {
    context.keymap.layer(() => ({
      commands: [
        {
          id: "opencodelog.tokenstat.show",
          title: "Tokenstat: Show token usage",
          description: "View token usage by model for the current project or all projects.",
          group: "Tokenstat",
          bind: "<leader>shift+s",
          palette: true,
          slash: { name: "tokenstat" },
          enabled: () => context.ui.router.current().type === "session",
          run: () => {
            const route = context.ui.router.current()
            if (route.type !== "session") return
            showUsageDialog(context, route.sessionID)
          },
        },
      ],
      bindings: ["opencodelog.tokenstat.show"],
    }))

    return context.ui.slot({
      append: "prompt.footer.status",
      render: (props) => <TokenStatus context={context} sessionID={props.sessionID ?? (props as any).session_id} />,
    })
  },
})
