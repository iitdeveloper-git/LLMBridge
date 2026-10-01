import { describe, expect, it } from 'vitest';
import { endpointNodes, keyState, modelNodes } from '../../src/core/tree';
import { ep } from './helpers';

const openai = ep({ id: 'my-ep', name: 'My EP', baseUrl: 'https://api.example.com/v1' });

describe('sidebar tree: key state', () => {
  it('missing / set / mismatch / not-needed', () => {
    expect(keyState(openai, undefined)).toBe('missing');
    expect(keyState(openai, { secret: 'k', origin: 'https://api.example.com' })).toBe('set');
    expect(keyState(openai, { secret: 'k', origin: 'https://other.example.com' })).toBe('mismatch');
    expect(keyState(ep({ baseUrl: 'http://localhost:11434/v1', protocol: 'ollama' }), undefined)).toBe('not-needed');
    expect(keyState({ ...openai, auth: 'none' }, undefined)).toBe('not-needed');
  });
});

describe('sidebar tree: nodes', () => {
  it('endpoint nodes show protocol, host, key status and model count', () => {
    const [n] = endpointNodes([{ ...openai, models: [{ id: 'a' }] }], { 'my-ep': { secret: 'k', origin: 'https://api.example.com' } }, { 'my-ep': [{ id: 'b' }] });
    expect(n).toMatchObject({ kind: 'endpoint', endpointId: 'my-ep', label: 'My EP', description: 'openai-chat · api.example.com', keyState: 'set', modelCount: 2 });
    expect(n!.tooltip).toContain('API key: set');
    expect(n!.tooltip).not.toContain('"k"');
  });
  it('tooltips never contain the secret', () => {
    const [n] = endpointNodes([openai], { 'my-ep': { secret: 'sk-very-secret-value', origin: 'https://api.example.com' } }, {});
    expect(JSON.stringify(n)).not.toContain('sk-very-secret-value');
  });
  it('model nodes: manual vs discovered, badges, picker id in tooltip', () => {
    const nodes = modelNodes({ ...openai, models: [{ id: 'm1', name: 'Mine', toolCalling: true, vision: true }] }, [{ id: 'm2' }]);
    const manual = nodes.find((x) => x.kind === 'model' && x.modelId === 'm1')!;
    const disc = nodes.find((x) => x.kind === 'model' && x.modelId === 'm2')!;
    expect(manual).toMatchObject({ label: 'Mine', source: 'manual', description: 'm1 · tools · vision' });
    expect(manual.kind === 'model' && manual.tooltip).toContain('my-ep::m1');
    expect(disc).toMatchObject({ source: 'discovered', description: 'discovered' });
  });
  it('empty endpoints show a hint: discover when listable, add when not (Azure legacy)', () => {
    expect(modelNodes(openai, [])).toEqual([{ kind: 'hint', endpointId: 'my-ep', commandSuffix: 'discoverModels', label: expect.stringContaining('discover') }]);
    const legacy = ep({ id: 'az', protocol: 'azure-openai-legacy', apiVersion: 'v', baseUrl: 'https://r.openai.azure.com' });
    expect(modelNodes(legacy, [])[0]).toMatchObject({ kind: 'hint', commandSuffix: 'addModel' });
  });
});
