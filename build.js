import { cp, mkdir, rm } from 'node:fs/promises';

const output = new URL('./dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'faq.html', 'app.js', 'styles.css']) {
  await cp(new URL(`./${file}`, import.meta.url), new URL(`./${file}`, output));
}
await cp(new URL('./videos/', import.meta.url), new URL('./videos/', output), { recursive: true });
console.log('DukeDrop: built dist/');
