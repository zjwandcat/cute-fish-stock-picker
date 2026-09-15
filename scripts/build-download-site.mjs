import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const output = 'build/download-site';
await mkdir(output, { recursive: true });
for (const file of ['download.html', 'download.css', 'download.js', 'download-platform.js', 'favicon.svg']) {
  await copyFile(join('public', file), join(output, file));
}
await copyFile('public/download.html', join(output, 'index.html'));
await writeFile(join(output, '.nojekyll'), '');
