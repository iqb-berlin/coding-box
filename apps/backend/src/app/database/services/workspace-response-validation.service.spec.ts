import { Repository } from 'typeorm';
import { WorkspaceResponseValidationService } from './workspace-response-validation.service';
import FileUpload from '../entities/file_upload.entity';
import { ResponseEntity } from '../entities/response.entity';
import { Unit } from '../entities/unit.entity';
import Persons from '../entities/persons.entity';
import { Booklet } from '../entities/booklet.entity';

describe('WorkspaceResponseValidationService.validateVariables', () => {
  const makeUnitXml = (unitId: string, variables: Array<{ id?: string; alias?: string; type?: string }>): Buffer => {
    const variablesXml = variables.map(v => {
      const attrs = [
        v.id ? `id="${v.id}"` : '',
        v.alias ? `alias="${v.alias}"` : '',
        `type="${v.type || 'string'}"`
      ].filter(Boolean).join(' ');
      return `<Variable ${attrs} />`;
    }).join('');

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
        { data: makeUnitXml('UNIT1', [{ id: 'V1', alias: 'A1', type: 'string' }]) } as unknown as FileUpload
      ])
    } as unknown as Repository<FileUpload>;

    const personsRepository = {
      find: jest.fn().mockResolvedValue([{ id: 1, workspace_id: 1, consider: true }])
    } as unknown as Repository<Persons>;

    const unitRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder([
        { id: 10, name: 'UNIT1' } as unknown as Unit
      ]))
    } as unknown as Repository<Unit>;

    const responseRepository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 100,
          unitid: 10,
          variableid: 'A1',
          value: 'x',
          unit: { id: 10, name: 'UNIT1' } as unknown as Unit
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
        { data: makeUnitXml('UNIT1', [{ id: 'V1', alias: 'A1', type: 'string' }]) } as unknown as FileUpload
      ])
    } as unknown as Repository<FileUpload>;

    const personsRepository = {
      find: jest.fn().mockResolvedValue([{ id: 1, workspace_id: 1, consider: true }])
    } as unknown as Repository<Persons>;

    const unitRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder([
        { id: 10, name: 'UNIT1' } as unknown as Unit
      ]))
    } as unknown as Repository<Unit>;

    const responseRepository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 100,
          unitid: 10,
          variableid: 'V1',
          value: 'x',
          unit: { id: 10, name: 'UNIT1' } as unknown as Unit
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
        { data: makeUnitXml('UNIT1', [{ id: 'V1', alias: 'A1', type: 'string' }]) } as unknown as FileUpload
      ])
    } as unknown as Repository<FileUpload>;

    const personsRepository = {
      find: jest.fn().mockResolvedValue([{ id: 1, workspace_id: 1, consider: true }])
    } as unknown as Repository<Persons>;

    const unitRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder([
        { id: 10, name: 'UNIT1' } as unknown as Unit
      ]))
    } as unknown as Repository<Unit>;

    const responseRepository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 100,
          unitid: 10,
          variableid: 'UNKNOWN',
          value: 'x',
          unit: { id: 10, name: 'UNIT1' } as unknown as Unit
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
        { data: makeUnitXml('UNIT1', [{ id: 'V1', alias: 'A1', type: 'no-value' }]) } as unknown as FileUpload
      ])
    } as unknown as Repository<FileUpload>;

    const personsRepository = {
      find: jest.fn().mockResolvedValue([{ id: 1, workspace_id: 1, consider: true }])
    } as unknown as Repository<Persons>;

    const unitRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder([
        { id: 10, name: 'UNIT1' } as unknown as Unit
      ]))
    } as unknown as Repository<Unit>;

    const responseRepository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 100,
          unitid: 10,
          variableid: 'A1',
          value: 'x',
          unit: { id: 10, name: 'UNIT1' } as unknown as Unit
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
