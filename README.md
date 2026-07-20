# Aplanatic IServ CLI

Unofficial command-line access to the normal-user features of an IServ instance. It does
not require or attempt to obtain administrator rights.

## Install

Configure npm authentication for the Aplanatic GitHub Packages registry, then run:

```sh
npm install --global @aplanatic/iserv-cli
```

Current package version: **0.6.16** (depends on `@aplanatic/iserv-api`).

## Login

```sh
iserv auth login --url iserv.example --profile school --terminal
iserv auth status
```

The terminal flow securely prompts for the password and any detected one-time
code. Use `--browser` when the instance requires WebAuthn, a password change,
or an unfamiliar challenge (uses your installed Chrome/Edge/Chromium via
`ISERV_BROWSER_PATH`; no Playwright browser download). Secrets and session cookies are
stored only in the operating system credential store.

For non-interactive login (CI/scripts), pipe a password and keep the password off disk:

```sh
printf '%s' "$PASS" | iserv auth login --url iserv.example --username u --password-stdin --ephemeral
```

`--ephemeral` stores cookies only (no password in the keychain), so SMTP/WebDAV will not
work until a full login. `iserv auth logout --all` and `iserv profile remove --all` clear
every stored profile.

Set `ISERV_HOST` or `ISERV_URL` when you prefer environment-based host selection.
Run `iserv --help` and `iserv <command> --help` for the complete command tree, including
documented environment variables. `iserv help show [topic]` prints focused topic help
(for example `iserv help show routes`).

## Fast search and agent workflows

Use one ranked search instead of guessing command names:

```sh
iserv search "calendar events" --scope routes --limit 10
iserv search "example student" --scope users --limit 10
iserv routes search message --module messenger --method GET --effect read --status supported
```

`--scope routes` is offline and uses the lightweight catalog entry point. User search uses
the bounded JSON autocomplete endpoint. `--scope all` runs both concurrently and preserves
route results if directory search is temporarily unavailable. Dashed queries need
`--query=--json` or `search -- "--json"`.

Agents invoking the CLI should put `--json` before the command and follow this sequence:

```sh
iserv --json auth status
iserv --json search "calendar events" --scope routes
iserv --json routes probe-many calendar.overview etherpad.list groupview.overview
```

`probe-many` restores the keychain session once and runs up to eight parameterless,
catalogued session GET routes concurrently. It cannot execute writes or arbitrary URLs.
Limits are validated before network work begins.

## Writes and dry-run

Mutating commands require an explicit `--confirm` (including `auth logout`). There is no
`ISERV_ALLOW_WRITES` bypass. Preview intent without network side effects using global
`--dry-run` (or `--what-if`):

```sh
iserv --dry-run mail send --to someone@example.com --subject Hi --body Test
iserv mail send --to someone@example.com --subject Hi --body Test --confirm
```

Successful writes print a `{ ok, action, … }` envelope in `--json` mode.

## Output

Interactive output is designed for people: compact headings, aligned values,
bounded tables, clear empty states, and actionable errors. Color is used only
when stdout is a terminal and can be disabled with `NO_COLOR=1`.

```text
Session
● Connected
Profile  school

Routes matching “calendar”  6
  Method   Id                  Module     Status      Summary
  GET      calendar.upcoming   calendar   supported   List upcoming calendar events
```

Automation remains stable and compact. Put the global option before the command:

```sh
iserv --json auth status
iserv --json routes search calendar
iserv --version --json
```

Use `--debug` / `--verbose` for redacted diagnostics, `--timeout <seconds>` (capped at 300;
sets `ISERV_TIMEOUT_MS`) for request budgets, and `--portable` for machine-friendly plain
text. Project defaults can live in `.iserv.json`.

Verified normal-user module checks have short, memorable commands:

```sh
iserv exercises list
iserv exercises past
iserv timetable show
iserv timetable today
iserv polls list
iserv forums list
iserv news list
iserv news show <id>
iserv courses list
iserv mailing-lists list
iserv print show
iserv etherpads list
iserv groups list
iserv office show
iserv calendar holidays
iserv messenger contacts
```

The focused command groups also cover account/profile, users, notifications, calendar,
files, mail, messenger, videoconference health, app information, groups, and help. Use
`iserv routes tree` for the complete, current route inventory rather than relying on a
static command list.

Useful extras:

```sh
iserv files ls /                                      # WebDAV listing
iserv mail send ... --attachment ~/doc.pdf --html-body '<p>Hi</p>' --confirm
iserv messenger create-direct '@user:matrix.iserv.example' --confirm
iserv doctor                                          # local environment / session health
iserv whatsnew                                        # highlights since the last noted version
iserv config show                                     # show resolved non-secret settings
iserv completion bash                                 # shell completion script (also zsh)
```

Overview and module commands prefer structured loaders when available; otherwise they show
extracted page content (`HtmlExtractedData`) rather than raw HTML. Output never prints
cookies, tokens, or full authenticated HTML documents.

`iserv auth status` shows the verified display name, username, installed modules,
experimental/unavailable integrations, verified read-route counts, and the number of
catalogued write/send/destructive actions. A listed write action is not a promise of
permission: IServ checks the account's rights when that action is actually invoked.

For a local authenticated, read-only production-path check, run
`npm run test:live`. It reports only pass/fail booleans and does not print account
names, room names, messages, hostnames, or response bodies. Normal startup defers the full
SDK, browser prompts, and explorer opener until needed; route-only help, version, and
search paths stay lightweight.

Human output and debug errors are redacted before display. The real instance URL
must never be added to this repository, logs, fixtures, screenshots, or issues.

## Security and contributing

Read [SECURITY.md](SECURITY.md) before reporting a vulnerability and use GitHub private
vulnerability reporting. Never put a real hostname, identity, screenshot, HAR file,
credential, cookie, token, or command output from a live account in an issue or pull
request. See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and sanitization rules.

This software is not affiliated with or endorsed by IServ GmbH.
