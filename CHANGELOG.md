# Changelog

## 1.0.0 — First release

Connect your own LLM endpoints to the native VS Code Chat model picker.

- **Protocols:** OpenAI Chat Completions, OpenAI Responses, Azure OpenAI (v1 and legacy deployments), Ollama's OpenAI-compatible API.
- **Sidebar:** an Activity Bar view with your endpoints and models, API-key status, inline Test / Set Key buttons, right-click actions, and a welcome screen.
- **Models:** automatic discovery with manual fallback, per-model tool-calling toggle (VS Code's Agent mode lists only models with tool calling), vision flag, context sizes.
- **Testing and diagnostics:** Test Connection, Test Inference, and a redacted Diagnostics Log (one line per chat request; prompts and replies are never logged).
- **Security:** API keys in VS Code SecretStorage bound to the endpoint's origin, user-settings-only endpoints, no cross-origin redirects, secret-free export/import.
- **Streaming, cancellation, timeouts, retries**, and tool calls handed to VS Code (VS Code runs the tools and the approvals).
- **No telemetry.** The extension only talks to the endpoints you configure.
