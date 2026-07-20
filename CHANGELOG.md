# Changelog

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
