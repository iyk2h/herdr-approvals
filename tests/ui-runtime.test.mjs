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
globalThis.__approvalReleasedAccesses=0;
globalThis.__approvalInput=(options={})=>{
  let value=options.value??'',released=false;const events=new Map();
  const usable=()=>{if(released){globalThis.__approvalReleasedAccesses++;throw new Error('Input state is released');}};
  return {value:()=>{usable();return value;},set_value:next=>{usable();value=next;},on:(name,callback)=>{events.set(name,callback);return true;},
    emit:(name,cx)=>events.get(name)?.({},cx),focus(){},release(){released=true;return true;}};
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
const {panel}=await import('../mods/approvals/ui.js');
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

test('repeated settings popups preserve one input owner and revoke every closed popup',async()=>{
  const {owner,controller,cx}=await ownerModel();
  const pending=controller.pending;
  const originalSpawn=cx.spawn;
  let ownerTasks=0;
  cx.spawn=fn=>{ownerTasks++;return originalSpawn(fn);};
  globalThis.__approvalReleasedAccesses=0;
  for(let index=0;index<30;index++){
    const {popup,popupCx}=presentation(owner,cx);
    assert.equal(popup.controller,controller);
    popup.render(popupCx);
    assert.equal(popupCx.scheduled.length,0,'a settings popup cannot own a countdown timer');
    popup.close();
    owner.changed(cx);
    await Promise.resolve();
    assert.equal(await popup.relay({action:'delay',value:7000}),false,'closed popups lose their capability');
    assert.equal(popup.applyDelayInput(popupCx),false,'closed inputs cannot apply a draft');
    assert.equal(controller.pending,pending,'opening and closing settings cannot restart the current deadline');
    assert.equal(controller.enabled,true);
    assert.equal(globalThis.__approvalReleasedAccesses,0);
  }
  await controller.flush();
  assert.deepEqual(await controller.journal.entries(),[],'settings navigation cannot create input or cancellation records');
  assert.equal(state.has('approvals.delay'),false,'navigation cannot save a new setting');
  assert.equal(ownerTasks,1,'the owner creates one action consumer for all popup instances');
  assert.ok(!commands.some(({name})=>name==='agent.focus'));
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

test('quarantined requests reject Enter, approval commands, and stale callbacks before a submission task starts',async()=>{
  check=false;
  const results=[];
  for(const action of ['enter','approve','stale-submit']){
    let submissions=0,spawns=0;
    const tasks=[];
    const row={sessionKey:'fixture',episode:'1',address:'t1',agent:'codex',status:'blocked',
      question:parseCodex(basicPrompt),quarantined:true};
    const controller={rows:[row],async submit(){submissions++;return{status:'unknown'};}};
    const view=Object.assign(Object.create(Approvals.prototype),{compact:false,tab:'requests',controller,
      preview:false,closed:false,busy:false,choice:1,selection:null,selectedKey:row.sessionKey});
    const cx=context();
    cx.spawn=fn=>{spawns++;const task=fn(cx);tasks.push(task);return task;};
    if(action==='enter')view.key({key:'enter'},cx);
    else if(action==='approve')view.command('approve',cx);
    else view.submit({...row,quarantined:false},cx);
    await Promise.all(tasks);
    results.push({action,submissions,spawns});
  }
  assert.deepEqual(results,[{action:'enter',submissions:0,spawns:0},{action:'approve',submissions:0,spawns:0},
    {action:'stale-submit',submissions:0,spawns:0}],
    'disabled requests cannot start controller submission or persistence work through keyboard shortcuts');
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

test('an untouched delay input follows saved changes from another view without writing settings',async()=>{
  const {owner,controller,cx}=await ownerModel();
  owner.initDelayInput(cx);
  assert.equal(owner.delayInput.value(),'3');
  state.set('approvals.delay',7000);
  const before=new Map(state);
  owner.syncSettings();
  assert.equal(owner.delayInput.value(),'7','a pristine field must show the actual saved duration');
  assert.equal(controller.delayMs,7000);
  assert.deepEqual(state,before,'updating a field is not a setting change');
  owner.close();
});

test('an external delay change preserves unsaved and invalid input drafts',async()=>{
  const {owner,cx}=await ownerModel();
  owner.initDelayInput(cx);
  for(const [draft,external] of [['9',7000],['0',11000]]){
    owner.delayInput.set_value(draft);
    owner.delayInput.emit('change',cx);
    state.set('approvals.delay',external);
    owner.syncSettings();
    assert.equal(owner.delayInput.value(),draft,'a settings update cannot erase user input');
    assert.equal(state.get('approvals.delay'),external,'an unsaved draft cannot replace the external setting');
  }
  assert.equal(await owner.applyDelayInput(cx),false,'an invalid preserved draft still requires correction');
  assert.equal(state.get('approvals.delay'),11000);
  owner.close();
});

test('a successfully applied delay becomes pristine for the next external update',async()=>{
  const {owner,cx}=await ownerModel();
  owner.initDelayInput(cx);
  owner.delayInput.set_value('7');
  owner.delayInput.emit('change',cx);
  assert.equal(await owner.applyDelayInput(cx),true);
  state.set('approvals.delay',11000);
  owner.syncSettings();
  assert.equal(owner.delayInput.value(),'11','Apply must finish the edit instead of preserving a stale saved draft');
  owner.close();
});

test('a live popup synchronizes pristine delay input but preserves edits and never accesses released state',async()=>{
  const {owner,cx}=await ownerModel();
  owner.initDelayInput(cx);
  const {popup,popupCx}=presentation(owner,cx);
  state.set('approvals.delay',7000);
  owner.syncSettings();owner.changed(cx);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(popup.delayInput.value(),'7','the popup update task must synchronize its own input');
  popup.delayInput.set_value('9');popup.delayInput.emit('change',popupCx);
  state.set('approvals.delay',11000);
  owner.syncSettings();owner.changed(cx);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(popup.delayInput.value(),'9','an owner update cannot replace an unfinished popup draft');
  assert.equal(await popup.applyDelayInput(popupCx),true);
  await new Promise(resolve=>setImmediate(resolve));
  state.set('approvals.delay',13000);
  owner.syncSettings();owner.changed(cx);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(popup.delayInput.value(),'13','a saved popup draft follows later external changes');
  globalThis.__approvalReleasedAccesses=0;
  owner.changed(cx);popup.close();
  state.set('approvals.delay',15000);owner.syncSettings();owner.changed(cx);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(globalThis.__approvalReleasedAccesses,0);
  owner.close();
});

for(const location of ['owner','popup']){
  for(const draft of [null,'5']){
    test(`immediate Apply in the ${location} respects an external delay and ${draft===null?'does not resave pristine text':'preserves an explicit user draft'}`,async()=>{
      const {owner,controller,cx}=await ownerModel();
      owner.initDelayInput(cx);
      let view=owner,taskContext=cx,popup=null;
      if(location==='popup'){
        const opened=presentation(owner,cx);
        view=opened.popup;taskContext=opened.popupCx;popup=opened.popup;
      }
      if(draft!==null){view.delayInput.set_value(draft);view.delayInput.emit('change',taskContext);}
      state.set('approvals.delay',7000);
      view.render(taskContext);
      assert.equal(await view.applyDelayInput(taskContext),true);
      const expected=draft===null?7000:5000;
      assert.equal(state.get('approvals.delay'),expected,'Apply must use the latest saved duration unless the user actually edited this input');
      assert.equal(controller.delayMs,expected);
      assert.equal(view.delayInput.value(),String(expected/1000));
      popup?.close();owner.close();
    });
  }
}

function renderedText(view) {
  const previous=globalThis.__approvalElement,strings=[];
  globalThis.__approvalElement=()=>{
    let element;
    element=new Proxy({}, {get:(_target,key)=>key==='then'?undefined:(...args)=>{
      if(key==='child'&&typeof args[0]==='string')strings.push(args[0]);
      return element;
    }});
    return element;
  };
  try{panel(view,context());}
  finally{globalThis.__approvalElement=previous;}
  return strings.join('\n');
}

for(const [status,message] of [['sent','The panel sent your reply.'],['changed','The request changed. The panel stopped the reply.'],['dispatching','Reply in progress. Cancellation is no longer possible.']]){
  test(`${status} notice belongs only to the selected request identity`,async()=>{
    const {owner,controller,row}=await ownerModel();
    const second={...structuredClone(row),sessionKey:'other',episode:'other-episode',address:'t2',title:'Other fixture'};
    controller.rows.push(second);
    controller.status=status;
    const view={...owner,compact:false,presentation:false,tab:'requests',controller};
    controller.statusRequest={sessionKey:second.sessionKey,episode:second.episode,fingerprint:second.question.fingerprint};
    assert.ok(!renderedText(view).includes(message),'a sibling reply cannot claim progress or success for the selected request');
    controller.statusRequest={sessionKey:row.sessionKey,episode:row.episode,fingerprint:row.question.fingerprint};
    assert.ok(renderedText(view).includes(message),'the current request still shows its own status');
    controller.statusRequest={sessionKey:row.sessionKey,episode:'previous-episode',fingerprint:row.question.fingerprint};
    assert.ok(!renderedText(view).includes(message),'a previous episode cannot supply the selected request status');
    controller.statusRequest={sessionKey:row.sessionKey,episode:row.episode,fingerprint:'previous-command'};
    assert.ok(!renderedText(view).includes(message),'a replaced command cannot supply the selected request status');
    controller.error='Fixture connection error';
    assert.ok(renderedText(view).includes('Fixture connection error'),'global errors remain visible even when the selected request differs');
    owner.close();
  });
}

test('cancelling the selected request explains that another agent still counts down',async()=>{
  const {owner,controller,row}=await ownerModel();
  const second={...structuredClone(row),sessionKey:'other',episode:'other-episode',address:'t2'};
  controller.rows.push(second);
  controller.status='cancelled';
  controller.pending={sessionKey:second.sessionKey,episode:second.episode,fingerprint:second.question.fingerprint,deadline:3000};
  const view={...owner,compact:false,presentation:false,tab:'requests',controller,choice:null};
  assert.ok(renderedText(view).includes('Other requests continue to count down.'),'cancelling one request cannot imply that automatic approval stopped globally');
  owner.close();
});
