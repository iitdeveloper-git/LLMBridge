import { build } from 'esbuild';
const production = process.argv.includes('--production');
await build({
  entryPoints: ['src/vscode/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  external: ['vscode'], minify: production, sourcemap: !production, logLevel: 'info',
});
