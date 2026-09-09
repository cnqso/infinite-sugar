// Static publication only: browser modules and vendored dependencies remain unbundled.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const root = fileURLToPath(new URL('..', import.meta.url));
const web = path.join(root, 'web');
const out = path.join(root, 'dist');
const manifest = JSON.parse(await fs.readFile(path.join(web, 'model/manifest.json'), 'utf8'));
const meta = JSON.parse(await fs.readFile(path.join(web, 'brain/meta.json'), 'utf8'));
for (const name of ['index.html', 'style.css', 'entry.ts', 'app.ts', 'brain.ts', 'performance.ts', 'neural-map.ts', 'brain/neural-map.json', 'model/scene.xml',
  'model/fruitfly.xml', ...manifest.assets.map(a => `model/assets/${a}`),
  ...Object.keys(meta.files).map(k => `brain/${k}.bin.gz`)]) {
  await fs.access(path.join(web, name));
}
await fs.rm(out, { recursive:true, force:true });
await fs.cp(web, out, { recursive:true, filter:src => !path.basename(src).startsWith('.') && !src.endsWith('.ts') });
await execFileAsync(path.join(root, 'node_modules/.bin/tsc'), ['-p', path.join(root, 'tsconfig.build.json')], { cwd: root });
// Fail a Pages build before publishing an asset it cannot serve (25 MiB per file).
let fileCount = 0;
async function checkAssets(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes:true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await checkAssets(file);
    else {
      fileCount++;
      if ((await fs.stat(file)).size > 25 * 1024 * 1024) {
        throw new Error(`Cloudflare Pages asset exceeds 25 MiB: ${path.relative(out, file)}`);
      }
    }
  }
}
await checkAssets(out);
if (fileCount > 20000) throw new Error('Cloudflare Pages Free supports at most 20,000 files');
console.log('Static site ready in dist/ (unbundled modules, body assets and complete connectome).');
