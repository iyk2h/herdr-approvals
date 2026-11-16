from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
temporary_root = '/private/tmp' if Path('/private/tmp').is_dir() else '/tmp'
scratch = Path(tempfile.mkdtemp(prefix='ha-check-', dir=temporary_root))
app = shutil.which('herdr-app')
assert app, 'herdr-app is required for native validation'
for variant in ('request','settings','selected','empty','unknown'):
    target=scratch/variant
    shutil.copytree(root/'mods/approvals', target, ignore=shutil.ignore_patterns('*.d.ts','jsconfig.json'))
    (target/'main.js').rename(target/'view.js')
    mutation = "this.controller.rows=[];this.controller.pending=null;" if variant=='empty' else "this.controller.pending=null;this.controller.status='unknown';this.controller.rows[0].quarantined=true;" if variant=='unknown' else "this.tab='settings';" if variant=='settings' else "this.tab='settings';this.scope='selected';this.selectedSessions=['preview'];this.sessionCatalog.push({...this.sessionCatalog[0],sessionKey:'preview-working',address:'fixture-working',title:'Codex · Build app',status:'working'});" if variant=='selected' else ''
    (target/'main.js').write_text("import Base from './view.js';import {sha256} from './digest.js';export default class Check extends Base{init(p,cx){if(sha256('abc')!=='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')throw new Error('Native digest mismatch');super.init(p,cx);"+mutation+"}}")
    subprocess.run([app,'check',str(target)],check=True,timeout=20)
print('PASS: actual native runtime digest + request/settings/selected/empty/unknown UI states')
