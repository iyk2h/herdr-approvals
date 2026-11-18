"""Build a reproducible Approval archive and its SHA256 file."""
from argparse import ArgumentParser
from pathlib import Path
import hashlib
import json
import re
import shutil
import stat
import tempfile
import zipfile


def runtime_files(directory):
    if directory.is_symlink():
        raise ValueError('Release sources must not contain symbolic links.')
    for path in sorted(directory.iterdir()):
        if path.name.startswith('.') or path.name in ('node_modules', '__pycache__', 'jsconfig.json'):
            continue
        if path.is_symlink():
            raise ValueError('Release sources must not contain symbolic links.')
        if path.is_dir():
            yield from runtime_files(path)
        elif not path.name.endswith('.d.ts') and path.suffix in ('.js', '.json', '.sh', '.py'):
            yield path


def build_release(root, output):
    root, output = Path(root), Path(output)
    source = root / 'mods/approvals'
    files = list(runtime_files(source))
    version_text = (source / 'version.js').read_text(encoding='utf-8')
    match = re.fullmatch(r'\s*export const VERSION = [\'"]((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))[\'"];\s*', version_text)
    if not match:
        raise ValueError('The runtime version is invalid.')
    version = match[1]
    if json.loads((root / 'package.json').read_text())['version'] != version:
        raise ValueError('The package and runtime versions differ.')
    entries = {f'approvals/{path.relative_to(source).as_posix()}': path for path in files}
    for name in ('LICENSE', 'NOTICE', 'LICENSES/Cockpit-MIT.txt'):
        path = root / name
        if path.is_symlink() or not path.is_file():
            raise ValueError('The release attribution is missing or unsafe.')
        entries['approvals/' + name] = path
    output.mkdir(parents=True, exist_ok=True)
    name = f'herdr-approval-{version}.zip'
    archive, checksum = output / name, output / (name + '.sha256')
    with tempfile.TemporaryDirectory(prefix='.approval-release-', dir=output) as directory:
        staging = Path(directory)
        candidate = staging / name
        with zipfile.ZipFile(candidate, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as package:
            for relative, path in sorted(entries.items()):
                info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = (stat.S_IFREG | (0o755 if path.suffix == '.sh' else 0o644)) << 16
                package.writestr(info, path.read_bytes())
        prepared_checksum = staging / checksum.name
        digest = hashlib.sha256(candidate.read_bytes()).hexdigest()
        prepared_checksum.write_text(f'{digest}  {name}\n', encoding='ascii')
        previous = {}
        for path in (archive, checksum):
            if path.exists():
                saved = staging / ('previous-' + path.name)
                shutil.copy2(path, saved)
                previous[path] = saved
        published = []
        try:
            for prepared, target in ((candidate, archive), (prepared_checksum, checksum)):
                prepared.replace(target)
                published.append(target)
        except BaseException:
            for path in reversed(published):
                if path in previous:
                    previous[path].replace(path)
                else:
                    path.unlink(missing_ok=True)
            raise
    return {'version': version, 'archive': str(archive), 'checksum': str(checksum)}


if __name__ == '__main__':
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'dist')
    args = parser.parse_args()
    print(json.dumps(build_release(Path(__file__).resolve().parents[1], args.output)))
