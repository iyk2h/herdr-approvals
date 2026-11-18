"""Capture the real strip and popup views with isolated, fictional requests."""
from pathlib import Path
import argparse
import json
import os
import shutil
import subprocess
import tempfile
import time

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--view', choices=['all', 'settings', 'requests', 'agents', 'updates'], default='all')
parser.add_argument('--selected', action='store_true', help='Capture only the agent picker.')
options = parser.parse_args()
views = ['agents'] if options.selected else ['settings', 'requests', 'agents'] if options.view == 'all' else [options.view]
app = shutil.which('herdr-app')
assert app, 'herdr-app must be on PATH'
temporary_root = '/private/tmp' if Path('/private/tmp').is_dir() else '/tmp'

driver = r'''
import Base from './view.js';
import {panel} from './ui.js';
import {checking,nextCommand,props} from 'herdr';
export default class Preview extends Base {
  init(options,cx) {
    const p=options??props()??{};
    if(p.presentation){super.init(p,cx);return;}
    super.init({...p,preview:true,compact:true},cx);
    if(checking())return;
    if(p.settings){this.controller.rows=[];this.controller.pending=null;}
    if(p.updates){
      this.controller.rows=[];this.controller.pending=null;
      this.updater.phase='available';
      this.updater.release={version:'0.3.0',available:true,notes:'- Show release notes before installation.\n- Preserve your settings and panel placement.\n- Save a complete backup before replacement.',url:'https://github.com/iyk2h/herdr-approvals/releases/tag/v0.3.0'};
    }
    if(p.agents){
      this.scope='selected';this.selectedSessions=['preview'];
      this.sessionCatalog.push({...this.sessionCatalog[0],sessionKey:'preview-working',address:'fixture-working',title:'Codex · Build app',status:'working'});
    }
    this.controller.provider={id:'preview',list:async()=>[],readQuestion:async()=>null,submit:async()=>{throw new Error('Preview cannot send input');}};
    this.preview=false;
    this.refresh=()=>{};this.syncSettings=()=>{};this.schedule=()=>{};
    this.ensurePresentationOwner(cx);
    cx.spawn(async cx=>{while(!this.closed){
      const name=await nextCommand();
      if(['settings','requests','updates'].includes(name))this.command(name,cx);
    }});
  }
  render(cx) {
    if(this.controller?.pending)this.controller.pending.deadline=Date.now()+3000;
    const view=this.presentation?this.presentationView():{...this,controller:this.controller};
    return panel({...view,preview:true,key:()=>false},cx);
  }
}
'''

background = r'''
import {View,div} from 'gpui-kit';
import {v_flex} from 'gpui-base';
import {theme,props} from 'herdr';
export default class Demo extends View {
  render(){
    const t=theme(),p=props()??{};
    const muted=text=>div().text_size(12).text_color(t.muted).child(text);
    const root=v_flex().size_full().min_w(0).p(20).gap(18).bg(t.background).text_color(t.foreground);
    if(p.zone==='footer')return root.p(12).gap(0).child(muted('Demo layout · Fictional agents'));
    if(p.zone!=='sidebar')return root.child(muted('Example workspace'));
    root.child(div().text_size(16).font_semibold().child('Demo agents'));
    for(const [name,status] of [['Run tests','Working'],['Build app','Ready']]){
      root.child(v_flex().gap(6).p(12).rounded(8).bg(t.raised||t.surface)
        .child(div().text_size(13).font_medium().child(name)).child(muted('Codex · '+status)));
    }
    return root.child(muted('Approval controls stay in one row.'));
  }
}
'''

def capture(view):
    scratch = Path(tempfile.mkdtemp(prefix='ha-ui-', dir=temporary_root))
    env = dict(os.environ)
    for key in ('HC_SOCKET', 'HC_TERMINAL_ID'):
        env.pop(key, None)
    env['HERDR_APP_HOME'] = str(scratch)
    env['HC_SESSION'] = 'ha-ui-' + scratch.name
    for key in ('XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_STATE_HOME','XDG_DATA_HOME','XDG_RUNTIME_DIR'):
        directory = scratch/key.lower()
        directory.mkdir(mode=0o700)
        env[key] = str(directory)
    mod = scratch/'mods/approvals'
    shutil.copytree(root/'mods/approvals', mod)
    (mod/'main.js').rename(mod/'view.js')
    (mod/'main.js').write_text(driver)
    (mod/'mod.json').write_text('{"place":"none","title":"Approval preview"}')
    (mod/'host.js').write_text("const blocked=async()=>{throw new Error('Preview host IO is disabled');};export const host={hc:blocked};export const journalHost={read:blocked,write:blocked};export const updateHost={latest:blocked,install:blocked,receipt:blocked};export const rpc=blocked;export const cockpitInfo=blocked;")
    context = scratch/'mods/preview-background'
    context.mkdir()
    (context/'mod.json').write_text('{"place":"none"}')
    (context/'main.js').write_text(background)
    strip = {'id':'approval-widget','type':'block','size':{'px':40},'content':{'mod':'approvals','props':{'panelId':'approval-widget','agents':view=='agents','settings':view=='settings','updates':view=='updates'}}}
    backdrop = lambda zone: {'id':'preview-'+zone,'type':'block','size':{'weight':1},'content':{'mod':'preview-background','props':{'zone':zone}}}
    if view == 'settings':
        layout = {'id':'root','type':'row','divider':{'width':1,'color':'border'},'children':[
            {'id':'demo-sidebar','type':'column','size':{'px':360},'children':[backdrop('sidebar'),strip]},backdrop('workspace')]}
        width, height = 1080, 880
    else:
        layout = {'id':'root','type':'column','children':[backdrop('footer'),strip]}
        width, height = 540, 640 if view=='updates' else 800 if view=='requests' else 880
    (scratch/'layouts').mkdir()
    (scratch/'layouts/approval-preview.json').write_text(json.dumps(layout))
    (scratch/'shared.json').write_text('{"layout":"approval-preview","frame.welcomed":"skipped"}')
    (scratch/'settings.json').write_text('{"zoom":1,"font_size":14,"ui_font_size":13}')
    (scratch/'keys.json').write_text('{"global":{}}')
    version = subprocess.run([app,'--version'],capture_output=True,text=True,check=True).stdout.strip().split()[-1]
    (scratch/'update-notes.json').write_text(json.dumps({'last_run':version,'presented':[]}))
    (scratch/'window.json').write_text(json.dumps({'state':'windowed','bounds':[80,80,width,height]}))

    def call(*args):
        return subprocess.run([app,*args],env=env,capture_output=True,text=True,check=True,timeout=20).stdout.strip()

    process = None
    image_name = {'settings':'preview.png','requests':'requests-preview.png','agents':'agents-preview.png','updates':'updates-preview.png'}[view]
    try:
        with (scratch/'preview.log').open('w') as log:
            process = subprocess.Popen([app],env=env,stdout=log,stderr=log,start_new_session=True)
        for _ in range(150):
            if (scratch/'herdr-app.sock').exists():
                break
            if process.poll() is not None:
                raise RuntimeError((scratch/'preview.log').read_text()[-2000:])
            time.sleep(.1)
        else:
            raise RuntimeError('Preview app did not start')
        call('check',str(mod))
        call('do','layout.switch','{"name":"approval-preview"}')
        time.sleep(.4)
        for overlay in json.loads(call('status')).get('overlays',[]):
            call('do','overlay.close',json.dumps({'id':overlay.get('id') if isinstance(overlay,dict) else overlay}))
        call('do','approvals.updates' if view=='updates' else 'approvals.requests' if view=='requests' else 'approvals.settings')
        for _ in range(40):
            status = json.loads(call('status'))
            assert not status.get('errors'), status.get('errors')
            if status.get('overlays'):
                break
            time.sleep(.1)
        else:
            raise RuntimeError('Native popup did not open')
        time.sleep(.3)
        call('shot',str(root/image_name))
        return {'view':view,'screenshot':image_name,'isolated_app_home':str(scratch),'native_popup':True,'host_io_disabled':True,'errors':status.get('errors',[])}
    finally:
        if process and process.poll() is None:
            try:
                call('do','app.quit')
            except Exception:
                process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        subprocess.run(['hc','server','stop','--json'],env=env,capture_output=True,text=True,timeout=10)

result = [capture(view) for view in views]
(root/'preview-result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
