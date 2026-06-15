import { BadRequestException } from '@nestjs/common';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import { Setting } from '../database/entities/setting.entity';

export const REGEX_SEARCH_PATTERN_MAX_LENGTH = 256;
export const REGEX_SEARCH_STATEMENT_TIMEOUT_MS = 3000;

export class InvalidRegexSearchPatternException extends BadRequestException {
  constructor(fieldName?: string, details?: string) {
    const target = fieldName ? ` for ${fieldName}` : '';
    const detailText = details ? `: ${details}` : '';
    super(`Invalid regular expression${target}${detailText}`);
  }
}

export async function getWorkspaceRegexSearchEnabled(
  settingRepository: Pick<Repository<Setting>, 'findOne'>,
  workspaceId: number
): Promise<boolean> {
  const setting = await settingRepository.findOne({
    where: { key: `workspace-${workspaceId}-enable-regex-search` }
  });

  if (!setting) {
    return false;
  }

  try {
    const parsed = JSON.parse(setting.content);
    return parsed.enabled === true;
  } catch {
    return false;
  }
}

export function assertValidRegexSearchPattern(
  pattern: string | undefined,
  fieldName: string
): string | null {
  const normalizedPattern = (pattern || '').trim();
  if (!normalizedPattern) {
    return null;
  }

  if (normalizedPattern.length > REGEX_SEARCH_PATTERN_MAX_LENGTH) {
    throw new InvalidRegexSearchPatternException(
      fieldName,
      `pattern must not exceed ${REGEX_SEARCH_PATTERN_MAX_LENGTH} characters`
    );
  }

  return normalizedPattern;
}

export function toInvalidRegexSearchPatternException(
  error: unknown,
  fieldName?: string
): InvalidRegexSearchPatternException | null {
  if (error instanceof InvalidRegexSearchPatternException) {
    return error;
  }

  const postgresError = findPostgresRegexError(error);
  if (!postgresError) {
    return null;
  }

  return new InvalidRegexSearchPatternException(
    fieldName,
    getErrorMessage(postgresError)
  );
}

export async function withRegexSearchStatementTimeout<T>(
  dataSource: Pick<DataSource, 'createQueryRunner'>,
  work: (queryRunner: QueryRunner) => Promise<T>,
  timeoutMs = REGEX_SEARCH_STATEMENT_TIMEOUT_MS
): Promise<T> {
  const queryRunner = dataSource.createQueryRunner();

  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    await queryRunner.query(`SET LOCAL statement_timeout = '${timeoutMs}ms'`);
    const result = await work(queryRunner);
    await queryRunner.commitTransaction();
    return result;
  } catch (error) {
    try {
      await queryRunner.rollbackTransaction();
    } catch {
      // Preserve the original query error for consistent HTTP mapping.
    }
    throw error;
  } finally {
    await queryRunner.release();
  }
}

export function toRegexSearchException(
  error: unknown,
  fieldName?: string
): BadRequestException | null {
  const invalidRegexError = toInvalidRegexSearchPatternException(error, fieldName);
  if (invalidRegexError) {
    return invalidRegexError;
  }

  if (findPostgresStatementTimeoutError(error)) {
    return createRegexSearchTimeoutException();
  }

  return null;
}

export function createRegexSearchTimeoutException(
  timeoutMs = REGEX_SEARCH_STATEMENT_TIMEOUT_MS
): BadRequestException {
  return new BadRequestException(
    `Regular expression search timed out after ${timeoutMs} ms. ` +
    'Please use a more specific pattern.'
  );
}

function findPostgresRegexError(error: unknown): unknown | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const candidate = error as {
    code?: unknown;
    message?: unknown;
    driverError?: unknown;
    cause?: unknown;
  };

  if (candidate.code === '2201B') {
    return error;
  }

  if (typeof candidate.message === 'string' &&
    candidate.message.toLowerCase().includes('invalid regular expression')) {
    return error;
  }

  return findPostgresRegexError(candidate.driverError) ||
    findPostgresRegexError(candidate.cause);
}

function findPostgresStatementTimeoutError(error: unknown): unknown | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const candidate = error as {
    code?: unknown;
    message?: unknown;
    driverError?: unknown;
    cause?: unknown;
  };

  if (candidate.code === '57014' &&
    typeof candidate.message === 'string' &&
    candidate.message.toLowerCase().includes('statement timeout')) {
    return error;
  }

  return findPostgresStatementTimeoutError(candidate.driverError) ||
    findPostgresStatementTimeoutError(candidate.cause);
}

function getErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return String(error);
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : String(error);
}
