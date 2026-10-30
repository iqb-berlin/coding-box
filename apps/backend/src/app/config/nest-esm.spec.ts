import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SourceTextModule } from 'vm';

@Injectable()
class EsmConsumer {
  constructor(readonly config: ConfigService) {}
}

describe('CommonJS tests with native Nest ESM dependencies', () => {
  it('enables the VM module loader before Jest starts, also when running in band', async () => {
    const module = new SourceTextModule('export const value = 42;');
    await module.link(() => { throw new Error('This fixture has no dependencies'); });
    await module.evaluate();
    expect((module.namespace as { value: number }).value).toBe(42);
  });

  it('preserves decorator metadata and provider identity across the CJS/ESM boundary', async () => {
    expect(jest.requireActual<typeof import('@nestjs/common')>('@nestjs/common').Injectable).toBe(Injectable);
    const config = new ConfigService({ esmValue: 42 });
    const module = await Test.createTestingModule({
      providers: [EsmConsumer, { provide: ConfigService, useValue: config }]
    }).compile();
    try {
      await module.init();
      expect(module.get(EsmConsumer).config).toBe(config);
      expect(module.get(EsmConsumer).config.get('esmValue')).toBe(42);
    } finally {
      await module.close();
    }
  });
});
