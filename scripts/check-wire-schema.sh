#!/usr/bin/env bash
# Validates the request bodies our adapters generate against OpenAI's own typed request schemas
# (which servers such as vLLM validate with). Needs python3 + network for `pip install openai`.
# Not a substitute for testing against a real server, but it catches strict-validation bugs mock servers cannot.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
python3 -m venv "$T/v" && "$T/v/bin/pip" -q install openai pydantic
cd "$ROOT"
npx esbuild src/core/adapters/responses.ts --bundle --platform=node --format=cjs --outfile="$T/resp.cjs" --log-level=error
npx esbuild src/core/adapters/chatCompletions.ts --bundle --platform=node --format=cjs --outfile="$T/chat.cjs" --log-level=error
cat > "$T/dump.cjs" <<'JS'
const { buildResponsesBody } = require('./resp.cjs'); const { buildChatBody } = require('./chat.cjs');
const t = (text) => [{ type: 'text', text }];
const tools = [{ name: 'w', description: 'd', parameters: { type: 'object', properties: {} } }];
const convs = {
  user_only: [{ role: 'user', parts: t('hi') }],
  system_plus_user: [{ role: 'system', parts: t('be brief') }, { role: 'user', parts: t('hi') }],
  assistant_history: [{ role: 'user', parts: t('hi') }, { role: 'assistant', parts: t('Hello!') }, { role: 'user', parts: t('again') }],
  tool_roundtrip: [{ role: 'user', parts: t('weather?') }, { role: 'assistant', parts: t('checking'), toolCalls: [{ id: 'call_1', name: 'w', args: { city: 'P' } }] }, { role: 'tool', toolCallId: 'call_1', parts: t('sunny') }, { role: 'user', parts: t('thanks') }],
  image_user: [{ role: 'user', parts: [{ type: 'text', text: 'see' }, { type: 'image', mime: 'image/png', base64: 'AAAA' }] }],
};
const out = { responses: {}, chat: {} };
for (const [k, m] of Object.entries(convs)) {
  out.responses[k] = buildResponsesBody({ model: 'm', messages: m, stream: true, tools });
  out.chat[k] = buildChatBody({ model: 'm', messages: m, stream: true, tools }, true);
}
console.log(JSON.stringify(out));
JS
node "$T/dump.cjs" > "$T/bodies.json"
"$T/v/bin/python" - "$T/bodies.json" <<'PY'
import json, sys
from typing import Union
from pydantic import TypeAdapter, ValidationError
from openai.types.responses import ResponseInputParam, ToolParam
from openai.types.chat import ChatCompletionMessageParam, ChatCompletionToolParam
d = json.load(open(sys.argv[1])); bad = 0
checks = {
  'responses': lambda b: (TypeAdapter(Union[str, ResponseInputParam]).validate_python(b['input']), TypeAdapter(list[ToolParam]).validate_python(b['tools'])),
  'chat': lambda b: (TypeAdapter(list[ChatCompletionMessageParam]).validate_python(b['messages']), TypeAdapter(list[ChatCompletionToolParam]).validate_python(b['tools'])),
}
for proto, bodies in d.items():
    for name, body in bodies.items():
        try: checks[proto](body); print(f'OK    {proto}/{name}')
        except ValidationError as e: bad += 1; print(f'FAIL  {proto}/{name}: {[(x["loc"][-1], x["msg"]) for x in e.errors()[:3]]}')
sys.exit(1 if bad else 0)
PY
