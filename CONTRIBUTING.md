# Contributing

Thanks for helping! Quick start:

```bash
npm install
npm run verify            # typecheck + lint + unit tests + production build
npm run test:integration  # Extension Development Host tests (needs VS Code)
```

## Guidelines
- Keep `src/core` free of any `vscode` import so it stays unit-testable.
- New protocol behavior needs unit tests against a local HTTP server (see `test/unit/network.test.ts`).
- Never log prompts, code, responses or secrets. Never disable TLS verification (lint enforces it).
- Do not touch settings or credentials outside the `iitdeveloperLlmBridge` namespace.
- Say honestly what you tested: mock server, Extension Development Host, or a real provider.

## Pull requests
Branch from `main`, keep changes focused, make sure `npm run verify` passes, and describe how you tested.
