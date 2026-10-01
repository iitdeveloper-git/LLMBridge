import * as vscode from 'vscode';
import { redactText } from '../core/redact';
import type { Logger } from '../core/types';
import { CONFIG_SECTION } from './ids';

const ORDER = { off: 0, error: 1, info: 2, debug: 3 } as const;

/** Redacting logger. Callers never pass prompts, code or responses; redaction is defense in depth. */
export function createLogger(): Logger & vscode.Disposable & { show(): void } {
  const channel = vscode.window.createOutputChannel('LLM Bridge', { log: true });
  const level = () => ORDER[vscode.workspace.getConfiguration(CONFIG_SECTION).get<keyof typeof ORDER>('logLevel', 'info')] ?? 2;
  return {
    error: (m) => { if (level() >= 1) channel.error(redactText(m)); },
    info: (m) => { if (level() >= 2) channel.info(redactText(m)); },
    debug: (m) => { if (level() >= 3) channel.debug(redactText(m)); },
    show: () => channel.show(true),
    dispose: () => channel.dispose(),
  };
}
