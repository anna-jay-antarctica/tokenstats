# Changelog

## 0.2.0

### Added

- **Tokens usage breakdown** dialog, opened by clicking the session token counter.
- Usage aggregation by model for the current project or all projects over 24 hours, 7 days, or 30 days.
- Aligned model table with IN, OUT, cache hit, USD cost, message count, and a highlighted Total row.
- Terminal-height-aware layout with vertical and horizontal scrolling.
- **Tokenstat: Show token usage** in the command palette, `/tokenstat`, and the default `<leader>shift+s` shortcut.
- Loading progress, empty and error states, refresh, and retry actions.

### Changed

- Token counts use compact K/M/G notation throughout the plugin.
- Costs are displayed to two decimal places.
- All dialog labels and messages are in English.

### Fixed

- Model grouping uses the API's `model.id` field, with a fallback for `model.modelID`.
- Opening the dialog on mouse release prevents the initiating click from dismissing it.
