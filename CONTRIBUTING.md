# Contributing

Contributions must preserve least privilege, stable automation output, and privacy.

- Use only `iserv.example`, `example.invalid`, and synthetic account data.
- Never add live hostnames, identities, screenshots, HAR files, credentials, cookies,
  tokens, response dumps, messages, email, or file contents.
- Do not add arbitrary HTTP, TLS bypasses, plaintext credential storage, admin probing, or
  permission-bypass behavior.
- Keep human output bounded and readable; keep `--json` stable, bounded, and redacted.
- New network operations must use the canonical API catalog and accurate side-effect labels.
- Report vulnerabilities through [SECURITY.md](SECURITY.md), not a public issue.

Run before submitting:

```sh
npm ci
npm run check
npm audit --audit-level=low
gitleaks git --redact=100 --log-opts=--all .
```

Live tests are local-only and read-only. They must never print live response data or
identifiers.
