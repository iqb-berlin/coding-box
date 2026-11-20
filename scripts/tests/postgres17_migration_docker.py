"""Real Docker/Liquibase proof. Only creates its own projects and synthetic data."""
import importlib.util
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("pg17", ROOT / "scripts/postgres17_migration.py")
pg17 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pg17)


class DockerMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        required = ("PG17_TEST_BACKEND_IMAGE", "PG17_TEST_POSTGRES14_IMAGE", "PG17_TEST_POSTGRES17_IMAGE", "PG17_TEST_LIQUIBASE_IMAGE")
        if any(not os.environ.get(key) for key in required):
            raise RuntimeError("Explicit test images are required: " + ", ".join(required))

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="pg17-automation-test-", dir=os.environ.get('PG17_TEST_DIRECTORY'))
        self.root = Path(self.directory.name)
        self.project = "pg17-proof-" + secrets.token_hex(5)
        self.database = "pr1186_migration_auto"
        self.network = self.project + "-app"
        self.command_env = {**os.environ, "PYTHONUNBUFFERED": "1"}
        # Nx can load the repository dotenv. Only the fixture selects its release and volume.
        for key in ("TAG", "POSTGRES_IMAGE_SUFFIX", "POSTGRES_DATA_VOLUME", "POSTGRES_DATA_VOLUME_EXTERNAL"):
            self.command_env.pop(key, None)
        self.volume_names = set()
        self.migration_networks = set()
        self.addCleanup(self.cleanup)
        (self.root / '.env.coding-box').write_text("# retained comment\nTAG=test\nPOSTGRES_DATA_VOLUME=\nPOSTGRES_DATA_VOLUME_EXTERNAL=false\n")
        os.chmod(self.root / '.env.coding-box', 0o600)
        self.original_env = (self.root / '.env.coding-box').read_bytes()
        credentials = {"POSTGRES_HOST": "db", "POSTGRES_PORT": "5432", "POSTGRES_USER": "integration_test",
                       "POSTGRES_PASSWORD": "integration$$test", "POSTGRES_DB": self.database}
        connect = "const pg=require('pg');const p=new pg.Client({host:process.env.POSTGRES_HOST,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,database:process.env.POSTGRES_DB});process.on('SIGTERM',()=>p.end().finally(()=>process.exit(0)));p.connect().then(()=>{"
        backend = connect + "require('http').createServer(async(q,s)=>{try{await p.query('SELECT 1');s.end('ready')}catch(e){s.statusCode=503;s.end('down')}}).listen(3333,'0.0.0.0')}).catch(()=>process.exit(1))"
        worker = connect + "setInterval(()=>p.query('SELECT 1').catch(()=>process.exit(1)),1000)}).catch(()=>process.exit(1))"
        release = self.project + ":test"
        self.execute(["docker", "tag", os.environ["PG17_TEST_POSTGRES14_IMAGE"], release])
        self.addCleanup(self.execute, ["docker", "image", "rm", release], check=False)
        self.execute(["docker", "tag", os.environ["PG17_TEST_POSTGRES17_IMAGE"], release + "-pg17"])
        self.addCleanup(self.execute, ["docker", "image", "rm", release + "-pg17"], check=False)
        model = {"name": self.project, "services": {
            "db": {"image": self.project + ":${TAG}${POSTGRES_IMAGE_SUFFIX:-}", "environment": credentials,
                   "volumes": ["db_vol:/var/lib/postgresql/data"], "networks": ["app"], "shm_size": "512m"},
            "backend": {"image": os.environ['PG17_TEST_BACKEND_IMAGE'], "environment": credentials,
                        "entrypoint": ["node"], "command": ["--input-type=commonjs", "-e", backend], "networks": ["app"],
                        "healthcheck": {"test": ["CMD", "node", "-e", "fetch('http://127.0.0.1:3333').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], "interval": "1s", "timeout": "2s", "retries": 5}},
            "backend-export-worker": {"image": os.environ['PG17_TEST_BACKEND_IMAGE'], "environment": credentials,
                                      "entrypoint": ["node"], "command": ["--input-type=commonjs", "-e", worker], "networks": ["app"],
                                      "healthcheck": {"disable": True}}},
            "volumes": {"db_vol": {"name": "${POSTGRES_DATA_VOLUME:-${COMPOSE_PROJECT_NAME}_db_vol}", "external": "${POSTGRES_DATA_VOLUME_EXTERNAL:-false}"}},
            "networks": {"app": {"name": self.network}}}
        self.model = model
        (self.root / 'docker-compose.coding-box.yaml').write_text(json.dumps(model))
        (self.root / 'docker-compose.coding-box.prod.yaml').write_text('{"services":{}}')
        self.base = ['docker', 'compose', '--project-directory', str(self.root), '--env-file', str(self.root / '.env.coding-box'),
                     '-p', self.project, '-f', str(self.root / 'docker-compose.coding-box.yaml'), '-f', str(self.root / 'docker-compose.coding-box.prod.yaml')]
        self.execute(self.base + ['up', '-d', '--no-deps', 'db'])
        self.wait_sql()
        self.execute(['docker', 'run', '--rm', '--network', self.network, '-e', 'LIQUIBASE_COMMAND_USERNAME=integration_test',
                      '-e', 'LIQUIBASE_COMMAND_PASSWORD=integration$test', os.environ['PG17_TEST_LIQUIBASE_IMAGE'],
                      '--classpath=changelog', '--changelog-file=coding-box.changelog-root.xml',
                      f'--url=jdbc:postgresql://db:5432/{self.database}', 'update'])
        self.sql((ROOT / 'scripts/qa/postgres-migration-fixture.sql').read_text())
        self.execute(self.base + ['up', '-d', '--no-deps', 'backend', 'backend-export-worker'])
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            if self.inspect('backend')['State'].get('Health', {}).get('Status') == 'healthy':
                return
            time.sleep(1)
        raise RuntimeError('Test backend not healthy')

    def execute(self, command, data=None, check=True):
        result = subprocess.run(command, input=data, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                env=self.command_env, timeout=240)
        if check and result.returncode:
            print(result.stdout[-6000:], flush=True)
            raise AssertionError(f"Command failed: {command}\n{result.stdout[-6000:]}")
        return result

    def inspect(self, service):
        value = self.execute(self.base + ['ps', '-aq', service]).stdout.strip()
        return json.loads(self.execute(['docker', 'inspect', value]).stdout)[0]

    def sql(self, value):
        db = self.inspect('db')
        host = next((v['IPAddress'] for k, v in db['NetworkSettings']['Networks'].items() if '-pg17-' in k), '127.0.0.1')
        return self.execute(['docker', 'exec', '-i', '-e', 'PGPASSWORD=integration$test', db['Id'], 'psql', '-h', host, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
                             '-U', 'integration_test', '-d', self.database], value).stdout.strip()

    def wait_sql(self):
        for _ in range(40):
            try:
                if self.sql('SELECT 1') == '1':
                    return
            except AssertionError:
                pass
            time.sleep(1)
        raise AssertionError('PostgreSQL test source did not start')

    def make(self, target, extra=None, check=True):
        return self.execute(['make', target, f'PG17_DIRECTORY={self.root}', 'PG17_WAIT_SECONDS=35', *(extra or [])], check=check)

    def journal(self):
        directory = Path(json.loads((self.root / 'backup/postgres17/latest.json').read_text())['directory'])
        state = json.loads((directory / 'state.json').read_text())
        self.volume_names.add(state['target_volume'])
        self.migration_networks.add(state['network'])
        return directory, state

    def cleanup(self):
        try:
            pointer = self.root / 'backup/postgres17/latest.json'
            if pointer.exists():
                try:
                    self.journal()
                except (KeyError, FileNotFoundError):
                    pass
            ids = self.execute(['docker', 'ps', '-aq', '--filter', f'label=com.docker.compose.project={self.project}'], check=False).stdout.split()
            if ids:
                self.execute(['docker', 'rm', '-f', *ids], check=False)
            networks = self.execute(['docker', 'network', 'ls', '-q', '--filter', f'name={self.project}'], check=False).stdout.split()
            if networks:
                self.execute(['docker', 'network', 'rm', *networks], check=False)
            self.volume_names.add(self.project + '_db_vol')
            # Exact names created by this disposable fixture only; never a prune.
            self.execute(['docker', 'volume', 'rm', *self.volume_names], check=False)
        finally:
            if os.environ.get('PG17_TEST_KEEP_ARTIFACTS') and (self.root / 'backup').exists():
                import shutil
                target = Path(os.environ['PG17_TEST_KEEP_ARTIFACTS']) / self.project
                shutil.copytree(self.root / 'backup', target, dirs_exist_ok=True)
            self.directory.cleanup()

    def test_prepared_upgrade_and_standalone_make_rollback_preserve_every_row(self):
        self.make('coding-box-postgres17-migrate', ['PG17_PREPARE_ONLY=1'])
        directory, state = self.journal()
        self.assertEqual(state['phase'], 'verified')
        self.assertFalse(state['writes_released'])
        self.assertEqual(self.sql('SHOW server_version'), '17.12')
        before = json.loads((directory / 'before.json').read_text())['preserved']
        after = json.loads((directory / 'cutover.json').read_text())['preserved']
        self.assertEqual(before, after)
        self.assertEqual(len(before['tables']), 43)
        self.make('coding-box-postgres17-rollback')
        self.assertEqual(self.journal()[1]['phase'], 'rolled_back')
        self.assertEqual(self.sql('SHOW server_version'), '14.24')
        self.assertEqual((self.root / '.env.coding-box').read_bytes(), self.original_env)
        self.assertEqual(self.sql('SELECT count(*) FROM response'), '3')
        self.assertEqual(self.inspect('backend')['State']['Health']['Status'], 'healthy')
        self.make('coding-box-postgres17-rollback')
        self.execute(self.base + ['up', '-d', '--no-deps', '--force-recreate', 'db'])
        self.wait_sql()
        self.assertEqual(self.sql('SHOW server_version'), '14.24')
        self.assertEqual(self.sql('SELECT count(*) FROM response'), '3')

    def test_completed_upgrade_keeps_new_writes_and_refuses_old_volume_rollback(self):
        self.make('coding-box-postgres17-migrate')
        directory, state = self.journal()
        self.assertEqual(state['phase'], 'complete')
        self.assertTrue(state['writes_released'])
        self.assertEqual(self.sql('SHOW server_version'), '17.12')
        self.sql("UPDATE response SET score_v1=42 WHERE variableid='V1'")
        current = (self.root / '.env.coding-box').read_bytes()
        result = self.make('coding-box-postgres17-rollback', check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('writes may have occurred', result.stdout)
        self.assertEqual(self.sql("SELECT score_v1 FROM response WHERE variableid='V1'"), '42')
        self.assertEqual((self.root / '.env.coding-box').read_bytes(), current)
        self.assertEqual(self.inspect('backend')['State']['Health']['Status'], 'healthy')
        self.assertEqual(json.loads((directory / 'checksums.json').read_text())['database.dump'], pg17.digest(directory / 'database.dump'))
        self.make('coding-box-postgres17-finish')
        self.assertEqual(self.inspect('backend')['State']['Health']['Status'], 'healthy')

        next_release = self.project + ":next-pg17"
        self.execute(["docker", "tag", os.environ["PG17_TEST_POSTGRES17_IMAGE"], next_release])
        self.addCleanup(self.execute, ["docker", "image", "rm", next_release], check=False)
        envfile = self.root / ".env.coding-box"
        envfile.write_text(pg17.update_environment(envfile.read_text(), {"TAG": "next"}))
        self.execute(self.base + ['up', '-d', '--no-deps', '--force-recreate', 'db'])
        self.wait_sql()
        self.assertEqual(self.sql('SHOW server_version'), '17.12')
        self.assertEqual(self.inspect('db')['Config']['Image'], next_release)
        self.assertEqual(self.sql("SELECT score_v1 FROM response WHERE variableid='V1'"), '42')

    def test_restore_difference_automatically_returns_to_source(self):
        class CorruptTarget(pg17.Migration):
            def snapshot(operation, host, name, baseline=None):
                if name == 'restored.json':
                    target = operation.container('stage.json', 'pg17_stage')
                    operation.sql(target, "UPDATE response SET score_v1=88 WHERE variableid='V1'", operation.state['database'], maintenance=True)
                return super().snapshot(host, name, baseline)
        from unittest.mock import patch
        with patch.object(pg17, 'Migration', CorruptTarget):
            self.assertEqual(pg17.main(['migrate', '--directory', str(self.root), '--wait-seconds', '35']), 1)
        directory, state = self.journal()
        self.assertEqual(state['phase'], 'rolled_back')
        self.assertEqual(self.sql('SHOW server_version'), '14.24')
        self.assertEqual(self.sql("SELECT score_v1 FROM response WHERE variableid='V1'"), '2')
        self.assertEqual((self.root / '.env.coding-box').read_bytes(), self.original_env)
        self.assertEqual(self.inspect('backend')['State']['Health']['Status'], 'healthy')

    def test_failure_after_new_writes_keeps_17_and_creates_recovery_backup(self):
        class FailAfterWrites(pg17.Migration):
            def start_apps(operation, file):
                super().start_apps(file)
                if file == 'target.json':
                    target = operation.container(file, 'db')
                    operation.sql(target, "UPDATE response SET score_v1=77 WHERE variableid='V1'", operation.state['database'])
                    raise pg17.MigrationError('Injected failure after a new write')
        from unittest.mock import patch
        with patch.object(pg17, 'Migration', FailAfterWrites):
            self.assertEqual(pg17.main(['migrate', '--directory', str(self.root), '--wait-seconds', '35']), 1)
        directory, state = self.journal()
        self.assertEqual(state['phase'], 'needs_attention')
        self.assertTrue(state['writes_released'])
        self.assertEqual(self.sql('SHOW server_version'), '17.12')
        self.assertEqual(self.sql('SHOW default_transaction_read_only'), 'on')
        self.assertEqual(self.sql("SELECT score_v1 FROM response WHERE variableid='V1'"), '77')
        self.assertTrue(list(directory.glob('recovery17-*.dump')))
        self.assertFalse(self.inspect('backend')['State']['Running'])
        self.assertNotEqual(self.make('coding-box-postgres17-rollback', check=False).returncode, 0)

    def test_external_session_aborts_without_restarting_source_or_terminating_client(self):
        original_id = self.inspect('db')['Id']
        code = "const p=new(require('pg').Client)({host:'db',user:'integration_test',password:process.env.PGPASSWORD,database:'pr1186_migration_auto',application_name:'foreign_writer'});p.connect().then(()=>setInterval(()=>{},1000))"
        self.execute(['docker', 'run', '-d', '--network', self.network, '--label', f'com.docker.compose.project={self.project}',
                      '-e', 'PGPASSWORD=integration$test', '--entrypoint', 'node', os.environ['PG17_TEST_BACKEND_IMAGE'], '-e', code])
        query = "SELECT count(*) FROM pg_stat_activity WHERE application_name='foreign_writer'"
        for _ in range(20):
            if self.sql(query) == '1':
                break
            time.sleep(1)
        else:
            self.fail('Foreign test session did not connect')
        result = self.make('coding-box-postgres17-migrate', check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('External database clients', result.stdout)
        self.assertEqual(self.journal()[1]['phase'], 'rolled_back')
        self.assertEqual(self.inspect('db')['Id'], original_id)
        self.assertEqual(self.sql(query), '1')
        self.assertEqual((self.root / '.env.coding-box').read_bytes(), self.original_env)

    def test_unsupported_schema_is_rejected_before_stopping_any_writers(self):
        self.sql('CREATE SCHEMA custom_data; CREATE TABLE custom_data.retained(id integer); INSERT INTO custom_data.retained VALUES(23)')
        original_id = self.inspect('db')['Id']
        result = self.make('coding-box-postgres17-migrate', check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('no writers stopped', result.stdout)
        self.assertEqual(self.inspect('db')['Id'], original_id)
        self.assertEqual(self.sql('SELECT id FROM custom_data.retained'), '23')
        self.assertEqual(self.inspect('backend')['State']['Health']['Status'], 'healthy')
        self.assertEqual((self.root / '.env.coding-box').read_bytes(), self.original_env)

    def test_interrupted_initial_report_does_not_prevent_return_to_untouched_source(self):
        class FailDuringSnapshot(pg17.Migration):
            def snapshot(operation, host, name, baseline=None):
                if name == 'before.json':
                    pg17.private_write(operation.run_dir / name, '{"incomplete":')
                    raise pg17.MigrationError('Injected interrupted snapshot write')
                return super().snapshot(host, name, baseline)
        from unittest.mock import patch
        with patch.object(pg17, 'Migration', FailDuringSnapshot):
            self.assertEqual(pg17.main(['migrate', '--directory', str(self.root), '--wait-seconds', '35']), 1)
        self.assertEqual(self.journal()[1]['phase'], 'rolled_back')
        self.assertEqual(self.sql('SHOW server_version'), '14.24')
        self.assertEqual(self.sql('SELECT count(*) FROM response'), '3')
        self.assertEqual((self.root / '.env.coding-box').read_bytes(), self.original_env)
        self.assertEqual(self.inspect('backend')['State']['Health']['Status'], 'healthy')


if __name__ == '__main__':
    unittest.main(verbosity=2)
