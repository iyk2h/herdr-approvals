from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
temporary_root = '/private/tmp' if Path('/private/tmp').is_dir() else '/tmp'
scratch = Path(tempfile.mkdtemp(prefix='ha-check-', dir=temporary_root))
app = shutil.which('herdr-app')
assert app, 'herdr-app is required for native validation'
mutations = {
    'request': '',
    'settings': "this.tab='settings';",
    'selected': "this.tab='settings';this.scope='selected';this.selectedSessions=['preview'];this.sessionCatalog.push({...this.sessionCatalog[0],sessionKey:'preview-working',address:'fixture-working',title:'Codex · Build app',status:'working'});",
    'empty': 'this.controller.rows=[];this.controller.pending=null;',
    'unknown': "this.controller.pending=null;this.controller.status='unknown';this.controller.rows[0].quarantined=true;",
    'compact-pending': 'this.compact=true;',
    'compact-empty': 'this.compact=true;this.controller.rows=[];this.controller.pending=null;',
    'compact-settings': "this.compact=true;this.expanded=true;this.tab='settings';",
}
for variant, mutation in mutations.items():
    target=scratch/variant
    shutil.copytree(root/'mods/approvals', target, ignore=shutil.ignore_patterns('*.d.ts','jsconfig.json'))
    (target/'main.js').rename(target/'view.js')
    (target/'main.js').write_text("import Base from './view.js';import {sha256} from './digest.js';export default class Check extends Base{init(p,cx){if(sha256('abc')!=='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')throw new Error('Native digest mismatch');super.init(p,cx);"+mutation+"}}")
    subprocess.run([app,'check',str(target)],check=True,timeout=20)
print('PASS: actual native runtime digest + eight full and compact UI states')
