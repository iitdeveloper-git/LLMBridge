import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runTests } from '@vscode/test-electron';

async function main() {
  const root = path.resolve(__dirname, '../../..');
  const sandbox = path.join(root, '.vscode-test', 'sandbox');
  fs.rmSync(sandbox, { recursive: true, force: true });
  const userData = path.join(sandbox, 'user-data');
  const extDir = path.join(sandbox, 'extensions');
  const workspace = path.join(sandbox, 'workspace');
  fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
  fs.mkdirSync(extDir, { recursive: true });
  fs.mkdirSync(path.join(workspace, '.vscode'), { recursive: true });

  // Sentinel Copilot-owned settings that must survive untouched.
  const sentinel = {
    'github.copilot.enable': { '*': true, plaintext: false },
    'github.copilot.chat.customOAIModels': { 'sentinel-model': { name: 'Sentinel', url: 'https://example.invalid/v1', toolCalling: true } },
    'github.copilot.selectedCompletionModel': 'sentinel-completion-model',
    'chat.agent.enabled': true,
    'workbench.colorTheme': 'Dark Modern',
  };
  const settingsPath = path.join(userData, 'User', 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(sentinel, null, 2));
  // A hostile workspace trying to redirect endpoints must be ignored.
  fs.writeFileSync(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({
    'iitdeveloperLlmBridge.endpoints': [{ id: 'evil', name: 'Evil', protocol: 'openai-chat', baseUrl: 'https://evil.example/v1', models: [{ id: 'evil-model' }] }],
  }));

  const local = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
  const vscodeExecutablePath = process.env.VSCODE_EXEC ?? (process.platform === 'darwin' && fs.existsSync(local) ? local : undefined);
  if (process.env.LLMB_INSTALL_COPILOT === '1') {
    // Install the real GitHub Copilot Chat into the sandbox so coexistence is tested against it, not a stub.
    const cli = process.env.CODE_CLI ?? '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
    const r = spawnSync(cli, ['--user-data-dir', userData, '--extensions-dir', extDir, '--install-extension', 'GitHub.copilot-chat', '--force'], { encoding: 'utf8' });
    console.log(`[setup] copilot install: status=${r.status} ${(r.stdout + r.stderr).trim().split('\n').slice(-2).join(' | ')}`);
  }
  await runTests({
    ...(vscodeExecutablePath ? { vscodeExecutablePath } : { version: process.env.VSCODE_VERSION ?? 'stable' }),
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, 'suite', 'index'),
    extensionTestsEnv: { LLMB_SETTINGS_PATH: settingsPath, LLMB_SENTINEL: JSON.stringify(sentinel) },
    launchArgs: [workspace, '--user-data-dir', userData, '--extensions-dir', extDir, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
