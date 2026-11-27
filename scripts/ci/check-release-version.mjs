import { readFileSync } from 'node:fs';

const tag = process.argv[2] || '';
const releaseTag = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:alpha|beta|rc)(?:\.?[1-9]\d*)?)?$/;
if (!releaseTag.test(tag)) throw new Error(`Invalid release tag: ${tag}`);

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
for (const [field, version] of Object.entries({
  'package.json version': manifest.version,
  'package-lock.json version': lock.version,
  'package-lock.json root version': lock.packages?.['']?.version
})) {
  if (version !== tag) throw new Error(`${field} is ${version}, expected release version ${tag}.`);
}
console.log(`Release tag ${tag} matches all npm version fields.`);
