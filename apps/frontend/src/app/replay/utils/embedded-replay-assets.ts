export interface PreparedReplayUnitDefinition {
  definition: unknown;
  serializedDefinition: string;
  objectUrls: string[];
  assetCount: number;
  assetReferenceCount: number;
  originalSize: number;
  preparedSize: number;
}

interface ObjectUrlApi {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

const base64DataUrlPattern = /^data:([^;,]*)(?:;[^,]*)?;base64,([\s\S]*)$/i;
const richTextImagePattern =
  /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=\s]+)\2/gi;
const supportedAssetMimeTypes = new Set([
  'application/octet-stream',
  'audio/mpeg',
  'audio/wav',
  'image/jpeg',
  'image/png',
  'video/mp4'
]);

const dataUrlToBlob = (dataUrl: string): Blob | null => {
  const match = dataUrl.match(base64DataUrlPattern);
  if (!match) {
    return null;
  }

  const mimeType = match[1].toLowerCase();
  if (!supportedAssetMimeTypes.has(mimeType)) {
    return null;
  }

  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
};

/**
 * Parses a unit definition once and replaces embedded Base64 assets with object URLs.
 * Repeated references to the same data URL share one Blob and one object URL.
 */
export const prepareEmbeddedReplayAssets = (
  serializedDefinition: string,
  objectUrlApi: ObjectUrlApi = URL
): PreparedReplayUnitDefinition => {
  const objectUrls: string[] = [];
  const urlByDataUrl = new Map<string, string>();
  let assetReferenceCount = 0;

  const replaceDataUrl = (dataUrl: string): string | null => {
    const existingUrl = urlByDataUrl.get(dataUrl);
    if (existingUrl) {
      assetReferenceCount += 1;
      return existingUrl;
    }

    try {
      const blob = dataUrlToBlob(dataUrl);
      if (!blob) {
        return null;
      }

      const objectUrl = objectUrlApi.createObjectURL(blob);
      urlByDataUrl.set(dataUrl, objectUrl);
      objectUrls.push(objectUrl);
      assetReferenceCount += 1;
      return objectUrl;
    } catch {
      return null;
    }
  };

  try {
    const definition = JSON.parse(serializedDefinition, (_key, value: unknown) => {
      if (typeof value !== 'string') {
        return value;
      }

      if (value.startsWith('data:')) {
        return replaceDataUrl(value) ?? value;
      }

      const normalizedValue = value.toLowerCase();
      if (!normalizedValue.includes('<img') || !normalizedValue.includes('data:image/')) {
        return value;
      }

      return value.replace(
        richTextImagePattern,
        (match, prefix: string, quote: string, dataUrl: string) => {
          const objectUrl = replaceDataUrl(dataUrl);
          return objectUrl ? `${prefix}${quote}${objectUrl}${quote}` : match;
        }
      );
    });
    const preparedDefinition = JSON.stringify(definition);

    return {
      definition,
      serializedDefinition: preparedDefinition,
      objectUrls,
      assetCount: objectUrls.length,
      assetReferenceCount,
      originalSize: serializedDefinition.length,
      preparedSize: preparedDefinition.length
    };
  } catch (error) {
    objectUrls.forEach(url => objectUrlApi.revokeObjectURL(url));
    throw error;
  }
};

export const releaseEmbeddedReplayAssets = (
  preparedDefinition: PreparedReplayUnitDefinition | undefined,
  objectUrlApi: ObjectUrlApi = URL
): void => {
  preparedDefinition?.objectUrls.forEach(url => objectUrlApi.revokeObjectURL(url));
};
