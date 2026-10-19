import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { build } from 'esbuild';
import AdmZip from 'adm-zip';

export async function loadStudioReference(root) {
  const source = path.join(root, 'apps/api/src/app/classes/download-workspaces.class.ts');
  const sourceBytes = await readFile(source);
  const result = await build({ entryPoints: [source], absWorkingDir: root, tsconfig: path.join(root, 'tsconfig.base.json'), bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false });
  const module = { exports: {} };
  // Resolve dependencies from Studio's actual installation; never write to it.
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(path.join(root, 'package.json')), module, module.exports);
  const generator = module.exports.DownloadWorkspacesClass;
  const tarball = await readFile(path.join(root, 'vendor/iqb-ngx-coding-components-4.1.0-dev.d79ca05.tgz'));
  return {
    metadata: {
      commit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
      packageSha256: createHash('sha256').update(tarball).digest('hex'),
      persistence: 'Studio repository/profile boundaries in memory; Kodierbox HTTP/DB/Redis live',
      scope: 'Studio receives the explicitly expected variable subset and item identities; it has no Kodierbox job/bundle filter'
    },
    generate(unit, options, missings) {
      return generator.getWorkspaceCodingBook(1, { findAllWithProperties: async () => [unit] }, { findMissingsProfiles: async () => [{ label: 'Proof profile', missings: JSON.stringify(missings) }] }, { ...options, missingsProfile: 'Proof profile' }, [unit.id]);
    }
  };
}
export function normalizedDocx(bytes) {
  return new AdmZip(bytes).getEntries().map(entry => ({ name: entry.entryName, data: entry.getData().toString('utf8').replace(/<dcterms:(created|modified)[^>]*>[^<]*<\/dcterms:\1>/g, '<timestamp/>') })).sort((a, b) => a.name.localeCompare(b.name));
}
