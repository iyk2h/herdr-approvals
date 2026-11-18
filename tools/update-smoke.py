"""Exercise an actual native self-update with local release files and an empty core."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time


root = Path(__file__).resolve().parents[1]
app = shutil.which('herdr-app')
assert app, 'herdr-app is required'
temporary_root = '/private/tmp' if Path('/private/tmp').is_dir() else '/tmp'
scratch = Path(tempfile.mkdtemp(prefix='ha-update-smoke-', dir=temporary_root))
env = dict(os.environ)
for key in ('HC_SOCKET', 'HC_TERMINAL_ID'):
    env.pop(key, None)
env['HERDR_APP_HOME'] = str(scratch)
env['HC_SESSION'] = 'hu-' + scratch.name.rsplit('-', 1)[-1]
for key in ('XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR'):
    directory = scratch / key.lower()
    directory.mkdir(mode=0o700)
    env[key] = str(directory)
fixtures = scratch / 'fixture-assets'
result = subprocess.run([sys.executable, str(root / 'tools/build-release.py'), '--output', str(fixtures)],
                        capture_output=True, text=True, check=True)
release = json.loads(result.stdout)
version = release['version']
base = f'https://github.com/iyk2h/herdr-approvals/releases/download/v{version}'
metadata = {'tag_name': 'v' + version, 'draft': False, 'prerelease': False,
            'html_url': f'https://github.com/iyk2h/herdr-approvals/releases/tag/v{version}',
            'body': '- Fixture native update.\n- Preserve settings and placement.',
            'assets': [{'name': Path(release[key]).name, 'browser_download_url': base + '/' + Path(release[key]).name}
                       for key in ('archive', 'checksum')]}
(fixtures / 'release.json').write_text(json.dumps(metadata))
binary = scratch / 'fixture-bin'
binary.mkdir()
backup_home = scratch / 'fixture-home'
backup_home.mkdir()
(binary / 'python3').write_text('#!' + sys.executable + '\nimport os,sys\nos.environ["HOME"]=' + repr(str(backup_home))
                               + '\nos.execv(sys.executable,[sys.executable,*sys.argv[1:]])\n')
(binary / 'python3').chmod(0o755)
(binary / 'curl').write_text('#!' + sys.executable + '\n' + '''from pathlib import Path
import json, shutil, sys
folder=Path(__file__).resolve().parents[1]/'fixture-assets'
args=sys.argv[1:]
url=args[-1]
if url=='https://api.github.com/repos/iyk2h/herdr-approvals/releases/latest':
    sys.stdout.write((folder/'release.json').read_text()+'\\n200')
elif '--url' in args:
    url=args[args.index('--url')+1]
    metadata=json.loads((folder/'release.json').read_text())
    asset=next((item for item in metadata['assets'] if item['browser_download_url']==url),None)
    if not asset: raise SystemExit('Unexpected fixture URL')
    shutil.copyfile(folder/asset['name'],Path(args[args.index('--output')+1]))
else: raise SystemExit('Unexpected fixture curl request')
''')
(binary / 'curl').chmod(0o755)
env['PATH'] = str(binary) + os.pathsep + env.get('PATH', '')
mod = scratch / 'mods/approvals'
shutil.copytree(root / 'mods/approvals', mod, ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.d.ts', 'jsconfig.json'))
(mod / 'version.js').write_text("export const VERSION = '0.1.9';\n")
(mod / 'mod.json').write_text('{"place":"none","title":"Personal Approval","focusable":true,"fixture_placement":"keep"}')
(mod / 'main.js').rename(mod / 'view.js')
(mod / 'main.js').write_text('''import Base from './view.js';
import {setShared} from 'herdr';
export default class Fixture extends Base {
  command(name,cx) {
    if(name==='fixture-install'){
      setShared('fixture.install-detail',{phase:this.updater.phase,version:this.updater.version,error:this.updater.error,
        release:this.updater.release,canUpdate:this.canUpdate(),busy:this.busy,refreshing:this.refreshing,rows:this.controller.rows.length});
      setShared('fixture.install-started',this.installUpdate(cx));
    }
    else super.command(name,cx);
  }
}
''')
(mod / 'obsolete-fixture.js').write_text('export const obsolete = true;\n')
layout = {'id': 'root', 'type': 'column', 'children': [
    {'id': 'spacer', 'type': 'block', 'size': {'weight': 1}, 'content': {'mod': 'fixture-background'}},
    {'id': 'fixture-approval', 'type': 'block', 'size': {'px': 40},
     'content': {'mod': 'approvals', 'props': {'compact': True, 'panelId': 'fixture-approval'}}}]}
backdrop = scratch / 'mods/fixture-background'
backdrop.mkdir(parents=True)
(backdrop / 'mod.json').write_text('{"place":"none"}')
(backdrop / 'main.js').write_text("import {View,div} from 'gpui-kit';import {theme} from 'herdr';export default class Fixture extends View{render(){return div().size_full().p(16).text_color(theme().muted).child('Isolated update test · No agent terminals');}}")
(scratch / 'layouts').mkdir()
(scratch / 'layouts/update-fixture.json').write_text(json.dumps(layout))
saved = {'layout': 'update-fixture', 'frame.welcomed': 'skipped', 'approvals.enabled': True,
         'approvals.delay': 7000, 'approvals.scope': 'all', 'approvals.mode': 'once',
         'approvals.provider': 'native', 'fixture.keep': 'saved setting'}
(scratch / 'shared.json').write_text(json.dumps(saved))
(scratch / 'settings.json').write_text('{"zoom":1,"font_size":14,"ui_font_size":13}')
(scratch / 'keys.json').write_text('{"global":{}}')
app_version = subprocess.run([app, '--version'], capture_output=True, text=True, check=True).stdout.strip().split()[-1]
(scratch / 'update-notes.json').write_text(json.dumps({'last_run': app_version, 'presented': []}))
(scratch / 'window.json').write_text('{"state":"windowed","bounds":[100,100,600,700]}')


def call(*args, timeout=20):
    return subprocess.run([app, *args], env=env, capture_output=True, text=True, check=True, timeout=timeout).stdout.strip()


process = None
try:
    with (scratch / 'app.log').open('w') as log:
        process = subprocess.Popen([app], env=env, stdout=log, stderr=log, start_new_session=True)
    for _ in range(150):
        if (scratch / 'herdr-app.sock').exists():
            break
        if process.poll() is not None:
            raise RuntimeError((scratch / 'app.log').read_text()[-2000:])
        time.sleep(.1)
    else:
        raise RuntimeError('The isolated app did not start')
    call('do', 'layout.switch', '{"name":"update-fixture"}')
    call('do', 'approvals.updates')
    for _ in range(80):
        call('do', 'approvals.fixture-install')
        shared = json.loads((scratch / 'shared.json').read_text())
        if shared.get('fixture.install-started') is True:
            break
        time.sleep(.15)
    else:
        raise RuntimeError('The native update action did not start: ' + json.dumps(shared.get('fixture.install-detail')))
    receipt = None
    for _ in range(300):
        path = scratch / 'data/approvals-update-result.json'
        if path.exists():
            receipt = json.loads(path.read_text())
            if receipt.get('status') == 'error':
                raise RuntimeError(receipt)
            if receipt.get('status') == 'installed':
                break
        time.sleep(.1)
    else:
        raise RuntimeError('The isolated update did not complete')
    time.sleep(2)
    status = json.loads(call('status'))
    assert not status['errors'], status['errors']
    assert status.get('overlays'), 'The updated owner must show its completion popup'
    assert (mod / 'version.js').read_text() == f"export const VERSION = '{version}';\n"
    assert not (mod / 'obsolete-fixture.js').exists()
    assert not (mod / 'view.js').exists()
    personal = json.loads((mod / 'mod.json').read_text())
    assert personal['place'] == 'none' and personal['fixture_placement'] == 'keep'
    after = json.loads((scratch / 'shared.json').read_text())
    assert all(after.get(key) == value for key, value in saved.items()), (saved, after)
    backup = Path(receipt['backup'])
    assert backup.resolve().is_relative_to(backup_home.resolve()), 'Test backups must stay in the isolated home'
    assert (backup / 'obsolete-fixture.js').is_file()
    assert (backup / 'version.js').read_text() == "export const VERSION = '0.1.9';\n"
    assert process.poll() is None, 'Self-update must keep the same native app process running'
    screenshot = scratch / 'after.png'
    call('shot', str(screenshot))
    evidence = {'version': version, 'native_self_update': True, 'reloaded_without_app_restart': True,
                'settings_preserved': True, 'placement_preserved': True, 'complete_backup': True,
                'obsolete_files_removed': True, 'errors': [], 'isolated_home': str(scratch), 'screenshot': str(screenshot)}
    (scratch / 'result.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(evidence))
finally:
    if process and process.poll() is None:
        try:
            call('do', 'app.quit')
        except Exception:
            process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
    subprocess.run(['hc', 'server', 'stop', '--json'], env=env, capture_output=True, text=True, timeout=10)
