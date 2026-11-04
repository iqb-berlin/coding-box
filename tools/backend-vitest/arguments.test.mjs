import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArguments } from './arguments.mjs';

test('existing Nx callers select coverage and limit workers without starting Jest', () => {
  const options = parseArguments(['--configuration=ci', '--maxWorkers=2', '--passWithNoTests=false']);
  assert.equal(options.coverage, true);
  assert.equal(options.workers, 2);
  assert.equal(options.scope, 'all');
  assert.equal(parseArguments(['--codeCoverage']).coverage, true);
  assert.equal(parseArguments(['--runInBand', '--codeCoverage=false']).workers, 1);
});

test('CI cannot silently reduce its suite, typecheck, or coverage', () => {
  for (const flag of ['--scope=pilot', '--filter=one', '--tests-only', '--typecheck-only', '--codeCoverage=false', '--coverage=false']) {
    for (const args of [['--configuration=ci', flag], [flag, '--configuration=ci']]) assert.throws(() => parseArguments(args), /CI requires/);
  }
});

test('unsupported options, invalid worker limits and weakened integration selection fail', () => {
  for (const flag of ['--maxWorkers=0', '--maxWorkers=1.5', '--maxWorkers=oops', '--passWithNoTests=true', '--unknown', '--scope=oops']) {
    assert.throws(() => parseArguments([flag]));
  }
  assert.throws(() => parseArguments(['--scope=integration', '--filter=one']), /cannot be filtered/);
  assert.throws(() => parseArguments(['--scope=integration', '--coverage']), /unit coverage/);
  assert.throws(() => parseArguments(['--tests-only', '--typecheck-only']), /Choose either/);
});
