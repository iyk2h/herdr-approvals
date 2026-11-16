from pathlib import Path
import json
import os
import shutil
import subprocess
import tempfile
import time

root = Path(__file__).resolve().parents[1]
temporary_root = '/private/tmp' if Path('/private/tmp').is_dir() else '/tmp'
scratch = Path(tempfile.mkdtemp(prefix='ha-ui-', dir=temporary_root))
app = shutil.which('herdr-app')
assert app, 'herdr-app must be on PATH'
env = dict(os.environ)
env.pop('HC_SOCKET', None)
env.pop('HC_TERMINAL_ID', None)
env['HERDR_APP_HOME'] = str(scratch)
env['HC_SESSION'] = 'ha-ui-' + str(os.getpid())
for key in ('XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_STATE_HOME','XDG_DATA_HOME','XDG_RUNTIME_DIR'):
    directory=scratch/key.lower();directory.mkdir(mode=0o700);env[key]=str(directory)
shutil.copytree(root/'mods/approvals',scratch/'mods/approvals')
(scratch/'layouts').mkdir()
(scratch/'layouts/approvals-preview.json').write_text(json.dumps({'id':'root','type':'row','divider':{'width':1,'color':'border'},'children':[{'id':'approval-requests','type':'block','size':{'weight':1},'content':{'mod':'approvals','props':{'preview':True,'tab':'requests'}}},{'id':'approval-settings','type':'block','size':{'weight':1},'content':{'mod':'approvals','props':{'preview':True,'tab':'settings'}}}]}))
(scratch/'shared.json').write_text(json.dumps({'layout':'approvals-preview','frame.welcomed':'skipped'}))
(scratch/'settings.json').write_text(json.dumps({'zoom':1.0,'font_size':14,'ui_font_size':13}))
(scratch/'keys.json').write_text(json.dumps({'global':{}}))
version = subprocess.run([app,'--version'],capture_output=True,text=True,check=True).stdout.strip().split()[-1]
(scratch/'update-notes.json').write_text(json.dumps({'last_run':version,'presented':[]}))
(scratch/'window.json').write_text(json.dumps({'state':'windowed','bounds':[80,80,760,980]}))

def command(args, timeout=10):
    result=subprocess.run([app,*args],env=env,capture_output=True,text=True,timeout=timeout)
    if result.returncode: raise RuntimeError(result.stderr or result.stdout)
    return result.stdout

process=None
with (scratch/'preview.log').open('w') as log:
    try:
        process=subprocess.Popen([app],env=env,stdout=log,stderr=log,start_new_session=True)
        for _ in range(160):
            if (scratch/'herdr-app.sock').exists(): break
            if process.poll() is not None: raise RuntimeError((scratch/'preview.log').read_text()[-2000:])
            time.sleep(0.1)
        else: raise RuntimeError('Preview window did not start')
        command(['do','layout.switch',json.dumps({'name':'approvals-preview'})])
        for _ in range(40):
            status=json.loads(command(['status']))
            if status.get('layout')=='approvals-preview' and not status.get('errors'): break
            time.sleep(0.1)
        assert not status.get('errors'), status.get('errors')
        for overlay in status.get('overlays',[]):
            command(['do','overlay.close',json.dumps({'id':overlay.get('id') if isinstance(overlay,dict) else overlay})])
        time.sleep(0.5)
        command(['shot',str(root/'preview.png')])
        result={'isolated_app_home':str(scratch),'cockpit_installed':False,'preview_only':True,'errors':status.get('errors',[]),'screenshot':'preview.png'}
        (root/'preview-result.json').write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps(result,indent=2))
    finally:
        if process and process.poll() is None:
            try:command(['do','app.quit'])
            except Exception:process.terminate()
        subprocess.run(['hc','server','stop','--json'],env=env,capture_output=True,text=True,timeout=10)
