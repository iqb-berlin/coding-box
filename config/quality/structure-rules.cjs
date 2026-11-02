const path = require('node:path');
const { builtinRules } = require('eslint/use-at-your-own-risk');
const { scopeIdentities } = require('./structure-identities.cjs');

const workspace = path.resolve(__dirname, '../..');
const defaults = {
  complexity: 20,
  'max-depth': 4,
  'max-lines-per-function': 100,
  'max-lines': 800
};
const options = {
  complexity: 20,
  'max-depth': 4,
  'max-lines-per-function': { max: 100, skipBlankLines: true, skipComments: true, IIFEs: true },
  'max-lines': { max: 800, skipBlankLines: true, skipComments: true }
};
const measurements = {
  complexity: ['complexity', 'max'],
  'max-depth': ['depth', 'maxDepth'],
  'max-lines-per-function': ['lineCount', 'maxLines'],
  'max-lines': ['actual', 'max']
};

function createRule(name, baseline, observe) {
  const native = builtinRules.get(name);
  const [metricField, limitField] = measurements[name];
  return {
    meta: {
      ...native.meta,
      messages: {
        ...native.meta.messages,
        outdatedBudget: 'Structure budget for {{scope}} is outdated ({{budget}}; now {{actual}}). Run this project\'s prune-structure-baseline target.'
      }
    },
    create(context) {
      const file = path.relative(workspace, path.resolve(workspace, context.filename)).split(path.sep).join('/');
      const entry = baseline.files?.[file];
      const fileRule = name === 'max-lines';
      const budgets = fileRule ? (entry?.file?.[name] ? { '<file>': entry.file[name] } : {}) :
        Object.fromEntries(Object.entries(entry?.functions || {}).filter(([, limits]) => limits[name])
          .map(([scope, limits]) => [scope, limits[name]]));
      const identify = scopeIdentities(context.sourceCode);
      const observed = new Map();
      const report = descriptor => {
        const scope = fileRule ? '<file>' : identify(descriptor.node);
        const actual = Number(descriptor.data[metricField]);
        observed.set(scope, Math.max(observed.get(scope) || 0, actual));
        observe?.({ file, scope, rule: name, actual });
        const limit = budgets[scope] ?? defaults[name];
        if (actual <= limit) return;
        context.report({ ...descriptor, data: { ...descriptor.data, [limitField]: limit } });
      };
      const nativeContext = Object.create(context, { report: { value: report } });
      const listeners = native.create(nativeContext);
      return {
        ...listeners,
        'Program:exit'(node) {
          listeners['Program:exit']?.(node);
          for (const [scope, budget] of Object.entries(budgets)) {
            const actual = observed.get(scope) ?? defaults[name];
            if (actual < budget) context.report({
              node, messageId: 'outdatedBudget', data: { scope, budget, actual }
            });
          }
        }
      };
    }
  };
}

function createPlugin(baseline = { schemaVersion: 2, files: {} }, observe) {
  return {
    meta: { name: 'coding-box-structure', version: '1.0.0' },
    rules: Object.fromEntries(Object.keys(defaults).map(name => [name, createRule(name, baseline, observe)]))
  };
}

module.exports = { createPlugin, defaults, options, workspace };
