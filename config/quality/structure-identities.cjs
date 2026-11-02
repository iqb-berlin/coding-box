const { createHash } = require('node:crypto');

const functionTypes = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const identities = new WeakMap();

function bindingName(node, source) {
  return source.getTokens(node).map(token => token.value).join(' ');
}

function anonymousName(node, source) {
  const tokens = source.getTokens(node).map(token => token.value).join('\u001f');
  return `anonymous:${createHash('sha256').update(tokens).digest('hex').slice(0, 16)}`;
}

function functionName(node, parent, source) {
  if (parent?.type === 'MethodDefinition') {
    return `${parent.static ? 'static ' : ''}${parent.kind} ${bindingName(parent.key, source)}`;
  }
  if (parent?.type === 'VariableDeclarator') return `function ${bindingName(parent.id, source)}`;
  if (['Property', 'PropertyDefinition'].includes(parent?.type)) {
    return `function ${bindingName(parent.key, source)}`;
  }
  return node.id ? `function ${node.id.name}` : anonymousName(node, source);
}

/** Stable named scopes; anonymous callbacks also identify their tokenized source. */
function scopeIdentities(source) {
  if (identities.has(source)) return identities.get(source);
  const keys = new WeakMap();
  const parents = new WeakMap();
  const occurrences = new Map();
  function visit(node, parent, owners) {
    if (parent) parents.set(node, parent);
    let label;
    let isFunction = false;
    if (functionTypes.has(node.type) && node.body) {
      label = functionName(node, parent, source);
      isFunction = true;
    } else if (['ClassDeclaration', 'ClassExpression'].includes(node.type)) {
      const name = node.id?.name || (parent?.type === 'VariableDeclarator' && bindingName(parent.id, source));
      label = `class ${name || anonymousName(node, source)}`;
    } else if (node.type === 'StaticBlock') {
      label = anonymousName(node, source);
      isFunction = true;
    } else if (node.type === 'PropertyDefinition') {
      label = `${node.static ? 'static ' : ''}field ${bindingName(node.key, source)}`;
      isFunction = true;
    } else if (node.type === 'TSModuleDeclaration') {
      label = `namespace ${bindingName(node.id, source)}`;
    } else if (node.type === 'ObjectExpression' && parent?.type === 'VariableDeclarator') {
      label = `object ${bindingName(parent.id, source)}`;
    }
    let nextOwners = owners;
    if (label) {
      const prefix = [...owners, label].join('/');
      const occurrence = (occurrences.get(prefix) || 0) + 1;
      occurrences.set(prefix, occurrence);
      const key = `${prefix}#${occurrence}`;
      if (isFunction) {
        keys.set(node, key);
        // ESLint's function-size rule reports the enclosing method/property.
        if (functionTypes.has(node.type) && ['MethodDefinition', 'Property'].includes(parent?.type)) keys.set(parent, key);
      }
      nextOwners = [...owners, `${label}#${occurrence}`];
    }
    for (const property of source.visitorKeys[node.type] || []) {
      const children = Array.isArray(node[property]) ? node[property] : [node[property]];
      for (const child of children) if (child?.type) visit(child, node, nextOwners);
    }
  }
  visit(source.ast, null, []);
  const result = node => {
    for (let scope = node; scope; scope = parents.get(scope)) {
      if (keys.has(scope)) return keys.get(scope);
    }
    return '<module>';
  };
  identities.set(source, result);
  return result;
}

module.exports = { scopeIdentities };
