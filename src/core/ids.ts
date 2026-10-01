const SEP = '::';
export function stableModelId(endpointId: string, modelId: string): string {
  return `${endpointId}${SEP}${modelId}`;
}
export function parseModelId(id: string): { endpointId: string; modelId: string } | undefined {
  const i = id.indexOf(SEP);
  if (i <= 0 || i + SEP.length >= id.length) return undefined;
  return { endpointId: id.slice(0, i), modelId: id.slice(i + SEP.length) };
}
