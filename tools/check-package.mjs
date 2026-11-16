import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const required=['README.md','RECIPE.md','preview.png','LICENSE','NOTICE','LICENSES/Cockpit-MIT.txt','mods/approvals/main.js','mods/approvals/mod.json','mods/approvals/rpc.sh','keys.json'];
for(const path of required)assert.ok(statSync(root+path).isFile(),`Missing ${path}`);
function files(path){return readdirSync(path).flatMap(name=>{const file=path+'/'+name;return statSync(file).isDirectory()?files(file):[file];});}
for(const file of files(root+'mods/approvals')){
  const text=readFileSync(file,'utf8');
  assert.ok(!/\/(?:Users|home)\/[^\s/'"]+\//.test(text),`Private path in ${file}`);
  assert.ok(!/from\s+['"](?:node:|.*mods\/cockpit\/)/.test(text),`Runtime external dependency in ${file}`);
  assert.ok(!/sk-proj-[A-Za-z0-9_-]{12}|ghp_[A-Za-z0-9]{12}/.test(text),`Credential in ${file}`);
}
assert.ok(readFileSync(root+'NOTICE','utf8').includes('herdr-relevo'));
console.log('Package structure, standalone runtime and source attribution passed');
