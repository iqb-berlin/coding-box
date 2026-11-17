import { BadRequestException } from '@nestjs/common';
import type { Unit } from '../../entities/unit.entity';

export function normalizeVariableId(variableId: unknown): string {
  return String(variableId ?? '').toUpperCase();
}

export function autocoderResultKey(variableId: unknown, subform: string): string {
  return `${normalizeVariableId(variableId)}\u0000${subform}`;
}

export function normalizeAutocoderValueForComparison(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value) ?? '';
  }
  return String(value ?? '');
}

export function serializeAutocoderValue(value: unknown): string {
  return typeof value === 'object' && value !== null ?
    JSON.stringify(value) :
    String(value ?? '');
}

export function normalizeAutocoderNumericInput(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new Error(
      `Autocoder input contains a non-numeric code or score: ${String(value)}`
    );
  }

  return numericValue;
}

export function getUnitFileId(unit: Unit): string | null {
  const candidate = unit.alias?.trim() || unit.name?.trim() || '';
  return candidate ? candidate.toUpperCase() : null;
}

export function uniquePositiveIds(ids: number[]): number[] {
  return Array.from(
    new Set(
      ids
        .map(id => Number(id))
        .filter(id => Number.isInteger(id) && id > 0)
    )
  );
}

export function normalizeAutoCoderRun(autoCoderRun: number): 1 | 2 {
  if (autoCoderRun === 1 || autoCoderRun === 2) {
    return autoCoderRun;
  }

  throw new BadRequestException('autoCoderRun must be 1 or 2');
}
