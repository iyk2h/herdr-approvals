import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { ApprovalController } from '../mods/approvals/controller.js';
import { MemoryJournal } from '../mods/approvals/state.js';
import { parseCodex } from '../mods/approvals/parsers/codex.js';
import { basicPrompt } from './fixtures/prompts.mjs';

const state=new Map();let io=0;let check=true;
globalThis.__approvalElement=()=>new Proxy({}, {get:(_target,key)=>key==='then'?undefined:(...args)=>globalThis.__approvalElement()});
globalThis.__approvalHost={
  checking:()=>check,shared:key=>state.get(key),setShared:(key,value)=>state.set(key,value),
  agents:()=>[],props:()=>({}),theme:()=>({background:'#101010',foreground:'#ffffff',muted:'#aaaaaa',raised:'#202020',surface:'#202020',hover:'#303030'}),
  appHome:()=>'/fixture',home:()=>'/fixture',nextCommand:()=>new Promise(()=>{}),run:()=>{io++;},
  exec:async()=>{io++;throw new Error('Unexpected exec');},hc:async()=>{io++;throw new Error('Unexpected hc');},readTextFile:async()=>{io++;throw new Error('Unexpected file read');},
};
const definitions={
  'gpui-kit':'export class View {} export const div=()=>globalThis.__approvalElement();',
  'gpui-base':'export const Button={new:()=>globalThis.__approvalElement()};export const h_flex=()=>globalThis.__approvalElement();export const v_flex=h_flex;',
  herdr:Object.keys(globalThis.__approvalHost).map(name=>`export const ${name}=(...args)=>globalThis.__approvalHost.${name}(...args);`).join('\n'),
};
registerHooks({resolve(specifier,context,next){return definitions[specifier]?{url:`data:text/javascript,${encodeURIComponent(definitions[specifier])}`,shortCircuit:true}:next(specifier,context);}});
const {default:Approvals}=await import('../mods/approvals/main.js');
function context(){const timers=[];return{timers,focus_handle:()=>({focus(){}}),notify(){},timer:{after(ms,run){timers.push(run);return{cancel(){}};},every(){throw new Error('Unexpected live timer in check');}},spawn(fn){return fn(context());},stop_propagation(){}};}

test('checking renders the real approval panel without starting IO, timers or writes',()=>{
  check=true;state.clear();io=0;
  const view=new Approvals(),cx=context();view.init({},cx);view.render(cx);
  assert.equal(io,0);assert.equal(state.size,0);assert.equal(cx.timers.length,0);
  assert.equal(view.controller.rows.length,1);
});
test('shared auto-off disables another copy immediately on redraw before its deadline',async()=>{
  check=false;state.set('approvals.enabled',true);state.set('approvals.mode','once');
  let sent=0;const row={sessionKey:'fixture',episode:'1',address:'t1',agent:'codex',status:'blocked',question:parseCodex(basicPrompt)};
  const controller=new ApprovalController({provider:{id:'native',list:async()=>[row],readQuestion:async()=>row,submit:async()=>{sent++;return{status:'delivered'};}},journal:new MemoryJournal()});
  controller.setEnabled(true);await controller.refresh();
  const view=Object.assign(Object.create(Approvals.prototype),{controller,preview:false,closed:false,mode:'once',connection:'native',choice:null,focus:{},refresh(){}});
  const cx=context();view.schedule(cx);assert.ok(controller.pending);
  state.set('approvals.enabled',false);view.render(cx);
  assert.equal(controller.enabled,false);assert.equal(controller.pending,null);
  for(const timer of cx.timers)timer(cx);
  await controller.tick();assert.equal(sent,0);
});
test('shared policy changes invalidate another copy countdown instead of using its old choice',async()=>{
  check=false;state.set('approvals.enabled',true);state.set('approvals.mode','once');
  const row={sessionKey:'fixture',episode:'1',address:'t1',agent:'codex',status:'blocked',question:parseCodex(basicPrompt)};
  const controller=new ApprovalController({provider:{id:'native',list:async()=>[row],readQuestion:async()=>row},journal:new MemoryJournal()});
  controller.setEnabled(true);await controller.refresh();
  const view=Object.assign(Object.create(Approvals.prototype),{controller,preview:false,closed:false,mode:'once',connection:'native',choice:null,focus:{},refresh(){}});
  state.set('approvals.mode','remember');view.render(context());
  assert.equal(controller.mode,'remember');assert.equal(controller.pending,null);
});
test('Enter in settings cannot submit a hidden previously selected approval',()=>{
  let sends=0;
  const row={sessionKey:'fixture',question:parseCodex(basicPrompt)};
  const view=Object.assign(Object.create(Approvals.prototype),{tab:'settings',controller:{rows:[row]},selectedKey:'fixture',choice:1,submit(){sends++;}});
  assert.equal(view.key({key:'enter'},context()),false);assert.equal(sends,0);
});
test('settings persist delay and scope and update an active controller immediately',async()=>{
  check=false;state.clear();state.set('approvals.enabled',true);
  const controller=new ApprovalController({provider:{id:'native',list:async()=>[],readQuestion:async()=>null},journal:new MemoryJournal()});
  controller.setEnabled(true);
  const view=Object.assign(Object.create(Approvals.prototype),{controller,preview:false,closed:false,mode:'once',delayMs:3000,scope:'all',selectedSessions:[],refresh(){}});
  view.setDelay(5000,context());assert.equal(state.get('approvals.delay'),5000);assert.equal(controller.delayMs,5000);
  view.setScope('selected',context());assert.equal(state.get('approvals.scope'),'selected');assert.equal(view.scope,'selected');
  view.setMode('remember',context());assert.equal(state.get('approvals.mode'),'remember');assert.equal(controller.mode,'remember');
});
