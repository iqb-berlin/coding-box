#!/usr/bin/env python3
"""Keep the already prepared private Redis/Keycloak fixture alive during checks."""
import os
from pathlib import Path
import signal
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
INFRA = ROOT / 'tmp/backend-build-comparison/infra'
processes = []

def stop(*_):
    for process in processes:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
    for process in processes:
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
    raise SystemExit(0)

signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)
for role, command, environment in [
    ('redis', [str(INFRA / 'redis-server'), '--bind', '127.0.0.1', '--port', '26441', '--save', '', '--appendonly', 'no', '--dir', str(INFRA)], os.environ),
    ('keycloak', [str(INFRA / 'keycloak-26.4.0/bin/kc.sh'), 'start-dev', '--import-realm', '--http-host=127.0.0.1', '--http-port=28441', '--hostname=http://127.0.0.1:28441'], {**os.environ, 'JAVA_OPTS_APPEND': '-Xmx512m -XX:ActiveProcessorCount=2'})
]:
    with (INFRA / (role + '.log')).open('a') as log:
        process = subprocess.Popen(command, env=environment, start_new_session=True,
                                   stdout=log, stderr=subprocess.STDOUT)
    processes.append(process)
    (INFRA / (role + '.pid')).write_text(str(process.pid))
deadline = time.time() + 90
while time.time() < deadline:
    if any(process.poll() is not None for process in processes):
        raise RuntimeError('A private fixture service failed; inspect its log')
    try:
        with urllib.request.urlopen('http://127.0.0.1:28441/realms/coding-e2e/.well-known/openid-configuration', timeout=2) as response:
            if response.status == 200:
                break
    except Exception:
        time.sleep(.5)
else:
    raise RuntimeError('Keycloak readiness timed out')
print('PRIVATE_BUILD_COMPARISON_FIXTURE_READY', flush=True)
while True:
    if any(process.poll() is not None for process in processes):
        stop()
    time.sleep(1)
