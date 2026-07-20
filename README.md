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

Human output and debug errors are redacted before display. The real instance URL
must never be added to this repository, logs, fixtures, screenshots, or issues.

This software is not affiliated with or endorsed by IServ GmbH.
