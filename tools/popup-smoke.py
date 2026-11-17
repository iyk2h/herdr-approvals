from pathlib import Path
import json, os, shutil, subprocess, tempfile, time

root = Path(__file__).resolve().parents[1]
app = shutil.which('herdr-app')
assert app, 'herdr-app is required for native popup validation'
temporary_root = '/private/tmp' if Path('/private/tmp').is_dir() else '/tmp'
scratch = Path(tempfile.mkdtemp(prefix='ha-r-', dir=temporary_root))
env = dict(os.environ)
for key in ('HC_SOCKET', 'HC_TERMINAL_ID'): env.pop(key, None)
env['HERDR_APP_HOME'] = str(scratch)
env['HC_SESSION'] = 'ha-r-' + str(os.getpid())
for key in ('XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_STATE_HOME','XDG_DATA_HOME','XDG_RUNTIME_DIR'):
    directory = scratch / key.lower(); directory.mkdir(mode=0o700); env[key] = str(directory)
mod = scratch / 'mods/approvals'
shutil.copytree(root / 'mods/approvals', mod)
(mod / 'main.js').rename(mod / 'view.js')
driver = r'''
import Base from './view.js';
import {panel} from './ui.js';
import {presentation} from './presentation-registry.js';
import {appHome,writeTextFile,props,nextCommand,checking} from 'herdr';
const revision=String(Date.now())+'-'+String(Math.random());
export default class Probe extends Base {
  record(event,cx) {
    const value={event,revision,popup:!!this.presentation,tab:this.tab,token:this.dialogToken,
      ownerId:this.ownerId,hasOwner:!!this.owner,ownerClosed:this.owner?.closed,
      available:!!presentation(this.ownerId,this.dialogToken),
      sameController:!this.presentation||this.owner?.controller===this.owner?.demoController,
      journalRecords:this.controller?.journal?.records?.size??0,at:Date.now()};
    cx.spawn(async()=>{await writeTextFile(appHome()+'/event-'+Date.now()+'-'+Math.random()+'.json',JSON.stringify(value),null);});
  }
  init(options,cx) {
    const p=options??props()??{};
    if(checking()){super.init({...p,preview:true},cx);return;}
    if(p.presentation){
      super.init(p,cx);this.record('popup-init',cx);
      if(this.tab==='settings')cx.spawn(async cx=>{
        const acknowledged=await this.relay({action:'delay',value:5000});
        this.record(acknowledged?'settings-ack':'settings-rejected',cx);
      });
      return;
    }
    super.init({...p,preview:true,compact:true},cx);
    this.controller.rows=[];this.controller.pending=null;this.controller.enabled=false;
    this.demoController=this.controller;
    this.preview=false;this.refresh=()=>{};this.syncSettings=()=>{};
    this.ensurePresentationOwner(cx);
    this.record('owner-init',cx);
    cx.spawn(async cx=>{while(!this.closed){
      const name=await nextCommand();
      if(name==='settings'||name==='requests'){this.command(name,cx);this.record('opened-'+name,cx);}
    }});
  }
  render(cx) {
    if(!this.presentation)return panel({...this,controller:this.controller,preview:true},cx);
    const view=this.presentationView();
    return panel({...view,preview:true},cx);
  }
  close(cx){if(!checking())this.record('close',cx);super.close();}
}
'''
(mod / 'main.js').write_text(driver)
background = scratch / 'mods/probe-background'; background.mkdir()
(background / 'mod.json').write_text('{"place":"none"}')
(background / 'main.js').write_text("import{View,div}from'gpui-kit';export default class Background extends View{render(){return div().size_full();}}")
(scratch / 'layouts').mkdir()
(scratch / 'layouts/demo.json').write_text(json.dumps({'id':'root','type':'column','children':[
    {'id':'background','type':'block','size':{'weight':1},'content':{'mod':'probe-background'}},
    {'id':'probe-strip','type':'block','size':{'px':40},'content':{'mod':'approvals','props':{'compact':True,'panelId':'probe-strip'}}}]}))
(scratch / 'shared.json').write_text('{"layout":"demo","frame.welcomed":"skipped"}')
(scratch / 'keys.json').write_text('{"global":{}}')
version = subprocess.run([app,'--version'],capture_output=True,text=True,check=True).stdout.strip().split()[-1]
(scratch / 'update-notes.json').write_text(json.dumps({'last_run':version,'presented':[]}))
(scratch / 'window.json').write_text('{"state":"windowed","bounds":[80,80,800,850]}')
def call(*args):
    return subprocess.run([app,*args],env=env,capture_output=True,text=True,check=True,timeout=20).stdout.strip()
def events():
    return sorted([json.loads(p.read_text()) for p in scratch.glob('event-*.json')],key=lambda e:e['at'])
def open_popup(tab):
    previous={e.get('token') for e in events() if e['event']=='popup-init'}
    call('do','approvals.'+tab)
    deadline=time.monotonic()+4
    while time.monotonic()<deadline:
        values=events()
        fresh=[e for e in values if e['event']=='popup-init' and e.get('token') not in previous]
        if fresh:
            current=fresh[-1]
            if not current['available'] or tab!='settings' or any(e['event']=='settings-ack' and e.get('token')==current['token'] for e in values):
                return current
        time.sleep(.05)
    raise RuntimeError('Popup or settings acknowledgement did not arrive: '+json.dumps(events()[-5:]))
process = None
try:
    with (scratch / 'app.log').open('w') as log:
        process = subprocess.Popen([app],env=env,stdout=log,stderr=log,start_new_session=True)
    for _ in range(150):
        if (scratch / 'herdr-app.sock').exists() and any(e['event']=='owner-init' for e in events()):break
        time.sleep(.1)
    else:raise RuntimeError('App did not start: '+(scratch/'app.log').read_text()[-1500:])
    result = []
    for index,tab in enumerate(['settings','requests','settings','requests','settings']):
        if index == 2:
            call('check',str(mod))
            time.sleep(.5)
        if index == 3:
            os.utime(scratch / 'mods', None)
            time.sleep(.6)
        current = open_popup(tab)
        assert current['available'] and current['tab']==tab and current['sameController'], current
        assert current['journalRecords']==0, current
        if tab=='settings':
            assert any(e['event']=='settings-ack' and e.get('token')==current['token'] for e in events()), current
        result.append({'step':index,'tab':tab,'result':current})
        call('shot',str(scratch / ('popup-'+str(index)+'.png')))
        if index != 3: call('do','overlay.close')
        time.sleep(.2)
    assert result[3]['result']['revision']!=result[0]['result']['revision'], 'Rescan must load a separate code revision'
    assert len({item['result']['ownerId'] for item in result})==1, 'A rescan cannot replace the input owner'
    call('do','approvals.settings');time.sleep(.3)
    (mod/'main.js').write_text(driver+'\n// reload probe\n')
    time.sleep(1)
    call('do','overlay.close');time.sleep(.2)
    current=open_popup('settings')
    assert current['available'] and current['tab']=='settings' and current['sameController'], current
    assert current['ownerId']!=result[0]['result']['ownerId'], 'A source reload must register a new owner'
    assert any(e['event']=='settings-ack' and e.get('token')==current['token'] for e in events()), current
    result.append({'step':'reload','tab':'settings','result':current})
    status=json.loads(call('status'));assert not status['errors'],status
    (scratch/'result.json').write_text(json.dumps({'steps':result,'events':events(),'status':status},indent=2))
    print(json.dumps({'artifacts':str(scratch),'checks':len(result),'settings_actions_acknowledged':True,'errors':status['errors']}))
finally:
    if process and process.poll() is None:
        try:call('do','app.quit')
        except Exception:process.terminate()
    subprocess.run(['hc','server','stop','--json'],env=env,capture_output=True,text=True,timeout=10)
