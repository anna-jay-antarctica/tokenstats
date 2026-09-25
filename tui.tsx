/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createSignal, on, onCleanup } from "solid-js"

function formatTokens(value: number) {
  return Math.round(value).toLocaleString()
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
    if (!props.sessionID) return "IN — · OUT — · CACHE —"

    const tokens = props.context.data.session.get(props.sessionID)?.tokens
    if (!tokens) return "IN 0 · OUT 0 · CACHE —"

    const input = tokens.input ?? 0
    const output = (tokens.output ?? 0) + (tokens.reasoning ?? 0)
    const cacheRead = tokens.cache?.read ?? 0
    const cacheWrite = tokens.cache?.write ?? 0
    const totalInput = input + cacheRead + cacheWrite
    const cacheHit = totalInput > 0 ? `${Math.round((cacheRead / totalInput) * 100)}%` : "—"

    return `IN ${formatTokens(totalInput)} · OUT ${formatTokens(output)} · CACHE ${cacheHit}`
  }

  return <text fg={props.context.theme.text.base}>{label()}</text>
}

export default Plugin.define({
  id: "opencodelog.tokenstat",
  setup(context) {
    return context.ui.slot({
      append: "prompt.footer.status",
      render: (props) => <TokenStatus context={context} sessionID={props.sessionID ?? props.session_id} />,
    })
  },
})
