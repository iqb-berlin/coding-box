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

interface NumericVersion {
  major: number;
  minor?: number;
  patch?: number;
}

export function compareVersions(a: NumericVersion, b: NumericVersion): number {
  return a.major - b.major || (a.minor ?? 0) - (b.minor ?? 0) || (a.patch ?? 0) - (b.patch ?? 0);
}

type VocsFormat =
  | ({ kind: 'versioned'; value: string } & NumericVersion)
  | { kind: 'legacy' | 'unknown' };

function hasLegacyVariableCodings(codings: unknown): boolean {
  return Array.isArray(codings) && codings.every((coding: {
    id?: unknown; sourceType?: unknown; codes?: unknown;
  } | null) => typeof coding?.id === 'string' && typeof coding.sourceType === 'string' && Array.isArray(coding.codes));
}

export function readVocsFormat(content: string): VocsFormat {
  try {
    const parsed: { version?: unknown; variableCodings?: unknown } | null = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !('version' in parsed) && hasLegacyVariableCodings(parsed.variableCodings)) {
      return { kind: 'legacy' };
    }
    const version = parsed?.version;
    if (typeof version !== 'string') return { kind: 'unknown' };
    const match = /^(\d+)\.(\d+)$/.exec(version);
    if (!match) return { kind: 'unknown' };
    const [, majorPart, minorPart] = match;
    const major = Number(majorPart);
    const minor = Number(minorPart);
    if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor)) return { kind: 'unknown' };
    return {
      kind: 'versioned', value: version, major, minor
    };
  } catch {
    return { kind: 'unknown' };
  }
}

function parseSchemerId(value: string) {
  const match = value.trim().replace(/\.html$/i, '')
    .match(/^(.+?)[@-](\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([\w.-]+))?(?:\+[\w.-]+)?$/);
  if (!match) return null;
  return {
    module: match[1].toLowerCase(),
    major: Number(match[2]),
    minor: match[3] === undefined ? undefined : Number(match[3]),
    patch: match[4] === undefined ? undefined : Number(match[4]),
    label: match[5]
  };
}

function readSchemerVersion(file: FilesInListDto) {
  const canonical = file.file_id ? parseSchemerId(file.file_id) : null;
  const filename = parseSchemerId(file.filename);
  const module = (canonical ?? filename)?.module;
  if (module && file.schemerVersion) {
    const version = parseSchemerId(`${module}@${file.schemerVersion.trim()}`);
    if (version?.module === module) {
      return { ...version, minor: version.minor ?? 0, patch: version.patch ?? 0 };
    }
  }
  if (!canonical) return filename;

  // The backend's normalized ID can omit the prerelease suffix.
  if (!canonical.label && filename?.label && filename.module === canonical.module &&
      compareVersions(filename, canonical) === 0) {
    return { ...canonical, label: filename.label };
  }
  return canonical;
}

export function selectSchemerFile(files: FilesInListDto[], reference?: string): FilesInListDto | undefined {
  const candidates = files.flatMap(file => {
    const version = readSchemerVersion(file);
    return version ? [{ file, version }] : [];
  });
  if (!reference) {
    const stable = candidates.filter(({ version }) => !version.label);
    const iqb = stable.filter(({ version }) => version.module === 'iqb-schemer');
    return (iqb.length ? iqb : stable).sort((a, b) => compareVersions(b.version, a.version))[0]?.file ??
      [...files].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0];
  }
  const requested = parseSchemerId(reference);
  if (!requested) return undefined;
  return candidates
    .filter(({ version }) => version.module === requested.module &&
      version.major === requested.major &&
      (requested.minor === undefined || version.minor === requested.minor) &&
      (requested.patch === undefined || version.patch === requested.patch) &&
      version.label === requested.label)
    .sort((a, b) => compareVersions(b.version, a.version))[0]?.file;
}
