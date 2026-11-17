from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile
import unittest


def snapshot(root):
    return {
        path.relative_to(root).as_posix(): path.read_bytes() if path.is_file() else None
        for path in root.rglob('*')
    }


class InstallationTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix='ha-install-')
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.project = self.root / 'project'
        self.source = self.project / 'mods/approvals'
        self.source.mkdir(parents=True)
        (self.source / 'main.js').write_text('export default class Current {}\n')
        (self.source / 'current.js').write_text('export const current = true;\n')
        (self.source / 'mod.json').write_text('{"place":"right"}\n')
        (self.source / 'generated.d.ts').write_text('declare const generated: true;\n')
        (self.source / 'jsconfig.json').write_text('{}\n')
        tools = self.project / 'tools'
        tools.mkdir()
        self.installer = tools / 'install.py'
        shutil.copy2(Path(__file__).resolve().parents[1] / 'tools/install.py', self.installer)
        self.app = self.root / 'app'
        self.app.mkdir()
        (self.app / 'keys.json').write_text('{"global":{"fixture":"keep"}}\n')
        (self.app / 'shared.json').write_text('{"approvals.enabled":false,"fixture":true}\n')
        (self.app / 'layouts').mkdir()
        (self.app / 'layouts/personal.json').write_text('{"id":"personal"}\n')
        (self.app / 'mods/cockpit').mkdir(parents=True)
        (self.app / 'mods/cockpit/main.js').write_text('fixture cockpit\n')
        self.target = self.app / 'mods/approvals'
        self.home = self.root / 'home'
        self.home.mkdir()
        self.env = dict(os.environ, HOME=str(self.home), HERDR_APP_HOME=str(self.app))
        self.user_files = snapshot(self.app)

    def run_installer(self, *args, fail_copy=False, fail_backup=False):
        argv = [sys.executable, str(self.installer), '--target', str(self.app), *args]
        if fail_copy or fail_backup:
            wrapper = '''
from pathlib import Path
import runpy, shutil, sys
installer, source, installed, mode = sys.argv[1:5]
arguments = sys.argv[5:]
copytree = shutil.copytree
def interrupted(src, dst, *args, **kwargs):
    selected = Path(source) if mode == 'source' else Path(installed)
    backup_root = Path.home() / '.local/share/herdr-approvals/backups'
    destination_matches = mode == 'source' or Path(dst).resolve().is_relative_to(backup_root.resolve())
    if Path(src).resolve() == selected.resolve() and destination_matches:
        target = Path(dst)
        target.mkdir(parents=True, exist_ok=True)
        (target / 'main.js').write_text('incomplete source copy\\n')
        (target / 'partial.js').write_text('incomplete helper\\n')
        raise OSError('fixture ' + mode + ' copy interrupted')
    return copytree(src, dst, *args, **kwargs)
shutil.copytree = interrupted
sys.argv = [installer, *arguments]
runpy.run_path(installer, run_name='__main__')
'''
            mode = 'backup' if fail_backup else 'source'
            argv = [sys.executable, '-c', wrapper, str(self.installer), str(self.source), str(self.target), mode, '--target', str(self.app), *args]
        return subprocess.run(argv, env=self.env, capture_output=True, text=True, timeout=10)

    def old_install(self):
        self.target.mkdir()
        (self.target / 'main.js').write_text('export default class Previous {}\n')
        (self.target / 'obsolete.js').write_text('old helper\n')
        return snapshot(self.target)

    def assert_user_files_unchanged(self):
        current = snapshot(self.app)
        for path, content in self.user_files.items():
            self.assertEqual(current.get(path), content, path)

    def test_fresh_install_preserves_user_files_and_omits_generated_files(self):
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.target / 'main.js').read_bytes(), (self.source / 'main.js').read_bytes())
        self.assertFalse((self.target / 'generated.d.ts').exists())
        self.assertFalse((self.target / 'jsconfig.json').exists())
        self.assert_user_files_unchanged()

    def test_existing_install_requires_explicit_update(self):
        self.old_install()
        previous = snapshot(self.app)
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('--update', result.stderr)
        self.assertEqual(snapshot(self.app), previous)

    def test_update_replaces_obsolete_files_and_backs_up_the_previous_version(self):
        previous = self.old_install()
        result = self.run_installer('--update')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.target / 'obsolete.js').exists(), 'updates must not retain removed runtime helpers')
        self.assertEqual((self.target / 'main.js').read_bytes(), (self.source / 'main.js').read_bytes())
        backups = list((self.home / '.local/share/herdr-approvals/backups').iterdir())
        self.assertEqual(len(backups), 1)
        self.assertEqual(snapshot(backups[0]), previous)
        self.assert_user_files_unchanged()

    def test_failed_update_keeps_the_last_good_install_and_leaves_no_partial_files(self):
        self.old_install()
        previous = snapshot(self.app)
        result = self.run_installer('--update', fail_copy=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('fixture source copy interrupted', result.stderr)
        self.assertEqual(snapshot(self.app), previous, 'a failed source copy must not modify or leave temporary files in the live home')

    def test_failed_backup_preserves_the_install_and_leaves_only_complete_previous_backups(self):
        self.old_install()
        previous_app = snapshot(self.app)
        backups = self.home / '.local/share/herdr-approvals/backups'
        completed = backups / 'previous-complete'
        completed.mkdir(parents=True)
        (completed / 'main.js').write_text('previous complete backup\\n')
        previous_backups = snapshot(backups)
        result = self.run_installer('--update', fail_backup=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('fixture backup copy interrupted', result.stderr)
        self.assertEqual(snapshot(self.app), previous_app, 'backup errors must leave the installed version unchanged')
        self.assertEqual(snapshot(backups), previous_backups,
                         'an interrupted backup must not leave an incomplete restore choice or remove an earlier complete backup')


if __name__ == '__main__':
    unittest.main()
