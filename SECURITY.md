# Security policy

## Supported versions

Security fixes are applied to the latest release and `main`.

## Report privately

Use [GitHub private vulnerability reporting](https://github.com/Aplanatic/iserv-cli/security/advisories/new).
Do not open a public issue for suspected vulnerabilities.

Never include a real instance hostname, username, email address, school name, screenshot,
HAR file, cookie, session, token, password, message, file, or unredacted command output.
Use `iserv.example`, synthetic identities, and mocked payloads in reproductions.

## Security boundaries

- Interactive password and OTP entry stays in secure prompts and is never written to
  `--json` output or logs. Scripts may pass a password only via `--password-stdin` (never
  as a CLI flag or argv string); prefer `--ephemeral` so the password is not retained in
  the keychain.
- Credentials and sessions are stored only in the native operating-system credential store
  (except ephemeral cookie-only sessions).
- Instance targets require HTTPS and are selected by a human during profile creation
  (`--url`, `ISERV_HOST` / `ISERV_URL`, or project config). Path-like hosts are rejected.
- Mutating commands require `--confirm`. `--dry-run` / `--what-if` preview without writing.
- Advanced route calls accept only catalog IDs; there is no arbitrary-URL command.
- Debug and structured output pass through redaction, but users must still treat output from
  authenticated module commands as private account data.

Test only accounts and instances you own or are explicitly authorized to use. Do not send,
modify, upload, join, leave, or delete data while researching a read-path issue without
explicit approval.
