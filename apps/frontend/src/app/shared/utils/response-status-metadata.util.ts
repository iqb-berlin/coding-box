import { responseStatesNumericMap } from '@iqbspecs/response/response.interface';

export interface ResponseStatusMetadata {
  numeric: number;
  status: string;
  label: string;
  tooltipKey?: string;
}

const metadataOverrides: Record<string, Partial<ResponseStatusMetadata>> = {
  DERIVE_ERROR: {
    tooltipKey: 'response-status.tooltips.DERIVE_ERROR'
  }
};

const responseStatusMetadata = responseStatesNumericMap.map<ResponseStatusMetadata>(entry => {
  const override = metadataOverrides[entry.value] || {};
  return {
    numeric: entry.key,
    status: entry.value,
    label: entry.value,
    ...override
  };
});

const metadataByNumericStatus = new Map(
  responseStatusMetadata.map(metadata => [metadata.numeric, metadata])
);
const metadataByTextStatus = new Map(
  responseStatusMetadata.map(metadata => [metadata.status, metadata])
);

export function getResponseStatusMetadata(
  status: string | number | null | undefined
): ResponseStatusMetadata | null {
  if (status === null || status === undefined || status === '') {
    return null;
  }

  if (typeof status === 'number') {
    return metadataByNumericStatus.get(status) || null;
  }

  const normalizedStatus = status.trim();
  if (normalizedStatus === '') {
    return null;
  }

  if (/^-?\d+$/.test(normalizedStatus)) {
    const numericStatus = parseInt(normalizedStatus, 10);
    return metadataByNumericStatus.get(numericStatus) || null;
  }

  return metadataByTextStatus.get(normalizedStatus) || null;
}

export function getResponseStatusLabel(
  status: string | number | null | undefined
): string {
  if (status === null || status === undefined || status === '') {
    return '';
  }

  return getResponseStatusMetadata(status)?.label || String(status);
}

export function getResponseStatusTooltipKey(
  status: string | number | null | undefined
): string {
  return getResponseStatusMetadata(status)?.tooltipKey || '';
}
