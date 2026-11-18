"""Install one verified Approval release without changing the person's Herdr settings."""
from argparse import ArgumentParser
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path, PurePosixPath
import fcntl
import hashlib
import hmac
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unicodedata
import zipfile


RELEASES = 'https://github.com/iyk2h/herdr-approvals/releases/download'
VERSION_PATTERN = r'(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)'
MAX_ARCHIVE_BYTES = 10 * 1024 * 1024
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 16 * 1024 * 1024
MAX_ENTRIES = 512


class UpdateBusyError(RuntimeError):
    pass


def stable_version(value):
    if not isinstance(value, str) or not re.fullmatch(VERSION_PATTERN, value) or len(value) > 48:
        raise ValueError('The release version is invalid.')
    return value


def app_directory(app_home):
    app = Path(app_home).absolute()
    if not app.is_dir() or app.is_symlink() or app.resolve() != app:
        raise ValueError('The Herdr home must not contain symbolic links.')
    return app


def app_paths(app_home):
    app = app_directory(app_home)
    target = app / 'mods/approvals'
    if target.parent.is_symlink() or target.is_symlink():
        raise ValueError('The installed mod must not be a symbolic link.')
    if not target.is_dir() or not (target / 'main.js').is_file() or not (target / 'mod.json').is_file():
        raise ValueError('The installed Approval mod is not available.')
    return app, target


@contextmanager
def update_lock(app_home):
    app = app_directory(app_home)
    data = app / 'data'
    if data.is_symlink():
        raise ValueError('The Herdr data folder must not be a symbolic link.')
    data.mkdir(exist_ok=True)
    flags = os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0)
    descriptor = os.open(data / '.approvals-update.lock', flags, 0o600)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise UpdateBusyError('An update is already running. Try again when it finishes.') from error
        yield
    finally:
        os.close(descriptor)


def verify_archive(archive, expected_sha256):
    if not isinstance(expected_sha256, str) or not re.fullmatch(r'[a-fA-F0-9]{64}', expected_sha256):
        raise ValueError('The release checksum is invalid.')
    archive = Path(archive)
    if archive.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError('The release archive is too large.')
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    if not hmac.compare_digest(digest, expected_sha256.lower()):
        raise ValueError('The release checksum does not match. The installed mod was not changed.')


def members(package):
    entries = package.infolist()
    if not entries or len(entries) > MAX_ENTRIES:
        raise ValueError('The release archive has an invalid file count.')
    seen = set()
    total = 0
    for info in entries:
        name = info.filename
        parts = PurePosixPath(name).parts
        canonical = '/'.join(parts)
        key = unicodedata.normalize('NFC', canonical).casefold()
        if (not name or '\\' in name or name.startswith('/') or any(ord(c) < 32 for c in name)
                or not parts or parts[0] != 'approvals' or '..' in parts
                or canonical != name.rstrip('/') or key in seen):
            raise ValueError('The release archive contains an unsafe path.')
        mode = stat.S_IFMT(info.external_attr >> 16)
        if (mode not in (0, stat.S_IFREG, stat.S_IFDIR) or info.flag_bits & 1
                or info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
            raise ValueError('The release archive contains an unsupported file.')
        if (info.is_dir() and mode not in (0, stat.S_IFDIR)) or (not info.is_dir() and mode == stat.S_IFDIR):
            raise ValueError('The release archive contains an invalid folder.')
        if info.file_size < 0 or info.file_size > MAX_FILE_BYTES:
            raise ValueError('A release file is too large.')
        total += info.file_size
        if total > MAX_TOTAL_BYTES:
            raise ValueError('The extracted release is too large.')
        seen.add(key)
    return entries


def unpack(archive, staging):
    with zipfile.ZipFile(archive) as package:
        entries = members(package)
        for info in entries:
            destination = staging / info.filename
            if info.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            with package.open(info) as source:
                content = source.read(MAX_FILE_BYTES + 1)
            if len(content) != info.file_size or len(content) > MAX_FILE_BYTES:
                raise ValueError('A release file has an invalid size.')
            destination.write_bytes(content)
            destination.chmod(0o755 if destination.suffix == '.sh' else 0o644)
    return staging / 'approvals'


def read_version(directory):
    source = (directory / 'version.js').read_text(encoding='utf-8')
    match = re.fullmatch(r'\s*export\s+const\s+VERSION\s*=\s*([\'"])(' + VERSION_PATTERN + r')\1\s*;\s*', source)
    if not match:
        raise ValueError('The release version file is invalid.')
    return stable_version(match[2])


def prepare(candidate, target, version):
    required = ('main.js', 'mod.json', 'version.js', 'updater.js', 'update.py')
    if any(not (candidate / name).is_file() for name in required):
        raise ValueError('The release archive is incomplete.')
    if read_version(candidate) != version:
        raise ValueError('The release archive contains a different version.')
    if (target / 'version.js').exists():
        current = read_version(target)
        if tuple(map(int, version.split('.'))) <= tuple(map(int, current.split('.'))):
            raise ValueError('The selected release is not newer than the installed version.')
    published = json.loads((candidate / 'mod.json').read_text(encoding='utf-8'))
    personal = json.loads((target / 'mod.json').read_text(encoding='utf-8'))
    if not isinstance(published, dict) or not isinstance(personal, dict):
        raise ValueError('The mod placement settings are invalid.')
    (candidate / 'mod.json').write_text(json.dumps({**published, **personal}, indent=2) + '\n', encoding='utf-8')


def backup_install(target):
    backups = Path.home() / '.local/share/herdr-approvals/backups'
    backups.mkdir(parents=True, exist_ok=True)
    backup = backups / (datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '-' + str(os.getpid()))
    with tempfile.TemporaryDirectory(prefix='.approvals-backup-', dir=backups) as directory:
        complete = Path(directory) / 'approvals'
        shutil.copytree(target, complete, symlinks=True)
        if backup.exists():
            raise FileExistsError('The backup folder already exists.')
        complete.replace(backup)
    return backup


def native_validate(candidate):
    result = subprocess.run(['herdr-app', 'check', str(candidate)], capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()[-1500:]
        raise RuntimeError('The update did not pass the native check. ' + detail)


def replace_install(candidate, target, previous, validate):
    target.replace(previous)
    try:
        candidate.replace(target)
        validate(target)
    except BaseException:
        try:
            if target.exists():
                target.replace(previous.parent / 'rejected')
            previous.replace(target)
        except BaseException as rollback_error:
            raise RuntimeError('The update failed and automatic recovery failed. Restore the complete backup.') from rollback_error
        raise


def install_archive(archive, app_home, version, expected_sha256, validate=None, *, lock=True, on_backup=None):
    version = stable_version(version)
    if lock:
        with update_lock(app_home):
            return install_archive(archive, app_home, version, expected_sha256, validate, lock=False, on_backup=on_backup)
    app, target = app_paths(app_home)
    verify_archive(archive, expected_sha256)
    validate = native_validate if validate is None else validate
    with tempfile.TemporaryDirectory(prefix='.approvals-update-', dir=app) as directory:
        staging = Path(directory)
        candidate = unpack(archive, staging)
        prepare(candidate, target, version)
        validate(candidate)
        backup = backup_install(target)
        if on_backup is not None:
            on_backup(backup)
        replace_install(candidate, target, staging / 'previous', validate)
    return {'version': version, 'backup': str(backup)}


def receipt(app_home, value):
    data = Path(app_home) / 'data'
    data.mkdir(exist_ok=True)
    if data.is_symlink():
        raise ValueError('The Herdr data folder must not be a symbolic link.')
    path = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', prefix='.approvals-result-', dir=data, delete=False) as file:
            path = Path(file.name)
            json.dump(value, file)
            file.write('\n')
            file.flush()
            os.fsync(file.fileno())
        path.replace(data / 'approvals-update-result.json')
    finally:
        if path is not None:
            path.unlink(missing_ok=True)


def download(url, destination, limit=MAX_ARCHIVE_BYTES):
    result = subprocess.run(['curl', '--fail', '--location', '--silent', '--show-error',
                             '--proto', '=https', '--proto-redir', '=https', '--max-redirs', '5',
                             '--connect-timeout', '10', '--max-time', '60', '--max-filesize', str(limit),
                             '--output', str(destination), '--url', url],
                            capture_output=True, text=True, timeout=75)
    if result.returncode != 0:
        raise RuntimeError('The update download failed. ' + result.stderr.strip()[-1000:])
    if destination.stat().st_size > limit:
        raise ValueError('The downloaded file is too large.')


def perform_update(app, version, state):
    app_paths(app)
    name = 'herdr-approval-' + version + '.zip'
    base = RELEASES + '/v' + version + '/' + name

    def saved_backup(backup):
        state['backup'] = str(backup)
        receipt(app, state)

    with tempfile.TemporaryDirectory(prefix='.approvals-download-', dir=app) as directory:
        archive = Path(directory) / name
        checksum = Path(directory) / (name + '.sha256')
        download(base + '.sha256', checksum, 512)
        checksum_text = checksum.read_text(encoding='ascii')
        match = re.fullmatch(r'([0-9a-fA-F]{64})[ \t]+\*?' + re.escape(name) + r'\s*', checksum_text)
        if not match:
            raise ValueError('The published checksum is invalid.')
        download(base, archive)
        return install_archive(archive, app, version, match[1], validate=native_validate,
                               lock=False, on_backup=saved_backup)


def update_status(app, version, attempt):
    state = {'attempt': attempt, 'version': version, 'status': 'error'}
    try:
        data = app / 'data'
        path = data / 'approvals-update-result.json'
        if data.is_symlink() or path.is_symlink() or path.stat().st_size > 16 * 1024:
            raise ValueError('The update record is invalid.')
        saved = json.loads(path.read_text(encoding='utf-8'))
        if (not isinstance(saved, dict) or saved.get('attempt') != attempt or saved.get('version') != version
                or saved.get('status') not in ('installing', 'installed', 'error')):
            raise ValueError('The update record belongs to another attempt or is invalid.')
        state = dict(saved)
        try:
            with update_lock(app):
                if saved['status'] == 'error':
                    return saved
                _app, target = app_paths(app)
                current = read_version(target)
                state['currentVersion'] = current
                if current != version:
                    raise RuntimeError('The update stopped before installation could be verified. Installed version: ' + current + '.')
                native_validate(target)
                state['status'] = 'installed'
                if saved['status'] != 'installed':
                    state['warning'] = 'The update is installed, but its completion record could not be saved.'
                return state
        except UpdateBusyError:
            return {**saved, 'status': 'installing'}
    except Exception as error:
        return {**state, 'status': 'error', 'error': str(error)[:2000]}


def main():
    parser = ArgumentParser(description='Install a verified Herdr Approval release')
    parser.add_argument('--app-home', type=Path, required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--attempt', required=True)
    parser.add_argument('--status', action='store_true')
    args = parser.parse_args()
    version = stable_version(args.version)
    if not re.fullmatch(r'[A-Za-z0-9._:-]{1,160}', args.attempt):
        parser.error('The update attempt is invalid.')
    app = app_directory(args.app_home)
    if args.status:
        print(json.dumps(update_status(app, version, args.attempt)))
        return 0
    state = {'attempt': args.attempt, 'version': version, 'status': 'installing', 'pid': os.getpid()}
    try:
        with update_lock(app):
            try:
                receipt(app, state)
                result = perform_update(app, version, state)
                try:
                    receipt(app, {**state, **result, 'status': 'installed'})
                except Exception:
                    result['warning'] = 'The update is installed, but its completion record could not be saved.'
                print(json.dumps(result))
            except Exception as error:
                failed = {**state, 'status': 'error', 'error': str(error)[:2000]}
                try:
                    receipt(app, failed)
                except Exception:
                    pass
                print(json.dumps(failed), file=sys.stderr)
                return 1
        return 0
    except Exception as error:
        # A caller that did not acquire the lock cannot replace another attempt's receipt.
        print(json.dumps({**state, 'status': 'error', 'error': str(error)[:2000]}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
