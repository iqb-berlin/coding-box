import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { BindingPipe, LiteralMap, LiteralPrimitive, parseTemplate } from '@angular/compiler';

// Existing catalog namespaces remain compatible. New UI messages use contextual IDs.
const managedPrefix = 'ui-text.';
const keyReferences = /\bui-text\.[a-zA-Z0-9_.-]+/g;
const placeholders = text => [...new Set([...text.matchAll(/{{\s*([\w.]+)\s*}}/g)]
  .map(match => match[1]))].sort();
const lineAt = (source, offset) => source.slice(0, offset).split('\n').length;

export function parseCatalog(source, file) {
  const catalog = JSON.parse(source);
  // JSON.parse silently keeps the last property; report duplicates before they disappear.
  const sf = ts.parseJsonText(file, source);
  const visit = node => {
    if (ts.isObjectLiteralExpression(node)) {
      const names = new Set();
      for (const property of node.properties) {
        const name = property.name?.text;
        if (names.has(name)) throw new Error(`${file}: duplicate JSON property: ${name}`);
        names.add(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return catalog;
}

export function flattenCatalog(catalog) {
  const messages = new Map();
  const visit = (value, prefix) => {
    if (typeof value === 'string') {
      if (messages.has(prefix)) throw new Error(`Duplicate translation ID: ${prefix}`);
      messages.set(prefix, value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) visit(child, prefix ? `${prefix}.${key}` : key);
    } else {
      throw new Error(`Translation must be a string or an object: ${prefix}`);
    }
  };
  visit(catalog, '');
  return messages;
}

export function validateCatalogs(catalogs, sourceLanguage = 'de') {
  const issues = [];
  const source = flattenCatalog(catalogs[sourceLanguage]);
  const checkPropertyNames = value => {
    if (!value || typeof value !== 'object') return;
    for (const [name, child] of Object.entries(value)) {
      if (name.includes('.')) issues.push(`${sourceLanguage}: use nested objects in ui-text: ${name}`);
      checkPropertyNames(child);
    }
  };
  checkPropertyNames(catalogs[sourceLanguage]['ui-text']);
  for (const key of source.keys()) {
    if (!key.startsWith(managedPrefix)) continue;
    if (key.split('.').some(part => !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(part) || part.length > 48) ||
      /-[0-9a-f]{6}$/.test(key)) {
      issues.push(`${sourceLanguage}: use short contextual translation IDs: ${key}`);
    }
  }
  for (const [language, catalog] of Object.entries(catalogs)) {
    const messages = flattenCatalog(catalog);
    for (const [key, text] of messages) {
      if (/\|\s*translate|\bui-text\./.test(text)) issues.push(`${language}: embedded translation expression: ${key}`);
      if (!source.has(key)) issues.push(`${language}: unknown translation ID: ${key}`);
      else if (JSON.stringify(placeholders(text)) !== JSON.stringify(placeholders(source.get(key)))) {
        issues.push(`${language}: placeholders differ from ${sourceLanguage}: ${key}`);
      }
    }
    for (const key of source.keys()) {
      if (!messages.has(key)) issues.push(`${language}: missing translation: ${key}`);
    }
  }
  return issues;
}

/** Checks literal managed IDs, including constants, and statically known parameter maps. */
export function validateTranslationSource(source, file, catalog) {
  const issues = [];
  const messages = flattenCatalog(catalog);
  const checkParameters = (key, parameters, line) => {
    if (!key.startsWith(managedPrefix) || !messages.has(key) || parameters === undefined) return;
    for (const placeholder of placeholders(messages.get(key))) {
      // ngx-translate accepts nested properties such as {{person.name}}.
      if (!parameters.has(placeholder) && !parameters.has(placeholder.split('.')[0])) {
        issues.push(`${file}:${line}: missing parameter '${placeholder}' for ${key}`);
      }
    }
  };
  const checkReferences = (text, lineOffset = 0) => {
    for (const match of text.matchAll(keyReferences)) {
      if (!messages.has(match[0])) issues.push(`${file}:${lineAt(text, match.index) + lineOffset}: unknown translation ID: ${match[0]}`);
    }
  };
  const checkTemplate = (text, lineOffset = 0) => {
    checkReferences(text, lineOffset);
    const parsed = parseTemplate(text, file);
    if (parsed.errors?.length) {
      issues.push(...parsed.errors.map(error => error.toString()));
      return;
    }
    const seen = new Set();
    const visit = node => {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      if (node instanceof BindingPipe && node.name === 'translate' &&
        node.exp instanceof LiteralPrimitive && typeof node.exp.value === 'string') {
        const argument = node.args[0];
        const parameters = !argument ? new Set() : argument instanceof LiteralMap &&
          argument.keys.every(key => key.kind !== 'spread') ? new Set(argument.keys.map(key => key.key)) : undefined;
        checkParameters(node.exp.value, parameters, lineAt(text, node.sourceSpan.start) + lineOffset);
      }
      for (const [name, child] of Object.entries(node)) {
        if (/span|source|file|tokens/i.test(name)) continue;
        if (Array.isArray(child)) child.forEach(visit); else visit(child);
      }
    };
    parsed.nodes.forEach(visit);
  };
  if (file.endsWith('.html')) {
    checkTemplate(source);
  } else {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const isLiteral = node => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
    const visit = node => {
      if (ts.isPropertyAssignment(node) && node.name.getText(sf) === 'template' && isLiteral(node.initializer)) {
        checkTemplate(node.initializer.text, sf.getLineAndCharacterOfPosition(node.initializer.getStart(sf)).line);
      } else if (isLiteral(node)) {
        // Skip inline templates here: the Angular parser checks them separately.
        checkReferences(node.text, sf.getLineAndCharacterOfPosition(node.getStart(sf)).line);
      }
      if (ts.isCallExpression(node) && isLiteral(node.arguments[0]) &&
        /(?:\btranslate|\buiTranslate|\btranslateGerman|\.instant|\.get|\.stream)$/.test(node.expression.getText(sf))) {
        const argument = node.arguments[1];
        const parameters = !argument ? new Set() : ts.isObjectLiteralExpression(argument) &&
          !argument.properties.some(property => ts.isSpreadAssignment(property)) ?
          new Set(argument.properties.map(property => property.name?.getText(sf).replace(/^['"]|['"]$/g, ''))) : undefined;
        checkParameters(node.arguments[0].text, parameters, sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
      }
      // The template initializer is visited through checkTemplate, not as a TS string.
      ts.forEachChild(node, child => {
        if (!(ts.isPropertyAssignment(node) && node.name.getText(sf) === 'template' && child === node.initializer)) visit(child);
      });
    };
    visit(sf);
  }
  return [...new Set(issues)];
}

export function validateWorkspaceTranslations(workspace) {
  const directory = join(workspace, 'apps/frontend/src/assets/i18n');
  const catalogs = Object.fromEntries(readdirSync(directory).filter(file => file.endsWith('.json'))
    .map(file => [file.slice(0, -5), parseCatalog(readFileSync(join(directory, file), 'utf8'), file)]));
  const issues = validateCatalogs(catalogs);
  const visit = directoryPath => {
    for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
      const file = join(directoryPath, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(ts|html)$/.test(file) && !/\.(spec|mock)\.ts$/.test(file)) {
        issues.push(...validateTranslationSource(readFileSync(file, 'utf8'), relative(workspace, file), catalogs.de));
      }
    }
  };
  visit(join(workspace, 'apps/frontend/src/app'));
  return issues;
}
