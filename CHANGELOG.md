# Changelog

## 0.2.1

### Added

- **Current month** period, from the first day of the month at local midnight to the current snapshot, using the shared daily cache.
- A persistent daily usage cache shared by every workspace and TUI process for the same OS user, with isolated server/database and project scopes.
- Sequential daily aggregate requests with tool statistics disabled, replacing full-message scans.
- Atomic cache writes, per-server disk locking, one-minute live snapshots, and 24-hour historical-day expiry.
- Progressive results, explicit Partial total rows, loaded/cached day counts, and Retry missing days.
- Automated tests for cache sharing, isolation, daily boundaries, expiry, request serialization, failures, and cancellation.

### Changed

- The table displays the statistics API's Steps count instead of downloaded message counts.
- Session counts are shown only for single daily intervals, avoiding double-counting across days.
- Refresh forces a reload; Retry preserves successful cached days.

### Fixed

- Usage requests time out after 30 seconds per API call instead of leaving the dialog loading indefinitely.
- Reject incompatible API responses instead of caching them as successful results.
- Cancel in-flight requests when closing the dialog, changing filters, or refreshing.
- All-project summaries no longer require fetching the active session first.
- Only filter changes and explicit refreshes restart aggregation, not reactive session-cache updates.

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
