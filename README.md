# tokenstat

OpenCode TUI plugin that displays cumulative token usage for the active session in the prompt footer:

```text
IN 12,345 · OUT 1,234 · CACHE 82%
```

`IN` includes input, cache reads, and cache writes. `OUT` includes generated output and reasoning tokens. Cache hit is cache-read tokens divided by all input and cache tokens. Values depend on usage reported by the provider.

The OpenCode TUI plugin API does not expose a slot inside the built-in agent/model/provider label, so tokenstat uses `prompt.footer.status` beside the composer.

## Install

Once published to npm:

```sh
opencode plugin add opencode-tokenstat
```

To pin a release, use `opencode plugin add opencode-tokenstat@0.1.0`.

## Test locally

1. From the project where you want to test, add the absolute plugin directory to `opencode.jsonc`:

   ```jsonc
   {
     "plugins": ["D:/dev/tokenstats"]
   }
   ```

   Preserve any existing configuration and append the path to its `plugins` array.
2. Restart OpenCode (or restart its service) so it reloads plugin configuration.
3. Open a session and send a prompt. The footer should show `IN`, `OUT`, and `CACHE`; the counts update as the provider reports usage.
4. Check startup output if the footer is absent. Ensure the installed OpenCode version supports the current TUI plugin API.

## Publish

Create a public GitHub repository for this project and add its URL to the `repository` field in `package.json`. The package already includes an Apache-2.0 license. Verify the package contents before publishing:

```sh
npm login
npm pack --dry-run
npm publish --access public
```

For later releases, update `version` in `package.json` (for example `npm version patch`) and publish again. The npm package name `opencode-tokenstat` must be available (or owned by your npm account) before the first release.
