import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const output = resolve(root, 'release', 'hem-standalone.html');
const assetFiles = await readdir(resolve(dist, 'assets'));
const cssFile = assetFiles.find((file) => file.endsWith('.css'));
const javascriptFile = assetFiles.find((file) => file.endsWith('.js'));

if (!cssFile || !javascriptFile) {
  throw new Error('Vite build assets were not found in dist/assets.');
}

let html = await readFile(resolve(dist, 'index.html'), 'utf8');
const css = await readFile(resolve(dist, 'assets', cssFile), 'utf8');
const javascript = await readFile(resolve(dist, 'assets', javascriptFile), 'utf8');
const javascriptDataUri = `data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`;

html = html.replace(
  /<script type="module" crossorigin src="[^"]+"><\/script>/,
  `<script type="module" src="${javascriptDataUri}"></script>`
);
html = html.replace(
  /<link rel="stylesheet" crossorigin href="[^"]+">/,
  `<style>\n${css}\n</style>`
);

await mkdir(resolve(root, 'release'), { recursive: true });
await writeFile(output, html, 'utf8');
console.log(`Created ${output}`);
