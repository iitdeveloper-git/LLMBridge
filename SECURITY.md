# Security Policy

LLM Bridge handles API keys, so please report vulnerabilities privately.

## Reporting a vulnerability

Do **not** open a public issue. Use GitHub's **Security → Report a vulnerability** (private advisory) on this repository.
Include the version, VS Code version, steps to reproduce, and impact. Do not include real API keys.

We aim to acknowledge reports within 7 days.

## Supported versions

Only the latest release receives security fixes.

## Security model (summary)

- API keys are stored only in VS Code `SecretStorage`, bound to the origin they were entered for.
- Endpoints are read from user settings only; workspace settings are ignored.
- Cross-origin redirects are never followed and credentials are never sent to them.
- Custom headers cannot carry credentials; TLS verification is never disabled.
- Logs are redacted and never include prompts, code or model output.

Reports that bypass any of the above are in scope.
