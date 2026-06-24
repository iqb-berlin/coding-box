import { Repository } from 'typeorm';
import FileUpload from '../../entities/file_upload.entity';
import { CodingFileCacheService } from './coding-file-cache.service';

describe('CodingFileCacheService', () => {
  function createRepository(files: Record<string, Partial<FileUpload>>) {
    return {
      findOne: jest.fn(({ where }: { where: { file_id: string } }) => (
        Promise.resolve(files[where.file_id] ?? null)
      ))
    } as unknown as Repository<FileUpload> & { findOne: jest.Mock };
  }

  function createFile(fileId: string, data: unknown): Partial<FileUpload> {
    return {
      file_id: fileId,
      file_type: 'Resource',
      workspace_id: 1,
      data: typeof data === 'string' ? data : JSON.stringify(data)
    };
  }

  it('uses the explicit VOCS page before the automatic VOUD page', async () => {
    const repository = createRepository({
      'UNIT.VOUD': createFile('UNIT.VOUD', {
        pages: [
          { sections: [{ elements: [{ id: 'VAR_ON_PAGE_1' }] }] },
          { sections: [{ elements: [{ id: 'VAR_WITH_OVERRIDE' }] }] },
          { sections: [{ elements: [{ id: 'VAR_WITHOUT_OVERRIDE' }] }] }
        ]
      }),
      'UNIT.VOCS': createFile('UNIT.VOCS', {
        variableCodings: [
          { id: 'VAR_WITH_OVERRIDE', page: '1' }
        ]
      })
    });
    const service = new CodingFileCacheService(repository);

    const pageMap = await service.loadVoudData('UNIT', 1);

    expect(pageMap.get('VAR_WITH_OVERRIDE')).toBe('0');
    expect(pageMap.get('VAR_WITHOUT_OVERRIDE')).toBe('2');
  });

  it('resolves a single-page unit variable to Verona page 0', async () => {
    const repository = createRepository({
      'UNIT.VOUD': createFile('UNIT.VOUD', {
        pages: [
          { sections: [{ elements: [{ id: 'VAR_ON_ONLY_PAGE' }] }] }
        ]
      }),
      'UNIT.VOCS': createFile('UNIT.VOCS', {
        variableCodings: [
          { id: 'VAR_ON_ONLY_PAGE', page: '1' }
        ]
      })
    });
    const service = new CodingFileCacheService(repository);

    const pageMap = await service.loadVoudData('UNIT', 1);

    expect(pageMap.get('VAR_ON_ONLY_PAGE')).toBe('0');
  });

  it('maps coding scheme pages from 1-based Studio pages to 0-based Verona pages', async () => {
    const repository = createRepository({
      'UNIT.VOCS': createFile('UNIT.VOCS', {
        variableCodings: [
          { id: 'VAR_PAGE_1', page: '1' },
          { id: 'VAR_PAGE_2', page: '2' },
          { id: 'VAR_PAGE_3', page: '3' },
          { id: 'VAR_PAGE_10', page: '10' }
        ]
      })
    });
    const service = new CodingFileCacheService(repository);

    const pageMap = await service.loadVoudData('UNIT', 1);

    expect(pageMap.get('VAR_PAGE_1')).toBe('0');
    expect(pageMap.get('VAR_PAGE_2')).toBe('1');
    expect(pageMap.get('VAR_PAGE_3')).toBe('2');
    expect(pageMap.get('VAR_PAGE_10')).toBe('9');
  });

  it('applies VOCS page overrides to both variable id and alias', async () => {
    const repository = createRepository({
      'UNIT.VOCS': createFile('UNIT.VOCS', {
        variableCodings: [
          { id: 'INTERNAL_VAR', alias: 'VAR_ALIAS', page: '2' }
        ]
      })
    });
    const service = new CodingFileCacheService(repository);

    const pageMap = await service.loadVoudData('UNIT', 1);

    expect(pageMap.get('INTERNAL_VAR')).toBe('1');
    expect(pageMap.get('VAR_ALIAS')).toBe('1');
  });

  it('prefers VOCS aliases over colliding variable ids for replay pages', async () => {
    const repository = createRepository({
      'UNIT.VOCS': createFile('UNIT.VOCS', {
        variableCodings: [
          { id: '08', alias: '09', page: '10' },
          { id: '09', alias: '10', page: '11' }
        ]
      })
    });
    const service = new CodingFileCacheService(repository);

    const pageMap = await service.loadVoudData('UNIT', 1);

    expect(pageMap.get('08')).toBe('9');
    expect(pageMap.get('09')).toBe('9');
    expect(pageMap.get('10')).toBe('10');
  });

  it('parses VOCS page overrides from already structured file data', async () => {
    const repository = createRepository({
      'UNIT.VOCS': {
        file_id: 'UNIT.VOCS',
        file_type: 'Resource',
        workspace_id: 1,
        data: {
          variableCodings: [
            { id: 'STRUCTURED_VAR', page: '3' }
          ]
        } as unknown as string
      }
    });
    const service = new CodingFileCacheService(repository);

    const pageMap = await service.loadVoudData('UNIT', 1);

    expect(pageMap.get('STRUCTURED_VAR')).toBe('2');
  });

  it('ignores empty and invalid VOCS pages and keeps VOUD fallback pages', async () => {
    const repository = createRepository({
      'UNIT.VOUD': createFile('UNIT.VOUD', {
        pages: [
          { sections: [{ elements: [{ id: 'EMPTY_PAGE' }] }] },
          { sections: [{ elements: [{ id: 'INVALID_PAGE' }] }] }
        ]
      }),
      'UNIT.VOCS': createFile('UNIT.VOCS', {
        variableCodings: [
          { id: 'EMPTY_PAGE', page: '' },
          { id: 'INVALID_PAGE', page: 'abc' }
        ]
      })
    });
    const service = new CodingFileCacheService(repository);

    const pageMap = await service.loadVoudData('UNIT', 1);

    expect(pageMap.get('EMPTY_PAGE')).toBe('0');
    expect(pageMap.get('INVALID_PAGE')).toBe('1');
  });

  it('uses scroll page indexes for automatic VOUD pages after a regular stimulus page', async () => {
    const repository = createRepository({
      'UNIT.VOUD': createFile('UNIT.VOUD', {
        pages: [
          { sections: [{ elements: [{ id: 'STIMULUS_TEXT' }] }] },
          { sections: [{ elements: [{ id: 'VAR_AFTER_STIMULUS' }] }] }
        ]
      })
    });
    const service = new CodingFileCacheService(repository);

    const pageMap = await service.loadVoudData('UNIT', 1);

    expect(pageMap.get('STIMULUS_TEXT')).toBe('0');
    expect(pageMap.get('VAR_AFTER_STIMULUS')).toBe('1');
  });

  it('skips always-visible pages when building automatic VOUD pages', async () => {
    const repository = createRepository({
      'UNIT.VOUD': createFile('UNIT.VOUD', {
        pages: [
          {
            alwaysVisible: true,
            sections: [{ elements: [{ id: 'ALWAYS_VISIBLE_STIMULUS' }] }]
          },
          { sections: [{ elements: [{ id: 'FIRST_SCROLL_PAGE_VAR' }] }] },
          { sections: [{ elements: [{ id: 'SECOND_SCROLL_PAGE_VAR' }] }] }
        ]
      })
    });
    const service = new CodingFileCacheService(repository);

    const pageMap = await service.loadVoudData('UNIT', 1);

    expect(pageMap.get('ALWAYS_VISIBLE_STIMULUS')).toBeUndefined();
    expect(pageMap.get('FIRST_SCROLL_PAGE_VAR')).toBe('0');
    expect(pageMap.get('SECOND_SCROLL_PAGE_VAR')).toBe('1');
  });

  it('recognizes aliases when building automatic VOUD pages', async () => {
    const repository = createRepository({
      'UNIT.VOUD': createFile('UNIT.VOUD', {
        pages: [
          {
            sections: [
              { elements: [{ id: 'TEXT_FIELD_1', alias: 'VAR_ALIAS' }] }
            ]
          }
        ]
      })
    });
    const service = new CodingFileCacheService(repository);

    const pageMap = await service.loadVoudData('UNIT', 1);

    expect(pageMap.get('TEXT_FIELD_1')).toBe('0');
    expect(pageMap.get('VAR_ALIAS')).toBe('0');
  });
});
