import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import ExcelJS from 'exceljs';
import FormData from 'form-data';
import archiver from 'archiver';
import sqlite3 from 'sqlite3';

// Exercise the callable CommonJS exports through native ESM, using only the
// production installation. These operations are deferred past API startup.
const zip = new AdmZip();
zip.addFile('proof.txt', Buffer.from('esm-proof'));
assert.equal(new AdmZip(zip.toBuffer()).readAsText('proof.txt'), 'esm-proof');

const workbook = new ExcelJS.Workbook();
workbook.addWorksheet('proof').getCell('A1').value = 'esm-proof';
const loaded = new ExcelJS.Workbook();
await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
assert.equal(loaded.getWorksheet('proof').getCell('A1').value, 'esm-proof');

const form = new FormData();
form.append('proof', 'esm-proof');
assert.match(form.getBuffer().toString(), /esm-proof/);
assert.match(form.getHeaders()['content-type'], /^multipart\/form-data; boundary=/);

const archive = archiver('zip');
const chunks = [];
const finished = new Promise((resolve, reject) => {
  archive.on('data', chunk => chunks.push(chunk));
  archive.once('end', resolve);
  archive.once('error', reject);
});
archive.append('esm-proof', { name: 'proof.txt' });
await Promise.all([archive.finalize(), finished]);
assert.equal(new AdmZip(Buffer.concat(chunks)).readAsText('proof.txt'), 'esm-proof');

const database = await new Promise((resolve, reject) => {
  const connection = new sqlite3.Database(':memory:', error => error ? reject(error) : resolve(connection));
});
try {
  await new Promise((resolve, reject) => database.exec(
    "CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES ('esm-proof');",
    error => error ? reject(error) : resolve()
  ));
  const row = await new Promise((resolve, reject) => database.get(
    'SELECT value FROM proof', (error, value) => error ? reject(error) : resolve(value)
  ));
  assert.equal(row.value, 'esm-proof');
} finally {
  await new Promise((resolve, reject) => database.close(error => error ? reject(error) : resolve()));
}
console.log('Native ESM ZIP, XLSX, multipart, archive and SQLite roundtrips passed.');
