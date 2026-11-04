#!/usr/bin/env python3
"""Start only private local fixture services; no existing database is touched."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import time
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
INFRA = ROOT / 'tmp/backend-build-comparison/infra'
INFRA.mkdir(parents=True, exist_ok=True)
POSTGRES_PORT, REDIS_PORT, KEYCLOAK_PORT = 25441, 26441, 28441

def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs)

def free(port):
    with socket.socket() as connection:
        connection.settimeout(.2)
        return connection.connect_ex(('127.0.0.1', port)) != 0

def wait_http(url, timeout=120):
    import urllib.request
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(.5)
    raise RuntimeError('Readiness failed: ' + url)

def schema(database, username):
    command = [str(INFRA / 'liquibase/liquibase'),
               '--search-path=' + str(ROOT / 'database/changelog'),
               '--changelog-file=coding-box.changelog-root.xml',
               '--url=jdbc:postgresql://127.0.0.1:' + str(POSTGRES_PORT) + '/' + database,
               '--username=' + username, '--password=disposable_test_only', 'update']
    result = run(command)
    (INFRA / ('liquibase-' + database + '.log')).write_text(result.stdout + result.stderr)
    print('Applied actual Liquibase schema:', database, flush=True)

for port in [POSTGRES_PORT, REDIS_PORT, KEYCLOAK_PORT]:
    if not free(port):
        raise RuntimeError(f'Fixture port already occupied: {port}')

data = INFRA / 'postgres'
if data.exists() and not (data / 'PG_VERSION').exists():
    raise RuntimeError('Unexpected private PostgreSQL directory')
password = INFRA / 'postgres-password.txt'
password.write_text('disposable_test_only\n')
password.chmod(0o600)
if not (data / 'PG_VERSION').exists():
    run(['initdb', '-D', str(data), '-U', 'codebook_test', '--pwfile=' + str(password),
         '--auth-host=scram-sha-256', '--auth-local=trust', '--encoding=UTF8', '--no-locale'])
socket_dir = tempfile.mkdtemp(prefix='build-compare-pg-')
(INFRA / 'postgres-socket-dir.txt').write_text(socket_dir)
run(['pg_ctl', '-D', str(data), '-l', str(INFRA / 'postgres.log'), '-o',
     f'-h 127.0.0.1 -p {POSTGRES_PORT} -k {socket_dir} -c shared_buffers=32MB -c max_connections=100', 'start'])
pg_env = {**os.environ, 'PGPASSWORD': 'disposable_test_only'}
run(['createdb', '-h', '127.0.0.1', '-p', str(POSTGRES_PORT), '-U', 'codebook_test', 'codebook_test'], env=pg_env)
run(['psql', '-h', '127.0.0.1', '-p', str(POSTGRES_PORT), '-U', 'codebook_test', '-d', 'postgres',
     '-v', 'ON_ERROR_STOP=1', '-c', "CREATE ROLE replay_e2e LOGIN PASSWORD 'disposable_test_only'"], env=pg_env)
run(['createdb', '-h', '127.0.0.1', '-p', str(POSTGRES_PORT), '-U', 'codebook_test', '-O', 'replay_e2e', 'replay_e2e'], env=pg_env)
run(['createdb', '-h', '127.0.0.1', '-p', str(POSTGRES_PORT), '-U', 'codebook_test', 'backend_integration'], env=pg_env)
schema('codebook_test', 'codebook_test')
schema('replay_e2e', 'replay_e2e')

redis_binary = os.environ.get('BUILD_COMPARISON_REDIS_SERVER') or shutil.which('redis-server')
if not redis_binary:
    raise RuntimeError('Set BUILD_COMPARISON_REDIS_SERVER to a real Redis server binary')
redis_candidates = [Path(redis_binary)]
for binary in ['redis-server', 'redis-cli']:
    shutil.copy2(redis_candidates[0].with_name(binary), INFRA / binary)
with (INFRA / 'redis.log').open('w') as log:
    process = subprocess.Popen([str(INFRA / 'redis-server'), '--bind', '127.0.0.1', '--port', str(REDIS_PORT),
                                '--save', '', '--appendonly', 'no', '--dir', str(INFRA)], stdout=log, stderr=subprocess.STDOUT)
(INFRA / 'redis.pid').write_text(str(process.pid))

keycloak = INFRA / 'keycloak-26.4.0'
imports = keycloak / 'data/import'
imports.mkdir(parents=True, exist_ok=True)
shutil.copy2(ROOT / 'scripts/e2e/codebook/codebook-proof-realm.json', imports / 'codebook-proof-realm.json')
node = os.environ.get('BUILD_COMPARISON_NODE') or shutil.which('node')
auth = INFRA / 'auth'
auth.mkdir(exist_ok=True)
run([node, '--input-type=module', '-e', """
import {prepareAuthEnvironment} from './scripts/e2e/replay/auth-environment.mjs';
import {writeFile} from 'node:fs/promises';
const env=await prepareAuthEnvironment(process.argv[1],28441,24200);
await writeFile(process.argv[1]+'/environment.json',JSON.stringify(env),{mode:0o600});
""", str(auth)], cwd=ROOT)
shutil.copy2(auth / 'coding-e2e-realm.json', imports / 'coding-e2e-realm.json')
with (INFRA / 'keycloak.log').open('w') as log:
    process = subprocess.Popen([str(keycloak / 'bin/kc.sh'), 'start-dev', '--import-realm',
                                '--http-host=127.0.0.1', '--http-port=' + str(KEYCLOAK_PORT),
                                '--hostname=http://127.0.0.1:' + str(KEYCLOAK_PORT)],
                               env={**os.environ, 'JAVA_OPTS_APPEND': '-Xmx512m -XX:ActiveProcessorCount=2'},
                               stdout=log, stderr=subprocess.STDOUT)
(INFRA / 'keycloak.pid').write_text(str(process.pid))
wait_http(f'http://127.0.0.1:{KEYCLOAK_PORT}/realms/codebook-proof/.well-known/openid-configuration')
wait_http(f'http://127.0.0.1:{KEYCLOAK_PORT}/realms/coding-e2e/.well-known/openid-configuration')
(INFRA / 'versions.json').write_text(json.dumps({
    'postgres': run(['postgres', '--version']).stdout.strip(),
    'redis': run([str(INFRA / 'redis-server'), '--version']).stdout.strip(),
    'keycloak': '26.4.0',
    'keycloakArchiveSha256': hashlib.sha256((INFRA / 'keycloak.tar.gz').read_bytes()).hexdigest(),
    'databaseTransport': 'Local PostgreSQL, own initdb; actual Liquibase 4.28.0 update (169 changesets)'
}, indent=2))
print('Private local PostgreSQL, Redis and Keycloak are ready.', flush=True)

if '--serve' in __import__('sys').argv:
    print('Keep this terminal open while running the comparison checks.', flush=True)
    while True:
        time.sleep(1)
