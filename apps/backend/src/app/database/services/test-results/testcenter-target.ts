import { BadRequestException, ForbiddenException } from '@nestjs/common';

function normalizeBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
        url.search || url.hash || value !== value.trim() || /[\\\s]/.test(value)) {
      throw new Error();
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    throw new BadRequestException('Invalid Testcenter base URL');
  }
}

/** Exact base URLs allow private installations only through trusted configuration. */
export function parseAllowedTestcenterUrls(value = ''): string[] {
  return value.split(',').map(entry => entry.trim()).filter(Boolean).map(normalizeBaseUrl);
}

export function resolveTestcenterBaseUrl(server: string, url = '', allowedUrls = ''): string {
  if (!url && !/^(?:[1-9]|10)?$/.test(server)) {
    throw new BadRequestException('Invalid Testcenter server selection');
  }
  const base = normalizeBaseUrl(url || `https://iqb-testcenter${server}.de`);
  const defaults = ['', ...Array.from({ length: 10 }, (_, i) => String(i + 1))]
    .map(suffix => `https://iqb-testcenter${suffix}.de`);
  if (![...defaults, ...parseAllowedTestcenterUrls(allowedUrls)].includes(base)) {
    throw new ForbiddenException('Testcenter target is not allowed');
  }
  return base;
}
