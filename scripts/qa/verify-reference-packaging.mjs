import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const markers = [
  'study-P001-U1', 'missing-14-recode', 'empty-derived-mc-reason-empty',
  'PC_RECHNEN', 'P001;SYN001;WS;B1;', 'eatpreptba-shaped-reference.csv',
  'scripts/reference/variable-analysis-eatpreptba'
].map(value => Buffer.from(value));
const digest = content => createHash('sha256').update(content).digest('hex');

function filesAt(root) {
  const stat = lstatSync(root);
  assert.ok(!stat.isSymbolicLink(), `Unexpected symlink in production input: ${root}`);
  return stat.isDirectory() ? readdirSync(root).flatMap(name => filesAt(join(root, name))) : [root];
}

export function referenceFingerprints(root = workspace) {
  return new Set(filesAt(join(root, 'scripts/reference')).map(file => digest(readFileSync(file))));
}

export function assertNoReferenceData(directory, fingerprints) {
  let count = 0;
  for (const file of filesAt(directory)) {
    const name = relative(directory, file).replaceAll('\\', '/');
    assert.ok(!/(?:^|\/)(?:__fixtures__|golden-datasets|test-data|reference)(?:\/|$)|\.spec\.[jt]s$/.test(name),
      `Test-only path in production artifact: ${file}`);
    const content = readFileSync(file);
    assert.ok(!fingerprints.has(digest(content)), `Reference file copied into production artifact: ${file}`);
    const marker = markers.find(value => content.includes(value));
    assert.ok(!marker, `Reference data embedded in production artifact: ${file} (${marker?.toString()})`);
    count += 1;
  }
  assert.ok(count > 0, `Production artifact is empty: ${directory}`);
  return count;
}

// Follow only stages inherited by prod. The full builder contains test inputs
// intentionally; COPY --from transfers the declared files, not builder layers.
export function assertProductionCopyPolicy(root = workspace) {
  const policy = {
    backend: {
      base: /^(?:\$\{REGISTRY_PATH\})?node:/,
      copies: new Set([
        'base:/usr/src/coding-box-base/package.json',
        'base:/usr/src/coding-box-base/package-lock.json',
        'base:/usr/src/coding-box-base/vendor',
        'base:/usr/src/coding-box-base/dist/apps/${PROJECT}',
        'build:/usr/src/coding-box-${PROJECT}/package.json',
        'build:/usr/src/coding-box-${PROJECT}/package-lock.json'
      ])
    },
    frontend: {
      base: /^(?:\$\{REGISTRY_PATH\})?nginxinc\/nginx-unprivileged:/,
      copies: new Set([
        'base:/usr/src/coding-box-base/dist/apps/${PROJECT}',
        'context:config/frontend/default.conf.http-template',
        'context:config/frontend/50x.html',
        'context:config/frontend/iqb-logo-red.svg'
      ])
    }
  };
  for (const [project, allowed] of Object.entries(policy)) {
    const stages = new Map();
    let stage;
    const source = readFileSync(join(root, `apps/${project}/Dockerfile`), 'utf8');
    for (const line of source.replace(/\\\r?\n/g, ' ').split(/\r?\n/)) {
      const instruction = line.trim();
      if (!instruction || instruction.startsWith('#')) continue;
      const from = instruction.match(/^FROM\s+(\S+)\s+AS\s+(\S+)$/i);
      if (from) {
        stage = { parent: from[1], copies: [] };
        stages.set(from[2], stage);
      } else if (/^(?:COPY|ADD)\s/i.test(instruction) && stage) {
        assert.ok(!instruction.startsWith('ADD '), `Review ADD in ${project} production ancestry`);
        const fromStage = instruction.match(/--from=(\S+)/)?.[1] ?? 'context';
        const argumentsText = instruction.replace(/^COPY\s+/i, '').replace(/--\S+\s+/g, '').trim();
        const args = argumentsText.startsWith('[') ? JSON.parse(argumentsText) : argumentsText.split(/\s+/);
        stage.copies.push(...args.slice(0, -1).map(path => `${fromStage}:${path}`));
      }
    }
    let current = 'prod';
    const visited = new Set();
    while (stages.has(current)) {
      assert.ok(!visited.has(current), `Cyclic Docker stage ancestry: ${project}`);
      visited.add(current);
      const item = stages.get(current);
      for (const copy of item.copies) assert.ok(allowed.copies.has(copy), `Unexpected ${project} production COPY: ${copy}`);
      current = item.parent;
    }
    assert.ok(visited.has('prod'), `Missing prod stage: ${project}`);
    assert.match(current, allowed.base, `${project} production must start from a runtime image, not the builder`);
  }
}

export function verifyReferencePackaging(root = workspace, checkPolicy = false, allowMissingBackend = false) {
  if (checkPolicy) assertProductionCopyPolicy(root);
  const fingerprints = referenceFingerprints(root);
  const projects = ['backend', 'frontend'].filter(project => (
    project !== 'backend' || !allowMissingBackend || existsSync(join(root, 'dist/apps/backend'))
  ));
  const runtimeInputs = ['vendor', 'package.json', 'package-lock.json'].reduce((count, source) => (
    count + assertNoReferenceData(join(root, source), fingerprints)
  ), 0);
  return { runtimeInputs, ...Object.fromEntries(projects.map(project => [project,
    assertNoReferenceData(join(root, `dist/apps/${project}`), fingerprints)
  ])) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify({ referenceDataExcluded: true, filesChecked: verifyReferencePackaging(
    workspace, process.argv.includes('--policy'), process.argv.includes('--available')
  ) }));
}
