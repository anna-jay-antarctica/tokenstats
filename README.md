# tokenstat

OpenCode TUI plugin that displays cumulative token usage for the active session in the prompt footer:

```text
IN 12,345 · OUT 1,234 · CH 82%
```

The counter stays hidden until the current session has token usage. `IN` includes input, cache reads, and cache writes. `OUT` includes generated output and reasoning tokens. `CH` (cache hit) is cache-read tokens divided by all input and cache tokens. Values depend on usage reported by the provider.

The OpenCode TUI plugin API does not expose a slot inside the built-in agent/model/provider label, so tokenstat uses `prompt.footer.status` beside the composer.

![tokenstat in the OpenCode prompt footer](https://raw.githubusercontent.com/anna-jay-antarctica/tokenstats/main/docs/screenshot.png)

## Install

```sh
opencode plugin add opencode-tokenstat
```

To pin a release, use `opencode plugin add opencode-tokenstat@0.1.2` after publishing that version.

## Local development

From this repository, copy the plugin into the project-local discovery directory:

```sh
npm run dev:copy
```

OpenCode discovers `.opencode/plugins/tokenstat/` automatically. The no-op server entrypoint does not need `@opencode/plugin` at runtime; the TUI entrypoint imports `@opencode/plugin/tui`, which OpenCode resolves for local CLI plugins. For local type checking, install dependencies with `npm install`. Run `npm run dev:copy` again after editing the plugin files; if the TUI does not reload the plugin automatically, restart OpenCode. The `.opencode/` directory is git-ignored.

The plugin appears in both server and TUI plugin views by design: `index.ts` is a no-op server entrypoint needed for automatic TUI loading, while `tui.tsx` renders the token counter. These are two entrypoints of the same local package, not two copies of the UI.
