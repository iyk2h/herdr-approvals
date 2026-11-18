from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch
import hashlib
import importlib.util
import json
import os
import shutil
import tempfile
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('approval_update_cli', ROOT / 'mods/approvals/update.py')
HELPER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HELPER)


class UpdateCliTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix='ha-update-cli-')
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
        (self.target / 'main.js').write_text('export default class Previous {}\n')
        (self.target / 'mod.json').write_text('{"place":"none"}\n')
        (self.target / 'version.js').write_text("export const VERSION = '0.2.0';\n")
        self.archive = self.root / 'fixture.zip'
        with zipfile.ZipFile(self.archive, 'w') as archive:
            for name, content in {
                'main.js': 'export default class Updated {}\n',
                'mod.json': '{"place":"right"}\n',
                'version.js': "export const VERSION = '0.3.0';\n",
                'updater.js': 'export class UpdateController {}\n',
                'update.py': '# fixture helper\n',
            }.items():
                archive.writestr('approvals/' + name, content)
        self.digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.requests = []
        self.validated = []

    def download(self, url, destination, limit=HELPER.MAX_ARCHIVE_BYTES):
        self.requests.append(url)
        base = HELPER.RELEASES + '/v0.3.0/herdr-approval-0.3.0.zip'
        if url == base + '.sha256':
            destination.write_text(self.digest + '  herdr-approval-0.3.0.zip\n')
        elif url == base:
            shutil.copyfile(self.archive, destination)
        else:
            raise AssertionError('The CLI requested an unexpected URL: ' + url)

    def run_cli(self, validate=None, receipt=None, status=False):
        output, errors = StringIO(), StringIO()
        arguments = ['update.py', '--app-home', str(self.app), '--version', '0.3.0', '--attempt', 'fixture-attempt']
        if status:
            arguments.append('--status')
        with patch.object(HELPER.sys, 'argv', arguments), patch.object(HELPER, 'download', self.download), \
                patch.object(HELPER, 'native_validate', validate or (lambda candidate: self.validated.append(Path(candidate)))), \
                patch.object(HELPER, 'receipt', receipt or HELPER.receipt), redirect_stdout(output), redirect_stderr(errors):
            code = HELPER.main()
        return code, output.getvalue(), errors.getvalue()

    def read_receipt(self):
        return json.loads((self.app / 'data/approvals-update-result.json').read_text())

    def test_success_uses_canonical_files_and_writes_a_completion_receipt_after_both_checks(self):
        code, output, errors = self.run_cli()
        self.assertEqual(code, 0, errors)
        result = json.loads(output)
        self.assertEqual(result['version'], '0.3.0')
        self.assertTrue(Path(result['backup']).is_dir())
        self.assertEqual(len(self.requests), 2)
        self.assertEqual(len(self.validated), 2)
        self.assertEqual(self.validated[-1], self.target)
        saved = self.read_receipt()
        self.assertEqual(saved['status'], 'installed')
        self.assertEqual(saved['attempt'], 'fixture-attempt')
        self.assertEqual(saved['version'], result['version'])
        self.assertEqual(saved['backup'], result['backup'])
        self.assertEqual(saved['pid'], os.getpid())

    def test_a_candidate_failure_writes_error_status_and_preserves_the_installed_version(self):
        def rejected(_candidate):
            raise RuntimeError('Fixture native check rejected the candidate')
        code, output, errors = self.run_cli(validate=rejected)
        self.assertEqual(code, 1)
        self.assertEqual(output, '')
        self.assertEqual(json.loads(errors)['status'], 'error')
        self.assertEqual(self.read_receipt()['status'], 'error')
        self.assertEqual(self.read_receipt()['attempt'], 'fixture-attempt')
        self.assertEqual((self.target / 'main.js').read_text(), 'export default class Previous {}\n')
        self.assertEqual(HELPER.read_version(self.target), '0.2.0')

    def test_another_attempt_cannot_replace_the_active_update_receipt(self):
        active = {'attempt': 'other-attempt', 'version': '0.4.0', 'status': 'installing'}
        with HELPER.update_lock(self.app):
            HELPER.receipt(self.app, active)
            code, output, errors = self.run_cli()
        self.assertEqual(code, 1)
        self.assertEqual(output, '')
        self.assertIn('already running', json.loads(errors)['error'])
        self.assertEqual(self.read_receipt(), active)
        self.assertEqual(self.requests, [], 'a lock refusal must not download a package')
        self.assertEqual(HELPER.read_version(self.target), '0.2.0')

    def test_a_failed_completion_record_does_not_report_a_verified_install_as_rolled_back(self):
        real_receipt = HELPER.receipt
        def fail_completed(app, value):
            if value['status'] == 'installed':
                raise OSError('Fixture completion record cannot be saved')
            real_receipt(app, value)
        code, output, errors = self.run_cli(receipt=fail_completed)
        self.assertEqual(HELPER.read_version(self.target), '0.3.0')
        self.assertEqual(code, 0, errors)
        result = json.loads(output)
        self.assertEqual(result['version'], '0.3.0')
        self.assertTrue(Path(result['backup']).is_dir())
        self.assertIn('completion record', result['warning'])
        self.assertNotEqual(self.read_receipt()['status'], 'error', 'the receipt cannot imply an installation failure after a successful swap')

    def test_status_does_not_validate_or_report_success_while_the_installer_holds_the_lock(self):
        active = {'attempt': 'fixture-attempt', 'version': '0.3.0', 'status': 'installing'}
        with HELPER.update_lock(self.app):
            HELPER.receipt(self.app, active)
            code, output, errors = self.run_cli(status=True)
        self.assertEqual(code, 0, errors)
        self.assertEqual(json.loads(output)['status'], 'installing')
        self.assertEqual(self.requests, [])
        self.assertEqual(self.validated, [])
        self.assertEqual(self.read_receipt(), active)

    def test_status_recovers_a_verified_installed_version_when_the_completion_record_was_not_saved(self):
        real_receipt = HELPER.receipt
        def fail_completed(app, value):
            if value['status'] == 'installed':
                raise OSError('Fixture completion record cannot be saved')
            real_receipt(app, value)
        self.run_cli(receipt=fail_completed)
        self.assertEqual(self.read_receipt()['status'], 'installing')
        self.requests.clear()
        self.validated.clear()
        code, output, errors = self.run_cli(status=True)
        self.assertEqual(code, 0, errors)
        recovered = json.loads(output)
        self.assertEqual(recovered['status'], 'installed')
        self.assertEqual(recovered['version'], '0.3.0')
        self.assertEqual(recovered['attempt'], 'fixture-attempt')
        self.assertEqual(self.requests, [])
        self.assertEqual(self.validated, [self.target])

    def test_status_cannot_report_success_when_the_installed_files_fail_validation(self):
        self.run_cli()
        HELPER.receipt(self.app, {'attempt': 'fixture-attempt', 'version': '0.3.0', 'status': 'installing'})
        self.requests.clear()
        def rejected(_candidate):
            raise RuntimeError('Fixture installed files failed validation')
        code, output, errors = self.run_cli(validate=rejected, status=True)
        result = json.loads(output)
        self.assertIn(result['status'], ['error', 'unknown'])
        self.assertIn('failed validation', result['error'])
        self.assertEqual(self.requests, [])

    def test_status_of_an_interrupted_attempt_does_not_claim_the_previous_version_was_restored(self):
        HELPER.receipt(self.app, {'attempt': 'fixture-attempt', 'version': '0.3.0', 'status': 'installing'})
        code, output, errors = self.run_cli(status=True)
        result = json.loads(output)
        self.assertIn(result['status'], ['error', 'unknown'])
        self.assertEqual(result['currentVersion'], '0.2.0')
        self.assertNotIn('restored', result['error'].lower())
        self.assertEqual(self.requests, [])


if __name__ == '__main__':
    unittest.main()
