import { all, create } from 'mathjs';

// A private instance of the original solver's mathjs 12.4.3. Do not configure
// the shared mathjs instance or change the math used by the Responses peer.
const solverMath = create(all, { epsilon: 1e-12 });
// The old default mathjs entry exposed a read-only config function. Preserve
// that contract inside the private instance, including nested evaluate/parser
// calls. Keep the function's option properties used by mathjs factories.
const originalConfig = solverMath.config;
const configuration = Object.freeze(originalConfig({}));
const readOnlyConfig = Object.assign((options?: unknown) => {
  if (options) throw new Error('The solver configuration is read-only.');
  return configuration;
}, originalConfig);
solverMath.import({ config: readOnlyConfig }, { override: true });

export function evaluate(expression: string): unknown {
  const value: unknown = solverMath.evaluate(expression);
  // Responses 5.2.0 rejected non-numeric solver results, including null. Throw
  // inside evaluation so 5.3.1's existing error path retains DERIVE_ERROR before
  // code matching or dependent derivations can turn it into a completed result.
  if (value === null) {
    throw new Error('SOLVER must produce a finite number.');
  }
  return value;
}
