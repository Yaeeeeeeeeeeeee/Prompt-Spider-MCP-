// Import tests into one process: avoids harness wrappers swallowing --test child argv.
import { readdir } from 'node:fs/promises';
for(const file of (await readdir(new URL('.',import.meta.url))).filter(x=>x.endsWith('.test.js')).sort()) await import(new URL(file,import.meta.url));
