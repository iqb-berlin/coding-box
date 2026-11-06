#!/usr/bin/env python3
"""Summarize original BuildKit logs, preserving cache hits and wall boundaries."""
from pathlib import Path
import argparse
import csv
import json
import re


def parse_steps(text):
    steps = {}
    for line in text.splitlines():
        header = re.match(r'^#(\d+) \[([^]]+)\] (RUN .+|COPY .+)$', line)
        if header:
            steps.setdefault(header[1], {'stage': header[2], 'command': header[3]})
        outcome = re.match(r'^#(\d+) (CACHED|DONE ([0-9.]+)s)$', line)
        if outcome and outcome[1] in steps:
            steps[outcome[1]].update(cached=outcome[2] == 'CACHED',
                                     seconds=None if outcome[2] == 'CACHED' else float(outcome[3]))
    return [s for s in steps.values() if 'cached' in s]


assert parse_steps('#4 [builder 3/4] RUN npm ci\n#4 CACHED')[0]['cached']
assert parse_steps('#7 [backend dependencies 5/5] RUN npm ci --omit=dev\n#7 DONE 12.3s')[0]['seconds'] == 12.3
assert parse_steps('#8 [builder 3/4] RUN npm ci\n#8 ERROR: failed') == []

parser = argparse.ArgumentParser()
parser.add_argument('--data', type=Path, default=Path(__file__).resolve().parents[2] / 'tmp/docker-build-benchmark')
args = parser.parse_args()
experiment = json.loads((args.data / 'experiment.json').read_text())
result = {'method': 'Shell wall time per phase; BuildKit RUN DONE and CACHED outcomes. Internal parallel steps are not added as wall time.', 'variants': {}}
snapshots = {}
for variant in ['before', 'after']:
    directory = args.data / variant / 'dist/docker-build-benchmark'
    if not directory.exists():
        continue
    expected = experiment[variant]
    assert expected and (directory / 'commit-sha.txt').read_text().strip() == expected['sha']
    assert (directory / 'pipeline-url.txt').read_text().strip().endswith('/' + str(expected['pipelineId']))
    timing = list(csv.DictReader((directory / 'timings.tsv').open(), delimiter='\t'))
    phases = {}
    for row in timing:
        assert int(row['finished_epoch']) - int(row['started_epoch']) == int(row['elapsed_seconds'])
        log = (directory / (row['step'] + '.log')).read_text()
        steps = parse_steps(log)
        phases[row['step']] = {
            'wallSeconds': int(row['elapsed_seconds']), 'exitCode': int(row['status']),
            'installations': [s for s in steps if 'npm ci ' in s['command']],
            'compilerSteps': [s for s in steps if 'nx build ' in s['command']],
            'layerExportsSeconds': [float(s) for s in re.findall(r'^#\d+ exporting layers ([0-9.]+)s done$', log, re.M)]
        }
    image = json.loads((directory / 'image-inspect.json').read_text())[0]
    snapshots[variant] = json.loads((directory / 'entity-metadata.json').read_text())
    result['variants'][variant] = {'phases': phases, 'imageBytes': image['Size'],
        'platform': image['Os'] + '/' + image['Architecture'],
        'artifact': json.loads((directory / 'production-artifact.json').read_text()),
        'entityCount': len(snapshots[variant])}
result['entitySnapshotsEqual'] = snapshots.get('before') == snapshots.get('after') if len(snapshots) == 2 else None
if len(snapshots) == 2:
    assert all(len(s) == 43 for s in snapshots.values())
    assert result['entitySnapshotsEqual'], 'Runtime entity metadata changed'
output = args.data / 'summary.json'
output.write_text(json.dumps(result, indent=2) + '\n')
print(output)
