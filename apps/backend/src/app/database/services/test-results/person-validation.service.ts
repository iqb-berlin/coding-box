import { Injectable, BadRequestException } from '@nestjs/common';
import { Person, TcMergeBooklet, TcMergeUnit } from '../shared';

/**
 * Service responsible for business rule validation and data integrity checks
 * for person-related operations.
 *
 * This service provides reusable validation logic with consistent error messages.
 */
@Injectable()
export class PersonValidationService {
  /**
   * Validates that a workspace ID is valid (positive number).
   * @param workspaceId - The workspace ID to validate
   * @throws BadRequestException if workspace ID is invalid
   */
  validateWorkspaceId(workspaceId: number): void {
    if (!workspaceId || typeof workspaceId !== 'number' || workspaceId <= 0) {
      throw new BadRequestException(
        `Invalid workspace ID: ${workspaceId}. Workspace ID must be a positive number.`
      );
    }
  }

  /**
   * Validates that a person list is a non-empty array.
   * @param personList - The person list to validate
   * @throws BadRequestException if person list is invalid
   */
  validatePersonList(personList: Person[]): void {
    if (!Array.isArray(personList)) {
      throw new BadRequestException(
        'Invalid person list: must be an array.'
      );
    }

    if (personList.length === 0) {
      throw new BadRequestException(
        'Invalid person list: cannot be empty.'
      );
    }
  }

  /**
   * Validates the structure of a person object.
   * @param person - The person object to validate
   * @throws BadRequestException if person structure is invalid
   */
  validatePersonData(person: Person): void {
    if (!person || typeof person !== 'object') {
      throw new BadRequestException(
        'Invalid person data: person must be an object.'
      );
    }

    if (person.workspace_id === undefined || person.workspace_id === null) {
      throw new BadRequestException(
        'Invalid person data: workspace_id is required.'
      );
    }

    this.validateWorkspaceId(person.workspace_id);
  }

  /**
   * Validates the structure of a booklet object.
   * @param booklet - The booklet to validate
   * @throws BadRequestException if booklet structure is invalid
   */
  validateBooklet(booklet: TcMergeBooklet): void {
    if (!booklet || typeof booklet !== 'object') {
      throw new BadRequestException(
        'Invalid booklet: booklet must be an object.'
      );
    }

    if (!booklet.id) {
      throw new BadRequestException(
        'Invalid booklet: booklet ID is required.'
      );
    }

    if (!Array.isArray(booklet.units)) {
      throw new BadRequestException(
        `Invalid booklet structure: units must be an array for booklet ${booklet.id}.`
      );
    }
  }

  /**
   * Validates that a booklet name is a non-empty string.
   * @param bookletName - The booklet name to validate
   * @throws BadRequestException if booklet name is invalid
   */
  validateBookletName(bookletName: string): void {
    this.validateNonEmptyString(bookletName, 'booklet name');
  }

  /**
   * Validates the structure of a unit object.
   * @param unit - The unit to validate
   * @throws BadRequestException if unit structure is invalid
   */
  validateUnit(unit: TcMergeUnit): void {
    if (!unit || typeof unit !== 'object') {
      throw new BadRequestException(
        'Invalid unit: unit must be an object.'
      );
    }

    if (!unit.id) {
      throw new BadRequestException(
        'Invalid unit: unit ID is required.'
      );
    }
  }

  /**
   * Validates that a unit name is a non-empty string.
   * @param unitName - The unit name to validate
   * @throws BadRequestException if unit name is invalid
   */
  validateUnitName(unitName: string): void {
    this.validateNonEmptyString(unitName, 'unit name');
  }

  /**
   * Validates the format of a log entry.
   * @param logEntry - The log entry to validate
   * @throws BadRequestException if log entry is invalid
   */
  validateLogEntry(logEntry: string): void {
    if (!logEntry || typeof logEntry !== 'string' || logEntry.trim() === '') {
      throw new BadRequestException(
        'Invalid log entry: log entry must be a non-empty string.'
      );
    }

    // Check for expected format: "KEY : VALUE"
    if (!logEntry.includes(' : ')) {
      throw new BadRequestException(
        `Invalid log entry format: expected "KEY : VALUE" format, got "${logEntry}".`
      );
    }
  }

  /**
   * Validates the structure of a LOADCOMPLETE log entry.
   * Returns true if valid, false if invalid (non-throwing for optional validation).
   * @param logEntry - The LOADCOMPLETE log entry to validate
   * @returns true if the log entry appears to be valid LOADCOMPLETE format
   */
  validateLoadCompleteLog(logEntry: string): boolean {
    if (!logEntry || typeof logEntry !== 'string') {
      return false;
    }

    // LOADCOMPLETE format should be like: {key:value,key:value,...}
    const trimmed = logEntry.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
      return false;
    }

    // Check if it contains key-value pairs
    const content = trimmed.slice(1, -1);
    if (!content.includes(':')) {
      return false;
    }

    return true;
  }

  /**
   * Generic validation for arrays.
   * @param array - The array to validate
   * @param fieldName - The name of the field for error messages
   * @throws BadRequestException if array is invalid
   */
  validateArray<T>(array: T[], fieldName: string): void {
    if (!Array.isArray(array)) {
      throw new BadRequestException(
        `Invalid ${fieldName}: must be an array.`
      );
    }
  }

  /**
   * Validates that a string is non-empty.
   * @param value - The string to validate
   * @param fieldName - The name of the field for error messages
   * @throws BadRequestException if string is empty or invalid
   */
  validateNonEmptyString(value: string, fieldName: string): void {
    if (!value || typeof value !== 'string' || value.trim() === '') {
      throw new BadRequestException(
        `Invalid ${fieldName}: must be a non-empty string.`
      );
    }
  }

  /**
   * Validates that logins array is valid and non-empty.
   * @param logins - The logins array to validate
   * @throws BadRequestException if logins array is invalid
   */
  validateLogins(logins: string[]): void {
    this.validateArray(logins, 'logins');

    if (logins.length === 0) {
      throw new BadRequestException(
        'Invalid logins: array cannot be empty.'
      );
    }
  }

  /**
   * Validates that a row object has required booklet and unit name fields.
   * @param row - The row object to validate
   * @throws BadRequestException if row structure is invalid
   */
  validateRowStructure(row: any): void {
    if (!row || typeof row !== 'object') {
      throw new BadRequestException(
        'Invalid row: row must be an object.'
      );
    }

    if (typeof row.bookletname !== 'string') {
      throw new BadRequestException(
        'Invalid row: bookletname must be a string.'
      );
    }

    if (typeof row.unitname !== 'string') {
      throw new BadRequestException(
        'Invalid row: unitname must be a string.'
      );
    }
  }
}
