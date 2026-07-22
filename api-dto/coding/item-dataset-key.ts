/* eslint-disable max-classes-per-file */
const ITEM_DATASET_KEY_SEPARATOR = '\u001F';

export const normalizeItemDatasetUnitId = (value: unknown): string => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/\.XML$/i, '');

export const normalizeItemDatasetItemId = (value: unknown): string => String(value ?? '').trim();

export const normalizeItemDatasetVariableId = (value: unknown): string => String(value ?? '').trim();

abstract class ItemDatasetKey {
  protected constructor(
    readonly unitId: string,
    readonly localId: string
  ) {}

  toString(): string {
    return `${this.unitId}${ITEM_DATASET_KEY_SEPARATOR}${this.localId}`;
  }
}

export class ItemDatasetSelectionKey extends ItemDatasetKey {
  private constructor(unitId: string, itemId: string) {
    super(unitId, itemId);
  }

  static from(unitId: unknown, itemId: unknown): ItemDatasetSelectionKey {
    return new ItemDatasetSelectionKey(
      normalizeItemDatasetUnitId(unitId),
      normalizeItemDatasetItemId(itemId)
    );
  }

  static parse(value: string): ItemDatasetSelectionKey | null {
    const separator = value.indexOf(ITEM_DATASET_KEY_SEPARATOR);
    return separator < 0 ?
      null :
      ItemDatasetSelectionKey.from(
        value.slice(0, separator),
        value.slice(separator + 1)
      );
  }

  get itemId(): string {
    return this.localId;
  }
}

export class ItemDatasetResponseKey extends ItemDatasetKey {
  private constructor(unitId: string, variableId: string) {
    super(unitId, variableId);
  }

  static from(unitId: unknown, variableId: unknown): ItemDatasetResponseKey {
    return new ItemDatasetResponseKey(
      normalizeItemDatasetUnitId(unitId),
      normalizeItemDatasetVariableId(variableId)
    );
  }

  static parse(value: string): ItemDatasetResponseKey | null {
    const separator = value.indexOf(ITEM_DATASET_KEY_SEPARATOR);
    return separator < 0 ?
      null :
      ItemDatasetResponseKey.from(
        value.slice(0, separator),
        value.slice(separator + 1)
      );
  }

  get variableId(): string {
    return this.localId;
  }
}
