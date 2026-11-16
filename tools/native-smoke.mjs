import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NativeProvider } from '../mods/approvals/providers/native.js';
import { CasJournal } from '../mods/approvals/state.js';
import { ApprovalController } from '../mods/approvals/controller.js';

assert.ok(process.env.HC_SESSION?.startsWith('ha-'), 'Refuse a non-isolated core');
assert.ok(['/private/tmp/ha-','/tmp/ha-'].some(prefix=>process.env.XDG_STATE_HOME?.startsWith(prefix)), 'Refuse a non-scratch state directory');
const [address, receipt] = process.argv.slice(2);
const script = fileURLToPath(new URL('../mods/approvals/rpc.sh', import.meta.url));
function rpc(method, params) {
  const raw = execFileSync('/bin/sh', [script, JSON.stringify({jsonrpc:'2.0',id:1,method,params})], {encoding:'utf8',timeout:15000});
  const response = raw.trim().split('\n').map(line=>JSON.parse(line)).find(value=>value.id===1);
  if (response.error) throw Object.assign(new Error(response.error.message), {kind:response.error.data?.kind});
  return response.result;
}
const host = {async hc(args) {
  try { return {code:0,stdout:execFileSync('hc',args,{encoding:'utf8',timeout:20000}),stderr:''}; }
  catch(e) { return {code:e.status??1,stdout:String(e.stdout??''),stderr:String(e.stderr??'')}; }
}};
const journalHost = {async read(name){return rpc('doc.get',{name});},async write(name,value,version){return rpc('doc.set',{name,value,version});}};
const provider = new NativeProvider(host);
let now=1000;
const journal=new CasJournal(journalHost,'herdr.approvals.smoke');
const controller=new ApprovalController({provider,journal,now:()=>now});
controller.setEnabled(true);
// The fixture emits blocked immediately after its first frame; await that fact.
for(let i=0;i<40;i++){
  await controller.refresh();
  if(controller.pending)break;
  await new Promise(resolve=>setTimeout(resolve,50));
}
if (!controller.pending) console.error(JSON.stringify({controllerError:controller.error,list:JSON.parse((await host.hc(['ls','--json'])).stdout),terminal:JSON.parse((await host.hc(['get',address,'--json'])).stdout),screen:JSON.parse((await host.hc(['read',address,'--lines','0','--json'])).stdout)},null,2));
assert.equal(controller.rows[0]?.address,address);
assert.ok(controller.pending,'Native parser must recognize the real core screen');
now=3999;await controller.tick();assert.equal(existsSync(receipt),false);
now=4000;await controller.tick();
for(let i=0;i<40&&!existsSync(receipt);i++)await new Promise(resolve=>setTimeout(resolve,50));
assert.deepEqual(JSON.parse(readFileSync(receipt,'utf8')),{choice:1,fixture:true});
const attempts=await journal.entries();assert.ok(attempts.some(entry=>entry.status==='sent'));
const reopened=new ApprovalController({provider,journal:new CasJournal(journalHost,'herdr.approvals.smoke'),now:()=>now});
reopened.setEnabled(true);await reopened.refresh();await reopened.tick();
assert.deepEqual(JSON.parse(readFileSync(receipt,'utf8')),{choice:1,fixture:true});
console.log('PASS: actual isolated core screen -> parser -> controller -> durable CAS -> hc keys -> fixture receipt; no Cockpit');
