# Aplanatic IServ CLI

Private, unofficial command-line access to the normal-user features of an
IServ instance. It does not require or attempt to obtain administrator rights.

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
Use `--json` for machine-readable output. The real instance URL must never be
added to this repository, logs, fixtures, screenshots, or issues.

This software is not affiliated with or endorsed by IServ GmbH.
