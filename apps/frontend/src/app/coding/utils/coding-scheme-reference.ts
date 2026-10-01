import { FilesInListDto } from '../../../../../../api-dto/files/files-in-list.dto';
import { UnitCodingSchemeRefDto } from '../../../../../../api-dto/unit-info/unit-coding-scheme-ref.dto';

export function readCodingSchemeReference(xml: string): UnitCodingSchemeRefDto | null {
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  if (document.querySelector('parsererror')) return null;
  const element = document.querySelector('CodingSchemeRef');
  const content = element?.textContent?.trim();
  if (!element || !content) return null;
  return {
    content,
    ...(element.getAttribute('schemer') ? { schemer: element.getAttribute('schemer')!.trim() } : {}),
    ...(element.getAttribute('schemeType') ? { schemeType: element.getAttribute('schemeType')!.trim() } : {})
  };
}

type SchemerFile = FilesInListDto & { file_id?: string };

function parseSchemerId(value: string) {
  const match = value.trim().replace(/\.html$/i, '').match(/^(.+?)[@-](\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([\w.-]+))?$/);
  if (!match) return null;
  return {
    module: match[1].toLowerCase(),
    major: Number(match[2]),
    minor: match[3] === undefined ? undefined : Number(match[3]),
    patch: match[4] === undefined ? undefined : Number(match[4]),
    label: match[5]
  };
}

export function selectSchemerFile(files: SchemerFile[], reference?: string): SchemerFile | undefined {
  if (!reference) {
    return [...files].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0];
  }
  const requested = parseSchemerId(reference);
  if (!requested) return undefined;
  return files.map(file => ({ file, version: parseSchemerId(file.file_id || file.filename) }))
    .filter(({ version }) => version && version.module === requested.module &&
      version.major === requested.major &&
      (requested.minor === undefined || version.minor === requested.minor) &&
      (requested.patch === undefined || version.patch === requested.patch) &&
      version.label === requested.label)
    .sort((a, b) => (b.version!.minor || 0) - (a.version!.minor || 0) ||
      (b.version!.patch || 0) - (a.version!.patch || 0))[0]?.file;
}
