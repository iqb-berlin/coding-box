#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import xml2js from 'xml2js';

const defaultBaseUrl = 'https://www2.iqb.hu-berlin.de/';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultOutput = path.resolve(scriptDir, '../../tmp/iqb-windows');
const identityTransform = 'urn:schemas-microsoft-com:HashTransforms.Identity';
const sha256Method = 'http://www.w3.org/2000/09/xmldsig#sha256';

export function safeRelativePath(value) {
  const normalized = String(value).replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some(
    part => !part || part === '.' || part === '..' || /[:\x00-\x1f]/.test(part)
  )) {
    throw new Error(`Unsafe relative path: ${value}`);
  }
  return normalized;
}

export function resourceUrl(baseUrl, relativePath) {
  const encoded = safeRelativePath(relativePath).split('/').map(encodeURIComponent).join('/');
  return new URL(encoded, baseUrl).href;
}

export async function parseManifest(buffer) {
  const document = await xml2js.parseStringPromise(buffer.toString('utf8'), {
    tagNameProcessors: [xml2js.processors.stripPrefix],
    attrNameProcessors: [xml2js.processors.stripPrefix]
  });
  if (!document.assembly?.assemblyIdentity?.[0]?.$) {
    throw new Error('Missing ClickOnce assembly identity');
  }
  return document.assembly;
}

export function manifestResources(manifest) {
  const assemblies = (manifest.dependency ?? []).flatMap(
    dependency => dependency.dependentAssembly ?? []
  ).filter(dependency => dependency.$.dependencyType === 'install');
  return [
    ...assemblies.map(assembly => ({
      name: safeRelativePath(assembly.$.codebase),
      size: Number(assembly.$.size),
      hash: assembly.hash?.[0]
    })),
    ...(manifest.file ?? []).map(file => ({
      name: safeRelativePath(file.$.name),
      size: Number(file.$.size),
      hash: file.hash?.[0]
    }))
  ];
}

export function verifyResource(buffer, expected) {
  if (!Number.isSafeInteger(expected.size) || expected.size !== buffer.length) {
    throw new Error(`Size mismatch: expected ${expected.size}, received ${buffer.length}`);
  }
  const hash = expected.hash;
  const transforms = hash?.Transforms?.[0]?.Transform ?? [];
  if (hash?.DigestMethod?.[0]?.$?.Algorithm !== sha256Method ||
      transforms.length !== 1 || transforms[0].$.Algorithm !== identityTransform) {
    throw new Error('Missing or unsupported manifest hash/transform');
  }
  const digest = Buffer.from(hash.DigestValue?.[0] ?? '', 'base64');
  if (digest.length !== 32 || !createHash('sha256').update(buffer).digest().equals(digest)) {
    throw new Error('SHA-256 mismatch');
  }
}

async function fetchBytes(url, fetchImpl) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const limit = 64 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > limit) {
    throw new Error(`Resource exceeds 64 MiB: ${url}`);
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > limit) throw new Error(`Resource exceeds 64 MiB: ${url}`);
    chunks.push(Buffer.from(chunk));
  }
  return { buffer: Buffer.concat(chunks), finalUrl: response.url || url };
}

export async function auditDownloads({ baseUrl = defaultBaseUrl, output = defaultOutput,
  fetchImpl = fetch } = {}) {
  const report = {
    checkedAt: new Date().toISOString(),
    baseUrl,
    scope: 'Download availability and manifest integrity; no Windows execution',
    applications: [],
    unavailableApplications: [],
    errors: []
  };
  const bundle = { createdAt: report.checkedAt, applications: [] };
  await mkdir(output, { recursive: true });

  try {
    const catalogue = JSON.parse((await fetchBytes(new URL('it/api/apps', baseUrl).href,
      fetchImpl)).buffer.toString('utf8'));
    const metadata = JSON.parse((await fetchBytes(new URL('it/apps.json', baseUrl).href,
      fetchImpl)).buffer.toString('utf8'));
    if (!Array.isArray(catalogue.apps) || !Array.isArray(metadata)) {
      throw new Error('Unexpected IQB catalogue/metadata response');
    }
    report.unavailableApplications = metadata.filter(
      app => !catalogue.apps.some(available => available.id === app.id)
    ).map(app => app.id);
    if (catalogue.apps.length === 0) throw new Error('IQB catalogue has no downloadable apps');

    for (const app of catalogue.apps) {
      const item = { id: app.id, version: app.version, status: 'passed', checks: [] };
      report.applications.push(item);
      const appFolder = safeRelativePath(`${app.id}/${app.version}`);
      const appBundle = { id: app.id, version: app.version, files: [] };

      async function check(kind, url, localName, expected, executable = false) {
        const result = { kind, url, status: 'passed' };
        item.checks.push(result);
        try {
          const { buffer, finalUrl } = await fetchBytes(url, fetchImpl);
          result.finalUrl = finalUrl;
          result.bytes = buffer.length;
          result.sha256 = createHash('sha256').update(buffer).digest('hex');
          if (expected) verifyResource(buffer, expected);
          if (executable && (buffer.length < 64 || buffer.toString('ascii', 0, 2) !== 'MZ')) {
            throw new Error('Download is not a Windows executable');
          }
          if (localName) {
            const relative = safeRelativePath(`${appFolder}/${localName}`);
            const target = path.join(output, relative);
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, buffer);
            appBundle.files.push({ path: relative, sha256: result.sha256, bytes: buffer.length });
            result.path = relative;
          }
          return { buffer, finalUrl };
        } catch (error) {
          result.status = 'failed';
          result.error = error.message;
          item.status = 'failed';
          return null;
        }
      }

      try {
        appBundle.setup = safeRelativePath(`${appFolder}/setup.exe`);
        await check('installer', new URL(app.setupUrl, baseUrl).href, 'setup.exe', null, true);
        const manifestName = safeRelativePath(app.manifest);
        const deployment = await check('deployment-manifest', new URL(app.manifestUrl,
          baseUrl).href, manifestName);
        if (!deployment) continue;
        const manifest = await parseManifest(deployment.buffer);
        const version = manifest.assemblyIdentity[0].$.version;
        if (version !== app.version) throw new Error(`Catalogue/manifest version mismatch: ${version}`);
        const mapped = manifest.deployment?.[0]?.$.mapFileExtensions === 'true';
        item.architecture = manifest.assemblyIdentity[0].$.processorArchitecture;
        item.frameworks = (manifest.compatibleFrameworks?.[0]?.framework ?? []).map(f => f.$);
        appBundle.frameworks = item.frameworks;
        appBundle.manifestUrl = new URL(app.manifestUrl, baseUrl).href;
        const references = manifestResources(manifest);
        if (references.length !== 1 || !references[0].name.endsWith('.manifest')) {
          throw new Error('Expected one application manifest in deployment');
        }
        const reference = references[0];
        const application = await check('application-manifest', resourceUrl(deployment.finalUrl,
          reference.name), reference.name, reference);
        if (!application) continue;
        const applicationManifest = await parseManifest(application.buffer);
        if (applicationManifest.assemblyIdentity[0].$.version !== version) {
          throw new Error('Deployment/application version mismatch');
        }
        const executable = applicationManifest.entryPoint?.[0]?.commandLine?.[0]?.$.file;
        const resourceFolder = path.posix.dirname(reference.name);
        appBundle.executable = safeRelativePath(`${appFolder}/${resourceFolder}/${executable}`);
        const resources = manifestResources(applicationManifest);
        if (!resources.some(resource => resource.name === executable)) {
          throw new Error('Application executable is not covered by the manifest');
        }
        for (const resource of resources) {
          await check('payload', resourceUrl(application.finalUrl,
            resource.name + (mapped ? '.deploy' : '')),
          `${resourceFolder}/${resource.name}`, resource);
        }

        // ClickOnce follows this URL on installation and before application startup.
        const providerUrl = manifest.deployment?.[0]?.deploymentProvider?.[0]?.$.codebase;
        if (!providerUrl) throw new Error('Missing deployment provider');
        const provider = await check('provider-manifest', providerUrl);
        if (provider) {
          const providerManifest = await parseManifest(provider.buffer);
          if (providerManifest.assemblyIdentity[0].$.version !== version) {
            throw new Error('Provider version differs from downloaded version');
          }
          const providerRefs = manifestResources(providerManifest);
          if (providerRefs.length !== 1) throw new Error('Unexpected provider application manifest');
          const providerApp = await check('provider-application-manifest', resourceUrl(
            provider.finalUrl, providerRefs[0].name), null, providerRefs[0]);
          if (providerApp) {
            const providerApplicationManifest = await parseManifest(providerApp.buffer);
            const providerMapped = providerManifest.deployment?.[0]?.$.mapFileExtensions === 'true';
            for (const resource of manifestResources(providerApplicationManifest)) {
              await check('provider-payload', resourceUrl(providerApp.finalUrl,
                resource.name + (providerMapped ? '.deploy' : '')), null, resource);
            }
          }
        }
      } catch (error) {
        item.status = 'failed';
        item.error = error.message;
      }
      if (item.status === 'passed') bundle.applications.push(appBundle);
    }
  } catch (error) {
    report.errors.push(error.message);
  }
  report.status = report.errors.length || report.applications.some(app => app.status !== 'passed')
    ? 'failed' : 'passed';
  await writeFile(path.join(output, 'audit.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(output, 'bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`);
  const lines = ['# IQB Download Audit', '', `Checked: ${report.checkedAt}`,
    '', report.scope, '', '| Application | Version | Download Checks | Result |',
    '| --- | --- | ---: | --- |', ...report.applications.map(app =>
      `| ${app.id} | ${app.version} | ${app.checks.length} | ${app.status} |`), '',
    `Listed without a current download: ${report.unavailableApplications.join(', ') || 'none'}.`,
    '', 'Windows installation, GUI automation, and functional correctness: NOT TESTED.', '',
    ...report.errors.map(error => `Error: ${error}`),
    ...report.applications.flatMap(app => [
      ...(app.error ? [`${app.id}: ${app.error}`] : []),
      ...app.checks.filter(check => check.status === 'failed').map(check =>
        `${app.id}: ${check.kind}: ${check.error}`)
    ])];
  await writeFile(path.join(output, 'audit.md'), `${lines.join('\n')}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await auditDownloads();
  for (const app of report.applications) {
    console.log(`${app.id} ${app.version}: ${app.status} (${app.checks.length} download checks)`);
  }
  console.log(`Report and Windows bundle: ${defaultOutput}`);
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
