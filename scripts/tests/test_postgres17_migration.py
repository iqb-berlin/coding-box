import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

SCRIPT = Path(__file__).resolve().parents[1] / "postgres17_migration.py"
spec = importlib.util.spec_from_file_location("postgres17_migration", SCRIPT)
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)

    def test_environment_edit_preserves_passwords_comments_and_removes_stale_duplicate_keys(self):
        original = '# private\nPOSTGRES_PASSWORD="pa$\\word#ä"\nPOSTGRES_DATA_VOLUME=old\nexport POSTGRES_DATA_VOLUME=stale\nTAG=1.2.3\n'
        result = migration.update_environment(original, {"POSTGRES_DATA_VOLUME": "restored", "POSTGRES_DATA_VOLUME_EXTERNAL": "true"})
        self.assertIn('POSTGRES_PASSWORD="pa$\\word#ä"\n', result)
        self.assertIn('TAG=1.2.3\n', result)
        self.assertEqual(result.count("POSTGRES_DATA_VOLUME="), 1)
        self.assertTrue(result.endswith('POSTGRES_DATA_VOLUME=restored\nPOSTGRES_DATA_VOLUME_EXTERNAL=true\n'))
        self.assertEqual(migration.update_environment("# header\r\nTAG=latest\r\n", {"POSTGRES_DATA_VOLUME": "new"}),
                         "# header\r\nTAG=latest\r\nPOSTGRES_DATA_VOLUME=new\r\n")

    def test_private_journal_is_atomic_and_readable_after_replacement(self):
        path = self.root / "state.json"
        migration.private_write(path, '{"writes_released":false}')
        migration.private_write(path, '{"writes_released":true}')
        self.assertTrue(json.loads(path.read_text())["writes_released"])
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(list(self.root.glob('.pg17-*')), [])

    def test_frozen_compose_values_do_not_interpolate_passwords_or_commands_again(self):
        value = {'environment': {'PASSWORD': 'pa$word${VAR}'}, 'command': ['sh', '-c', 'echo "$PGDATA"'], 'enabled': True}
        self.assertEqual(migration.compose_literals(value), {
            'environment': {'PASSWORD': 'pa$$word$${VAR}'}, 'command': ['sh', '-c', 'echo "$$PGDATA"'], 'enabled': True})

    def test_repeated_rollback_is_a_noop_before_any_mutation(self):
        operation = migration.Migration(self.root)
        operation.state = {"phase": "rolled_back", "writes_released": False}
        operation.save = Mock()
        operation.stop_apps = Mock()
        operation.rollback()
        operation.save.assert_not_called()
        operation.stop_apps.assert_not_called()

    def test_repeated_finish_keeps_the_completed_application_running(self):
        operation = migration.Migration(self.root)
        operation.state = {"phase": "complete", "writes_released": True}
        operation.snapshot = Mock()
        operation.docker = Mock()
        operation.finish()
        operation.snapshot.assert_not_called()
        operation.docker.assert_not_called()

    def test_source_fence_allows_only_migration_admin_then_rejects_before_old_rules(self):
        result = migration.hba_fence("coding-box", "root", "172.29.0.0/16", "scram-sha-256", "host all all all trust\n")
        self.assertLess(result.index('172.29.0.0/16 scram-sha-256'), result.index('0.0.0.0/0 reject'))
        self.assertLess(result.index('::0/0 reject'), result.index('host all all all trust'))
        self.assertIn('local "coding-box" all reject', result)
        for value in ('broken\nname', 'broken"name'):
            with self.assertRaises(migration.MigrationError):
                migration.hba_fence(value, "root", "172.29.0.0/16", "md5", "")

    def test_sql_identifiers_and_literals_cannot_change_a_statement(self):
        self.assertEqual(migration.identifier('a"b'), '"a""b"')
        self.assertEqual(migration.literal("a'\\b"), "E'a''\\\\b'")

    def test_second_migration_cannot_acquire_installation_lock(self):
        first = migration.Migration(self.root)
        second = migration.Migration(self.root)
        first.acquire()
        try:
            with self.assertRaises(migration.MigrationError):
                second.acquire()
        finally:
            first.lock.close()
            if second.lock:
                second.lock.close()

    def test_rollback_after_write_gate_refuses_before_any_mutation(self):
        operation = migration.Migration(self.root)
        operation.state = {"writes_released": True}
        operation.save = Mock()
        operation.docker = Mock()
        with self.assertRaisesRegex(migration.MigrationError, 'writes may have occurred'):
            operation.rollback()
        operation.save.assert_not_called()
        operation.docker.assert_not_called()

    def test_write_gate_is_durable_before_hba_readonly_or_application_start(self):
        operation = migration.Migration(self.root, self.root)
        operation.envfile.write_text("TAG=1.2.3\n")
        (self.root / 'pg_hba.conf').write_text('host all all all scram-sha-256\n')
        operation.state = {"phase": "verified", "changed_env_hash": migration.digest(operation.envfile),
                           "writes_released": False, "readonly_setting": None, "network": "private"}
        operation.snapshot = Mock()
        operation.verify_backups = Mock()
        operation.validate_target = Mock()
        operation.container = Mock(return_value={"Id": "target"})

        def assert_gate(*args, **kwargs):
            self.assertTrue(json.loads((self.root / 'state.json').read_text())["writes_released"])
        operation.write_container_file = Mock(side_effect=assert_gate)
        operation.sql = Mock(side_effect=assert_gate)
        operation.set_readonly = Mock(side_effect=assert_gate)
        operation.docker = Mock()
        operation.start_apps = Mock(side_effect=migration.MigrationError('readiness failed'))
        with self.assertRaises(migration.MigrationError):
            operation.finish()
        self.assertTrue(operation.state['writes_released'])
        with self.assertRaises(migration.MigrationError):
            operation.rollback()

    def test_environment_drift_prevents_release_and_does_not_overwrite_operator_edits(self):
        operation = migration.Migration(self.root, self.root)
        operation.envfile.write_text('TAG=operator-change\n')
        operation.state = {"phase": "verified", "changed_env_hash": "different", "writes_released": False}
        operation.snapshot = Mock()
        with self.assertRaisesRegex(migration.MigrationError, 'changed after verification'):
            operation.finish()
        operation.snapshot.assert_not_called()
        self.assertFalse(operation.state['writes_released'])
        self.assertEqual(operation.envfile.read_text(), 'TAG=operator-change\n')

    def test_backup_corruption_is_detected_before_writes(self):
        data = self.root / 'database.dump'
        data.write_bytes(b'valid archive')
        (self.root / 'checksums.json').write_text(json.dumps({'database.dump': migration.digest(data)}))
        operation = migration.Migration(self.root, self.root)
        operation.verify_backups()
        data.write_bytes(b'changed archive')
        with self.assertRaisesRegex(migration.MigrationError, 'backup/checksum changed'):
            operation.verify_backups()

    def test_restore_input_is_streamed_from_file(self):
        data = self.root / 'database.dump'
        data.write_bytes(b'archive')
        operation = migration.Migration(self.root, self.root)
        self.assertEqual(operation.run(['python3', '-c', 'import sys;sys.stdout.write(sys.stdin.buffer.read().decode())'], input_file=data), 'archive')

    def test_before_write_failure_rolls_back_but_after_write_failure_preserves_target(self):
        for released in (False, True):
            operation = Mock()
            operation.state = {'maintenance': True, 'writes_released': released}
            operation.run_dir = self.root
            operation.lock = None
            operation.initialize.return_value = True
            operation.freeze.side_effect = migration.MigrationError('injected failure')
            with patch.object(migration, 'Migration', return_value=operation), patch.object(migration.signal, 'signal'), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(migration.main(['migrate', '--directory', str(self.root)]), 1)
            if released:
                operation.protect_target.assert_called_once()
                operation.rollback.assert_not_called()
            else:
                operation.rollback.assert_called_once()
                operation.protect_target.assert_not_called()

    def test_make_and_release_installers_include_automation(self):
        root = SCRIPT.parents[1]
        self.assertIn('scripts/make/postgres17.mk', (root / 'scripts/make/prod.mk').read_text())
        for script in ('install.sh', 'update.sh'):
            text = (root / 'scripts' / script).read_text()
            self.assertIn('download_file scripts/postgres17_migration.py scripts/postgres17_migration.py', text)
            self.assertIn('download_file scripts/qa/postgres-migration-snapshot.mjs', text)

    def test_installed_make_keeps_original_default_goal(self):
        scripts = self.root / 'scripts/make'
        scripts.mkdir(parents=True)
        (scripts / 'postgres17.mk').write_text((SCRIPT.parent / 'make/postgres17.mk').read_text())
        (self.root / '.env.coding-box').write_text('TAG=test\n')
        probe = self.root / 'probe.mk'
        probe.write_text('probe:\n\t@echo "$(.DEFAULT_GOAL)"\n')
        result = subprocess.run(['make', '--no-print-directory', '-f', str(SCRIPT.parent / 'make/prod.mk'),
                                 '-f', str(probe), f'CODING_BOX_BASE_DIR={self.root}', 'probe'],
                                capture_output=True, text=True, check=True)
        self.assertEqual(result.stdout.strip(), 'coding-box-up')

    def test_updater_keeps_14_running_and_keeps_normal_restart_for_17(self):
        (self.root / 'scripts/make').mkdir(parents=True)
        (self.root / 'scripts/make/coding-box.mk').write_text('include scripts/make/postgres17.mk\n')
        source = (SCRIPT.parent / 'update.sh').read_text()
        functions = source[source.index('postgres17_migration_pending() {'):source.index('application_reload() {')]
        shell = functions + '''
APP_NAME=coding-box
APP_DIR=$1
HAS_ENV_FILE_UPDATE=false
HAS_CONFIG_FILE_UPDATE=false
HAS_MIGRATION_FILES=false
docker() {
  if [[ $1 == compose && ${*: -3} == "ps -q db" ]]; then printf 'source-db\n';
  elif [[ $1 == exec ]]; then printf 'postgres (PostgreSQL) %s\n' "$TEST_PG_VERSION";
  else printf 'Unexpected Docker mutation\n' >&2; return 99; fi
}
application_restart() { printf 'NORMAL_RESTART\n'; }
finalize_update
'''
        for version in ('14.24', '17.12'):
            result = subprocess.run(['bash', '-c', shell, 'test', str(self.root)],
                                    env={**os.environ, 'TEST_PG_VERSION': version}, capture_output=True, text=True, check=True)
            self.assertEqual('coding-box-postgres17-migrate' in result.stdout, version == '14.24')
            self.assertEqual('NORMAL_RESTART' in result.stdout, version == '17.12')
            self.assertNotIn('Unexpected Docker mutation', result.stderr)


if __name__ == '__main__':
    unittest.main()
