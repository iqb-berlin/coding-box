import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';

const booleanParameterValues = new Set<unknown>([true, false, 'true', 'false', '1', '0']);

class RequestValidationPipe extends ValidationPipe {
  constructor() {
    super({
      transform: false,
      // Interface/array and Swagger-only DTO bodies have explicit schema pipes.
      // A global whitelist would remove their properties before those pipes run.
      whitelist: false,
      forbidUnknownValues: false
    });
  }

  async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    if (value !== undefined && (metadata.type === 'query' || metadata.type === 'param')) {
      if (metadata.metatype === Number && !(
        (typeof value === 'number' && Number.isFinite(value)) ||
        (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
      )) {
        throw new BadRequestException(`${metadata.data || 'Parameter'} must be numeric`);
      }
      if (metadata.metatype === Number && metadata.type === 'param' && !(
        /^-?\d+$/.test(String(value)) && Number.isSafeInteger(Number(value))
      )) {
        throw new BadRequestException(`${metadata.data || 'Parameter'} must be an integer`);
      }
      if (metadata.metatype === Boolean && !booleanParameterValues.has(value)) {
        throw new BadRequestException(`${metadata.data || 'Parameter'} must be boolean`);
      }
    }
    // Existing parameter pipes and controller parsing retain their conversions.
    return super.transform(value, metadata);
  }
}

export const createRequestValidationPipe = (): ValidationPipe => new RequestValidationPipe();
