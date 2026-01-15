import * as crypto from 'crypto';
import { ResponseEntity } from '../database/entities/response.entity';
import { CodingJobUnit } from '../database/entities/coding-job-unit.entity';

export interface ExpectedCombinationDto {
  unit_key: string;
  login_name: string;
  login_code: string;
  booklet_id: string;
  variable_id: string;
}

/**
 * Calculates the modal value (most frequent code) from a list of codes.
 * If there are multiple modes, one is selected randomly.
 *
 * @param codes - Array of numerical codes
 * @returns Object containing the modal value and the number of deviations from it
 */
export function calculateModalValue(codes: number[]): { modalValue: number; deviationCount: number } {
  if (codes.length === 0) {
    return { modalValue: 0, deviationCount: 0 };
  }

  const frequency = new Map<number, number>();
  codes.forEach(code => {
    frequency.set(code, (frequency.get(code) || 0) + 1);
  });

  let maxFrequency = 0;
  const modalCodes: number[] = [];

  frequency.forEach((count, code) => {
    if (count > maxFrequency) {
      maxFrequency = count;
      modalCodes.length = 0;
      modalCodes.push(code);
    } else if (count === maxFrequency) {
      modalCodes.push(code);
    }
  });

  const modalValue = modalCodes[Math.floor(Math.random() * modalCodes.length)];
  const deviationCount = codes.length - maxFrequency;

  return { modalValue, deviationCount };
}

/**
 * Generates a short SHA-256 hash for a list of expected unit/person/variable combinations.
 * Used for cache keys and consistency checks.
 *
 * @param expectedCombinations - Array of combination descriptors
 * @returns 16-character hex hash
 */
export function generateExpectedCombinationsHash(
  expectedCombinations: ExpectedCombinationDto[]
): string {
  const sortedData = expectedCombinations
    .map(
      combo => `${combo.unit_key}|${combo.login_name}|${combo.login_code}|${combo.booklet_id}|${combo.variable_id}`
    )
    .sort()
    .join('||');

  return crypto
    .createHash('sha256')
    .update(sortedData)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Determines the latest valid code and score from a response entity,
 * checking versions in descending order (v3 -> v2 -> v1).
 *
 * @param response - The response entity containing v1, v2, and v3 results
 * @returns The code, score, and version string identifying where the result came from
 */
export function getLatestCode(response: ResponseEntity): { code: number | null; score: number | null; version: string } {
  // Priority: v3 > v2 > v1
  if (response.code_v3 !== null && response.code_v3 !== undefined) {
    return { code: response.code_v3, score: response.score_v3, version: 'v3' };
  }
  if (response.code_v2 !== null && response.code_v2 !== undefined) {
    return { code: response.code_v2, score: response.score_v2, version: 'v2' };
  }
  return { code: response.code_v1, score: response.score_v1, version: 'v1' };
}

/**
 * Builds a mapping of coder names to anonymous identifiers (K1, K2, etc.).
 *
 * @param coders - Array of real coder names
 * @param usePseudo - If true, sorts coders alphabetically for deterministic mapping.
 *                    If false, shuffles coders for random mapping.
 * @returns Map of real names to anonymous identifiers
 */
export function buildCoderNameMapping(coders: string[], usePseudo: boolean): Map<string, string> {
  const mapping = new Map<string, string>();

  if (usePseudo) {
    // For pseudo mode: always use K1 and K2 for any pair of coders
    // Sort alphabetically for deterministic assignment
    const sortedCoders = [...coders].sort();
    sortedCoders.forEach((coder, index) => {
      mapping.set(coder, `K${index + 1}`);
    });
  } else {
    // For regular anonymization: shuffle and assign K1, K2, K3, etc.
    const shuffledCoders = [...coders].sort(() => Math.random() - 0.5);
    shuffledCoders.forEach((coder, index) => {
      mapping.set(coder, `K${index + 1}`);
    });
  }

  return mapping;
}

/**
 * Higher-level variant of coder mapping that works directly with CodingJobUnit entities.
 *
 * @param codingJobUnits - Array of coding job units
 * @param usePseudo - Whether to use deterministic pseudo-anonymization
 * @returns Map of real names to anonymous identifiers
 */
export function buildCoderMapping(codingJobUnits: CodingJobUnit[], usePseudo = false): Map<string, string> {
  const allCoders = new Set<string>();

  for (const unit of codingJobUnits) {
    const coder = unit.coding_job?.codingJobCoders?.[0];
    const coderName = coder?.user?.username || `Job ${unit.coding_job_id}`;
    allCoders.add(coderName);
  }

  return buildCoderNameMapping(Array.from(allCoders), usePseudo);
}
