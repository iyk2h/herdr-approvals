import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeProvider } from '../mods/approvals/providers/native.js';
import { CockpitProvider } from '../mods/approvals/providers/cockpit.js';
import { parseCodex } from '../mods/approvals/parsers/codex.js';
import { basicPrompt, codexPrompt } from './fixtures/prompts.mjs';

const terminal = (patch = {}) => ({ address:'t7',state:'live',created_ms:100,pid:123,foreground:{pid:123},turn:2,status_ms:200,title:'Fixture',status:{app:'codex',state:'blocked'}, ...patch });
function fakeHost({ screen = basicPrompt, metadata = () => terminal(), failKeys = false } = {}) {
  const calls = [];
  return { calls, async hc(args) {
    calls.push(args);
    if (args[0] === 'server') return { code:0,stdout:JSON.stringify({core:{id:'fixture-core'}}) };
    if (args[0] === 'ls') return { code:0,stdout:JSON.stringify({terminals:[{address:'t7',state:'live',status:'blocked',agent:'codex'},{address:'remote/t8',state:'live',status:'blocked',agent:'codex'},{address:'t9',state:'live',status:'blocked',agent:'claude-code'}]}) };
    if (args[0] === 'get') return {code:0,stdout:JSON.stringify(metadata())};
    if (args[0] === 'read') return {code:0,stdout:JSON.stringify({text:screen,how:'screen',complete:true})};
    if (args[0] === 'keys') { if (failKeys) throw new Error('timeout after possible delivery'); return {code:0,stdout:'{}'}; }
    throw new Error('Unexpected hc operation');
  } };
}

test('native discovery does not inspect remote or unsupported-agent terminals', async () => {
  const host = fakeHost(), provider = new NativeProvider(host);
  const rows = await provider.list();
  assert.equal(rows.length,1); assert.equal(rows[0].agent,'codex');
  assert.ok(host.calls.filter(a=>a[0]==='get').every(a=>a[1]==='t7'));
});
test('foreground changes invalidate observations without bypassing an incarnation quarantine', async () => {
  let pid = 9;
  const provider = new NativeProvider(fakeHost({metadata:()=>terminal({foreground:{pid}})}));
  const first = await provider.get('t7'); pid=10;
  const second=await provider.get('t7');
  assert.equal(first.sessionKey,second.sessionKey);
  assert.notEqual(first.episode,second.episode);
});
test('unknown foreground identity cannot lift a previous attempt fence',async()=>{
  const provider=new NativeProvider(fakeHost({metadata:()=>terminal({foreground:null})}));
  assert.equal(await provider.get('t7'),null);
});
test('explicit auth and question status never trigger permission input',async()=>{
  for(const kind of ['auth','question']){
    const host=fakeHost({metadata:()=>terminal({status:{app:'codex',state:'blocked',kind}})});
    const provider=new NativeProvider(host);
    assert.equal(await provider.readQuestion({address:'t7'}),null);
    assert.equal(host.calls.filter(args=>args[0]==='keys').length,0);
  }
});
test('an agent with a merely similar name does not qualify as Codex',async()=>{
  const provider=new NativeProvider(fakeHost({metadata:()=>terminal({status:{app:'codex-helper',state:'blocked'}})}));
  assert.equal(await provider.readQuestion({address:'t7'}),null);
});
test('native read rejects a restarted terminal during screen capture', async () => {
  let gets=0;
  const provider=new NativeProvider(fakeHost({metadata:()=>terminal({pid:++gets===1?123:456})}));
  assert.equal(await provider.readQuestion({address:'t7'}),null);
});
test('a changed program after screen capture invalidates the request',async()=>{
  let reads=0;
  const provider=new NativeProvider(fakeHost({metadata:()=>terminal({status:{app:++reads===1?'codex':'claude-code',state:'blocked'}})}));
  assert.equal(await provider.readQuestion({address:'t7'}),null);
});
test('native input revalidates the full command before pressing any keys', async () => {
  const host=fakeHost({screen:codexPrompt({command:'pnpm build'})}),provider=new NativeProvider(host);
  const session={...await provider.get('t7'),question:parseCodex(basicPrompt)};
  assert.equal((await provider.submit(session,1)).status,'rejected');
  assert.equal(host.calls.filter(a=>a[0]==='keys').length,0);
});
test('native input uses the freshly observed cursor rather than a cached option position', async () => {
  const host=fakeHost({screen:codexPrompt({cursor:2})}),provider=new NativeProvider(host);
  const session={...await provider.get('t7'),question:parseCodex(basicPrompt)};
  assert.equal((await provider.submit(session,1)).status,'delivered');
  assert.deepEqual(host.calls.find(a=>a[0]==='keys'),['keys','t7','up','enter','--json']);
});
test('uncertain native delivery returns unknown without retrying', async () => {
  const host=fakeHost({failKeys:true}),provider=new NativeProvider(host);
  const session={...await provider.get('t7'),question:parseCodex(basicPrompt)};
  assert.equal((await provider.submit(session,1)).status,'unknown');
  assert.equal(host.calls.filter(a=>a[0]==='keys').length,1);
});
test('native refuses a non-blocked terminal even when stale prompt text remains', async () => {
  const provider=new NativeProvider(fakeHost({metadata:()=>terminal({status:{app:'codex',state:'working'}})}));
  assert.equal(await provider.readQuestion({address:'t7'}),null);
});
test('optional Cockpit provider shares canonical claims and filters remote handles', async () => {
  const native=new NativeProvider(fakeHost()); let answers=0;
  const cockpit=new CockpitProvider({native,view:async()=>({agents:[{terminal:'app:t7',stage:'needs_you'},{terminal:'app:remote/t8',stage:'needs_you'}]}),answer:async()=>{answers++;return{};}});
  assert.equal(native.claimScope,cockpit.claimScope);
  const rows=await cockpit.list(); assert.equal(rows.length,1);
  const row=await cockpit.readQuestion(rows[0]);
  assert.equal((await cockpit.submit(row,1)).status,'delivered');assert.equal(answers,1);
});
test('optional Cockpit never answers when native metadata or prompt changed', async () => {
  let answers=0;
  const native=new NativeProvider(fakeHost({screen:codexPrompt({command:'pnpm build'})}));
  const cockpit=new CockpitProvider({native,view:async()=>({agents:[]}),answer:async()=>{answers++;return{};}});
  const row={...await native.get('t7'),question:parseCodex(basicPrompt)};
  assert.equal((await cockpit.submit(row,1)).status,'rejected');assert.equal(answers,0);
});
