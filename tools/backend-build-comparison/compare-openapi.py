#!/usr/bin/env python3
"""Compare real OpenAPI documents, ignoring only parameter display order."""
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'tmp/backend-build-comparison'

def normalize(document):
    result = copy.deepcopy(document)
    for path in result['paths'].values():
        for operation in path.values():
            if isinstance(operation, dict) and isinstance(operation.get('parameters'), list):
                operation['parameters'].sort(key=lambda parameter: (parameter.get('in', ''), parameter.get('name', '')))
    return result

def differences(left, right, route=''):
    if type(left) is not type(right):
        return [{'path': route, 'webpack': left, 'candidate': right}]
    if isinstance(left, dict):
        result = []
        for key in sorted(set(left) | set(right)):
            pointer = route + '/' + key.replace('~', '~0').replace('/', '~1')
            if key not in left or key not in right:
                result.append({'path': pointer, 'webpack': left.get(key), 'candidate': right.get(key)})
            else:
                result.extend(differences(left[key], right[key], pointer))
        return result
    if isinstance(left, list):
        if len(left) != len(right):
            return [{'path': route, 'webpack': left, 'candidate': right}]
        return [difference for index, (a, b) in enumerate(zip(left, right))
                for difference in differences(a, b, route + '/' + str(index))]
    return [] if left == right else [{'path': route, 'webpack': left, 'candidate': right}]

documents = {}
for variant in ['webpack', 'rspack', 'tsc']:
    # Browser runs follow the final clean build and therefore bind the final DTO
    # annotation. API-only documents remain in the evidence as earlier probes.
    file = DATA / f'browser-{variant}/openapi.json'
    if not file.exists():
        file = DATA / f'codebook-{variant}/openapi.json'
    documents[variant] = normalize(json.loads(file.read_text()))
report = {'normalization': 'Sort operation parameters by location and name only.', 'variants': {}}
for variant in ['rspack', 'tsc']:
    changes = differences(documents['webpack'], documents[variant])
    report['variants'][variant] = {'equal': not changes, 'differences': changes}
(DATA / 'openapi-equivalence.json').write_text(json.dumps(report, indent=2))
print(json.dumps({variant: len(result['differences']) for variant, result in report['variants'].items()}))
