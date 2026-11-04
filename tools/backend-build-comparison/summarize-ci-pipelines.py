#!/usr/bin/env python3
"""Describe observed completion paths without adding parallel job durations."""
from pathlib import Path
from datetime import datetime
import json

DATA = Path(__file__).resolve().parents[2] / 'tmp/backend-build-comparison'

def stamp(value):
    return datetime.fromisoformat(value).timestamp() if value else None

# Resolved needs for the frozen, complete feature-branch graph. Jobs with
# explicit needs bypass stage barriers; DB/Liquibase image jobs retain .pre.
distributed = ['install-dependencies', 'build-cicd-base-image']
needs = {
    'check-config': [], 'check-default-rules': [], 'install-dependencies': [],
    'build-cicd-base-image': [], 'gemnasium-dependency_scanning': [],
    'test-backend-container': [],
    'build-db-image': ['check-config', 'check-default-rules'],
    'build-liquibase-image': ['check-config', 'check-default-rules'],
    'build-app': distributed, 'test-backend': distributed,
    'test-backend-integration': distributed, 'lint-app': distributed,
    'test-db': ['build-db-image', 'build-liquibase-image'],
    'test-frontend': ['install-dependencies', 'test-backend-integration', 'test-backend', 'build-cicd-base-image'],
    'test-browser': ['install-dependencies', 'build-app'],
    'test-replay-live': ['install-dependencies'],
    'test-auth-live': ['install-dependencies'],
    'test-workflows-live': ['install-dependencies'],
    'audit-app': ['install-dependencies']
}

source = DATA / 'ci-results.json'
report = {'method': 'Follow the latest-finishing prerequisite of the last-finishing job; scheduler waiting is explicit. This is the observed completion path, not a hypothetical queue-free speed estimate.', 'runs': []}
if source.exists():
    for run in json.loads(source.read_text())['runs']:
        pipeline = run['pipeline']
        jobs = {}
        for job in run['jobs']:
            if job['name'] not in jobs or job['id'] > jobs[job['name']]['id']:
                jobs[job['name']] = job
        ended = [j for j in jobs.values() if j.get('finished_at')]
        if not ended or not pipeline.get('finished_at'):
            continue
        assert set(jobs) == set(needs), 'Unexpected job graph; inspect source before deriving a path'
        current = max(ended, key=lambda j: stamp(j['finished_at']))
        path = []
        visited = set()
        while current:
            assert current['name'] not in visited
            visited.add(current['name'])
            parents = [jobs[n] for n in needs[current['name']] if n in jobs and jobs[n].get('finished_at')]
            parent = max(parents, key=lambda j: stamp(j['finished_at'])) if parents else None
            ready = stamp(parent['finished_at']) if parent else stamp(pipeline['created_at'])
            started = stamp(current['started_at'])
            path.append({'job': current['name'], 'id': current['id'], 'secondsUntilStartAfterPrerequisites': max(0, started-ready), 'executionSeconds': stamp(current['finished_at'])-started})
            current = parent
        report['runs'].append({'variant': run['variant'], 'pipelineId': pipeline['id'],
                              'wallSeconds': stamp(pipeline['finished_at'])-stamp(pipeline['created_at']),
                              'completionPath': list(reversed(path))})
(DATA / 'ci-pipeline-summary.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
