# Aplanatic IServ CLI

Private, unofficial command-line access to the normal-user features of an
IServ instance. It does not require or attempt to obtain administrator rights.

## Install

Authenticate npm for the private Aplanatic GitHub Packages registry, then run:

```sh
npm install --global @aplanatic/iserv-cli
```

## Login

```sh
iserv auth login --url iserv.example --profile school --terminal
iserv auth status
```

The terminal flow securely prompts for the password and any detected one-time
code. Use `--browser` when the instance requires WebAuthn, a password change,
or an unfamiliar challenge. Secrets and session cookies are stored only in the
operating system credential store.

Run `iserv --help` and `iserv <command> --help` for the complete command tree.

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
```

Verified normal-user module checks have short, memorable commands:

```sh
iserv exercises list
iserv exercises past
iserv timetable show
iserv polls list
iserv forums list
iserv news list
iserv courses list
iserv mailing-lists list
iserv print show
iserv etherpads list
iserv groups list
iserv office show
```

These commands issue only catalogued GET requests. Their default output confirms module
availability and shows non-content-bearing page structure; it never prints authenticated
HTML, form values, account identifiers, or hidden fields.

`iserv auth status` shows the verified display name, username, installed modules,
experimental/unavailable integrations, verified read-route counts, and the number of
catalogued write/send/destructive actions. A listed write action is not a promise of
permission: IServ checks the account's rights when that action is actually invoked.

For a local authenticated, read-only production-path check, run
`npm run test:live`. It reports only pass/fail booleans and does not print account
names, room names, messages, hostnames, or response bodies.

Human output and debug errors are redacted before display. The real instance URL
must never be added to this repository, logs, fixtures, screenshots, or issues.

This software is not affiliated with or endorsed by IServ GmbH.
