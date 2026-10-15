# tokenstat

OpenCode TUI plugin that displays cumulative token usage for the active session in the prompt footer:

```text
IN 12.3K · OUT 1.2K · CH 82%
```

The counter stays hidden until the current session has token usage. `IN` includes input, cache reads, and cache writes. `OUT` includes generated output and reasoning tokens. `CH` (cache hit) is cache-read tokens divided by all input and cache tokens. Values depend on usage reported by the provider.

Click the counter to open token usage by model. The dialog can summarize the current project or all projects for the last 24 hours, 7 days, or 30 days. It shows a loading status while sessions and messages are fetched and summed.

While viewing a session, you can also open the dialog with **Ctrl+X, then Shift+S** (or your configured leader followed by Shift+S), select **Tokenstat: Show token usage** from **Ctrl+P**, or run **`/tokenstat`**. These actions work even when the session has no token usage yet. The shortcut avoids Ctrl+Alt+S, which can conflict with AltGr+S (`ś`) on Polish keyboards. To use that shortcut instead, set `"opencodelog.tokenstat.show": "ctrl+alt+s"` under `keybinds` in your global `cli.json`.

The English-language dialog provides scope and period filters above the model usage table. Its height adapts to the terminal, including when resized. The body scrolls with the arrow keys or mouse wheel, keeping filters, totals, and all models accessible even in short terminals; the title and refresh action remain visible. Models show names, providers, message counts, and costs, ordered by total token usage. A highlighted Total row below the models summarizes IN, OUT, cache hit, cost, and messages; the overall cache hit is calculated from total cache reads and total input, not averaged across models. Click **Refresh** to refresh or **Retry** after an error; press **Esc** to close. Colors follow the active OpenCode theme.

The OpenCode TUI plugin API does not expose a slot inside the built-in agent/model/provider label, so tokenstat uses `prompt.footer.status` beside the composer.

Models are displayed in a table with column names only in the header: Provider / Model, IN, OUT, CH, Cost (USD), and Messages. Token counts remain compact; message counts remain integers. Each model occupies one non-wrapping row, with numeric columns right-aligned. Costs are displayed to two decimal places in both the table and summary. Scroll horizontally to see the full table in narrow terminals.

![tokenstat in the OpenCode prompt footer](https://raw.githubusercontent.com/anna-jay-antarctica/tokenstats/main/docs/screenshot.png)

## Install

```sh
opencode plugin add opencode-tokenstat
```

To pin this release, use `opencode plugin add opencode-tokenstat@0.2.0` once it is published.

## Version 0.2.0

- Responsive **Tokens usage breakdown** dialog with project and time-period filters.
- Per-model usage table with a Total row, compact token counts, and two-decimal USD costs.
- Keyboard shortcut, command palette entry, and `/tokenstat` command.
- Correct model identification, loading and error states, refresh, and retry.

See [CHANGELOG.md](./CHANGELOG.md) for release details.

## Local development

From this repository, copy the plugin into the project-local discovery directory:

```sh
npm run dev:copy
```

OpenCode discovers `.opencode/plugins/tokenstat/` automatically. The no-op server entrypoint does not need `@opencode/plugin` at runtime; the TUI entrypoint imports `@opencode/plugin/tui`, which OpenCode resolves for local CLI plugins. For local type checking, install dependencies with `npm install`. Run `npm run dev:copy` again after editing the plugin files; if the TUI does not reload the plugin automatically, restart OpenCode. The `.opencode/` directory is git-ignored.

The plugin appears in both server and TUI plugin views by design: `index.ts` is a no-op server entrypoint needed for automatic TUI loading, while `tui.tsx` renders the token counter. These are two entrypoints of the same local package, not two copies of the UI.
