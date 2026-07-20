# Changelog

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
