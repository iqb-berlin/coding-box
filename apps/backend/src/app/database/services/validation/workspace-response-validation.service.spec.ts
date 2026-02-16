import { Repository, DeleteResult } from 'typeorm';
import { WorkspaceResponseValidationService } from './workspace-response-validation.service';
import FileUpload from '../../entities/file_upload.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { Unit } from '../../entities/unit.entity';
import Persons from '../../entities/persons.entity';
import { Booklet } from '../../entities/booklet.entity';

describe('WorkspaceResponseValidationService.validateVariables', () => {
  const makeUnitXml = (
    unitId: string,
    variables: Array<{ id?: string; alias?: string; type?: string }>
  ): Buffer => {
    const variablesXml = variables
      .map(v => {
        const attrs = [
          v.id ? `id="${v.id}"` : '',
          v.alias ? `alias="${v.alias}"` : '',
          `type="${v.type || 'string'}"`
        ]
          .filter(Boolean)
          .join(' ');
        return `<Variable ${attrs} />`;
      })
      .join('');

    return Buffer.from(
      '<?xml version="1.0" encoding="utf-8"?>' +
        '<Unit>' +
        `<Metadata><Id>${unitId}</Id></Metadata>` +
        `<BaseVariables>${variablesXml}</BaseVariables>` +
        '</Unit>'
    );
  };

  const makeQueryBuilder = (units: Unit[]) => ({
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(units)
  });

  it('accepts response variableid matching variable alias in unit xml', async () => {
    const filesRepository = {
      find: jest.fn().mockResolvedValue([
        {
          data: makeUnitXml('UNIT1', [
            { id: 'V1', alias: 'A1', type: 'string' }
          ])
        } as unknown as FileUpload
      ])
    } as unknown as Repository<FileUpload>;

    const personsRepository = {
      find: jest
        .fn()
        .mockResolvedValue([{ id: 1, workspace_id: 1, consider: true }])
    } as unknown as Repository<Persons>;

    const unitRepository = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValue(
          makeQueryBuilder([{ id: 10, name: 'UNIT1' } as unknown as Unit])
        )
    } as unknown as Repository<Unit>;

    const responseRepository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 100,
          unitid: 10,
          variableid: 'A1',
          value: 'x',
          unit: {
            id: 10,
            name: 'UNIT1'
          } as unknown as Unit
        } as unknown as ResponseEntity
      ])
    } as unknown as Repository<ResponseEntity>;

    const service = new WorkspaceResponseValidationService(
      responseRepository,
      unitRepository,
      personsRepository,
      {} as unknown as Repository<Booklet>,
      filesRepository
    );

    const result = await service.validateVariables(1, 1, 10);
    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
  });

  it('accepts response variableid matching variable id when alias does not match', async () => {
    const filesRepository = {
      find: jest.fn().mockResolvedValue([
        {
          data: makeUnitXml('UNIT1', [
            { id: 'V1', alias: 'A1', type: 'string' }
          ])
        } as unknown as FileUpload
      ])
    } as unknown as Repository<FileUpload>;

    const personsRepository = {
      find: jest
        .fn()
        .mockResolvedValue([{ id: 1, workspace_id: 1, consider: true }])
    } as unknown as Repository<Persons>;

    const unitRepository = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValue(
          makeQueryBuilder([{ id: 10, name: 'UNIT1' } as unknown as Unit])
        )
    } as unknown as Repository<Unit>;

    const responseRepository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 100,
          unitid: 10,
          variableid: 'V1',
          value: 'x',
          unit: {
            id: 10,
            name: 'UNIT1'
          } as unknown as Unit
        } as unknown as ResponseEntity
      ])
    } as unknown as Repository<ResponseEntity>;

    const service = new WorkspaceResponseValidationService(
      responseRepository,
      unitRepository,
      personsRepository,
      {} as unknown as Repository<Booklet>,
      filesRepository
    );

    const result = await service.validateVariables(1, 1, 10);
    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
  });

  it('flags response as invalid when variable is neither alias nor id in unit xml', async () => {
    const filesRepository = {
      find: jest.fn().mockResolvedValue([
        {
          data: makeUnitXml('UNIT1', [
            { id: 'V1', alias: 'A1', type: 'string' }
          ])
        } as unknown as FileUpload
      ])
    } as unknown as Repository<FileUpload>;

    const personsRepository = {
      find: jest
        .fn()
        .mockResolvedValue([{ id: 1, workspace_id: 1, consider: true }])
    } as unknown as Repository<Persons>;

    const unitRepository = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValue(
          makeQueryBuilder([{ id: 10, name: 'UNIT1' } as unknown as Unit])
        )
    } as unknown as Repository<Unit>;

    const responseRepository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 100,
          unitid: 10,
          variableid: 'UNKNOWN',
          value: 'x',
          unit: {
            id: 10,
            name: 'UNIT1'
          } as unknown as Unit
        } as unknown as ResponseEntity
      ])
    } as unknown as Repository<ResponseEntity>;

    const service = new WorkspaceResponseValidationService(
      responseRepository,
      unitRepository,
      personsRepository,
      {} as unknown as Repository<Booklet>,
      filesRepository
    );

    const result = await service.validateVariables(1, 1, 10);
    expect(result.total).toBe(1);
    expect(result.data[0]).toMatchObject({
      fileName: 'UNIT1',
      variableId: 'UNKNOWN',
      responseId: 100,
      errorReason: 'Variable not defined in unit'
    });
  });

  it('accepts response variableid matching alias for a no-value variable', async () => {
    const filesRepository = {
      find: jest.fn().mockResolvedValue([
        {
          data: makeUnitXml('UNIT1', [
            { id: 'V1', alias: 'A1', type: 'no-value' }
          ])
        } as unknown as FileUpload
      ])
    } as unknown as Repository<FileUpload>;

    const personsRepository = {
      find: jest
        .fn()
        .mockResolvedValue([{ id: 1, workspace_id: 1, consider: true }])
    } as unknown as Repository<Persons>;

    const unitRepository = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValue(
          makeQueryBuilder([{ id: 10, name: 'UNIT1' } as unknown as Unit])
        )
    } as unknown as Repository<Unit>;

    const responseRepository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 100,
          unitid: 10,
          variableid: 'A1',
          value: 'x',
          unit: {
            id: 10,
            name: 'UNIT1'
          } as unknown as Unit
        } as unknown as ResponseEntity
      ])
    } as unknown as Repository<ResponseEntity>;

    const service = new WorkspaceResponseValidationService(
      responseRepository,
      unitRepository,
      personsRepository,
      {} as unknown as Repository<Booklet>,
      filesRepository
    );

    const result = await service.validateVariables(1, 1, 10);
    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
  });
});

describe('WorkspaceResponseValidationService.validateVariableTypes', () => {
  it('accepts valid string value', async () => {
    const makeUnitXml = (
      unitId: string,
      variables: Array<{ alias: string; type: string }>
    ): Buffer => {
      const vars = variables
        .map(v => `<Variable alias="${v.alias}" type="${v.type}"/>`)
        .join('');
      return Buffer.from(
        `<Unit><Metadata><Id>${unitId}</Id></Metadata><BaseVariables>${vars}</BaseVariables></Unit>`
      );
    };

    const filesRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          { data: makeUnitXml('U1', [{ alias: 'A1', type: 'string' }]) }
        ])
    } as unknown as Repository<FileUpload>;
    const personsRepo = {
      find: jest
        .fn()
        .mockResolvedValue([{ id: 1, workspace_id: 1, consider: true }])
    } as unknown as Repository<Persons>;
    const unitRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ id: 10, name: 'U1' }])
      })
    } as unknown as Repository<Unit>;
    const responseRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          {
            id: 100,
            unitid: 10,
            variableid: 'A1',
            value: 'test',
            unit: { id: 10, name: 'U1' }
          }
        ])
    } as unknown as Repository<ResponseEntity>;

    const service = new WorkspaceResponseValidationService(
      responseRepo,
      unitRepo,
      personsRepo,
      {} as Repository<Booklet>,
      filesRepo
    );
    const result = await service.validateVariableTypes(1, 1, 10);
    expect(result.total).toBe(0);
  });

  it('flags invalid integer value', async () => {
    const makeUnitXml = (
      unitId: string,
      variables: Array<{ alias: string; type: string }>
    ): Buffer => {
      const vars = variables
        .map(v => `<Variable alias="${v.alias}" type="${v.type}"/>`)
        .join('');
      return Buffer.from(
        `<Unit><Metadata><Id>${unitId}</Id></Metadata><BaseVariables>${vars}</BaseVariables></Unit>`
      );
    };

    const filesRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          { data: makeUnitXml('U1', [{ alias: 'A1', type: 'integer' }]) }
        ])
    } as unknown as Repository<FileUpload>;
    const personsRepo = {
      find: jest
        .fn()
        .mockResolvedValue([{ id: 1, workspace_id: 1, consider: true }])
    } as unknown as Repository<Persons>;
    const unitRepo = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValue({
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([{ id: 10, name: 'U1' }])
        })
    } as unknown as Repository<Unit>;
    const responseRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          {
            id: 100,
            unitid: 10,
            variableid: 'A1',
            value: 'abc',
            unit: { id: 10, name: 'U1' }
          }
        ])
    } as unknown as Repository<ResponseEntity>;

    const service = new WorkspaceResponseValidationService(
      responseRepo,
      unitRepo,
      personsRepo,
      {} as Repository<Booklet>,
      filesRepo
    );
    const result = await service.validateVariableTypes(1, 1, 10);
    expect(result.total).toBe(1);
    expect(result.data[0].errorReason).toContain('integer');
  });

  it('accepts valid boolean value', async () => {
    const makeUnitXml = (
      unitId: string,
      variables: Array<{ alias: string; type: string }>
    ): Buffer => {
      const vars = variables
        .map(v => `<Variable alias="${v.alias}" type="${v.type}"/>`)
        .join('');
      return Buffer.from(
        `<Unit><Metadata><Id>${unitId}</Id></Metadata><BaseVariables>${vars}</BaseVariables></Unit>`
      );
    };

    const filesRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          { data: makeUnitXml('U1', [{ alias: 'A1', type: 'boolean' }]) }
        ])
    } as unknown as Repository<FileUpload>;
    const personsRepo = {
      find: jest
        .fn()
        .mockResolvedValue([{ id: 1, workspace_id: 1, consider: true }])
    } as unknown as Repository<Persons>;
    const unitRepo = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValue({
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([{ id: 10, name: 'U1' }])
        })
    } as unknown as Repository<Unit>;
    const responseRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          {
            id: 100,
            unitid: 10,
            variableid: 'A1',
            value: 'true',
            unit: { id: 10, name: 'U1' }
          }
        ])
    } as unknown as Repository<ResponseEntity>;

    const service = new WorkspaceResponseValidationService(
      responseRepo,
      unitRepo,
      personsRepo,
      {} as Repository<Booklet>,
      filesRepo
    );
    const result = await service.validateVariableTypes(1, 1, 10);
    expect(result.total).toBe(0);
  });

  it('flags value not matching multiple array type', async () => {
    const makeUnitXml = (
      unitId: string,
      variables: Array<{ alias: string; type: string; multiple?: boolean }>
    ): Buffer => {
      const vars = variables
        .map(
          v => `<Variable alias="${v.alias}" type="${v.type}" multiple="${v.multiple}"/>`
        )
        .join('');
      return Buffer.from(
        `<Unit><Metadata><Id>${unitId}</Id></Metadata><BaseVariables>${vars}</BaseVariables></Unit>`
      );
    };

    const filesRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          {
            data: makeUnitXml('U1', [
              { alias: 'A1', type: 'string', multiple: true }
            ])
          }
        ])
    } as unknown as Repository<FileUpload>;
    const personsRepo = {
      find: jest
        .fn()
        .mockResolvedValue([{ id: 1, workspace_id: 1, consider: true }])
    } as unknown as Repository<Persons>;
    const unitRepo = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValue({
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([{ id: 10, name: 'U1' }])
        })
    } as unknown as Repository<Unit>;
    const responseRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          {
            id: 100,
            unitid: 10,
            variableid: 'A1',
            value: 'not-json',
            unit: { id: 10, name: 'U1' }
          }
        ])
    } as unknown as Repository<ResponseEntity>;

    const service = new WorkspaceResponseValidationService(
      responseRepo,
      unitRepo,
      personsRepo,
      {} as Repository<Booklet>,
      filesRepo
    );
    const result = await service.validateVariableTypes(1, 1, 10);
    expect(result.total).toBe(1);
    expect(result.data[0].errorReason).toContain('array');
  });
});

describe('WorkspaceResponseValidationService.validateDuplicateResponses', () => {
  it('returns empty result when no duplicates exist', async () => {
    const personsRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          {
            id: 1, workspace_id: 1, consider: true, login: 'user1'
          }
        ])
    } as unknown as Repository<Persons>;
    const bookletRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          { id: 20, personid: 1, bookletinfo: { name: 'B1' } }
        ])
    } as unknown as Repository<Booklet>;
    const unitRepo = {
      find: jest.fn().mockResolvedValue([{ id: 10, name: 'U1', bookletid: 20 }])
    } as unknown as Repository<Unit>;
    const responseRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          {
            id: 100, unitid: 10, variableid: 'A1', value: 'x'
          }
        ])
    } as unknown as Repository<ResponseEntity>;

    const service = new WorkspaceResponseValidationService(
      responseRepo,
      unitRepo,
      personsRepo,
      bookletRepo,
      {} as Repository<FileUpload>
    );
    const result = await service.validateDuplicateResponses(1, 1, 10);
    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
  });

  it('detects duplicate responses for same unit and variable', async () => {
    const personsRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          {
            id: 1, workspace_id: 1, consider: true, login: 'user1'
          }
        ])
    } as unknown as Repository<Persons>;
    const bookletRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          { id: 20, personid: 1, bookletinfo: { name: 'B1' } }
        ])
    } as unknown as Repository<Booklet>;
    const unitRepo = {
      find: jest.fn().mockResolvedValue([{ id: 10, name: 'U1', bookletid: 20 }])
    } as unknown as Repository<Unit>;
    const responseRepo = {
      find: jest.fn().mockResolvedValue([
        {
          id: 100, unitid: 10, variableid: 'A1', value: 'x', status: 1
        },
        {
          id: 101, unitid: 10, variableid: 'A1', value: 'y', status: 2
        }
      ])
    } as unknown as Repository<ResponseEntity>;

    const service = new WorkspaceResponseValidationService(
      responseRepo,
      unitRepo,
      personsRepo,
      bookletRepo,
      {} as Repository<FileUpload>
    );
    const result = await service.validateDuplicateResponses(1, 1, 10);
    expect(result.total).toBe(1);
    expect(result.data[0].duplicates.length).toBe(2);
  });

  it('returns empty result when workspaceId is not provided', async () => {
    const service = new WorkspaceResponseValidationService(
      {} as Repository<ResponseEntity>,
      {} as Repository<Unit>,
      {} as Repository<Persons>,
      {} as Repository<Booklet>,
      {} as Repository<FileUpload>
    );
    const result = await service.validateDuplicateResponses(
      0 as unknown as number,
      1,
      10
    );
    expect(result.total).toBe(0);
  });
});

describe('WorkspaceResponseValidationService.validateResponseStatus', () => {
  const makeQueryBuilder = (units: Unit[]) => ({
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(units)
  });

  it('accepts valid response status', async () => {
    const personsRepo = {
      find: jest
        .fn()
        .mockResolvedValue([{ id: 1, workspace_id: 1, consider: true }])
    } as unknown as Repository<Persons>;
    const unitRepo = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValue(
          makeQueryBuilder([{ id: 10, name: 'U1' } as unknown as Unit])
        )
    } as unknown as Repository<Unit>;
    const responseRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          {
            id: 100,
            unitid: 10,
            variableid: 'A1',
            value: 'x',
            status: 1,
            unit: { id: 10, name: 'U1' }
          }
        ])
    } as unknown as Repository<ResponseEntity>;

    const service = new WorkspaceResponseValidationService(
      responseRepo,
      unitRepo,
      personsRepo,
      {} as Repository<Booklet>,
      {} as Repository<FileUpload>
    );
    const result = await service.validateResponseStatus(1, 1, 10);
    expect(result.total).toBe(0);
  });

  it('flags invalid response status', async () => {
    const personsRepo = {
      find: jest
        .fn()
        .mockResolvedValue([{ id: 1, workspace_id: 1, consider: true }])
    } as unknown as Repository<Persons>;
    const unitRepo = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValue(
          makeQueryBuilder([{ id: 10, name: 'U1' } as unknown as Unit])
        )
    } as unknown as Repository<Unit>;
    const responseRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          {
            id: 100,
            unitid: 10,
            variableid: 'A1',
            value: 'x',
            status: 999,
            unit: { id: 10, name: 'U1' }
          }
        ])
    } as unknown as Repository<ResponseEntity>;

    const service = new WorkspaceResponseValidationService(
      responseRepo,
      unitRepo,
      personsRepo,
      {} as Repository<Booklet>,
      {} as Repository<FileUpload>
    );
    const result = await service.validateResponseStatus(1, 1, 10);
    expect(result.total).toBe(1);
    expect(result.data[0].errorReason).toContain('Invalid response status');
  });

  it('returns empty result when workspaceId is not provided', async () => {
    const service = new WorkspaceResponseValidationService(
      {} as Repository<ResponseEntity>,
      {} as Repository<Unit>,
      {} as Repository<Persons>,
      {} as Repository<Booklet>,
      {} as Repository<FileUpload>
    );
    const result = await service.validateResponseStatus(
      0 as unknown as number,
      1,
      10
    );
    expect(result.total).toBe(0);
  });
});

describe('WorkspaceResponseValidationService.deleteInvalidResponses', () => {
  const makeQueryBuilder = (units: Unit[]) => ({
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(units)
  });

  it('deletes specified response IDs', async () => {
    const personsRepo = {
      find: jest
        .fn()
        .mockResolvedValue([{ id: 1, workspace_id: 1, consider: true }])
    } as unknown as Repository<Persons>;
    const unitRepo = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValue(
          makeQueryBuilder([{ id: 10, name: 'U1' } as unknown as Unit])
        )
    } as unknown as Repository<Unit>;
    const responseRepo = {
      delete: jest.fn().mockResolvedValue({ affected: 1 } as DeleteResult)
    } as unknown as Repository<ResponseEntity>;

    const service = new WorkspaceResponseValidationService(
      responseRepo,
      unitRepo,
      personsRepo,
      {} as Repository<Booklet>,
      {} as Repository<FileUpload>
    );
    const result = await service.deleteInvalidResponses(1, [100]);
    expect(result).toBe(1);
    expect(responseRepo.delete).toHaveBeenCalled();
  });

  it('returns 0 when no response IDs provided', async () => {
    const service = new WorkspaceResponseValidationService(
      {} as Repository<ResponseEntity>,
      {} as Repository<Unit>,
      {} as Repository<Persons>,
      {} as Repository<Booklet>,
      {} as Repository<FileUpload>
    );
    const result = await service.deleteInvalidResponses(1, []);
    expect(result).toBe(0);
  });

  it('returns 0 when workspaceId is not provided', async () => {
    const service = new WorkspaceResponseValidationService(
      {} as Repository<ResponseEntity>,
      {} as Repository<Unit>,
      {} as Repository<Persons>,
      {} as Repository<Booklet>,
      {} as Repository<FileUpload>
    );
    const result = await service.deleteInvalidResponses(
      0 as unknown as number,
      [100]
    );
    expect(result).toBe(0);
  });
});

describe('WorkspaceResponseValidationService.deleteAllInvalidResponses', () => {
  const makeUnitXml = (
    unitId: string,
    variables: Array<{ alias: string; type: string }>
  ): Buffer => {
    const vars = variables
      .map(v => `<Variable alias="${v.alias}" type="${v.type}"/>`)
      .join('');
    return Buffer.from(
      `<Unit><Metadata><Id>${unitId}</Id></Metadata><BaseVariables>${vars}</BaseVariables></Unit>`
    );
  };

  const makeQueryBuilder = (units: Unit[]) => ({
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(units)
  });

  it('deletes invalid variable responses', async () => {
    const filesRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          { data: makeUnitXml('U1', [{ alias: 'A1', type: 'string' }]) }
        ])
    } as unknown as Repository<FileUpload>;
    const personsRepo = {
      find: jest
        .fn()
        .mockResolvedValue([{ id: 1, workspace_id: 1, consider: true }])
    } as unknown as Repository<Persons>;
    const unitRepo = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValue(
          makeQueryBuilder([{ id: 10, name: 'U1' } as unknown as Unit])
        )
    } as unknown as Repository<Unit>;
    const responseRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          {
            id: 100,
            unitid: 10,
            variableid: 'UNKNOWN',
            value: 'x',
            unit: { id: 10, name: 'U1' }
          }
        ]),
      delete: jest.fn().mockResolvedValue({ affected: 1 } as DeleteResult)
    } as unknown as Repository<ResponseEntity>;

    const service = new WorkspaceResponseValidationService(
      responseRepo,
      unitRepo,
      personsRepo,
      {} as Repository<Booklet>,
      filesRepo
    );
    const result = await service.deleteAllInvalidResponses(1, 'variables');
    expect(result).toBe(1);
  });

  it('deletes duplicate responses keeping first', async () => {
    const personsRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          {
            id: 1, workspace_id: 1, consider: true, login: 'user1'
          }
        ])
    } as unknown as Repository<Persons>;
    const bookletRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          { id: 20, personid: 1, bookletinfo: { name: 'B1' } }
        ])
    } as unknown as Repository<Booklet>;
    const unitRepo = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValue(
          makeQueryBuilder([
            { id: 10, name: 'U1', bookletid: 20 } as unknown as Unit
          ])
        ),
      find: jest.fn().mockResolvedValue([{ id: 10, name: 'U1', bookletid: 20 }])
    } as unknown as Repository<Unit>;
    const responseRepo = {
      find: jest.fn().mockResolvedValue([
        {
          id: 100, unitid: 10, variableid: 'A1', value: 'x', status: 1
        },
        {
          id: 101, unitid: 10, variableid: 'A1', value: 'y', status: 1
        }
      ]),
      delete: jest.fn().mockResolvedValue({ affected: 1 } as DeleteResult)
    } as unknown as Repository<ResponseEntity>;

    const service = new WorkspaceResponseValidationService(
      responseRepo,
      unitRepo,
      personsRepo,
      bookletRepo,
      {} as Repository<FileUpload>
    );
    const result = await service.deleteAllInvalidResponses(
      1,
      'duplicateResponses'
    );
    expect(result).toBe(1);
  });

  it('returns 0 when workspaceId is not provided', async () => {
    const service = new WorkspaceResponseValidationService(
      {} as Repository<ResponseEntity>,
      {} as Repository<Unit>,
      {} as Repository<Persons>,
      {} as Repository<Booklet>,
      {} as Repository<FileUpload>
    );
    const result = await service.deleteAllInvalidResponses(
      0 as unknown as number,
      'variables'
    );
    expect(result).toBe(0);
  });
});
