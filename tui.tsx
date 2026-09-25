import { Plugin } from "@opencode/plugin/tui"

function formatTokens(value: number) {
  return Math.round(value).toLocaleString()
}

function TokenStatus(props: { context: any; sessionID?: string }) {
  const label = () => {
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
