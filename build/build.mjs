import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
const assets = {};
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8'};
async function collect(dir, prefix='') {
  let entries;
  try { entries = await readdir(dir,{withFileTypes:true}); } catch(e) { if(e.code==='ENOENT')return;throw e; }
  for(const e of entries) {
    const p=join(dir,e.name), url=prefix+'/'+e.name;
    if(e.isDirectory()) await collect(p,url);
    else {
      const ext=e.name.slice(e.name.lastIndexOf('.'));
      if(!types[ext]) continue;
      const body=await readFile(p,'utf8');
      assets[url]={body,type:types[ext]};
    }
  }
}
await collect('web');
await collect('vendor','/vendor');
await mkdir('src',{recursive:true});
await writeFile('src/assets.generated.js', 'export default '+JSON.stringify(assets)+';\n');
console.log('Built static assets:',Object.keys(assets).length);

import { build } from 'esbuild';
await mkdir('.build',{recursive:true});
await build({entryPoints:['src/worker.js'],outfile:'.build/worker.js',bundle:true,format:'esm',platform:'browser',target:'es2022',conditions:['workerd','browser'],external:['node:*'],logLevel:'warning'});
console.log('Built Worker bundle');
