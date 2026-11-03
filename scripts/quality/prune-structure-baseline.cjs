const fs = require('node:fs');
const path = require('node:path');
const { workspace } = require('../../config/quality/structure-rules.cjs');
const { measureSource, sourceFiles, tightenBaseline, serializeBaseline } = require('../../config/quality/structure-baseline-utils.cjs');

const project = process.argv[2];
const files = sourceFiles(project);
const baselineFile = path.join(workspace, 'config/quality/structure-baseline.json');
const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
const measured = Object.fromEntries(files.map(file => [file, measureSource(fs.readFileSync(path.join(workspace, file), 'utf8'), file)]));
const next = tightenBaseline(baseline, measured, project);
fs.writeFileSync(baselineFile, serializeBaseline(next));
console.log(`Tightened ${project} structure budgets; no exceptions added or increased.`);
