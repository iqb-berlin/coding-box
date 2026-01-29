import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkspaceTestFilesValidationService } from './workspace-test-files-validation.service';
import FileUpload from '../../entities/file_upload.entity';
import Persons from '../../entities/persons.entity';
import { WorkspaceXmlSchemaValidationService } from '../workspace/workspace-xml-schema-validation.service';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';

describe('WorkspaceTestFilesValidationService', () => {
  let service: WorkspaceTestFilesValidationService;
  let fileUploadRepository: Partial<Record<keyof Repository<FileUpload>, jest.Mock>>;

  beforeEach(async () => {
    fileUploadRepository = {
      find: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([])
      })
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceTestFilesValidationService,
        {
          provide: getRepositoryToken(FileUpload),
          useValue: fileUploadRepository
        },
        {
          provide: getRepositoryToken(Persons),
          useValue: {
            find: jest.fn().mockResolvedValue([])
          }
        },
        {
          provide: WorkspaceXmlSchemaValidationService,
          useValue: {
            validateAllXmlSchemas: jest.fn().mockResolvedValue(new Map())
          }
        },
        {
          provide: WorkspaceCoreService,
          useValue: {
            getIgnoredUnits: jest.fn().mockResolvedValue([])
          }
        }
      ]
    }).compile();

    service = module.get<WorkspaceTestFilesValidationService>(WorkspaceTestFilesValidationService);
  });

  it('should treat missing IQB-SCHEMER-1.1 as present (with warning) if IQB-SCHEMER-2.5 exists', async () => {
    const workspaceId = 1;

    // Mock data
    const unitContent = `
      <Unit>
        <Metadata><Id>UNIT1</Id></Metadata>
        <CodingSchemeRef schemer="IQB-SCHEMER-1.1"/>
      </Unit>
    `;

    const testTakerContent = `
      <TestTakers>
        <Group id="G1">
          <Login mode="run-hot-return" name="user1">
             <Booklet>BOOKLET1</Booklet>
          </Login>
        </Group>
      </TestTakers>
    `;

    const bookletContent = `
      <Booklet>
         <Units>
           <Unit id="UNIT1" />
         </Units>
      </Booklet>
    `;

    const mockBooklets = [{ file_id: 'BOOKLET1', data: bookletContent, file_type: 'Booklet' }];
    const mockUnits = [{ file_id: 'UNIT1', data: unitContent, file_type: 'Unit' }];
    const mockSchemers = [{
      file_id: 'IQB-SCHEMER-2.5.HTML', filename: 'IQB-SCHEMER-2.5.HTML', data: '{}', file_type: 'Schemer'
    }];
    const mockTestTakers = [{ file_id: 'TESTTAKER1', data: testTakerContent, file_type: 'TestTakers' }];
    const mockAllFiles = [...mockBooklets, ...mockUnits, ...mockSchemers, ...mockTestTakers].map((f, i) => ({ ...f, id: i + 1 }));

    // Helper to return data based on file_type in arguments
    fileUploadRepository.find.mockImplementation(args => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where = args.where as any;
      if (where.file_type === 'Booklet') {
        // simulate pagination: return empty if skipping
        if (args.skip > 0) return Promise.resolve([]);
        return Promise.resolve(mockBooklets);
      }
      if (where.file_type === 'Unit') {
        if (args.skip > 0) return Promise.resolve([]);
        return Promise.resolve(mockUnits);
      }
      if (where.file_type === 'Schemer') {
        // validateAllCodingSchemes doesn't paginate
        return Promise.resolve(mockSchemers);
      }
      // eslint-disable-next-line no-underscore-dangle
      if (where.file_type && (Array.isArray(where.file_type) || where.file_type._type === 'in')) { // TestTakers uses In(...)
        // TypeORM 'In' operator check might involve looking at object structure or if it's just 'TestTakers'
        // The service code: file_type: In(['TestTakers', 'Testtakers'])
        if (args.skip > 0) return Promise.resolve([]);
        return Promise.resolve(mockTestTakers);
      }
      // getUnusedTestFilesFromValidationGraph just checks where workspace_id, no file_type (or selects all?)
      // find({ where: { workspace_id: 1 }, select: [...] })
      if (!where.file_type) {
        return Promise.resolve(mockAllFiles);
      }

      return Promise.resolve([]);
    });

    // getAllResourceIds using QueryBuilder
    const qbMock = fileUploadRepository.createQueryBuilder();
    qbMock.getRawMany
      .mockResolvedValueOnce([{ file_id: 'IQB-SCHEMER-2.5.HTML', filename: 'IQB-SCHEMER-2.5.HTML' }])
      .mockResolvedValueOnce([]); // end loop

    // Execute
    const result = await service.validateTestFiles(workspaceId);

    // Verification
    const files = result.validationResults[0].schemer.files || [];
    const schemerFileEntry = files.find(f => f.filename === 'IQB-SCHEMER-1.1');

    expect(schemerFileEntry).toBeDefined();
    expect(schemerFileEntry?.exists).toBe(true);
    expect(schemerFileEntry?.schemaErrors).toEqual(expect.arrayContaining([
      expect.stringContaining('IQB-SCHEMER-1.1 ist veraltet')
    ]));
  });
});
