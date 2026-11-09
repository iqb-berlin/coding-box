#!/usr/bin/env python3
"""Import a downloaded comparison archive only after checking its exact source."""
from pathlib import Path, PurePosixPath
import argparse
import json
import stat
import zipfile

DATA = Path(__file__).resolve().parents[2] / 'tmp/docker-build-benchmark'
parser = argparse.ArgumentParser()
parser.add_argument('variant', choices=['before', 'after'])
parser.add_argument('archive', type=Path)
args = parser.parse_args()
expected = json.loads((DATA / 'experiment.json').read_text())[args.variant]
prefix = 'dist/docker-build-benchmark/'
entries = []
with zipfile.ZipFile(args.archive) as archive:
    assert sum(i.file_size for i in archive.infolist()) <= 200 * 1024**2
    assert len(archive.namelist()) == len(set(archive.namelist()))
    assert archive.testzip() is None, 'Corrupt archive'
    assert archive.read(prefix + 'commit-sha.txt').decode().strip() == expected['sha'], 'Wrong commit'
    assert expected.get('pipelineId')
    assert archive.read(prefix + 'pipeline-url.txt').decode().strip() == (
        f'https://scm.cms.hu-berlin.de/iqb/coding-box/-/pipelines/{expected["pipelineId"]}'), 'Wrong pipeline'
    for item in archive.infolist():
        path = PurePosixPath(item.filename)
        assert not path.is_absolute() and '..' not in path.parts and '\\' not in item.filename
        assert not stat.S_ISLNK(item.external_attr >> 16)
        if item.is_dir():
            continue
        assert item.filename.startswith((prefix, 'dist/backend-container-proof/')) or item.filename == 'container-startup.log'
        target = (DATA / args.variant).joinpath(*path.parts)
        content = archive.read(item)
        assert not target.exists() or target.read_bytes() == content, 'Conflicting previous evidence'
        entries.append((target, content))
for target, content in entries:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
print(json.dumps({'variant': args.variant, 'sha': expected['sha'], 'pipelineId': expected['pipelineId'], 'files': len(entries)}))
