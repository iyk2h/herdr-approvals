from pathlib import Path
from unittest.mock import patch
import hashlib
import importlib.util
import json
import os
import shutil
import stat
import tempfile
import unittest
import warnings
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('approval_update_helper', ROOT / 'mods/approvals/update.py')
HELPER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HELPER)


def snapshot(root):
    return {
        p.relative_to(root).as_posix(): p.read_bytes() if p.is_file() else None
        for p in root.rglob('*')
    }


class UpdateInstallationTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix='ha-update-test-')
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name).resolve()
        self.home = self.root / 'home'
        self.home.mkdir()
        environment = patch.dict(os.environ, {'HOME': str(self.home)})
        environment.start()
        self.addCleanup(environment.stop)
        self.app = self.root / 'app'
        self.target = self.app / 'mods/approvals'
        self.target.mkdir(parents=True)
        self.old_manifest = {'place': 'none', 'size': 40, 'title': 'Personal approval', 'personal': True}
        (self.target / 'mod.json').write_text(json.dumps(self.old_manifest))
        (self.target / 'main.js').write_text('export default class Previous {}\n')
        (self.target / 'obsolete.js').write_text('old module\n')
        (self.target / 'version.js').write_text("export const VERSION = '0.2.0';\n")
        (self.app / 'keys.json').write_text('{"fixture":"keep"}')
        (self.app / 'shared.json').write_text('{"approvals.enabled":true,"approvals.delay":7000}')
        (self.app / 'layouts').mkdir()
        (self.app / 'layouts/personal.json').write_text('{"id":"personal"}')
        (self.app / 'mods/cockpit').mkdir()
        (self.app / 'mods/cockpit/main.js').write_text('fixture cockpit')
        self.previous = snapshot(self.target)
        self.protected = {str(p.relative_to(self.app)): p.read_bytes() for p in self.app.rglob('*')
                          if p.is_file() and not p.is_relative_to(self.target)}
        self.backups = self.home / '.local/share/herdr-approvals/backups'
        self.archive = self.root / 'release.zip'

    def entries(self):
        return {
            'approvals/main.js': 'export default class Updated {}\n',
            'approvals/current.js': 'export const current = true;\n',
            'approvals/version.js': "export const VERSION = '0.3.0';\n",
            'approvals/mod.json': json.dumps({'place': 'right', 'size': 360, 'title': 'Approval', 'focusable': True}),
            'approvals/updater.js': 'export class UpdateController {}\n',
            'approvals/update.py': '# fixture update helper\n',
        }

    def package(self, entries=None, extra=()):
        with warnings.catch_warnings(), zipfile.ZipFile(self.archive, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            warnings.simplefilter('ignore', UserWarning)
            for name, content in (self.entries() if entries is None else entries).items():
                archive.writestr(name, content)
            for name, content in extra:
                archive.writestr(name, content)
        return hashlib.sha256(self.archive.read_bytes()).hexdigest()

    def install(self, digest=None, validate=None):
        return HELPER.install_archive(self.archive, self.app, '0.3.0',
                                      digest or hashlib.sha256(self.archive.read_bytes()).hexdigest(),
                                      validate=validate or (lambda candidate: None))

    def assert_protected(self):
        for relative, content in self.protected.items():
            self.assertEqual((self.app / relative).read_bytes(), content, relative)

    def assert_previous(self):
        self.assertEqual(snapshot(self.target), self.previous)
        self.assert_protected()

    def test_success_preserves_personal_manifest_and_user_files_with_a_complete_backup(self):
        self.package()
        validated = []
        result = self.install(validate=lambda candidate: validated.append(Path(candidate)))
        self.assertEqual(result['version'], '0.3.0')
        self.assertEqual((self.target / 'main.js').read_text(), self.entries()['approvals/main.js'])
        self.assertFalse((self.target / 'obsolete.js').exists())
        manifest = json.loads((self.target / 'mod.json').read_text())
        for key, value in self.old_manifest.items():
            self.assertEqual(manifest[key], value)
        self.assertEqual(manifest['focusable'], True, 'new manifest fields remain available')
        backup = Path(result['backup'])
        self.assertTrue(backup.is_relative_to(self.backups))
        self.assertEqual(snapshot(backup), self.previous, 'the recovery copy must be complete and unchanged')
        self.assertEqual(len(validated), 2)
        self.assertNotEqual(validated[0], self.target, 'validate the prepared candidate before replacement')
        self.assertEqual(validated[1], self.target, 'validate the installed copy before reporting success')
        self.assert_protected()

    def test_checksum_failure_changes_neither_install_nor_backups(self):
        self.package()
        with self.assertRaises(Exception):
            self.install(digest='0' * 64)
        self.assert_previous()
        self.assertFalse(self.backups.exists() and any(self.backups.iterdir()))

    def test_unsafe_archive_members_are_rejected_without_writing_outside_the_mod(self):
        for name in ('../escape', '/absolute', 'approvals/../escape', 'approvals\\escape', 'other/main.js'):
            with self.subTest(member=name):
                self.package(extra=[(name, 'fixture')])
                with self.assertRaises(Exception):
                    self.install()
                self.assert_previous()
                self.assertFalse((self.root / 'escape').exists())
                self.assertFalse((self.app / 'escape').exists())

    def test_symlink_and_duplicate_archive_members_are_rejected(self):
        link = zipfile.ZipInfo('approvals/link.js')
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        for extra in ([(link, '../outside')], [('approvals/main.js', 'shadowed duplicate')]):
            with self.subTest(extra=str(extra[0][0])):
                self.package(extra=extra)
                with self.assertRaises(Exception):
                    self.install()
                self.assert_previous()

    def test_an_excessive_uncompressed_member_is_rejected_before_replacement(self):
        self.package(extra=[('approvals/oversized.js', 'x' * (16 * 1024 * 1024 + 1))])
        with self.assertRaises(Exception):
            self.install()
        self.assert_previous()

    def test_wrong_version_or_incomplete_package_cannot_replace_the_install(self):
        wrong = self.entries()
        wrong['approvals/version.js'] = "export const VERSION = '0.4.0';\n"
        without_main = self.entries()
        del without_main['approvals/main.js']
        without_manifest = self.entries()
        del without_manifest['approvals/mod.json']
        for entries in (wrong, without_main, without_manifest):
            with self.subTest(files=list(entries)):
                self.package(entries)
                with self.assertRaises(Exception):
                    self.install()
                self.assert_previous()

    def test_candidate_validation_failure_leaves_the_old_install_in_place(self):
        self.package()
        def invalid(_candidate):
            raise RuntimeError('Fixture candidate rejected')
        with self.assertRaises(Exception):
            self.install(validate=invalid)
        self.assert_previous()

    def test_post_install_validation_failure_restores_the_complete_old_install(self):
        self.package()
        def invalid_installed(candidate):
            if Path(candidate) == self.target:
                raise RuntimeError('Fixture installed copy rejected')
        with self.assertRaises(Exception):
            self.install(validate=invalid_installed)
        self.assert_previous()
        self.assertTrue(any(p.is_dir() and snapshot(p) == self.previous for p in self.backups.iterdir()),
                        'a failed installation must retain a usable recovery copy')

    def test_interrupted_backup_does_not_publish_a_partial_recovery_choice(self):
        self.package()
        self.backups.mkdir(parents=True)
        completed = self.backups / 'previous-complete'
        completed.mkdir()
        (completed / 'main.js').write_text('complete prior backup')
        before = snapshot(self.backups)
        original = shutil.copytree
        def interrupted(source, destination, *args, **kwargs):
            if Path(source) == self.target:
                Path(destination).mkdir(parents=True, exist_ok=True)
                (Path(destination) / 'partial.js').write_text('incomplete')
                raise OSError('Fixture backup interrupted')
            return original(source, destination, *args, **kwargs)
        with patch.object(HELPER.shutil, 'copytree', interrupted):
            with self.assertRaises(Exception):
                self.install()
        self.assert_previous()
        self.assertEqual(snapshot(self.backups), before)

    def test_replacement_failure_rolls_back_instead_of_leaving_a_missing_mod(self):
        self.package()
        original = Path.replace
        def interrupted(source, destination):
            if Path(destination) == self.target and Path(source) != self.target and not self.target.exists():
                if (Path(source) / 'current.js').exists():
                    raise OSError('Fixture replacement interrupted')
            return original(source, destination)
        with patch.object(Path, 'replace', interrupted):
            with self.assertRaises(Exception):
                self.install()
        self.assert_previous()


if __name__ == '__main__':
    unittest.main()
