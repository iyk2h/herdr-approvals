from argparse import ArgumentParser
from datetime import datetime
from pathlib import Path
import os
import shutil
import tempfile

parser = ArgumentParser(description='Install the independent Herdr Approval mod')
parser.add_argument('--target', type=Path, default=Path(os.environ.get('HERDR_APP_HOME', str(Path.home() / '.config/herdr-app'))))
parser.add_argument('--update', action='store_true')
args = parser.parse_args()
source = Path(__file__).resolve().parents[1] / 'mods/approvals'
target = args.target / 'mods/approvals'
if target.exists() and not args.update:
    parser.error('approvals already exists; --update first backs up the previous version')
args.target.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='.approvals-install-', dir=args.target) as directory:
    staging = Path(directory)
    candidate = staging / 'approvals'
    shutil.copytree(source, candidate, ignore=shutil.ignore_patterns('*.d.ts','jsconfig.json','__pycache__'))
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        backups = Path.home() / '.local/share/herdr-approvals/backups'
        backups.mkdir(parents=True, exist_ok=True)
        backup = backups / datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        with tempfile.TemporaryDirectory(prefix='.approvals-backup-', dir=backups) as backup_directory:
            prepared_backup = Path(backup_directory) / 'approvals'
            shutil.copytree(target, prepared_backup)
            if backup.exists():
                raise FileExistsError('The backup already exists: ' + str(backup))
            prepared_backup.rename(backup)
        print('Previous version backed up:', backup)
        previous = staging / 'previous'
        target.replace(previous)
        try:
            candidate.replace(target)
        except BaseException:
            previous.replace(target)
            raise
    else:
        candidate.replace(target)
print('Installed:', target)
print('Automatic approval defaults off. Existing Cockpit, keys and layouts were not edited.')
