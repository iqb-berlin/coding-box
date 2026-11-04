import { globSync } from 'node:fs';
import path from 'node:path';

export function testPathRegex(pattern) {
  try { return new RegExp(pattern.replace(/^\.\//, '^'), 'i'); }
  catch (error) { throw new Error(`Invalid --testPathPatterns regular expression: ${error.message}`); }
}

/** Match Jest-style regular expressions against project-relative or absolute test paths within the chosen scope. */
export function selectTestPaths(include, patterns, root) {
  const expressions = patterns.map(testPathRegex);
  const backendRoot = path.resolve(root, 'apps/backend').split(path.sep).join('/');
  return [...globSync(include, { cwd: root })].filter(file => {
    const filename = path.resolve(root, file).split(path.sep).join('/');
    const projectRoot = filename.startsWith(backendRoot + '/') ? backendRoot : root;
    const relative = path.relative(projectRoot, filename).split(path.sep).join('/');
    return expressions.some(expression => expression.test(relative) || expression.test(filename));
  }).sort();
}
