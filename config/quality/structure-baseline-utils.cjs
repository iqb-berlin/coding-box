const fs = require('node:fs');
const path = require('node:path');
const { Linter } = require('eslint');
const parser = require('@typescript-eslint/parser');
const { createPlugin, defaults, options, workspace } = require('./structure-rules.cjs');

function measureSource(source, file) {
  const entry = { file: {}, functions: {} };
  const plugin = createPlugin(undefined, ({ scope, rule, actual }) => {
    const limits = scope === '<file>' ? entry.file : (entry.functions[scope] ??= {});
    limits[rule] = Math.max(limits[rule] || 0, actual);
  });
  const messages = new Linter().verify(source, [{
    files: ['**/*.ts'],
    languageOptions: { parser, ecmaVersion: 2022, sourceType: 'module' },
    plugins: { structure: plugin },
    rules: Object.fromEntries(Object.entries(options).map(([name, option]) => [`structure/${name}`, ['error', option]]))
  }], { filename: path.resolve(workspace, file), allowInlineConfig: false });
  if (messages.some(message => message.fatal)) {
    throw new Error(`${file}: ${messages.map(message => message.message).join('\n')}`);
  }
  return entry;
}

function sourceFiles(project) {
  if (!['backend', 'frontend'].includes(project)) throw new Error('Choose backend or frontend.');
  const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
  return walk(path.join(workspace, 'apps', project, 'src')).filter(file => file.endsWith('.ts') &&
    !/\.(spec|test|mock|d)\.ts$/.test(file) && !/test\.factory\.ts$/.test(file))
    .map(file => path.relative(workspace, file).split(path.sep).join('/')).sort();
}

/** Only removes or lowers existing entries; cannot grant an exception to new code. */
function tightenBaseline(baseline, measured, project) {
  if (!['backend', 'frontend'].includes(project)) throw new Error('Choose backend or frontend.');
  const next = structuredClone(baseline);
  for (const [file, entry] of Object.entries(next.files)) {
    if (!file.startsWith(`apps/${project}/src/`)) continue;
    const current = measured[file];
    if (!current) {
      delete next.files[file];
      continue;
    }
    const tighten = (limits, actual = {}) => {
      for (const [rule, limit] of Object.entries(limits)) {
        if (!actual[rule] || actual[rule] <= defaults[rule]) delete limits[rule];
        else limits[rule] = Math.min(limit, actual[rule]);
      }
    };
    tighten(entry.file, current.file);
    for (const [scope, limits] of Object.entries(entry.functions)) {
      tighten(limits, current.functions[scope]);
      if (!Object.keys(limits).length) delete entry.functions[scope];
    }
    if (!Object.keys(entry.file).length && !Object.keys(entry.functions).length) delete next.files[file];
  }
  return next;
}

function serializeBaseline(baseline) {
  const sorted = value => value && typeof value === 'object' ?
    Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sorted(entry)])) : value;
  return `${JSON.stringify({ schemaVersion: 2, files: sorted(baseline.files) }, null, 2)}\n`;
}

module.exports = { measureSource, sourceFiles, tightenBaseline, serializeBaseline };
