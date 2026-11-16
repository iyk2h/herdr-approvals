from argparse import ArgumentParser
from datetime import datetime
from pathlib import Path
import os
import shutil

parser = ArgumentParser(description='Install the independent Herdr Approvals mod')
parser.add_argument('--target', type=Path, default=Path(os.environ.get('HERDR_APP_HOME', str(Path.home() / '.config/herdr-app'))))
parser.add_argument('--update', action='store_true')
args = parser.parse_args()
source = Path(__file__).resolve().parents[1] / 'mods/approvals'
target = args.target / 'mods/approvals'
if target.exists():
    if not args.update:
        parser.error('approvals already exists; --update first backs up the previous version')
    backup = Path.home() / '.local/share/herdr-approvals/backups' / datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    shutil.copytree(target, backup)
    print('Previous version backed up:', backup)
shutil.copytree(source, target, dirs_exist_ok=args.update, ignore=shutil.ignore_patterns('*.d.ts','jsconfig.json','__pycache__'))
print('Installed:', target)
print('Automatic approval defaults off. Existing Cockpit, keys and layouts were not edited.')
