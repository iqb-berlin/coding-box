import { BadRequestException, PipeTransform } from '@nestjs/common';
import Ajv, { AnySchema, ValidateFunction } from 'ajv';

// No coercion or field removal: reject malformed payloads without altering a
// client's JSON or accepting strings in place of booleans/numbers.
const ajv = new Ajv({ allErrors: false, coerceTypes: false, removeAdditional: false });

export class JsonSchemaValidationPipe implements PipeTransform {
  private readonly validate: ValidateFunction;

  constructor(schema: AnySchema, private readonly optional = false) {
    this.validate = ajv.compile(schema);
  }

  transform(value: unknown): unknown {
    if (value === undefined && this.optional) {
      return value;
    }
    if (!this.validate(value)) {
      throw new BadRequestException({
        message: 'Invalid request body',
        errors: this.validate.errors?.map(error => ({
          path: error.instancePath || '/',
          message: error.message
        }))
      });
    }
    return value;
  }
}
