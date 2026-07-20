# Changelog

## 0.6.16

- `files ls --json` returns `{ path, items: [...] }` (not a bare array)
- `help show [topic]` shows CLI help for a command (e.g. `help show routes`)
- Cap `timeoutSeconds` / `--timeout` at 300 seconds

## 0.6.15

- Messenger rooms/sync/status flatten last message in the CLI (no `[object Object]`)
- `messenger send` accepts optional room + local `--dry-run` / `--what-if`
- Bash completion finds the command after global flags; re-source after upgrade
- `config show` Env lists effective `ISERV_HOST` from config when unset in the environment
- Corrupt config still reports `Config file corrupted (…)` (0.6.14)

## 0.6.14

- Corrupt `config.json` / `.iserv.json` → clear "Config file corrupted" (no raw SyntaxError)
- Messenger last-message hardening (never `[object Object]` in tables)
- `config show` includes `resolved.host` (config file vs env source)
- (0.6.13) dry-run send without room; nested bash/zsh completion — re-source `iserv completion bash`

## 0.6.13

- Fix messenger rooms/sync Last column (`[object Object]` → message body)
- `messenger send --dry-run` works without a room argument
- Clearer `files ls` errors for WebDAV 401/403 (student / no password)
- `config set host=` validates via `normalizeInstanceUrl`
- Bash/zsh completion suggests subcommands (`timetable show`, …)

## 0.6.12

- Mail `--attachment` / `--html-body`; `~` and absolute attachment paths
- `files ls` WebDAV listing; `messenger create-direct`
- `auth login --password-stdin` / `--ephemeral`; `logout --all` / `profile remove --all`
- Global `--dry-run` / `--what-if` for write commands
- Documented env vars in `--help`; clearer `--browser` (system Chrome/Edge, no Playwright download)
- Notes: SMTP stays on IServ host ports 465/587 by design

## 0.6.11

- File-lock + `.bak` backup for `profiles.json`
- `--idempotency-key` for mail/messenger send (dedupe retries)
- `routes serve --port` (still loopback + token auth)
- Defaults standardized to `--limit 25`
- `whatsnew`, `doctor`, `config`, `completion`
- `--portable`, `.iserv.json` project config, mail `--offset`
- Mail list documents ~200 server page size

## 0.6.10

- Global `--timeout <seconds>` (sets `ISERV_TIMEOUT_MS`; default 30s via API)
- Debug stacks are path-redacted; suppressed entirely with `--json`
- Clear HTTP 429 errors with limited retries (API)
- Distinct `Aplanatic-IServ` User-Agent product token
- `--json --help` emits structured JSON
- Write results use `{ ok, action, … }` envelope
- `ISERV_HOST` / `ISERV_URL` for login host
- Mail `--to`/`--cc`/`--bcc` repeatable; messenger send accepts room name

## 0.6.9

- `auth login` requires a TTY (no interactive prompts / ANSI in pipes)
- Validate `--url` before prompting; reject path-like / invalid hostnames
- `iserv --version --json` → `{"name":"@aplanatic/iserv-cli","version":"…"}`
- Global `--debug` / `--verbose` (sets `ISERV_DEBUG=1`, prints stacks on errors)
- `timetable show --end <date>` for custom ranges

## 0.6.8

- Writes require `--confirm` (including `auth logout`); no `ISERV_ALLOW_WRITES` bypass
- Dashed search queries: `--query=--json` or `search -- "--json"`
- Help/success exit codes fixed; `messenger sync` restored; print/files aliases

## 0.6.7

- Write gates, timetable today, and earlier QA hardening

## 0.6.5

- JSON errors on stdout, single headers, drop dead module commands

## 0.6.4

- Add `messenger contacts`

## 0.6.3

- Add `calendar holidays` countdown command

## 0.6.2

- Valid JSON for `probe-many` and stricter CLI validation

## 0.6.1

- Project command results into readable tables

## 0.6.0

- Render real tables for every command
