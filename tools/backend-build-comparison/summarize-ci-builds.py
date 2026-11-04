#!/usr/bin/env python3
"""Extract BuildKit step durations from the downloaded original job artifacts."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'tmp/backend-build-comparison'

def steps(text):
    headers = {}
    result = []
    for line in text.splitlines():
        header = re.match(r'^#(\d+) \[([^]]+)\] (.*)$', line)
        if header:
            headers[header[1]] = {'step': header[2], 'command': header[3]}
        done = re.match(r'^#(\d+) DONE ([0-9.]+)s$', line)
        if done and done[1] in headers:
            result.append({**headers[done[1]], 'seconds': float(done[2])})
    return result

assert steps('#7 [builder 5/8] RUN npx nx build backend\n#7 0.1 log\n#7 DONE 12.3s') == [
    {'step': 'builder 5/8', 'command': 'RUN npx nx build backend', 'seconds': 12.3}]
assert steps('#4 [dependencies 5/5] RUN npm ci\n#4 ERROR: failed') == []

report = {'method': 'Original BuildKit DONE seconds for completed RUN steps; includes the entire corresponding command.', 'variants': {}}
for variant in ['webpack', 'rspack', 'tsc']:
    directory = DATA / 'ci' / variant / 'dist/backend-build-comparison-ci'
    record = {}
    for phase in ['builder', 'production']:
        log = directory / (phase + '.log')
        if log.exists():
            record[phase] = [step for step in steps(log.read_text()) if step['command'].startswith('RUN ')]
    report['variants'][variant] = record
(DATA / 'ci-build-summary.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
