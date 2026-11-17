from pathlib import Path
import json
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
temporary_root = '/private/tmp' if Path('/private/tmp').is_dir() else '/tmp'
scratch = Path(tempfile.mkdtemp(prefix='ha-check-', dir=temporary_root))
app = shutil.which('herdr-app')
assert app, 'herdr-app is required for native validation'
input_prompt = r'''Would you like to send input to terminal 24680?

Environment: local

Reason: Send input to an existing terminal.

Input: "\u{3}"

❯ 1. Yes, proceed (y)
  2. No, and tell Codex what to do differently (esc)

Press enter to confirm or esc to cancel'''
mutations = {
    'request': '',
    'terminal-input': 'this.controller.rows[0].question=parseCodex('+json.dumps(input_prompt)+');if(!this.controller.rows[0].question)throw new Error("Terminal input permission was not recognized");this.controller.pending=null;',
    'settings': "this.tab='settings';",
    'custom-settings': "this.tab='settings';this.delayMs=7000;this.delayInput.set_value('7');",
    'selected': "this.tab='settings';this.scope='selected';this.selectedSessions=['preview'];this.sessionCatalog.push({...this.sessionCatalog[0],sessionKey:'preview-working',address:'fixture-working',title:'Codex · Build app',status:'working'});",
    'empty': 'this.controller.rows=[];this.controller.pending=null;',
    'unknown': "this.controller.pending=null;this.controller.status='unknown';this.controller.rows[0].quarantined=true;",
    'compact-pending': 'this.compact=true;',
    'compact-empty': 'this.compact=true;this.controller.rows=[];this.controller.pending=null;',
    'compact-error': "this.compact=true;this.controller.rows=[];this.controller.pending=null;this.controller.error='Fixture connection error';",
    'compact-long': "this.compact=true;this.delayMs=3600000;this.controller.pending.deadline=Date.now()+3600000;",
}
for variant, mutation in mutations.items():
    target=scratch/variant
    shutil.copytree(root/'mods/approvals', target, ignore=shutil.ignore_patterns('*.d.ts','jsconfig.json'))
    (target/'main.js').rename(target/'view.js')
    (target/'main.js').write_text("import Base from './view.js';import {sha256} from './digest.js';import {parseCodex} from './parsers/codex.js';export default class Check extends Base{init(p,cx){if(sha256('abc')!=='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')throw new Error('Native digest mismatch');super.init(p,cx);"+mutation+"}}")
    subprocess.run([app,'check',str(target)],check=True,timeout=20)
print('PASS: actual native runtime digest + eleven full and compact UI states')
