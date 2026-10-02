import { BadRequestException } from '@nestjs/common';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import { Setting } from '../database/entities/setting.entity';

export const REGEX_SEARCH_PATTERN_MAX_LENGTH = 256;
export const REGEX_SEARCH_STATEMENT_TIMEOUT_MS = 3000;
export const RESPONSE_VALUE_SEARCH_STATEMENT_TIMEOUT_MS = 15000;

export const SEARCH_ERROR_CODES = {
  invalidRegex: 'INVALID_REGEX',
  regexTimeout: 'REGEX_TIMEOUT',
  searchTimeout: 'SEARCH_TIMEOUT'
} as const;

export class InvalidRegexSearchPatternException extends BadRequestException {
  constructor(fieldName?: string, details?: string) {
    const target = fieldName ? ` for ${fieldName}` : '';
    const detailText = details ? `: ${details}` : '';
    const message = `Invalid regular expression${target}${detailText}`;
    super({
      statusCode: 400,
      code: SEARCH_ERROR_CODES.invalidRegex,
      ...(fieldName ? { field: fieldName } : {}),
      message
    });
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

export async function validatePostgresRegexSearchPatterns(
  queryRunner: Pick<QueryRunner, 'query'>,
  patterns: Array<{ fieldName: string; pattern: string | undefined }>
): Promise<void> {
  for (const { fieldName, pattern } of patterns) {
    const normalizedPattern = assertValidRegexSearchPattern(pattern, fieldName);
    if (!normalizedPattern) {
      continue;
    }

    try {
      await queryRunner.query(
        'SELECT \'\'::text ~ $1::text AS "isValid"',
        [normalizedPattern]
      );
    } catch (error) {
      const invalidRegexError = toInvalidRegexSearchPatternException(
        error,
        fieldName
      );
      if (invalidRegexError) {
        throw invalidRegexError;
      }
      throw error;
    }
  }
}

export function withResponseValueSearchStatementTimeout<T>(
  dataSource: Pick<DataSource, 'createQueryRunner'>,
  work: (queryRunner: QueryRunner) => Promise<T>,
  timeoutMs = RESPONSE_VALUE_SEARCH_STATEMENT_TIMEOUT_MS
): Promise<T> {
  return withRegexSearchStatementTimeout(dataSource, work, timeoutMs);
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
  return new BadRequestException({
    statusCode: 400,
    code: SEARCH_ERROR_CODES.regexTimeout,
    message: `Regular expression search timed out after ${timeoutMs} ms. ` +
      'Please use a more specific pattern.'
  });
}

export function toResponseValueSearchException(
  error: unknown
): BadRequestException | null {
  return findPostgresStatementTimeoutError(error) ?
    new BadRequestException({
      statusCode: 400,
      code: SEARCH_ERROR_CODES.searchTimeout,
      field: 'responseValue',
      message: 'Response value search timed out after ' +
        `${RESPONSE_VALUE_SEARCH_STATEMENT_TIMEOUT_MS} ms. ` +
        'Please use a more specific search term.'
    }) :
    null;
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
