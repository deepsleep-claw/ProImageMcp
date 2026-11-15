import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { isBuiltin } from 'node:module';
import { readFile, readdir, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const check = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json', '--noEmit'], { cwd: root, stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status ?? 1);

const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22.19',
  sourcemap: false,
  legalComments: 'inline',
  metafile: true,
  write: false,
  banner: { js: 'import { createRequire as __bundleCreateRequire } from "node:module";\nconst require = __bundleCreateRequire(import.meta.url);' },
});

for (const output of Object.values(result.metafile.outputs)) {
  for (const dependency of output.imports) {
    if (dependency.external && !isBuiltin(dependency.path)) {
      throw new Error(`Unexpected external dependency: ${dependency.path}`);
    }
  }
}

const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.split(/[\\/]/).includes('node_modules')) continue;
  let directory = path.dirname(path.resolve(root, input));
  // Some packages put an unnamed package.json in their ESM output folder.
  while (directory !== path.dirname(directory)) {
    let metadata;
    try {
      metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (metadata?.name && metadata?.version) {
      packages.set(directory, metadata);
      break;
    }
    directory = path.dirname(directory);
  }
  if (!packages.has(directory)) throw new Error(`Cannot identify bundled package: ${input}`);
}

const notices = ['Third-party notices for the bundled ProImage MCP server.'];
for (const [directory, metadata] of [...packages].sort((a, b) => `${a[1].name}@${a[1].version}`.localeCompare(`${b[1].name}@${b[1].version}`))) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter(entry => entry.isFile() && /^(licen[cs]e|notice|copying|copyright)(?:[._-].*)?$/i.test(entry.name)).map(entry => entry.name).sort();
  if (!files.some(name => /^(licen[cs]e|copying)(?:[._-].*)?$/i.test(name))) {
    throw new Error(`License text missing for bundled package ${metadata.name}@${metadata.version}`);
  }
  notices.push(`\n${'='.repeat(72)}\n${metadata.name}@${metadata.version}\nLicense: ${metadata.license ?? 'See license text below'}`);
  for (const file of files) notices.push(`\n--- ${file} ---\n${(await readFile(path.join(directory, file), 'utf8')).trim()}`);
}

// Replace the output only after type checking, bundling and license validation succeed.
const dist = path.join(root, 'dist');
if (path.dirname(dist) !== path.resolve(root)) throw new Error('Build output must stay inside the package root.');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const output of result.outputFiles) await writeFile(output.path, output.contents);
await writeFile(path.join(dist, 'THIRD_PARTY_NOTICES.txt'), `${notices.join('\n')}\n`);
console.log(`Built dist/index.js with notices for ${packages.size} bundled packages.`);
