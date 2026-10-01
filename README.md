<div align="center">

<img src="media/banner.png" alt="LLM Bridge Banner" width="100%" />

<br/><br/>

# 🌉 LLM Bridge

### *Seamlessly connect custom LLM endpoints to native VS Code Chat & Agent mode*

Developed with ❤️ by **[IITDEVELOPER](https://github.com/iitdeveloper-git)**

[![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.104.0-007ACC?style=for-the-badge&logo=visual-studio-code&logoColor=white)](https://code.visualstudio.com/)
[![Version](https://img.shields.io/badge/version-1.0.0-6366f1?style=for-the-badge)](https://github.com/iitdeveloper-git/LLMBridge/blob/main/package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald?style=for-the-badge)](https://github.com/iitdeveloper-git/LLMBridge/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Keys](https://img.shields.io/badge/Keys-SecretStorage-success?style=for-the-badge&logo=shield)](#️-security--privacy-first)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4?style=for-the-badge)](#-contributing)

<br/>

[🚀 Quick Start](#-quick-start) •
[✨ Key Features](#-key-features) •
[📊 Why LLM Bridge?](#-why-llm-bridge-vs-built-in) •
[🏗️ Architecture](#️-architecture) •
[🌐 Supported Protocols](#-supported-protocols) •
[🛡️ Security Model](#-security--privacy-first) •
[⌨️ Commands](#️-command-palette) •
[🛠️ Development](#️-local-development)

<br/>

</div>

---

Connect your own self-hosted or enterprise LLM endpoints directly to the **native VS Code Chat model picker** using the official [Language Model Chat Provider API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider).

> [!NOTE]
> **Additive by design:** LLM Bridge registers its own independent vendor (`iitdeveloper-llm-bridge`). It **never** reads, writes, or intercepts GitHub Copilot settings, credentials, telemetry, or completions. Zero Copilot lock-in or dependency.

---

## ✨ Key Features

| Feature | Highlight |
| :--- | :--- |
| 🎯 **Native Experience** | Zero custom webviews or chat tabs. Appears right inside VS Code's native Chat dropdown & Agent Mode. |
| 🧭 **Sidebar** | An Activity Bar view with your endpoints and models, key status, and one-click Test / Set Key / Discover / Toggle Tool Calling. |
| 🔐 **Origin-Bound Vault** | API keys live solely inside VS Code's encrypted `SecretStorage`, strictly bound to the target origin URL. |
| ⚡ **One-Click Discovery** | Automatic `/models` endpoint discovery with fallback to manual model and context sizing. |
| 🧪 **In-Editor Diagnostics** | Real-time connection and inference smoke tests with zero prompt or output leakage. |
| 🦙 **Broad Compatibility** | Speaks the **OpenAI Chat Completions** and **Responses** formats plus **Azure OpenAI (v1 & Legacy)** and **Ollama**'s OpenAI-compatible API. Servers such as vLLM or LocalAI should work if they follow the OpenAI format; verify with *Test Inference*. |
| 📦 **Safe Export/Import** | Share endpoint configurations across your team with automatic credential stripping. |

---

## 📊 How this relates to VS Code's built-in Custom Endpoint

Recent VS Code versions include a built-in Custom Endpoint provider (`chatLanguageModels.json`) for Chat Completions, Responses and Anthropic Messages. **If that is enough for you, use it.** LLM Bridge is for what it does not cover:

- **Azure OpenAI** v1 and legacy deployments, and an **Ollama** setup flow
- **Model discovery** with a manual fallback, plus **connection and inference tests** from the editor
- **Origin-bound credentials**: a stored key is only ever sent to the origin it was entered for
- **User-settings-only endpoints**: workspace settings cannot redirect your key
- **Redacted diagnostics** and **secret-free export/import**

> This is not a feature-by-feature comparison with the built-in provider, which changes between VS Code releases.

---

## 🏗️ Architecture

```mermaid
flowchart LR
    subgraph VSCode["🖥️ VS Code IDE"]
        ChatUI["💬 Native Chat UI / Agent Mode"]
        LM_API["🔌 LanguageModelChatProvider API"]
        Picker["📋 Model Picker Dropdown"]
        ChatUI <--> LM_API
        LM_API <--> Picker
    end

    subgraph Bridge["🌉 LLM Bridge Extension"]
        Router["⚡ Request Router & Streamer"]
        Secrets[("🔐 SecretStorage (Origin-Locked)")]
        Diag["🩺 Redacted Diagnostics"]
        Router --- Secrets
        Router --- Diag
    end

    subgraph Providers["☁️ LLM Endpoints"]
        Ollama["🦙 Ollama (Local)"]
        VLLM["🚀 vLLM / LocalAI"]
        Azure["🔷 Azure OpenAI (v1 / Legacy)"]
        OpenAI["🟢 OpenAI API"]
    end

    LM_API <==>|"Streaming / Tool Calling"| Router
    Router <==>|"HTTP/S (SSE)"| Ollama
    Router <==>|"HTTP/S (SSE)"| VLLM
    Router <==>|"HTTP/S (SSE)"| Azure
    Router <==>|"HTTP/S (SSE)"| OpenAI

    style Bridge fill:#1e1e2e,stroke:#6366f1,stroke-width:2px,color:#fff
    style VSCode fill:#181825,stroke:#007acc,stroke-width:2px,color:#fff
    style Providers fill:#11111b,stroke:#10b981,stroke-width:2px,color:#fff
```

---

## 🧭 The Sidebar

Click the **LLM Bridge** (lotus) icon in the Activity Bar. You get:

- A tree of your **endpoints** and their **models**, with an API-key status icon (✔ set · 🔑 missing · ⛔ saved for a different origin).
- **Inline buttons** on each endpoint: *Test Connection* and *Set API Key*. Right-click for Test Inference, Discover Models, Add Model, Clear Key, Remove.
- A title bar with **Add Endpoint**, **Refresh**, and a `…` menu for Import / Export / Edit settings / Diagnostics Log.
- A welcome screen with **Add Endpoint** and **Import Configuration** when you have none yet.

Every action is also available from the Command Palette (`LLM Bridge: …`).

---

## 🚀 Quick Start

### 1️⃣ Add an endpoint
Click the **LLM Bridge** (lotus) icon in the Activity Bar and press **+**, or run `LLM Bridge: Add Endpoint` from the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).

### 2️⃣ Configure and authenticate
Choose the protocol, a name, and the **base URL** (e.g. `https://my-server.example.com/v1`, without `/chat/completions`), then enter your API key if the server needs one. Keys go to VS Code's `SecretStorage`. The wizard also asks whether the models support **tool calling**: answer *Yes* only if you know they do (VS Code's Agent mode lists only such models).

### 3️⃣ Check it works
In the sidebar, click **Test Connection**, then **Test Inference** on a model. If the server has no `/models` endpoint, use **Add Model Manually**.

### 4️⃣ Chat
Open the Chat panel (`Ctrl+Alt+I` / `Cmd+Ctrl+I`), open the model dropdown, and choose your model. Then run **LLM Bridge: Show Diagnostics Log** to confirm the request reached your server. See [My model is not in the model picker](#-my-model-is-not-in-the-model-picker) if it is missing.

---

## 🌐 Supported Protocols

| Protocol | Base URL Example | Auth Scheme | Discovery Endpoint |
| :--- | :--- | :---: | :---: |
| `ollama` | `http://localhost:11434/v1` | *None* | `/models` |
| `openai-chat` | `https://api.openai.com/v1` | `Bearer <token>` | `/models` |
| `openai-responses` | `https://api.openai.com/v1` | `Bearer <token>` | `/models` |
| `azure-openai-v1` | `https://RESOURCE.openai.azure.com/openai/v1` | `api-key` or Entra Bearer | `/models` |
| `azure-openai-legacy` | `https://RESOURCE.openai.azure.com` | `api-key` header | *Manual Deployment Entry* |

<details>
<summary><b>📝 Example settings.json configuration</b></summary>

```jsonc
// User Settings (settings.json)
{
  "iitdeveloperLlmBridge.endpoints": [
    {
      "id": "my-local-ollama",
      "name": "Ollama Local",
      "protocol": "ollama",
      "baseUrl": "http://localhost:11434/v1",
      "autoDiscover": true
    },
    {
      "id": "enterprise-vllm",
      "name": "Internal vLLM Cluster",
      "protocol": "openai-chat",
      "baseUrl": "https://llm.corp.internal/v1",
      "models": [
        {
          "id": "qwen2.5-coder-32b",
          "name": "Qwen 2.5 Coder 32B",
          "maxInputTokens": 131072,
          "maxOutputTokens": 8192,
          "toolCalling": true,
          "vision": false
        }
      ]
    }
  ]
}
```
</details>

---

## 🛡️ Security & Privacy-First

Security is baked into LLM Bridge by design, not bolted on as an afterthought:

> [!IMPORTANT]
> **Origin-Locked Secrets:** API keys are cryptographic pairs tied to the exact origin (`protocol + host + port`) entered. If a settings sync or imported configuration alters the base URL, the key is automatically disabled until manually confirmed.

> [!CAUTION]
> **Anti-Hijack Workspace Isolation:** Settings are strictly loaded from **User-level configuration (`globalValue`)**. Untrusted cloned repositories cannot override endpoints or hijack your secrets.

- **🚫 Zero Redirect Key Leakage:** Cross-origin redirects are never followed with authorization headers. Non-307/308 POST redirects are explicitly rejected.
- **🔒 TLS Enforcement:** TLS certificate verification can never be disabled for remote hosts. Insecure plain `http://` is restricted to loopback interfaces (`localhost`, `127.0.0.1`).
- **🩺 Redacted Logs:** The diagnostics log records only metadata: model, endpoint path, message and tool counts, status and timing. **Your prompts, file contents, code, and replies are never logged or stored.**

---

## 🔏 Privacy

- **No telemetry.** LLM Bridge has no analytics code and no runtime dependencies.
- **It only talks to the endpoints you configure.** There is no IIT DEVELOPER server. With a local model (e.g. `http://localhost:11434/v1`) your prompts never leave your computer.
- Choosing a different model in the Chat dropdown (e.g. Copilot *Auto*) sends that chat to that provider instead, and VS Code has its own telemetry setting (`telemetry.telemetryLevel`).

---

## ⌨️ Command Palette

Search `LLM Bridge:` in the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

| Command | Action |
| :--- | :--- |
| `LLM Bridge: Manage Endpoints` | Interactive dashboard to inspect, test, or reconfigure endpoints |
| `LLM Bridge: Add Endpoint` | Guided wizard for adding Ollama, OpenAI, or Azure targets |
| `LLM Bridge: Remove Endpoint` | Delete an endpoint and prune associated cached metadata |
| `LLM Bridge: Set API Key` | Securely store or update an API key in `SecretStorage` |
| `LLM Bridge: Clear API Key` | Wipe stored API key for an endpoint origin |
| `LLM Bridge: Test Connection` | Health check endpoint reachability and latency |
| `LLM Bridge: Test Inference` | Validate model completion response without leaking data |
| `LLM Bridge: Discover Models` | Fetch available models dynamically via `/models` |
| `LLM Bridge: Add Model Manually` | Define custom model identifier, token limits, and tools |
| `LLM Bridge: Export Configuration` | Export sanitised JSON configuration without secrets |
| `LLM Bridge: Import Configuration` | Safe import with change preview and origin validation |
| `LLM Bridge: Show Diagnostics Log` | Open the (redacted, local) troubleshooting log. Not telemetry; nothing is uploaded |
| `LLM Bridge: Edit Endpoints in settings.json` | Open your user settings to edit endpoints and models directly |
| `LLM Bridge: Refresh` | Reload the sidebar and the model list |

Sidebar-only actions (right-click or inline buttons on a model): **Toggle Tool Calling**, **Remove Model**.

---

## ⚙️ Capabilities & Technical Specifications

- **Streaming:** Native Server-Sent Events (SSE) streaming with cooperative cancellation and configurable idle/connect timeouts.
- **Resilient Retries:** Intelligent backoff for rate limits (`HTTP 429`) and transient errors (`HTTP 5xx`), honoring `Retry-After` headers.
- **Agent Mode & Tool Calling:** Models declare `toolCalling: true`. LLM Bridge emits standard structured tool calls back to VS Code; execution and user approvals remain 100% under VS Code's native control.
- **Token Estimation:** Fast ~4 chars/token heuristic by default with configurable `maxInputTokens` and `maxOutputTokens`.

---

## 🧰 My model is not in the model picker

VS Code's **Agent** mode only lists models that declare **tool calling**, and LLM Bridge does not assume your model supports it. Two fixes:

1. **Turn tool calling on** (only if your model really supports tool/function calls): in the LLM Bridge sidebar, click the 🛠 button on the model (or right-click → *Toggle Tool Calling*). Or set `"toolCalling": true` on the model, or `"assumeToolCalling": true` on the endpoint.
2. **Or switch Chat to Ask mode**, where models without tool calling are listed.

Still missing? Open **Manage Models…** in the picker and make sure **LLM Bridge (IITDEVELOPER)** is enabled.

---

## 🧪 Using vLLM, LiteLLM or another OpenAI-compatible server

- **Start with `openai-chat`** (`/v1/chat/completions`). It is the most widely implemented format.
- Use `openai-responses` only if your server implements `/v1/responses`. LLM Bridge's Responses requests are validated against OpenAI's typed request schemas (`scripts/check-wire-schema.sh`), but servers differ, so run **Test Inference** and chat once with history (send two messages).
- If a request fails with HTTP 400, the full server message (up to 900 characters) is shown in the error. Open **LLM Bridge: Show Diagnostics Log** and report it with your server name and version.

---

## ✅ How to confirm a reply came from your endpoint

Chat can silently fall back to another model (e.g. Copilot **Auto**) if yours isn't selected. After sending a message, run **LLM Bridge: Show Diagnostics Log**. You should see:

```text
Chat request: my-endpoint::my-model POST https://…/v1/chat/completions stream=true messages=1 tools=0
Chat response: my-endpoint::my-model completed in 842ms (text chunks=37, tool calls=0)
```

No `Chat request` line means the reply came from a different model. If your models are missing from the model picker, open **Manage Models…** in the picker and enable **LLM Bridge (IITDEVELOPER)**. If VS Code instead says you must set up GitHub Copilot and sign in to use Chat (reported on one machine), sign in; the free plan is enough to try. VS Code's docs say custom models do not require a Copilot plan, so this may depend on your VS Code version.

---

## 💡 Good to Know

- **Tool calling is never auto-detected.** VS Code's Agent mode only lists models that support it. *Add Endpoint* asks, and you can toggle it per model in the sidebar. Whether a model behaves well in Agent mode depends on the model; VS Code runs the tools and approvals.
- **Vision is never auto-detected** either. Declare it per model.
- **Token counts are estimates** (about 4 characters per token), not billing figures.
- **Tested by the author** end to end in VS Code 1.140 with OpenAI Chat Completions (vLLM and others), OpenAI Responses, Azure OpenAI v1 and legacy, and Ollama. Servers differ, so run **Test Inference** on yours.
- **Works in VS Code 1.104 and newer.** Other VS Code-based editors (Cursor, Windsurf, Antigravity) may not include the Chat panel this extension relies on, and usually install extensions from Open VSX, so use the `.vsix` file there.
- **Not supported yet:** Anthropic Messages, reasoning/thinking output, Bedrock, Vertex. Azure legacy has no model listing, so add deployment names manually.
- Whether third-party models appear in Chat can depend on your VS Code/Copilot plan and organization policy.

---

## 🛠️ Local Development

Ready to contribute or test locally?

### Prerequisites
- Node.js `20.x` or higher
- VS Code `1.104.0` or higher

```bash
# 1. Clone repository & install dependencies
git clone https://github.com/iitdeveloper-git/LLMBridge.git
cd LLMBridge
npm install

# 2. Run full verification suite (types, linter, tests, build)
npm run verify

# 3. Launch Extension Development Host integration tests
npm run test:integration

# 4. Package local VSIX installer
npm run package
code --install-extension llm-bridge-ai-1.0.0.vsix
```

See [REQUIREMENTS-MATRIX.md](docs/REQUIREMENTS-MATRIX.md) for full requirement-to-test traceability.

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.

The IIT DEVELOPER name and logo are trademarks of IIT DEVELOPER and are **not** covered by the MIT license.

<div align="center">

**Built for the Open-Source Community by [IITDEVELOPER](https://github.com/iitdeveloper-git)**

</div>

