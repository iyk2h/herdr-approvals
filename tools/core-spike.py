from pathlib import Path
import json
import os
import subprocess
import shutil
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
temporary_root = '/private/tmp' if Path('/private/tmp').is_dir() else '/tmp'
scratch = Path(tempfile.mkdtemp(prefix='ha-', dir=temporary_root))
env = dict(os.environ)
env.pop('HC_SOCKET', None)
env.pop('HC_TERMINAL_ID', None)
env['HC_SESSION'] = 'ha-' + str(os.getpid())
for key in ('XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR'):
    directory = scratch / key.lower()
    directory.mkdir(mode=0o700)
    env[key] = str(directory)
hc = shutil.which('hc')
assert hc, 'hc must be on PATH'

def command(args, timeout=30):
    result = subprocess.run(args, env=env, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or str(result.returncode))
    return result.stdout

def rpc(method, params):
    request = json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params})
    output = command(['/bin/sh', str(root / 'mods/approvals/rpc.sh'), request])
    values = [json.loads(line) for line in output.splitlines() if line.strip()]
    response = next((v for v in values if v.get('id') == 1), None)
    if response is None:
        raise RuntimeError('No RPC response: ' + output[:400])
    return response

started = False
try:
    command([hc, 'server', 'start', '--json'])
    started = True
    status = json.loads(command([hc, 'server', 'status', '--json']))
    assert status['live'] == 0, 'Isolated core must start without user terminals'
    initial = rpc('doc.get', {'name':'herdr.approvals.test'})
    assert initial['result']['version'] == 0
    first = rpc('doc.set', {'name':'herdr.approvals.test','value':{'fixture':True},'version':0})
    assert first['result']['version'] == 1
    conflict = rpc('doc.set', {'name':'herdr.approvals.test','value':{'fixture':False},'version':0})
    assert conflict['error']['data']['kind'] == 'conflict'
    saved = rpc('doc.get', {'name':'herdr.approvals.test'})
    assert saved['result']['value'] == {'fixture':True}
    fixtures = []
    for index in range(2):
        receipt = scratch / ('receipt-' + str(index) + '.json')
        fixture = rpc('terminal.run', {'argv':[sys.executable,str(root / 'tools/fixture-tui.py'),str(receipt),'terminal-input' if index else 'command'],'cwd':str(scratch),'no_parent':True,'no_notify':True,'size':{'cols':120,'rows':30}})
        result = fixture['result']
        address = result.get('terminal', result).get('address') if isinstance(result.get('terminal', result), dict) else None
        assert address, 'Fixture terminal address missing: ' + json.dumps(result)[:300]
        fixtures.extend([address, str(receipt)])
    command([shutil.which('node'),str(root / 'tools/native-smoke.mjs'),*fixtures], timeout=45)
    evidence = {'isolated_session':env['HC_SESSION'],'core_version':status['version'],'empty_core':True,'rpc_helper':'passed','atomic_claim_conflict':'passed','real_native_input':'passed','request_kinds':['command','terminal-input'],'independent_countdowns':2,'custom_delay_seconds':7,'cleanup':'isolated core stopped'}
    (root / 'core-spike-result.json').write_text(json.dumps(evidence,indent=2) + '\n')
    print(json.dumps(evidence,indent=2))
finally:
    if started:
        command([hc, 'server', 'stop', '--json'])
