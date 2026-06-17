function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#(\d+)|#x([0-9a-f]+)|[a-z]+);/gi, (entity, body, decimal, hex) => {
    if (decimal) {
      return decodeCodePoint(Number(decimal), entity);
    }
    if (hex) {
      return decodeCodePoint(parseInt(hex, 16), entity);
    }

    switch (body.toLowerCase()) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      case 'nbsp':
        return ' ';
      default:
        return entity;
    }
  });
}

function decodeCodePoint(codePoint: number, fallback: string): string {
  if (
    !Number.isInteger(codePoint) ||
    codePoint < 0 ||
    codePoint > 0x10ffff
  ) {
    return fallback;
  }

  return String.fromCodePoint(codePoint);
}

export function getVisibleManualInstructionText(manualInstruction?: string | null): string {
  if (!manualInstruction) return '';

  return decodeHtmlEntities(manualInstruction.replace(/<[^>]*>/g, ' '))
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasManualInstruction(code: { manualInstruction?: string | null }): boolean {
  return getVisibleManualInstructionText(code.manualInstruction).length > 0;
}
