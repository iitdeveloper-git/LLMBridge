# Requirements → verification matrix (v1.0.0)

Legend — **U**: unit test against a real local HTTP server (no real provider) · **H**: Extension Development Host test on VS Code 1.140.0
(real `vscode.lm` API, mock HTTP server) · **S**: scripted lifecycle (`scripts/verify-vsix-lifecycle.sh`) · **M**: manual steps required · **—**: not verified.

| # | Requirement | Verification | Where |
|---|---|---|---|
| 2 | API verified; min version documented (1.104.0) | Types diffed across @types/vscode 1.103 vs 1.104 (`registerLanguageModelChatProvider` first appears in 1.104) | README, package.json `engines`, `@types/vscode` pinned 1.104.0 |
| 3 | Built-in Custom Endpoint inspected; only gaps implemented | Docs review (not a test) | README "How this relates…" |
| 4 | `contributes.languageModelChatProviders` + `registerLanguageModelChatProvider` | H | `extension.test.ts` manifest + models-exposed tests |
| 5 | Adapters: OpenAI chat / Responses / Azure v1 / Azure legacy / Ollama | U (URL, auth, body, stream, non-stream per adapter) | `basics.test.ts`, `network.test.ts` |
| 6 | Connection mgmt, discovery + manual fallback, connection test, inference test, stable IDs, redacted diagnostics, secret-free import/export | U (discovery, fallback, ids, export/import, tests); H (stable ids via native API). **Command UI flows (QuickPick/InputBox wizards) are not automated — M.** | `basics.test.ts`, `network.test.ts`, `extension.test.ts` |
| 7 | SecretStorage; no credential to unapproved destination; no TLS disable; no secret logging | U (binding, cross-origin redirect, header denylist, redaction, SecretStorage wrapper with fake store); lint rule bans `rejectUnauthorized`; H (workspace endpoints ignored). **Real OS keychain not exercised — M.** | `network.test.ts` "credential safety", `basics.test.ts` |
| 8 | Streaming, non-streaming, cancel, timeouts, retries, errors | U; H (stream, cancel, HTTP error surfaced) | `network.test.ts`, `extension.test.ts` |
| 9 | Tool calling via VS Code interfaces only | U (round trip, all adapters); H (`LanguageModelToolCallPart` out, `ToolResultPart` in). No tool is executed by the extension. **Agent-mode UI end-to-end — M.** | tests above |
| 10 | Copilot preserved; no auto model selection | H (sentinel `github.copilot.*` settings byte-equal; only own-namespace keys written); S (install/uninstall leave settings identical); code audit: only `iitdeveloperLlmBridge.endpoints` is written. **Real Copilot Chat loaded alongside — NOT verified (see limits). Disable-in-UI not automated.** | `extension.test.ts`, lifecycle script |
| 11 | Unique ids/namespaces | H (manifest asserts every command/setting/vendor is namespaced) | `extension.test.ts` |
| 12 | No Copilot dependency; graceful absence | H (manifest has no `extensionDependencies`, no "copilot" string); runs where Copilot is absent | `extension.test.ts` |
| 13 | Listed test areas | U: URL, auth, redaction, discovery, manual fallback, stable IDs, streaming, **split UTF-8/SSE (every byte boundary + byte-by-byte + 3-byte network chunks)**, tool round trips, cancellation, timeouts (connect + idle), retries, credential binding, cross-origin redirects | `test/unit/*` |
| 14 | typecheck, lint, unit, integration, build, EDH tests, install/uninstall | `npm run verify`, `npm run test:integration`, lifecycle script | see report |
| 15 | Local VSIX, no Marketplace publish | `llm-bridge-ai-1.0.0.vsix` | repo root |

## Known limits / not verified

- **Real providers**: no test used OpenAI, Azure or Ollama. All protocol behavior is verified against mock servers written from the public wire formats. Run **Test Inference** against yours.
- **Real GitHub Copilot Chat alongside LLM Bridge**: Copilot Chat 0.68.0 is built into this VS Code (1.140) but does not load in the automated test host, so that test is *skipped*. Manual: sign in to Copilot, add an endpoint, confirm Copilot models, inline completions and your selected model are unchanged and your model appears under its own group in the picker.
- **Agent mode with custom models**: only the provider side (tool calls out, results in) is verified. Whether a particular model behaves well in Agent mode is model-dependent.
- **Native UI**: command wizards, the picker's management gear, the notifications and modal import review were not driven by automation.
- Token counts are heuristic. Tool-calling and vision are never auto-detected: declare them per model.
- Default VS Code behavior: if no other chat model is available, VS Code itself may pick a third-party model as the Chat default (observed in the sandbox log). LLM Bridge never writes a model-selection setting.

- **Strict-server compatibility**: `scripts/check-wire-schema.sh` validates generated Chat Completions and Responses bodies against OpenAI's typed schemas (the kind servers such as vLLM validate with). It is a schema check, not a test against a real vLLM server.

- **Hosts tested** (same Extension Development Host suite): VS Code 1.140.0, 1.130.0 (15 pass, 1 skipped: Copilot coexistence); 1.120.0, 1.107.0, 1.104.0 and Antigravity IDE 2.5.5 (14 pass, 2 skipped: Copilot coexistence, and cancellation propagation, which VS Code before 1.130 does not provide to providers). `VSCODE_VERSION=1.107.0 npm run test:integration` or `VSCODE_EXEC=<path to the app's Electron binary>` selects the host.
