import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { ApprovalController } from '../mods/approvals/controller.js';
import { MemoryJournal } from '../mods/approvals/state.js';
import { parseCodex } from '../mods/approvals/parsers/codex.js';
import { basicPrompt } from './fixtures/prompts.mjs';
import { sha256 } from '../mods/approvals/digest.js';

const state=new Map();const commands=[];const overlays=[];const closedOverlays=[];let io=0;let check=true;
globalThis.__approvalElement=()=>new Proxy({}, {get:(_target,key)=>key==='then'?undefined:(...args)=>globalThis.__approvalElement()});
globalThis.__approvalInput=(options={})=>{
  let value=options.value??'';const events=new Map();
  return {value:()=>value,set_value:next=>{value=next;},on:(name,callback)=>{events.set(name,callback);return true;},
    emit:(name,cx)=>events.get(name)?.({},cx),focus(){},release(){return true;}};
};
globalThis.__approvalHost={
  checking:()=>check,shared:key=>state.get(key),setShared:(key,value)=>state.set(key,value),settings:()=>({zoom:1}),
  agents:()=>[],props:()=>({}),theme:()=>({background:'#101010',foreground:'#ffffff',muted:'#aaaaaa',raised:'#202020',surface:'#202020',hover:'#303030'}),
  openOverlay:spec=>{io++;overlays.push(spec);return `popup-${overlays.length}`;},closeOverlay:id=>{io++;closedOverlays.push(id);},
  appHome:()=>'/fixture',home:()=>'/fixture',nextCommand:()=>new Promise(()=>{}),run:(name,args)=>{io++;commands.push({name,args});},
  exec:async()=>{io++;throw new Error('Unexpected exec');},hc:async()=>{io++;throw new Error('Unexpected hc');},readTextFile:async()=>{io++;throw new Error('Unexpected file read');},
};
const definitions={
  'gpui-kit':'export class View {} export const div=()=>globalThis.__approvalElement();',
  'gpui-base':'export const Button={new:()=>globalThis.__approvalElement()};export const InputState={new:options=>globalThis.__approvalInput(options)};export const Input={new:()=>globalThis.__approvalElement()};export const NumberInput=Input;export const h_flex=()=>globalThis.__approvalElement();export const v_flex=h_flex;',
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

test('compact checking and preview render one fixed strip without live IO or settings writes',()=>{
  for(const checking of [false,true]){
    check=checking;state.clear();commands.length=0;io=0;
    const view=new Approvals(),cx=context();
    view.init({compact:true,panelId:'fixture-panel',preview:!checking},cx);
    const controller=view.controller;
    view.render(cx);
    assert.equal(view.compact,true);
    assert.equal(view.panelId,'fixture-panel');
    assert.equal(view.controller,controller);
    assert.equal(io,0);
    assert.equal(state.size,0);
    assert.equal(commands.length,0);
    assert.equal(cx.timers.length,0);
  }
});

function liveContext() {
  const scheduled=[];
  const cx={scheduled,focus_handle:()=>({focus(){}}),notify(){},stop_propagation(){},
    timer:{after(ms,fn){scheduled.push({ms,fn});return{cancel(){}};},every(){throw new Error('No automatic timer belongs to a popup');}},
    spawn(fn){const task=fn(cx);task.catch?.(()=>{});return task;},
  };
  return cx;
}

async function ownerModel() {
  check=false;state.clear();commands.length=0;overlays.length=0;closedOverlays.length=0;
  state.set('approvals.enabled',true);state.set('approvals.mode','once');state.set('approvals.scope','all');
  let sends=0;
  const source={sessionKey:'fixture',episode:'1',address:'t1',agent:'codex',status:'blocked',question:parseCodex(basicPrompt)};
  const controller=new ApprovalController({provider:{id:'native',list:async()=>[source],readQuestion:async()=>source},journal:new MemoryJournal(),now:()=>0});
  controller.setEnabled(true);await controller.refresh();
  const cx=liveContext();
  const owner=Object.assign(Object.create(Approvals.prototype),{
    compact:true,panelId:'fixture-panel',preview:false,closed:false,tab:'requests',controller,
    sessionCatalog:[],selectedKey:'fixture',choice:1,selection:null,busy:false,refreshing:false,
    mode:'once',connection:'native',scope:'all',delayMs:3000,selectedSessions:[],focus:cx.focus_handle(),
    makeController(){throw new Error('A presentation cannot replace the input owner');},
    refresh(){},
    submit(row,taskContext){sends++;assert.equal(taskContext,cx,'manual input runs in the owner task context');},
  });
  return {owner,controller,cx,row:controller.rows[0],sends:()=>sends};
}

function presentation(owner,cx,tab='settings') {
  owner.openPopup(tab,cx);
  const spec=overlays.at(-1);
  assert.ok(spec,'navigation must open a native overlay');
  assert.equal(spec.mod,'approvals');
  assert.equal(spec.props.presentation,true);
  assert.equal(spec.props.tab,tab);
  const popup=Object.assign(new Approvals(),{
    makeController(){throw new Error('A popup cannot create a provider or controller');},
    refresh(){throw new Error('A popup cannot start a provider refresh');},
  });
  const popupCx=liveContext();
  popup.init({...spec.props,overlay:`popup-${overlays.length}`},popupCx);
  return {popup,popupCx,spec};
}

const snapshot=row=>({sessionKey:row.sessionKey,episode:row.episode,digest:sha256(row.question.fingerprint)});

test('compact height stays 40px for idle countdown sending and error without inline expansion',async()=>{
  const {owner,controller,cx}=await ownerModel();
  for(const status of ['idle','countdown','dispatching','error']){
    controller.status=status;controller.pending=status==='countdown'?{sessionKey:'fixture',deadline:3000}:null;
    owner.updateCompactSize(cx);
  }
  owner.setTab('settings',cx);
  owner.setTab('requests',cx);
  const sizes=commands.filter(item=>item.name==='layout.resize');
  assert.ok(sizes.length>0);
  assert.ok(sizes.every(item=>item.args.id==='fixture-panel'&&item.args.px===40),'pending requests and popups cannot move surrounding panels');
  assert.equal(overlays.length,2,'compact tab navigation uses popups');
  owner.close();
});

test('settings presentation reuses the owner and closing it preserves its exact automatic countdown',async()=>{
  const {owner,controller,cx}=await ownerModel();
  const pending=controller.pending;
  const {popup,popupCx}=presentation(owner,cx);
  assert.equal(popup.controller,controller);
  const beforeIO=io;
  popup.render(popupCx);
  assert.equal(io,beforeIO,'presentation rendering cannot start provider IO');
  assert.equal(popupCx.scheduled.length,0);
  popup.close();
  assert.equal(controller.enabled,true);
  assert.equal(controller.pending,pending);
  assert.equal(controller.closed,false);
  await controller.flush();
  assert.deepEqual(await controller.journal.entries(),[],'closing settings is not cancellation');
  owner.close();
});

test('popup settings actions update the existing owner through its mailbox without creating another controller',async()=>{
  const {owner,controller,cx}=await ownerModel();
  const {popup}=presentation(owner,cx);
  assert.equal(await popup.relay({action:'delay',value:5000}),true);
  assert.equal(state.get('approvals.delay'),5000);
  assert.equal(controller.delayMs,5000);
  assert.equal(await popup.relay({action:'mode',value:'remember'}),true);
  assert.equal(controller.mode,'remember');
  assert.equal(await popup.relay({action:'scope',value:'selected'}),true);
  assert.equal(state.get('approvals.scope'),'selected');
  assert.equal(popup.controller,controller);
  popup.close();owner.close();
});

test('closed and replaced popup capabilities cannot apply queued settings or manual actions',async()=>{
  const {owner,controller,cx}=await ownerModel();
  const pending=controller.pending;
  const {popup:closed}=presentation(owner,cx);
  closed.close();
  assert.equal(await closed.relay({action:'delay',value:10000}),false);
  assert.equal(state.has('approvals.delay'),false);
  const {popup:queued}=presentation(owner,cx);
  const handle=owner.handlePresentation.bind(owner);
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  owner.handlePresentation=async(packet,taskContext)=>{await gate;return handle(packet,taskContext);};
  const acknowledgement=queued.relay({action:'delay',value:10000});
  await Promise.resolve();
  queued.close();release();
  assert.equal(await acknowledgement,false,'revocation must also reject an already queued action');
  assert.equal(state.has('approvals.delay'),false);
  owner.handlePresentation=handle;
  const {popup:old}=presentation(owner,cx);
  const {popup:current}=presentation(owner,cx);
  assert.equal(await old.relay({action:'mode',value:'remember'}),false);
  assert.equal(controller.mode,'once');
  assert.equal(controller.pending,pending);
  current.close();owner.close();
});

test('presentation input rejects settings and stale request identities but preserves explicit current request actions',async()=>{
  const model=await ownerModel(),{owner,controller,cx,row}=model;
  const {popup:settings}=presentation(owner,cx);
  assert.equal(await settings.relay({action:'submit',...snapshot(row),choice:1}),false);
  assert.equal(model.sends(),0);
  const {popup}=presentation(owner,cx,'requests');
  const original=snapshot(row);
  row.episode='2';
  assert.equal(await popup.relay({action:'choose',...original,choice:1}),false);
  row.episode='1';
  const question=row.question;
  row.question={...question,fingerprint:'changed full request'};
  assert.equal(await popup.relay({action:'choose',...original,choice:1}),false);
  row.question=question;
  assert.equal(model.sends(),0);
  assert.equal(await popup.relay({action:'choose',...snapshot(row),choice:1}),true);
  assert.equal(await popup.relay({action:'submit',...snapshot(row),choice:1}),true);
  assert.equal(model.sends(),1);
  popup.close();owner.close();
});

test('the thin owner never submits hidden manual choices while the regular request pane keeps its explicit command',()=>{
  check=false;
  for(const expanded of [false,true]){
    let sends=0,choices=0;
    const row={sessionKey:'fixture',question:parseCodex(basicPrompt)};
    const pending={sessionKey:'fixture',deadline:3000};
    const view=Object.assign(Object.create(Approvals.prototype),{compact:true,expanded,tab:'requests',controller:{rows:[row],pending,enabled:true},choice:1,selectedKey:'fixture',submit(){sends++;},choose(){choices++;}});
    view.key({key:'enter'},context());view.key({key:'3'},context());view.command('approve',context());
    assert.equal(sends,0);assert.equal(choices,0);assert.equal(view.controller.pending,pending);
  }
  let sends=0;
  const row={sessionKey:'fixture',question:parseCodex(basicPrompt)};
  const regular=Object.assign(Object.create(Approvals.prototype),{compact:false,tab:'settings',controller:{rows:[row]},selectedKey:'fixture',choice:1,submit(){sends++;}});
  regular.command('approve',context());assert.equal(sends,0);
  regular.tab='requests';regular.command('approve',context());assert.equal(sends,1);
});

test('custom whole-second delays persist and update the owner without accepting invalid settings',()=>{
  check=false;state.clear();state.set('approvals.enabled',true);
  const controller=new ApprovalController({provider:{id:'native',list:async()=>[]},journal:new MemoryJournal()});
  const view=Object.assign(Object.create(Approvals.prototype),{controller,preview:false,closed:false,mode:'once',
    delayMs:3000,scope:'all',selectedSessions:[],refresh(){}});
  for(const ms of [1000,7000,3600000,3000,5000,10000]){
    view.setDelay(ms,context());
    assert.equal(state.get('approvals.delay'),ms);
    assert.equal(view.delayMs,ms);
    assert.equal(controller.delayMs,ms);
  }
  for(const invalid of ['',null,undefined,NaN,Infinity,-1000,0,999,1500,3600001,3601000,'7000']){
    const before=state.get('approvals.delay');
    view.setDelay(invalid,context());
    assert.equal(state.get('approvals.delay'),before,`invalid ${String(invalid)} must not persist`);
    assert.equal(controller.delayMs,before);
  }
});

test('a custom delay survives a fresh view and shared setting synchronization',()=>{
  check=true;state.clear();state.set('approvals.delay',7000);
  const view=new Approvals(),cx=context();
  view.init({},cx);
  assert.equal(view.delayMs,7000);
  assert.equal(view.controller.delayMs,7000);
  view.preview=false;view.closed=false;
  state.set('approvals.delay',12000);
  view.syncSettings();
  assert.equal(view.delayMs,12000);
  assert.equal(view.controller.delayMs,12000);
  view.close();
});

test('popup relay accepts custom delays and rejects invalid values without changing the owner',async()=>{
  const {owner,controller,cx}=await ownerModel();
  const {popup}=presentation(owner,cx);
  assert.equal(await popup.relay({action:'delay',value:7000}),true);
  assert.equal(state.get('approvals.delay'),7000);
  assert.equal(controller.delayMs,7000);
  for(const invalid of [0,1500,3601000,NaN,'7000']){
    assert.equal(await popup.relay({action:'delay',value:invalid}),false);
    assert.equal(state.get('approvals.delay'),7000);
    assert.equal(controller.delayMs,7000);
  }
  popup.close();owner.close();
});

test('reviewing one agent in a popup preserves another agent countdown',async()=>{
  const {owner,controller,cx,row}=await ownerModel();
  const second={...row,sessionKey:'second-fixture',address:'t2'};
  controller.provider.list=async()=>[row,second];
  controller.provider.readQuestion=async request=>request.sessionKey===row.sessionKey?row:second;
  await controller.refresh();
  owner.review(row,cx);
  assert.equal(controller.pending.sessionKey,second.sessionKey);
  assert.equal(controller.pending.deadline,3000);
  assert.equal(overlays.at(-1).props.tab,'requests');
  owner.close();
});

test('editing a delay draft does not save until Apply and invalid text leaves the saved delay unchanged',async()=>{
  const {owner,controller,cx}=await ownerModel();
  owner.initDelayInput(cx);
  owner.delayInput.set_value('7');
  owner.delayInput.emit('change',cx);
  assert.equal(state.has('approvals.delay'),false,'typing cannot change the setting');
  assert.equal(controller.delayMs,3000);
  assert.equal(await owner.applyDelayInput(cx),true);
  assert.equal(state.get('approvals.delay'),7000);
  assert.equal(controller.delayMs,7000);
  for(const text of ['', ' ', 'NaN', '-1', '0', '1.5', '1e2', '3601']){
    owner.delayInput.set_value(text);
    owner.delayInput.emit('change',cx);
    assert.equal(await owner.applyDelayInput(cx),false,`invalid text ${JSON.stringify(text)} must be refused`);
    assert.equal(state.get('approvals.delay'),7000);
    assert.equal(controller.delayMs,7000);
  }
  owner.preview=true;
  owner.delayInput.set_value('9');
  assert.equal(await owner.applyDelayInput(cx),false,'preview cannot save a valid draft');
  assert.equal(state.get('approvals.delay'),7000);
  owner.close();
});

test('the custom delay input accepts both whole-second limits and Enter uses the same Apply action',async()=>{
  const {owner,controller,cx}=await ownerModel();
  owner.initDelayInput(cx);
  for(const [text,ms] of [['1',1000],['3600',3600000]]){
    owner.delayInput.set_value(text);
    assert.equal(await owner.applyDelayInput(cx),true);
    assert.equal(state.get('approvals.delay'),ms);
    assert.equal(controller.delayMs,ms);
  }
  owner.delayInput.set_value('7');
  await owner.delayInput.emit('submit',cx);
  assert.equal(state.get('approvals.delay'),7000);
  assert.equal(controller.delayMs,7000);
  owner.delayInput.set_value('1.5');
  await owner.delayInput.emit('submit',cx);
  assert.equal(state.get('approvals.delay'),7000,'Enter cannot bypass input validation');
  owner.close();
});

test('popup delay drafts stay local and Apply or Enter reaches only the current input owner mailbox',async()=>{
  const {owner,controller,cx}=await ownerModel();
  owner.initDelayInput(cx);
  owner.delayInput.set_value('9');
  const {popup,popupCx}=presentation(owner,cx);
  assert.ok(popup.delayInput,'a settings popup owns retained input state');
  assert.notEqual(popup.delayInput,owner.delayInput);
  popup.delayInput.set_value('7');
  popup.delayInput.emit('change',popupCx);
  assert.equal(owner.delayInput.value(),'9','a popup draft cannot edit another view input');
  assert.equal(state.has('approvals.delay'),false);
  const apply=owner.setDelay.bind(owner);
  let ownerActions=0;
  owner.setDelay=(value,taskContext)=>{
    ownerActions++;
    assert.equal(taskContext,cx,'the original owner context applies the setting');
    return apply(value,taskContext);
  };
  assert.equal(await popup.applyDelayInput(popupCx),true);
  assert.equal(ownerActions,1);
  assert.equal(state.get('approvals.delay'),7000);
  assert.equal(controller.delayMs,7000);
  popup.delayInput.set_value('11');
  await popup.delayInput.emit('submit',popupCx);
  assert.equal(ownerActions,2);
  assert.equal(state.get('approvals.delay'),11000);
  popup.delayInput.set_value('12');
  popup.close();
  assert.equal(await popup.applyDelayInput(popupCx),false);
  assert.equal(ownerActions,2,'closed popup capabilities cannot mutate settings');
  assert.equal(state.get('approvals.delay'),11000);
  owner.close();
});
