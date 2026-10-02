const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const repo = process.argv[2];
require('ts-node').register({ project: path.join(repo, 'apps/backend/tsconfig.spec.json'), transpileOnly: true });
const AdmZip = require('adm-zip');
const { ResourcePackageService } = require('./resource-package.service');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'package-extraction-regression-'));
process.on('uncaughtException', error => {
  console.error(error.message);
  fs.rmSync(directory, { recursive: true, force: true });
  process.exit(2);
});
const zip = new AdmZip();
zip.addFile('a.txt', Buffer.from('first'));
zip.addFile('b.txt', Buffer.from('second'));
for (const entry of zip.getEntries()) entry.header.method = 0;
const buffer = zip.toBuffer();
let offset = 0;
while ((offset = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset)) >= 0) {
  const length = buffer.readUInt16LE(offset + 28);
  if (buffer.subarray(offset + 46, offset + 46 + length).toString() === 'b.txt') {
    buffer.writeUInt32LE(123, offset + 16);
    buffer.writeUInt32LE(123, buffer.readUInt32LE(offset + 42) + 14);
    break;
  }
  offset += 4;
}
const malformedZip = new AdmZip(buffer);
const fixtureEntries = ['a.txt', 'b.txt'].map(entryName => {
  const entry = malformedZip.getEntry(entryName);
  if (!entry) throw new Error(`Missing fixture entry: ${entryName}`);
  return { entry, entryName };
});
const service = new ResourcePackageService({}, {}, {});
service.resourcePackagesPath = directory;
service.extractAndStorePackage('Broken', { buffer }, fixtureEntries, null)
  .then(() => { console.error('Malformed ZIP was accepted'); process.exitCode = 1; })
  .catch(error => {
    if (!/CRC/.test(error.message)) {
      console.error(error.message);
      process.exitCode = 1;
    }
    const leftovers = fs.readdirSync(directory);
    console.log(JSON.stringify({ rejected: true, leftovers }));
    if (leftovers.length) process.exitCode = 1;
  })
  .finally(() => fs.rmSync(directory, { recursive: true, force: true }));
