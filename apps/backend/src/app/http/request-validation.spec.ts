import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { createRequestValidationPipe } from './request-validation';

describe('Primitive HTTP parameter validation', () => {
  const pipe = createRequestValidationPipe();
  const numericQuery: ArgumentMetadata = { type: 'query', data: 'page', metatype: Number };
  const booleanQuery: ArgumentMetadata = { type: 'query', data: 'enabled', metatype: Boolean };

  it.each(['abc', 'NaN', 'Infinity', '', null, [], ['1'], { page: 1 }].map(value => [value]))(
    'rejects malformed numeric parameters: %j',
    async value => {
      await expect(pipe.transform(value, numericQuery)).rejects.toBeInstanceOf(BadRequestException);
    }
  );

  it.each(['true', 'false', '1', '0', true, false])(
    'retains valid booleans for existing controller parsing: %j',
    async value => {
      await expect(pipe.transform(value, booleanQuery)).resolves.toBe(value);
    }
  );

  it.each(['yes', null, ['true'], { enabled: true }].map(value => [value]))(
    'rejects malformed boolean parameters: %j',
    async value => {
      await expect(pipe.transform(value, booleanQuery)).rejects.toBeInstanceOf(BadRequestException);
    }
  );

  it('validates path numbers and retains numeric strings and optional defaults', async () => {
    await expect(pipe.transform('bad-id', { ...numericQuery, type: 'param' }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform('12', numericQuery)).resolves.toBe('12');
    await expect(pipe.transform('0.85', numericQuery)).resolves.toBe('0.85');
    await expect(pipe.transform(undefined, numericQuery)).resolves.toBeUndefined();
  });

  it.each(['1.5', '0x10', '1e3', '9007199254740993'])(
    'rejects fractional, non-decimal and unsafe path IDs: %j',
    async value => {
      await expect(pipe.transform(value, { ...numericQuery, type: 'param' }))
        .rejects.toBeInstanceOf(BadRequestException);
    }
  );
});
