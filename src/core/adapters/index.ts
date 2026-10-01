import { BridgeError } from '../errors';
import type { EndpointConfig, Protocol } from '../types';
import type { ProtocolAdapter } from './adapter';
import { azureLegacyAdapter, ollamaAdapter, openAiChatAdapter } from './chatCompletions';
import { openAiResponsesAdapter } from './responses';

/** Azure OpenAI v1 GA API: /openai/v1/{responses|chat/completions}, api-key or Entra bearer, no api-version. */
const azureV1Responses: ProtocolAdapter = { ...openAiResponsesAdapter, defaultAuth: 'api-key-header' };
const azureV1Chat: ProtocolAdapter = { ...openAiChatAdapter, defaultAuth: 'api-key-header' };

export function getAdapter(ep: Pick<EndpointConfig, 'protocol' | 'azureV1Api'>): ProtocolAdapter {
  switch (ep.protocol as Protocol) {
    case 'openai-chat': return openAiChatAdapter;
    case 'openai-responses': return openAiResponsesAdapter;
    case 'azure-openai-v1': return ep.azureV1Api === 'chat' ? azureV1Chat : azureV1Responses;
    case 'azure-openai-legacy': return azureLegacyAdapter;
    case 'ollama': return ollamaAdapter;
    default: throw new BridgeError('config', `Unknown protocol "${String(ep.protocol)}".`);
  }
}
