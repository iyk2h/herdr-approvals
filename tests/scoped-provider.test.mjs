import test from 'node:test';
import assert from 'node:assert/strict';
import { ScopedProvider } from '../mods/approvals/providers/scoped.js';

test('excluded sessions remain visible for manual answers while automatic input is rejected',async()=>{
  let sends=0;
  const row={sessionKey:'fixture'};
  const scoped=new ScopedProvider({id:'native',claimScope:'same-core',list:async()=>[row],readQuestion:async()=>row,submit:async()=>{sends++;return{status:'delivered'};}},()=>({scope:'selected',selectedSessions:[]}));
  assert.deepEqual(await scoped.list(),[row]);assert.equal((await scoped.readQuestion(row)).autoAllowed,false);
  assert.equal((await scoped.submit(row,1,{source:'auto'})).status,'rejected');assert.equal(sends,0);
  assert.equal((await scoped.submit(row,1,{source:'manual'})).status,'delivered');assert.equal(sends,1);
});
test('scope changes during delegate validation are reflected by the final input guard',async()=>{
  let included=true,sends=0;
  const scoped=new ScopedProvider({id:'native',submit:async(_row,_choice,options)=>{included=false;await Promise.resolve();if(!options.allowed())return{status:'rejected'};sends++;return{status:'delivered'};}},()=>({scope:'selected',selectedSessions:included?['fixture']:[]}));
  assert.equal((await scoped.submit({sessionKey:'fixture'},1,{source:'auto',allowed:()=>true})).status,'rejected');assert.equal(sends,0);
});
test('controller cancellation guards remain enforced even for a manually selected session',async()=>{
  let sends=0;
  const scoped=new ScopedProvider({id:'native',submit:async()=>{sends++;return{status:'delivered'};}},()=>({scope:'all',selectedSessions:[]}));
  assert.equal((await scoped.submit({sessionKey:'fixture'},1,{source:'manual',allowed:()=>false})).status,'rejected');assert.equal(sends,0);
});
