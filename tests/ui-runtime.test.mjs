import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { ApprovalController } from '../mods/approvals/controller.js';
import { MemoryJournal } from '../mods/approvals/state.js';
import { parseCodex } from '../mods/approvals/parsers/codex.js';
import { basicPrompt } from './fixtures/prompts.mjs';

const state=new Map();const commands=[];let io=0;let check=true;
globalThis.__approvalElement=()=>new Proxy({}, {get:(_target,key)=>key==='then'?undefined:(...args)=>globalThis.__approvalElement()});
globalThis.__approvalHost={
  checking:()=>check,shared:key=>state.get(key),setShared:(key,value)=>state.set(key,value),
  agents:()=>[],props:()=>({}),theme:()=>({background:'#101010',foreground:'#ffffff',muted:'#aaaaaa',raised:'#202020',surface:'#202020',hover:'#303030'}),
  appHome:()=>'/fixture',home:()=>'/fixture',nextCommand:()=>new Promise(()=>{}),run:(name,args)=>{io++;commands.push({name,args});},
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

test('navigation commands focus the requested tab without sending a hidden selected approval',()=>{
  let sends=0,focused=0;
  const row={sessionKey:'fixture',question:parseCodex(basicPrompt)};
  const view=Object.assign(Object.create(Approvals.prototype),{
    tab:'requests',controller:{rows:[row]},selectedKey:'fixture',choice:1,
    focus:{focus(){focused++;}},submit(){sends++;},
  });
  const cx=context();

  view.command('settings',cx);
  assert.equal(view.tab,'settings');
  assert.equal(focused,1);
  assert.equal(view.key({key:'enter'},cx),false);
  assert.equal(sends,0,'Enter in the opened settings tab cannot approve the hidden request');

  view.command('requests',cx);
  assert.equal(view.tab,'requests');
  assert.equal(focused,2);
  assert.equal(sends,0,'opening requests is navigation, not an approval action');
});

test('compact checking and preview render one collapsed controller without live IO or settings writes',()=>{
  for(const checking of [false,true]){
    check=checking;state.clear();commands.length=0;io=0;
    const view=new Approvals(),cx=context();
    view.init({compact:true,panelId:'fixture-panel',preview:!checking},cx);
    const controller=view.controller;
    view.render(cx);
    assert.equal(view.compact,true);
    assert.equal(view.expanded,false);
    assert.equal(view.panelId,'fixture-panel');
    assert.equal(view.controller,controller);
    assert.equal(io,0);
    assert.equal(state.size,0);
    assert.equal(commands.length,0);
    assert.equal(cx.timers.length,0);
  }
});

test('compact navigation and collapse resize the same slot without sending or cancelling its active countdown',async()=>{
  check=false;state.clear();commands.length=0;
  let sends=0;
  const row={sessionKey:'fixture',episode:'1',address:'t1',agent:'codex',status:'blocked',question:parseCodex(basicPrompt)};
  const controller=new ApprovalController({provider:{id:'native',list:async()=>[row],readQuestion:async()=>row,
    submit:async()=>{sends++;return{status:'delivered'};}},journal:new MemoryJournal(),now:()=>0});
  controller.setEnabled(true);await controller.refresh();
  const pending=controller.pending;
  const view=Object.assign(Object.create(Approvals.prototype),{
    compact:true,expanded:false,panelId:'fixture-panel',preview:false,closed:false,tab:'requests',
    controller,selectedKey:row.sessionKey,choice:1,focus:{focus(){}},
    makeController(){throw new Error('Navigation must reuse its existing controller');},
    submit(){sends++;},
  });
  const cx=context();

  view.setTab('settings',cx);
  assert.equal(view.expanded,true);
  assert.equal(view.tab,'settings');
  assert.deepEqual(commands.at(-1),{name:'layout.resize',args:{id:'fixture-panel',px:620}});
  assert.equal(view.key({key:'enter'},cx),false);
  assert.equal(sends,0);
  assert.equal(view.controller,controller);
  assert.equal(controller.enabled,true);
  assert.equal(controller.pending,pending);

  view.setTab('requests',cx);
  assert.equal(view.expanded,true);
  assert.equal(view.tab,'requests');
  assert.deepEqual(commands.at(-1),{name:'layout.resize',args:{id:'fixture-panel',px:620}});
  view.collapse(cx);
  assert.equal(view.expanded,false);
  assert.equal(view.tab,'requests');
  assert.deepEqual(commands.at(-1),{name:'layout.resize',args:{id:'fixture-panel',px:164}});
  assert.equal(view.controller,controller);
  assert.equal(controller.enabled,true);
  assert.equal(controller.pending,pending);
  assert.equal(sends,0);
  assert.deepEqual(await controller.journal.entries(),[],'navigation cannot persist a cancellation or a new attempt');
});

test('an idle compact widget collapses to 112px while regular tab changes do not resize any layout slot',()=>{
  check=false;commands.length=0;
  const controller=new ApprovalController({provider:{id:'native'},journal:new MemoryJournal()});
  const compact=Object.assign(Object.create(Approvals.prototype),{
    compact:true,expanded:true,panelId:'fixture-panel',preview:false,tab:'settings',controller,
  });
  compact.collapse(context());
  assert.equal(compact.expanded,false);
  assert.equal(compact.tab,'requests');
  assert.deepEqual(commands,[{name:'layout.resize',args:{id:'fixture-panel',px:112}}]);

  commands.length=0;
  const regular=Object.assign(Object.create(Approvals.prototype),{
    compact:false,expanded:false,panelId:'regular-panel',preview:false,tab:'requests',controller,
  });
  regular.setTab('settings',context());
  regular.setTab('requests',context());
  assert.equal(regular.tab,'requests');
  assert.deepEqual(commands,[]);
});

test('a collapsed compact widget ignores hidden answer keys and approve commands until expanded',()=>{
  for(const action of ['enter','approve','digit']){
    let sends=0,choices=0;
    const row={sessionKey:'fixture',question:parseCodex(basicPrompt)};
    const pending={sessionKey:'fixture',choice:1,deadline:3000};
    const controller={rows:[row],pending,enabled:true};
    const view=Object.assign(Object.create(Approvals.prototype),{
      compact:true,expanded:false,tab:'requests',controller,selectedKey:'fixture',choice:1,
      submit(){sends++;},choose(){choices++;},
    });
    const invoke=()=>action==='approve'?view.command('approve',context()):view.key({key:action==='digit'?'3':'enter'},context());

    invoke();
    assert.equal(sends,0,`${action} must not dispatch a previously selected hidden answer`);
    assert.equal(choices,0,`${action} must not choose an answer hidden by the compact widget`);
    assert.equal(controller.enabled,true);
    assert.equal(controller.pending,pending,'ignoring a hidden manual action does not cancel the automatic countdown');

    view.expanded=true;
    invoke();
    assert.equal(sends,action==='digit'?0:1,'expanded requests retain explicit submit actions');
    assert.equal(choices,action==='digit'?1:0,'expanded requests retain numeric selection');
  }
});

test('approve commands cannot send a request hidden behind settings in compact or regular panels',()=>{
  check=false;
  for(const compact of [false,true]){
    let sends=0;
    const row={sessionKey:'fixture',question:parseCodex(basicPrompt)};
    const view=Object.assign(Object.create(Approvals.prototype),{
      compact,expanded:true,panelId:'fixture-panel',preview:false,tab:'requests',
      controller:{rows:[row],pending:null},selectedKey:'fixture',choice:1,
      submit(){sends++;},
    });
    const cx=context();

    view.setTab('settings',cx);
    view.command('approve',cx);
    assert.equal(sends,0,compact?'expanded compact settings hide the old approval':'regular settings hide the old approval');

    view.setTab('requests',cx);
    view.command('approve',cx);
    assert.equal(sends,1,'the explicit approve command remains available on the visible request tab');
  }
});
