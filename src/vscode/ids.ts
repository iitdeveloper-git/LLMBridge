/** All identifiers are namespaced to avoid collisions with other extensions and with Copilot. */
export const VENDOR = 'iitdeveloper-llm-bridge';
export const CONFIG_SECTION = 'iitdeveloperLlmBridge';
export const CMD = (name: string) => `iitdeveloperLlmBridge.${name}`;
export const SECRET_KEY = (endpointId: string) => `iitdeveloper.llmBridge.credential.${endpointId}`;
export const DISCOVERY_STATE_KEY = 'iitdeveloper.llmBridge.discovered';
