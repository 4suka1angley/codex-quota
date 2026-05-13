# Codex Quota

Shows current Codex ChatGPT plan quota in the VS Code status bar.

The extension reads local Codex ChatGPT auth from `~/.codex/auth.json` and calls the same ChatGPT backend usage endpoint used by the official Codex usage view. Tokens are kept in memory only and are never logged.

## Settings

- `codexQuota.pollIntervalSeconds`: refresh interval in seconds. Default: `60`.
- `codexQuota.codexHome`: optional Codex home path. Defaults to `CODEX_HOME`, then `~/.codex`.
- `codexQuota.codexExecutablePath`: optional Codex executable path for token refresh through `codex app-server`.

## Commands

- `Codex Quota: Refresh Codex Quota`

## Install from GitHub Release

Download `codex-quota-0.0.1.vsix` from the latest GitHub Release, then run:

```sh
code --install-extension codex-quota-0.0.1.vsix
```

## License

MIT. See [LICENSE](LICENSE).

Forks and modifications are allowed under the MIT License. Changes are merged
into the main repository only after maintainer review and approval.
