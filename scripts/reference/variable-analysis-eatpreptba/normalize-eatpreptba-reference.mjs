#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');
const referenceTablePath = path.join(scriptDir, 'eatpreptba-shaped-reference.csv');
const responsesPath = path.join(scriptDir, 'reference-responses.csv');
const schemaPath = path.join(scriptDir, 'reference-schema.csv');
const goldenPath = path.join(
  repoRoot,
  'apps/backend/src/app/job-queue/processors/__fixtures__/variable-analysis-eatpreptba-reference.golden.json'
);

const invalidOrMissingStatuses = new Set([0, 1, 2, 4, 7, 9, 10]);
const tolerance = 1e-9;
const referenceTableColumns = [
  'unit_key',
  'variable_id',
  'variable_source_type',
  'code_id',
  'code_type',
  'code_score',
  'code_n',
  'code_n_total',
  'code_n_valid',
  'code_p_total',
  'code_p_valid',
  'domain',
  'code_pbc',
  'category_id',
  'category_label',
  'category_n',
  'category_p_total',
  'category_p_valid',
  'category_pbc'
];
const responseColumns = [
  'unitName',
  'variableId',
  'responseId',
  'value',
  'status',
  'isMultiple'
];
const schemaColumns = ['unitName', 'variableId', 'value', 'label', 'score'];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter(currentRow => currentRow.some(value => value !== ''));
}

function readCsv(filePath, expectedColumns) {
  const [header, ...rows] = parseCsv(readFileSync(filePath, 'utf8'));
  if (!header) {
    throw new Error(`CSV file has no header: ${filePath}`);
  }

  const missingColumns = expectedColumns.filter(
    column => !header.includes(column)
  );
  const extraColumns = header.filter(column => !expectedColumns.includes(column));
  if (missingColumns.length > 0 || extraColumns.length > 0) {
    throw new Error(
      `Unexpected columns in ${filePath}. ` +
        `Missing: ${missingColumns.join(', ') || 'none'}. ` +
        `Extra: ${extraColumns.join(', ') || 'none'}.`
    );
  }

  return rows.map(row => Object.fromEntries(
    header.map((column, index) => [column, row[index] ?? ''])
  ));
}

function toNumber(value, fieldName) {
  if (value === '') {
    return null;
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected numeric ${fieldName}, got "${value}".`);
  }
  return number;
}

function toRequiredNumber(value, fieldName) {
  const number = toNumber(value, fieldName);
  if (number === null) {
    throw new Error(`Expected numeric ${fieldName}, got an empty value.`);
  }
  return number;
}

function assertClose(actual, expected, context) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      `${context}: expected ${expected}, got ${actual}.`
    );
  }
}

function assertEqual(actual, expected, context) {
  if (actual !== expected) {
    throw new Error(`${context}: expected ${expected}, got ${actual}.`);
  }
}

function percent(value, denominator) {
  return denominator > 0 ? (value / denominator) * 100 : null;
}

function key(unitName, variableId, value = '') {
  return `${unitName}\u001F${variableId}\u001F${value}`;
}

function comboKey(unitName, variableId) {
  return `${unitName}\u001F${variableId}`;
}

function parseResponseValues(response) {
  if (response.isMultiple === 'true') {
    const values = JSON.parse(response.value || '[]');
    return [...new Set(values)];
  }

  return [response.value];
}

function getSchemaByKey(schemaRows) {
  return new Map(schemaRows.map(row => [
    key(row.unitName, row.variableId, row.value),
    row
  ]));
}

function getObservedValues(responses) {
  const observedValues = new Set();
  responses.forEach(response => {
    parseResponseValues(response).forEach(value => {
      observedValues.add(key(response.unitName, response.variableId, value));
    });
  });
  return observedValues;
}

function getExpectedFrequencyStats(responses, schemaRows) {
  const stats = new Map();
  const ensureStat = (unitName, variableId, value) => {
    const statKey = key(unitName, variableId, value);
    if (!stats.has(statKey)) {
      stats.set(statKey, {
        unitName,
        variableId,
        value,
        count: 0,
        validOccurrenceCount: 0
      });
    }
    return stats.get(statKey);
  };

  schemaRows.forEach(row => {
    ensureStat(row.unitName, row.variableId, row.value);
  });

  responses.forEach(response => {
    const isValid = !invalidOrMissingStatuses.has(Number(response.status));
    parseResponseValues(response).forEach(value => {
      const stat = ensureStat(response.unitName, response.variableId, value);
      stat.count += 1;
      if (isValid) {
        stat.validOccurrenceCount += 1;
      }
    });
  });

  return stats;
}

function getVariableCombos(responses) {
  const grouped = new Map();

  responses.forEach(response => {
    const groupKey = comboKey(response.unitName, response.variableId);
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, []);
    }
    grouped.get(groupKey).push(response);
  });

  return [...grouped.values()].map(groupRows => {
    const [{ unitName, variableId }] = groupRows;
    const totalCount = groupRows.length;
    const validCount = groupRows.filter(
      row => !invalidOrMissingStatuses.has(Number(row.status))
    ).length;
    const emptyCount = groupRows.filter(row => (
      parseResponseValues(row).length === 0 ||
      parseResponseValues(row).every(value => value === '')
    )).length;
    const distinctValues = new Set();

    groupRows.forEach(row => {
      parseResponseValues(row).forEach(value => {
        if (row.isMultiple === 'true' && value === '') {
          return;
        }
        distinctValues.add(value);
      });
    });

    return {
      unitName,
      variableId,
      totalCount,
      validCount,
      invalidCount: totalCount - validCount,
      emptyCount,
      emptyPercentage: percent(emptyCount, totalCount),
      distinctValueCount: distinctValues.size
    };
  });
}

function validateReferenceRow({
  row,
  combo,
  expectedFrequency,
  value
}) {
  const rowLabel = `${row.unit_key}/${row.variable_id}/${value || '___EMPTY___'}`;
  const codeCount = toRequiredNumber(row.code_n, `${rowLabel} code_n`);
  const codeScore = toNumber(row.code_score, `${rowLabel} code_score`);
  const codePTotal = toRequiredNumber(row.code_p_total, `${rowLabel} code_p_total`);
  const codePValid = toNumber(row.code_p_valid, `${rowLabel} code_p_valid`);
  const categoryCount = toRequiredNumber(row.category_n, `${rowLabel} category_n`);
  const categoryPTotal = toRequiredNumber(
    row.category_p_total,
    `${rowLabel} category_p_total`
  );
  const categoryPValid = toRequiredNumber(
    row.category_p_valid,
    `${rowLabel} category_p_valid`
  );

  assertEqual(categoryCount, expectedFrequency.count, `${rowLabel} category_n`);
  assertClose(
    codePTotal,
    combo.totalCount > 0 ? codeCount / combo.totalCount : 0,
    `${rowLabel} code_p_total`
  );
  if (codeScore === null && codePValid !== null) {
    throw new Error(`${rowLabel} code_p_valid must be empty for missing codes.`);
  }
  if (codeScore !== null) {
    if (codePValid === null) {
      throw new Error(`${rowLabel} code_p_valid must be present for valid codes.`);
    }
    assertClose(
      codePValid,
      combo.validCount > 0 ? codeCount / combo.validCount : 0,
      `${rowLabel} code_p_valid`
    );
  }
  assertEqual(
    toRequiredNumber(row.code_n_total, `${rowLabel} code_n_total`),
    combo.totalCount,
    `${rowLabel} code_n_total`
  );
  assertEqual(
    toRequiredNumber(row.code_n_valid, `${rowLabel} code_n_valid`),
    combo.validCount,
    `${rowLabel} code_n_valid`
  );
  assertClose(
    categoryPTotal,
    combo.totalCount > 0 ? expectedFrequency.count / combo.totalCount : 0,
    `${rowLabel} category_p_total`
  );
  assertClose(
    categoryPValid,
    combo.validCount > 0 ?
      expectedFrequency.validOccurrenceCount / combo.validCount :
      0,
    `${rowLabel} category_p_valid`
  );

  return { categoryCount, categoryPTotal, categoryPValid };
}

function getFrequencies(referenceRows, schemaRows, responses) {
  const schemaByKey = getSchemaByKey(schemaRows);
  const observedValues = getObservedValues(responses);
  const expectedFrequencies = getExpectedFrequencyStats(responses, schemaRows);
  const combosByKey = new Map(
    getVariableCombos(responses).map(combo => [
      comboKey(combo.unitName, combo.variableId),
      combo
    ])
  );
  const seenKeys = new Set();

  const frequencies = referenceRows
    .map(row => {
      if (row.category_id === '') {
        throw new Error(
          `Reference row for ${row.unit_key}/${row.variable_id} has no category_id.`
        );
      }

      const unitName = row.unit_key;
      const variableId = row.variable_id;
      const value = row.category_id === '___EMPTY___' ? '' : row.category_id;
      const frequencyKey = key(unitName, variableId, value);
      const schema = schemaByKey.get(key(unitName, variableId, value));
      const combo = combosByKey.get(comboKey(unitName, variableId));
      const expectedFrequency = expectedFrequencies.get(frequencyKey);

      if (!combo) {
        throw new Error(`No input combo found for ${unitName}/${variableId}.`);
      }
      if (!expectedFrequency) {
        throw new Error(
          `Reference row has no documented response/schema source: ${unitName}/${variableId}/${value}.`
        );
      }
      if (seenKeys.has(frequencyKey)) {
        throw new Error(
          `Duplicate reference row: ${unitName}/${variableId}/${value}.`
        );
      }
      seenKeys.add(frequencyKey);

      const {
        categoryCount,
        categoryPTotal,
        categoryPValid
      } = validateReferenceRow({
        row,
        combo,
        expectedFrequency,
        value
      });

      const frequency = {
        unitName,
        variableId,
        value,
        count: categoryCount,
        validOccurrenceCount: expectedFrequency.validOccurrenceCount,
        percentageTotal: categoryPTotal * 100,
        percentageValid: categoryPValid * 100,
        isSchemaOnly: Boolean(schema) &&
          categoryCount === 0 &&
          !observedValues.has(key(unitName, variableId, value))
      };

      if (schema?.label) {
        frequency.label = schema.label;
      }

      const schemaScore = schema ? toNumber(schema.score, 'score') : null;
      if (schemaScore !== null) {
        frequency.score = schemaScore;
      }

      return frequency;
    });

  const missingReferenceRows = [...expectedFrequencies.keys()]
    .filter(expectedKey => !seenKeys.has(expectedKey));
  if (missingReferenceRows.length > 0) {
    throw new Error(
      `Reference table is missing rows: ${missingReferenceRows.join(', ')}.`
    );
  }

  return frequencies;
}

const responses = readCsv(responsesPath, responseColumns);
const schema = readCsv(schemaPath, schemaColumns);
const referenceRows = readCsv(referenceTablePath, referenceTableColumns);

const golden = {
  source: 'Normalized from checked-in manual eatPrepTBA-shaped reference table for GitHub issue #563',
  referenceUrl: 'https://github.com/franikowsp/eatPrepTBA/blob/16e3567adefb7341a3e93fd3d97aa25a207d0c99/R/evaluate_psychometrics.R',
  referenceCommit: '16e3567adefb7341a3e93fd3d97aa25a207d0c99',
  referenceTable: 'scripts/reference/variable-analysis-eatpreptba/eatpreptba-shaped-reference.csv',
  referenceInputs: [
    'scripts/reference/variable-analysis-eatpreptba/reference-responses.csv',
    'scripts/reference/variable-analysis-eatpreptba/reference-schema.csv'
  ],
  generator: 'scripts/reference/variable-analysis-eatpreptba/normalize-eatpreptba-reference.mjs',
  tolerance,
  notes: [
    'The reference table is manually normalized in the eatPrepTBA evaluate_psychometrics column format. It is not an unchanged external eatPrepTBA export.',
    'Percentages are stored as percent values in Kodierbox. eatPrepTBA emits proportions in category_p_total and category_p_valid.',
    'Point-biserial discrimination columns are intentionally outside this fixture because the current Kodierbox variable analysis does not calculate domain scores.'
  ],
  variableCombos: getVariableCombos(responses),
  frequencies: getFrequencies(referenceRows, schema, responses)
};

const serializedGolden = `${JSON.stringify(golden, null, 2)}\n`;
const [command] = process.argv.slice(2);

if (command && command !== '--check') {
  throw new Error(
    'Unknown argument. Usage: node normalize-eatpreptba-reference.mjs [--check]'
  );
}

if (command === '--check') {
  const currentGolden = readFileSync(goldenPath, 'utf8');
  if (currentGolden !== serializedGolden) {
    throw new Error(
      'Golden fixture is out of sync with the reference table. ' +
        'Run: node scripts/reference/variable-analysis-eatpreptba/normalize-eatpreptba-reference.mjs'
    );
  }
  console.log('Golden fixture matches normalized reference table.');
} else {
  writeFileSync(goldenPath, serializedGolden);
  console.log(`Wrote ${path.relative(repoRoot, goldenPath)}`);
}
