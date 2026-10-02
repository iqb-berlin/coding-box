import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_CODING_FILE_LOAD_CONCURRENCY,
  DEFAULT_AUTOCODER_SCHEMA_VALIDATION_MODE,
  DEFAULT_IN_FLIGHT_REQUEST_THRESHOLD_MS,
  DEFAULT_RESPONSE_CACHE_ITEM_CONCURRENCY,
  DEFAULT_RESPONSE_CACHE_WORKSPACE_CONCURRENCY,
  DEFAULT_SLOW_REQUEST_THRESHOLD_MS,
  RuntimeConfigService
} from './runtime-config.service';

describe('RuntimeConfigService', () => {
  it('provides typed defaults for missing and invalid values', () => {
    const config = new RuntimeConfigService(new ConfigService({
      CODING_FILE_LOAD_CONCURRENCY: 'invalid',
      RESPONSE_CACHE_WORKSPACE_CONCURRENCY: '0',
      SLOW_REQUEST_THRESHOLD_MS: '-1'
    }));

    expect(config.codingFileLoadConcurrency)
      .toBe(DEFAULT_CODING_FILE_LOAD_CONCURRENCY);
    expect(config.responseCacheWorkspaceConcurrency)
      .toBe(DEFAULT_RESPONSE_CACHE_WORKSPACE_CONCURRENCY);
    expect(config.responseCacheItemConcurrency)
      .toBe(DEFAULT_RESPONSE_CACHE_ITEM_CONCURRENCY);
    expect(config.slowRequestThresholdMs)
      .toBe(DEFAULT_SLOW_REQUEST_THRESHOLD_MS);
    expect(config.inFlightRequestThresholdMs)
      .toBe(DEFAULT_IN_FLIGHT_REQUEST_THRESHOLD_MS);
    expect(config.requestStartLogging).toBe(false);
    expect(config.autocoderSchemaValidationMode)
      .toBe(DEFAULT_AUTOCODER_SCHEMA_VALIDATION_MODE);
  });

  it('keeps combined response warmup concurrency within the pool budget', () => {
    const config = new RuntimeConfigService(new ConfigService({
      POSTGRES_POOL_MAX: '5',
      CODING_FILE_LOAD_CONCURRENCY: '20',
      RESPONSE_CACHE_WORKSPACE_CONCURRENCY: '2',
      RESPONSE_CACHE_ITEM_CONCURRENCY: '20'
    }));

    expect(config.codingFileLoadConcurrency).toBe(4);
    expect(config.responseCacheWorkspaceConcurrency).toBe(2);
    expect(config.responseCacheItemConcurrency).toBe(2);
    expect(
      config.responseCacheWorkspaceConcurrency *
      config.responseCacheItemConcurrency
    ).toBeLessThanOrEqual(4);
  });

  it('parses monitoring configuration once', () => {
    const config = new RuntimeConfigService(new ConfigService({
      SLOW_REQUEST_THRESHOLD_MS: '2500.9',
      IN_FLIGHT_REQUEST_THRESHOLD_MS: '12000',
      REQUEST_START_LOGGING: 'yes'
    }));

    expect(config.slowRequestThresholdMs).toBe(2500);
    expect(config.inFlightRequestThresholdMs).toBe(12_000);
    expect(config.requestStartLogging).toBe(true);
  });

  it.each(['strict', 'compatible'] as const)(
    'accepts the %s Autocoder schema validation mode',
    mode => {
      const config = new RuntimeConfigService(new ConfigService({
        AUTOCODER_SCHEMA_VALIDATION_MODE: mode
      }));

      expect(config.autocoderSchemaValidationMode).toBe(mode);
    }
  );

  it('rejects an unknown Autocoder schema validation mode', () => {
    expect(() => new RuntimeConfigService(new ConfigService({
      AUTOCODER_SCHEMA_VALIDATION_MODE: 'off'
    }))).toThrow(
      'AUTOCODER_SCHEMA_VALIDATION_MODE must be "strict" or "compatible".'
    );
  });
});
