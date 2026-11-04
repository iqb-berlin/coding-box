import { testPathRegex } from './selection.mjs';

/** Keep established Nx/npm callers while rejecting flags that could weaken CI. */
export function parseArguments(args) {
  const options = { scope: 'all', coverage: false, testsOnly: false, typecheckOnly: false, testPathPatterns: [] };
  for (const argument of args) {
    if (argument.startsWith('--scope=')) options.scope = argument.slice(8);
    else if (argument === '--configuration=ci') options.ci = options.coverage = true;
    else if (['--coverage', '--codeCoverage', '--codeCoverage=true'].includes(argument)) options.coverage = true;
    else if (['--coverage=false', '--codeCoverage=false'].includes(argument)) options.noCoverage = true;
    else if (argument === '--tests-only') options.testsOnly = true;
    else if (argument === '--typecheck-only') options.typecheckOnly = true;
    else if (argument.startsWith('--filter=')) options.filter = argument.slice(9);
    else if (argument.startsWith('--testPathPatterns=')) options.testPathPatterns.push(argument.slice(19));
    else if (argument.startsWith('--maxWorkers=')) options.workers = Number(argument.slice(13));
    else if (argument === '--runInBand') options.workers = 1;
    else if (argument === '--passWithNoTests=false') continue;
    else throw new Error('Unknown backend test argument: ' + argument);
  }
  if (!['all', 'pilot', 'contracts', 'integration'].includes(options.scope)) throw new Error('Unknown scope: ' + options.scope);
  for (const pattern of options.testPathPatterns) testPathRegex(pattern);
  if (options.filter && options.testPathPatterns.length) throw new Error('Choose either --filter or --testPathPatterns.');
  if (options.testsOnly && options.typecheckOnly) throw new Error('Choose either --tests-only or --typecheck-only.');
  if (options.workers !== undefined && (!Number.isSafeInteger(options.workers) || options.workers < 1)) throw new Error('maxWorkers must be a positive integer.');
  if (options.ci && (options.scope !== 'all' || options.filter || options.testPathPatterns.length || options.testsOnly || options.typecheckOnly || options.noCoverage)) {
    throw new Error('CI requires the complete backend suite, typecheck and coverage.');
  }
  if (options.scope === 'integration' && (options.filter || options.testPathPatterns.length || options.coverage)) throw new Error('The mandatory integration selection cannot be filtered or used for unit coverage.');
  if (options.noCoverage) options.coverage = false;
  return options;
}
