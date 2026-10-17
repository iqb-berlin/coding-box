import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import xml2js from 'xml2js';
import {
  auditDownloads, manifestResources, parseManifest, resourceUrl, safeRelativePath, verifyResource
} from './audit-downloads.mjs';

function hash(buffer) {
  return {
    'dsig:Transforms': { 'dsig:Transform': {
      $: { Algorithm: 'urn:schemas-microsoft-com:HashTransforms.Identity' }
    } },
    'dsig:DigestMethod': { $: { Algorithm: 'http://www.w3.org/2000/09/xmldsig#sha256' } },
    'dsig:DigestValue': createHash('sha256').update(buffer).digest('base64')
  };
}

function manifest(content) {
  return Buffer.from(new xml2js.Builder({ rootName: 'asmv1:assembly' }).buildObject({
    $: { 'xmlns:asmv1': 'urn:schemas-microsoft-com:asm.v1',
      'xmlns:dsig': 'http://www.w3.org/2000/09/xmldsig#' },
    'asmv1:assemblyIdentity': { $: { name: 'Example.exe', version: '1.0.0.0',
      processorArchitecture: 'msil' } },
    ...content
  }));
}

function exampleSite() {
  const baseUrl = 'https://iqb.example/';
  const appBase = `${baseUrl}it/dl/Example/`;
  const providerBase = `${baseUrl}legacy/Example/`;
  const executable = Buffer.alloc(128);
  executable.write('MZ');
  const application = manifest({
    entryPoint: { commandLine: { $: { file: 'Example.exe' } } },
    dependency: { dependentAssembly: { $: { dependencyType: 'install', codebase: 'Example.exe',
      size: executable.length }, hash: hash(executable) } }
  });
  const deployment = manifest({
    deployment: { $: { mapFileExtensions: 'true' },
      deploymentProvider: { $: { codebase: `${providerBase}Example.application` } } },
    dependency: { dependentAssembly: { $: { dependencyType: 'install',
      codebase: 'Application Files\\Example_1_0_0_0\\Example.exe.manifest', size: application.length },
    hash: hash(application) } }
  });
  const urls = new Map([
    [`${baseUrl}it/api/apps`, JSON.stringify({ apps: [{ id: 'Example', version: '1.0.0.0',
      setupUrl: '/it/dl/Example/setup.exe', manifest: 'Example.application',
      manifestUrl: '/it/dl/Example/Example.application' }] })],
    [`${baseUrl}it/apps.json`, JSON.stringify([{ id: 'Example' }, { id: 'NotPublished' }])],
    [`${appBase}setup.exe`, executable],
    [`${appBase}Example.application`, deployment],
    [`${appBase}Application%20Files/Example_1_0_0_0/Example.exe.manifest`, application],
    [`${appBase}Application%20Files/Example_1_0_0_0/Example.exe.deploy`, executable],
    [`${providerBase}Example.application`, deployment],
    [`${providerBase}Application%20Files/Example_1_0_0_0/Example.exe.manifest`, application],
    [`${providerBase}Application%20Files/Example_1_0_0_0/Example.exe.deploy`, executable]
  ]);
  const fetchImpl = async url => new Response(urls.get(url) ?? 'not found', {
    status: urls.has(url) ? 200 : 404
  });
  return { baseUrl, urls, fetchImpl, executable, appBase, providerBase };
}

test('ClickOnce paths preserve folders and encode spaces and non-ASCII filenames', () => {
  assert.equal(safeRelativePath('Application Files\\v1\\Resources\\icon.ico'),
    'Application Files/v1/Resources/icon.ico');
  assert.equal(resourceUrl('https://example.org/app/App.application', 'Application Files\\v1\\a b.dll'),
    'https://example.org/app/Application%20Files/v1/a%20b.dll');
  for (const unsafe of ['../secret', 'a/../secret', '/absolute', 'C:\\absolute',
    'a//b', '.', 'a/./b', 'a\u0000b']) {
    assert.throws(() => safeRelativePath(unsafe), /Unsafe relative path/);
  }
});

test('namespace-aware parsing excludes runtime prerequisites and verifies exact payload bytes', async () => {
  const content = Buffer.from('test\r\n');
  const parsed = await parseManifest(manifest({ dependency: [
    { dependentAssembly: { $: { dependencyType: 'preRequisite' } } },
    { dependentAssembly: { $: { dependencyType: 'install', codebase: 'test.dll',
      size: content.length }, hash: hash(content) } }
  ] }));
  const [resource] = manifestResources(parsed);
  assert.equal(manifestResources(parsed).length, 1);
  assert.doesNotThrow(() => verifyResource(content, resource));
  assert.throws(() => verifyResource(Buffer.from('other!'), resource), /SHA-256 mismatch/);
  assert.throws(() => verifyResource(Buffer.from('short'), resource), /Size mismatch/);
  assert.throws(() => verifyResource(content, { ...resource, hash: undefined }), /unsupported/);
});

test('successful audit checks provider payloads and builds a versioned, verified Windows bundle', async t => {
  const site = exampleSite();
  const output = await mkdtemp(path.join(os.tmpdir(), 'iqb-audit-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const report = await auditDownloads({ ...site, output });
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.unavailableApplications, ['NotPublished']);
  assert.equal(report.applications[0].checks.length, 7);
  const bundle = JSON.parse(await readFile(path.join(output, 'bundle.json'), 'utf8'));
  assert.equal(bundle.applications.length, 1);
  assert.equal(bundle.applications[0].executable,
    'Example/1.0.0.0/Application Files/Example_1_0_0_0/Example.exe');
  assert.deepEqual(await readFile(path.join(output, bundle.applications[0].executable)), site.executable);
  assert.match(await readFile(path.join(output, 'audit.md'), 'utf8'), /NOT TESTED/);
});

test('missing files and invalid hashes fail the audit and exclude apps from runnable bundles', async t => {
  for (const mode of ['missing-provider', 'corrupted-payload', 'wrong-catalogue-version']) {
    const site = exampleSite();
    if (mode === 'missing-provider') site.urls.delete(`${site.providerBase}Example.application`);
    if (mode === 'corrupted-payload') site.urls.set(
      `${site.appBase}Application%20Files/Example_1_0_0_0/Example.exe.deploy`, Buffer.alloc(128, 1));
    if (mode === 'wrong-catalogue-version') {
      const catalogue = JSON.parse(site.urls.get(`${site.baseUrl}it/api/apps`));
      catalogue.apps[0].version = '2.0.0.0';
      site.urls.set(`${site.baseUrl}it/api/apps`, JSON.stringify(catalogue));
    }
    const output = await mkdtemp(path.join(os.tmpdir(), 'iqb-audit-'));
    t.after(() => rm(output, { recursive: true, force: true }));
    const report = await auditDownloads({ ...site, output });
    assert.equal(report.status, 'failed', mode);
    assert.equal(report.applications[0].status, 'failed', mode);
    const bundle = JSON.parse(await readFile(path.join(output, 'bundle.json'), 'utf8'));
    assert.deepEqual(bundle.applications, [], mode);
  }
});

test('an empty catalogue is an error, not a successful run without tests', async t => {
  const site = exampleSite();
  site.urls.set(`${site.baseUrl}it/api/apps`, JSON.stringify({ apps: [] }));
  const output = await mkdtemp(path.join(os.tmpdir(), 'iqb-audit-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const report = await auditDownloads({ ...site, output });
  assert.equal(report.status, 'failed');
  assert.match(report.errors[0], /no downloadable apps/);
});
