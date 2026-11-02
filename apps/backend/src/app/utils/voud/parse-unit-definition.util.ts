function removeControlChars(value: string): string {
  let cleanedValue = '';

  for (const character of value) {
    const charCode = character.charCodeAt(0);
    if ((charCode > 0x1F && charCode < 0x7F) || charCode > 0x9F) {
      cleanedValue += character;
    }
  }

  return cleanedValue;
}

/** Preserve the result export's repair of unescaped legacy control characters. */
export function parseUnitDefinition(definition: string): unknown {
  try {
    return JSON.parse(definition);
  } catch (_error) {
    return JSON.parse(removeControlChars(definition));
  }
}
