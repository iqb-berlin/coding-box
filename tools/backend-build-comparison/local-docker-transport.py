#!/usr/bin/env python3
"""Transport existing fixture SQL to our real local services, without Docker.

This does not emulate application responses or test assertions. It accepts only
the known private fixture project and executes its unmodified psql/redis calls.
"""
import os
from pathlib import Path
import signal
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
INFRA = ROOT / 'tmp/backend-build-comparison/infra'
args = sys.argv[1:]
project = os.environ.get('REPLAY_E2E_COMPOSE_PROJECT', '')
if not project.startswith('coding-box-replay-build-comparison-'):
    raise SystemExit('Local transport requires the private comparison project')
if args[0] == 'ps':
    if f'label=com.docker.compose.project={project}' not in args:
        raise SystemExit('Unexpected project')
    for service in ['db', 'redis', 'keycloak']:
        if f'label=com.docker.compose.service={service}' in args:
            print('local-build-comparison-' + service)
            raise SystemExit(0)
elif args[0] == 'exec':
    items = args[1:]
    if items[0] == '-i':
        items = items[1:]
    service, command, *parameters = items
    if service == 'local-build-comparison-db' and command == 'psql':
        os.execvpe('psql', ['psql', '-h', '127.0.0.1', '-p', '25441', *parameters],
                   {**os.environ, 'PGPASSWORD': 'disposable_test_only'})
    if service == 'local-build-comparison-redis' and command == 'redis-cli':
        binary = str(INFRA / 'redis-cli')
        os.execv(binary, [binary, '-h', '127.0.0.1', '-p', '26441', *parameters])
elif args[0] == 'inspect' and args[-1] == 'local-build-comparison-keycloak':
    print('true' if (INFRA / 'keycloak-paused').exists() else 'false')
    raise SystemExit(0)
elif args[0] in ['pause', 'unpause'] and args[-1] == 'local-build-comparison-keycloak':
    pid = int((INFRA / 'keycloak.pid').read_text())
    paused = args[0] == 'pause'
    os.kill(pid, signal.SIGSTOP if paused else signal.SIGCONT)
    marker = INFRA / 'keycloak-paused'
    if paused:
        marker.touch()
    else:
        marker.unlink(missing_ok=True)
    raise SystemExit(0)
raise SystemExit('Unsupported local fixture transport operation: ' + repr(args[:3]))
