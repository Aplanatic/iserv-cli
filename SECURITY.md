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

- Password and OTP entry stays in secure interactive prompts and is never accepted through
  JSON output or logged.
- Credentials and sessions are stored only in the native operating-system credential store.
- Instance targets require HTTPS and are selected by a human during profile creation.
- Advanced route calls accept only catalog IDs; there is no arbitrary-URL command.
- Debug and structured output pass through redaction, but users must still treat output from
  authenticated module commands as private account data.

Test only accounts and instances you own or are explicitly authorized to use. Do not send,
modify, upload, join, leave, or delete data while researching a read-path issue without
explicit approval.
