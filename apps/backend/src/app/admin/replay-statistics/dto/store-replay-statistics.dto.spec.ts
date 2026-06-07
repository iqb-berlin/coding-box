import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { StoreReplayStatisticsDto } from './store-replay-statistics.dto';

describe('StoreReplayStatisticsDto', () => {
  it('should accept bounded timing maps', async () => {
    const dto = plainToInstance(StoreReplayStatisticsDto, {
      unitId: 'UNIT-1',
      durationMilliseconds: 1000,
      clientTimings: { payloadMs: 10 },
      serverTimings: { responseTotalMs: 5 }
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('should reject non-object timing maps', async () => {
    const dto = plainToInstance(StoreReplayStatisticsDto, {
      unitId: 'UNIT-1',
      durationMilliseconds: 1000,
      clientTimings: ['payloadMs']
    });

    const errors = await validate(dto);

    expect(errors.some(error => error.property === 'clientTimings')).toBe(true);
  });

  it('should allow oversized replay URLs so controller sanitization can remove large query data', async () => {
    const dto = plainToInstance(StoreReplayStatisticsDto, {
      unitId: 'UNIT-1',
      durationMilliseconds: 1000,
      replayUrl: `https://example.test/${'x'.repeat(5000)}`,
      errorMessage: 'E'.repeat(5000)
    });

    const errors = await validate(dto);

    expect(errors.some(error => error.property === 'replayUrl')).toBe(false);
  });
});
