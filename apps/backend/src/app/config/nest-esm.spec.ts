import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { constants, Script, SourceTextModule } from 'node:vm';
import path from 'node:path';

@Injectable()
class EsmConsumer {
  constructor(readonly config: ConfigService) {}
}

describe('ESM backend tests with native Nest dependencies', () => {
  it('enables the VM module loader for remaining package and subprocess checks', async () => {
    const module = new SourceTextModule('export const value = 42;');
    await module.link(() => { throw new Error('This fixture has no dependencies'); });
    await module.evaluate();
    expect((module.namespace as { value: number }).value).toBe(42);
  });

  it('uses the same external Nest module identity as the native Node import loader', async () => {
    const nativeImport = new Script("import('@nestjs/common')", {
      filename: path.join(process.cwd(), 'native-import-probe.mjs'),
      importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER
    });
    const native = await nativeImport.runInThisContext();
    expect(native.Injectable).toBe(Injectable);
  });

  it('preserves constructor metadata and resolves providers in the ESM application graph', async () => {
    expect(Reflect.getMetadata('design:paramtypes', EsmConsumer)).toEqual([ConfigService]);
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
