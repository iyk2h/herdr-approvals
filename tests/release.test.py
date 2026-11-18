from pathlib import Path
import hashlib
import importlib.util
import json
import os
import tempfile
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('approval_release_builder', ROOT / 'tools/build-release.py')
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


class ReleasePackageTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix='ha-release-test-')
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name).resolve() / 'project'
        self.source = self.root / 'mods/approvals'
        self.source.mkdir(parents=True)
        self.files = {
            'main.js': 'export default class Approval {}\n',
            'ui.js': 'export const panel = () => null;\n',
            'version.js': "export const VERSION = '0.2.0';\n",
            'mod.json': '{"place":"right","size":360,"title":"Approval"}\n',
            'rpc.sh': '#!/bin/sh\nexit 0\n',
            'update.py': '# fixture updater\n',
            'providers/native.js': 'export class NativeProvider {}\n',
        }
        for name, text in self.files.items():
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        self.licenses = {
            'LICENSE': 'Fixture Apache-2.0 license\n',
            'NOTICE': 'Fixture upstream attribution\n',
            'LICENSES/Cockpit-MIT.txt': 'Fixture Cockpit MIT license\n',
        }
        for name, text in self.licenses.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        (self.root / 'package.json').write_text(json.dumps({'name': 'herdr-approvals', 'version': '0.2.0'}))
        self.output = self.root.parent / 'output'

    def build(self, output=None):
        return BUILDER.build_release(self.root, output or self.output)

    def assert_no_artifacts(self, output=None):
        output = output or self.output
        if output.exists():
            self.assertFalse(list(output.glob('*.zip')))
            self.assertFalse(list(output.glob('*.sha256')))

    def test_release_has_canonical_names_complete_runtime_licenses_and_matching_checksum(self):
        result = self.build()
        self.assertEqual(result['version'], '0.2.0')
        archive = Path(result['archive'])
        checksum = Path(result['checksum'])
        self.assertEqual(archive, self.output / 'herdr-approval-0.2.0.zip')
        self.assertEqual(checksum, self.output / 'herdr-approval-0.2.0.zip.sha256')
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        self.assertEqual(checksum.read_text(), f'{digest}  {archive.name}\n')
        with zipfile.ZipFile(archive) as package:
            self.assertIsNone(package.testzip(), 'all archive entries must pass CRC validation')
            expected = {f'approvals/{name}': text for name, text in {**self.files, **self.licenses}.items()}
            self.assertEqual(set(package.namelist()), set(expected))
            self.assertEqual(len(package.namelist()), len(set(package.namelist())), 'archive members must be unique')
            for name, text in expected.items():
                self.assertEqual(package.read(name), text.encode(), name)

    def test_generated_files_private_config_and_development_folders_are_not_published(self):
        excluded = {
            'generated.d.ts': 'fixture generated declaration',
            'providers/generated.d.ts': 'fixture nested declaration',
            'jsconfig.json': '{}',
            '__pycache__/update.cpython-312.pyc': 'fixture bytecode',
            'nested/old.pyc': 'fixture bytecode',
            'node_modules/dependency/index.js': 'fixture development dependency',
            '.env': 'FIXTURE_PRIVATE_VALUE=not-a-real-secret',
            '.env.local': 'FIXTURE_PRIVATE_VALUE=not-a-real-secret',
        }
        for name, text in excluded.items():
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        for name in ('shared.json', 'settings.json', 'auth.json', 'keys.json'):
            (self.root / name).write_text('{"fixture":"private config"}')
        result = self.build()
        with zipfile.ZipFile(result['archive']) as package:
            names = set(package.namelist())
            for name in excluded:
                self.assertNotIn(f'approvals/{name}', names)
            self.assertEqual(names, {f'approvals/{name}' for name in {**self.files, **self.licenses}})

    def test_identical_source_content_produces_identical_archive_despite_mtime_changes(self):
        first = self.build()
        first_archive = Path(first['archive']).read_bytes()
        first_checksum = Path(first['checksum']).read_bytes()
        for index, path in enumerate(sorted(self.root.rglob('*'))):
            os.utime(path, (1000000000 + index, 1000000000 + index))
        second = self.build(self.root.parent / 'second-output')
        self.assertEqual(Path(second['archive']).read_bytes(), first_archive)
        self.assertEqual(Path(second['checksum']).read_bytes(), first_checksum)

    def test_package_and_runtime_version_mismatch_fails_without_final_artifacts(self):
        (self.root / 'package.json').write_text(json.dumps({'version': '0.3.0'}))
        with self.assertRaises(Exception):
            self.build()
        self.assert_no_artifacts()

    def test_runtime_file_and_directory_symlinks_are_refused_without_final_artifacts(self):
        outside = self.root.parent / 'outside'
        outside.mkdir()
        (outside / 'extra.js').write_text('fixture outside source')
        for index, destination in enumerate((outside / 'extra.js', outside)):
            output = self.root.parent / f'unsafe-output-{index}'
            link = self.source / ('linked.js' if index == 0 else 'linked-directory')
            link.symlink_to(destination, target_is_directory=destination.is_dir())
            try:
                with self.assertRaises(Exception):
                    self.build(output)
                self.assert_no_artifacts(output)
            finally:
                link.unlink()

    def test_failed_rebuild_keeps_the_previous_complete_artifact_pair(self):
        result = self.build()
        archive, checksum = Path(result['archive']), Path(result['checksum'])
        previous_archive, previous_checksum = archive.read_bytes(), checksum.read_bytes()
        (self.source / 'version.js').write_text("export const VERSION = '0.3.0';\n")
        with self.assertRaises(Exception):
            self.build()
        self.assertEqual(archive.read_bytes(), previous_archive)
        self.assertEqual(checksum.read_bytes(), previous_checksum)


if __name__ == '__main__':
    unittest.main()
