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
  let fileUploadRepository: Partial<
  Record<keyof Repository<FileUpload>, jest.Mock>
  >;
  let personsRepository: { find: jest.Mock };
  let xmlSchemaValidationService: { validateAllXmlSchemas: jest.Mock };
  let workspaceCoreService: { getIgnoredUnits: jest.Mock };

  // Helper to check if a query is for TestTakers (handles both string and In() operator)
  const isTestTakersQuery = (where: unknown): boolean => {
    if (!where || typeof where !== 'object') return false;
    const w = where as { file_type?: string | object | string[] };
    if (w.file_type === 'TestTakers') return true;
    if (w.file_type === 'Testtakers') return true;
    // Handle In() operator - array with TestTakers/Testtakers
    if (Array.isArray(w.file_type)) {
      return w.file_type.some(
        (ft: string) => ft?.toLowerCase() === 'testtakers'
      );
    }
    // Handle TypeORM In() object structure
    if (typeof w.file_type === 'object' && w.file_type !== null) {
      const ftObj = w.file_type as { _type?: string; _value?: unknown };
      // eslint-disable-next-line no-underscore-dangle
      if (ftObj._type === 'in' && Array.isArray(ftObj._value)) {
        // eslint-disable-next-line no-underscore-dangle
        return ftObj._value.some(
          (v: string) => typeof v === 'string' && v.toLowerCase() === 'testtakers'
        );
      }
    }
    return false;
  };

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

    personsRepository = {
      find: jest.fn().mockResolvedValue([])
    };

    xmlSchemaValidationService = {
      validateAllXmlSchemas: jest.fn().mockResolvedValue(new Map())
    };

    workspaceCoreService = {
      getIgnoredUnits: jest.fn().mockResolvedValue([])
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
          useValue: personsRepository
        },
        {
          provide: WorkspaceXmlSchemaValidationService,
          useValue: xmlSchemaValidationService
        },
        {
          provide: WorkspaceCoreService,
          useValue: workspaceCoreService
        }
      ]
    }).compile();

    service = module.get<WorkspaceTestFilesValidationService>(
      WorkspaceTestFilesValidationService
    );
  });

  describe('XML Schema Validation', () => {
    it('should include XML schema validation results for test takers', async () => {
      const testTakerContent =
        '<TestTakers><Group id="G1"><Login mode="run-hot-return" name="user1"><Booklet>BOOKLET1</Booklet></Login></Group></TestTakers>';
      const mockTestTakers = [
        {
          id: 1,
          file_id: 'TESTTAKER1',
          data: testTakerContent,
          file_type: 'TestTakers'
        }
      ];

      fileUploadRepository.find.mockImplementation(args => {
        if (args.skip && args.skip > 0) return Promise.resolve([]);
        const where = args.where as { file_type?: string | object };
        if (where.file_type === 'Booklet') return Promise.resolve([]);
        if (isTestTakersQuery(where)) return Promise.resolve(mockTestTakers);
        if (!where.file_type) return Promise.resolve(mockTestTakers);
        return Promise.resolve([]);
      });

      xmlSchemaValidationService.validateAllXmlSchemas.mockResolvedValue(
        new Map([
          [
            'TestTakers:TESTTAKER1',
            { schemaValid: false, errors: ['Invalid XML structure'] }
          ]
        ])
      );

      const result = await service.validateTestFiles(1);

      expect(result.validationResults[0].testTakerSchemaValid).toBe(false);
      expect(result.validationResults[0].testTakerSchemaErrors).toContain(
        'Invalid XML structure'
      );
    });

    it('should include XML schema validation results for booklets and units', async () => {
      const testTakerContent =
        '<TestTakers><Group id="G1"><Login mode="run-hot-return" name="user1"><Booklet>BOOKLET1</Booklet></Login></Group></TestTakers>';
      const bookletContent =
        '<Booklet><Units><Unit id="UNIT1" /></Units></Booklet>';
      const unitContent = '<Unit><Metadata><Id>UNIT1</Id></Metadata></Unit>';
      const mockTestTakers = [
        {
          id: 1,
          file_id: 'TESTTAKER1',
          data: testTakerContent,
          file_type: 'TestTakers'
        }
      ];
      const mockBooklets = [
        { file_id: 'BOOKLET1', data: bookletContent, file_type: 'Booklet' }
      ];
      const mockUnits = [
        { file_id: 'UNIT1', data: unitContent, file_type: 'Unit' }
      ];

      fileUploadRepository.find.mockImplementation(args => {
        if (args.skip && args.skip > 0) return Promise.resolve([]);
        const where = args.where as { file_type?: string };
        if (where.file_type === 'Booklet') return Promise.resolve(mockBooklets);
        if (where.file_type === 'Unit') return Promise.resolve(mockUnits);
        if (isTestTakersQuery(where)) return Promise.resolve(mockTestTakers);
        if (!where.file_type) {
          return Promise.resolve([
            ...mockTestTakers,
            ...mockBooklets,
            ...mockUnits
          ]);
        }
        return Promise.resolve([]);
      });

      xmlSchemaValidationService.validateAllXmlSchemas.mockResolvedValue(
        new Map([
          [
            'Booklet:BOOKLET1',
            { schemaValid: false, errors: ['Missing required attribute'] }
          ],
          ['Unit:UNIT1', { schemaValid: true, errors: [] }]
        ])
      );

      const result = await service.validateTestFiles(1);

      const bookletFile = result.validationResults[0].booklets.files.find(
        f => f.filename === 'BOOKLET1'
      );
      expect(bookletFile?.schemaValid).toBe(false);
      expect(bookletFile?.schemaErrors).toContain('Missing required attribute');

      const unitFile = result.validationResults[0].units.files.find(
        f => f.filename === 'UNIT1'
      );
      expect(unitFile?.schemaValid).toBe(true);
    });
  });

  describe('File Structure Validation', () => {
    it('should detect missing booklets', async () => {
      const testTakerContent =
        '<TestTakers><Group id="G1"><Login mode="run-hot-return" name="user1"><Booklet>MISSING_BOOKLET</Booklet></Login></Group></TestTakers>';
      const mockTestTakers = [
        {
          id: 1,
          file_id: 'TESTTAKER1',
          data: testTakerContent,
          file_type: 'TestTakers'
        }
      ];

      fileUploadRepository.find.mockImplementation(args => {
        if (args.skip && args.skip > 0) return Promise.resolve([]);
        const where = args.where as { file_type?: string | object };
        if (where.file_type === 'Booklet') return Promise.resolve([]);
        if (
          where.file_type === 'TestTakers' ||
          typeof where.file_type === 'object'
        ) return Promise.resolve(mockTestTakers);
        if (!where.file_type) return Promise.resolve(mockTestTakers);
        return Promise.resolve([]);
      });

      const result = await service.validateTestFiles(1);

      expect(result.validationResults[0].booklets.complete).toBe(false);
      expect(result.validationResults[0].booklets.missing).toContain(
        'MISSING_BOOKLET'
      );
    });

    it('should detect missing units', async () => {
      const testTakerContent =
        '<TestTakers><Group id="G1"><Login mode="run-hot-return" name="user1"><Booklet>BOOKLET1</Booklet></Login></Group></TestTakers>';
      const bookletContent =
        '<Booklet><Units><Unit id="MISSING_UNIT" /></Units></Booklet>';
      const mockTestTakers = [
        {
          id: 1,
          file_id: 'TESTTAKER1',
          data: testTakerContent,
          file_type: 'TestTakers'
        }
      ];
      const mockBooklets = [
        { file_id: 'BOOKLET1', data: bookletContent, file_type: 'Booklet' }
      ];

      fileUploadRepository.find.mockImplementation(args => {
        if (args.skip && args.skip > 0) return Promise.resolve([]);
        const where = args.where as { file_type?: string };
        if (where.file_type === 'Booklet') return Promise.resolve(mockBooklets);
        if (where.file_type === 'Unit') return Promise.resolve([]);
        if (isTestTakersQuery(where)) return Promise.resolve(mockTestTakers);
        if (!where.file_type) return Promise.resolve([...mockTestTakers, ...mockBooklets]);
        return Promise.resolve([]);
      });

      const result = await service.validateTestFiles(1);

      expect(result.validationResults[0].units.missing).toContain(
        'MISSING_UNIT'
      );
      expect(result.validationResults[0].units.missingUnitsPerBooklet).toEqual(
        expect.arrayContaining([
          { booklet: 'BOOKLET1', missingUnits: ['MISSING_UNIT'] }
        ])
      );
    });

    it('should detect units without player references', async () => {
      const testTakerContent =
        '<TestTakers><Group id="G1"><Login mode="run-hot-return" name="user1"><Booklet>BOOKLET1</Booklet></Login></Group></TestTakers>';
      const bookletContent =
        '<Booklet><Units><Unit id="UNIT1" /></Units></Booklet>';
      const unitContent =
        '<Unit><Metadata><Id>UNIT1</Id></Metadata><DefinitionRef>definition.html</DefinitionRef></Unit>';
      const mockTestTakers = [
        {
          id: 1,
          file_id: 'TESTTAKER1',
          data: testTakerContent,
          file_type: 'TestTakers'
        }
      ];
      const mockBooklets = [
        { file_id: 'BOOKLET1', data: bookletContent, file_type: 'Booklet' }
      ];
      const mockUnits = [
        { file_id: 'UNIT1', data: unitContent, file_type: 'Unit' }
      ];

      fileUploadRepository.find.mockImplementation(args => {
        if (args.skip && args.skip > 0) return Promise.resolve([]);
        const where = args.where as { file_type?: string };
        if (where.file_type === 'Booklet') return Promise.resolve(mockBooklets);
        if (where.file_type === 'Unit') return Promise.resolve(mockUnits);
        if (isTestTakersQuery(where)) return Promise.resolve(mockTestTakers);
        if (!where.file_type) {
          return Promise.resolve([
            ...mockTestTakers,
            ...mockBooklets,
            ...mockUnits
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await service.validateTestFiles(1);

      expect(result.validationResults[0].units.unitsWithoutPlayer).toContain(
        'UNIT1'
      );
    });

    it('should mark ignored units appropriately', async () => {
      workspaceCoreService.getIgnoredUnits.mockResolvedValue(['UNIT1']);

      const testTakerContent =
        '<TestTakers><Group id="G1"><Login mode="run-hot-return" name="user1"><Booklet>BOOKLET1</Booklet></Login></Group></TestTakers>';
      const bookletContent =
        '<Booklet><Units><Unit id="UNIT1" /></Units></Booklet>';
      const unitContent = '<Unit><Metadata><Id>UNIT1</Id></Metadata></Unit>';
      const mockTestTakers = [
        {
          id: 1,
          file_id: 'TESTTAKER1',
          data: testTakerContent,
          file_type: 'TestTakers'
        }
      ];
      const mockBooklets = [
        { file_id: 'BOOKLET1', data: bookletContent, file_type: 'Booklet' }
      ];
      const mockUnits = [
        { file_id: 'UNIT1', data: unitContent, file_type: 'Unit' }
      ];

      fileUploadRepository.find.mockImplementation(args => {
        if (args.skip && args.skip > 0) return Promise.resolve([]);
        const where = args.where as { file_type?: string };
        if (where.file_type === 'Booklet') return Promise.resolve(mockBooklets);
        if (where.file_type === 'Unit') return Promise.resolve(mockUnits);
        if (isTestTakersQuery(where)) return Promise.resolve(mockTestTakers);
        if (!where.file_type) {
          return Promise.resolve([
            ...mockTestTakers,
            ...mockBooklets,
            ...mockUnits
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await service.validateTestFiles(1);

      const unitFile = result.validationResults[0].units.files.find(
        f => f.filename === 'UNIT1'
      );
      expect(unitFile?.ignored).toBe(true);
    });

    it('should mark complete=true when all files exist', async () => {
      const testTakerContent =
        '<TestTakers><Group id="G1"><Login mode="run-hot-return" name="user1"><Booklet>BOOKLET1</Booklet></Login></Group></TestTakers>';
      const bookletContent =
        '<Booklet><Units><Unit id="UNIT1" /></Units></Booklet>';
      const unitContent =
        '<Unit><Metadata><Id>UNIT1</Id></Metadata><DefinitionRef player="PLAYER-1.1">definition.html</DefinitionRef></Unit>';
      const mockTestTakers = [
        {
          id: 1,
          file_id: 'TESTTAKER1',
          data: testTakerContent,
          file_type: 'TestTakers'
        }
      ];
      const mockBooklets = [
        { file_id: 'BOOKLET1', data: bookletContent, file_type: 'Booklet' }
      ];
      const mockUnits = [
        { file_id: 'UNIT1', data: unitContent, file_type: 'Unit' }
      ];

      fileUploadRepository.find.mockImplementation(args => {
        if (args.skip && args.skip > 0) return Promise.resolve([]);
        const where = args.where as { file_type?: string };
        if (where.file_type === 'Booklet') return Promise.resolve(mockBooklets);
        if (where.file_type === 'Unit') return Promise.resolve(mockUnits);
        if (isTestTakersQuery(where)) return Promise.resolve(mockTestTakers);
        if (!where.file_type) {
          return Promise.resolve([
            ...mockTestTakers,
            ...mockBooklets,
            ...mockUnits
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await service.validateTestFiles(1);

      expect(result.validationResults[0].booklets.complete).toBe(true);
      expect(result.validationResults[0].units.complete).toBe(true);
    });
  });

  describe('Reference Validation', () => {
    it('should detect missing coding scheme references', async () => {
      const testTakerContent =
        '<TestTakers><Group id="G1"><Login mode="run-hot-return" name="user1"><Booklet>BOOKLET1</Booklet></Login></Group></TestTakers>';
      const bookletContent =
        '<Booklet><Units><Unit id="UNIT1" /></Units></Booklet>';
      const unitContent =
        '<Unit><Metadata><Id>UNIT1</Id></Metadata><CodingSchemeRef>missing-scheme.vocs</CodingSchemeRef></Unit>';
      const mockTestTakers = [
        {
          id: 1,
          file_id: 'TESTTAKER1',
          data: testTakerContent,
          file_type: 'TestTakers'
        }
      ];
      const mockBooklets = [
        { file_id: 'BOOKLET1', data: bookletContent, file_type: 'Booklet' }
      ];
      const mockUnits = [
        { file_id: 'UNIT1', data: unitContent, file_type: 'Unit' }
      ];

      fileUploadRepository.find.mockImplementation(args => {
        if (args.skip && args.skip > 0) return Promise.resolve([]);
        const where = args.where as { file_type?: string };
        if (where.file_type === 'Booklet') return Promise.resolve(mockBooklets);
        if (where.file_type === 'Unit') return Promise.resolve(mockUnits);
        if (isTestTakersQuery(where)) return Promise.resolve(mockTestTakers);
        if (!where.file_type) {
          return Promise.resolve([
            ...mockTestTakers,
            ...mockBooklets,
            ...mockUnits
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await service.validateTestFiles(1);

      expect(result.validationResults[0].schemes.missing).toContain(
        'MISSING-SCHEME.VOCS'
      );
      expect(result.validationResults[0].schemes.missingRefsPerUnit).toEqual(
        expect.arrayContaining([
          { unit: 'UNIT1', missingRefs: ['MISSING-SCHEME.VOCS'] }
        ])
      );
    });

    it('should detect missing definition references', async () => {
      const testTakerContent =
        '<TestTakers><Group id="G1"><Login mode="run-hot-return" name="user1"><Booklet>BOOKLET1</Booklet></Login></Group></TestTakers>';
      const bookletContent =
        '<Booklet><Units><Unit id="UNIT1" /></Units></Booklet>';
      const unitContent =
        '<Unit><Metadata><Id>UNIT1</Id></Metadata><DefinitionRef player="PLAYER-1.0@0.0.1">missing-definition.html</DefinitionRef></Unit>';
      const mockTestTakers = [
        {
          id: 1,
          file_id: 'TESTTAKER1',
          data: testTakerContent,
          file_type: 'TestTakers'
        }
      ];
      const mockBooklets = [
        { file_id: 'BOOKLET1', data: bookletContent, file_type: 'Booklet' }
      ];
      const mockUnits = [
        { file_id: 'UNIT1', data: unitContent, file_type: 'Unit' }
      ];

      fileUploadRepository.find.mockImplementation(args => {
        if (args.skip && args.skip > 0) return Promise.resolve([]);
        const where = args.where as { file_type?: string };
        if (where.file_type === 'Booklet') return Promise.resolve(mockBooklets);
        if (where.file_type === 'Unit') return Promise.resolve(mockUnits);
        if (isTestTakersQuery(where)) return Promise.resolve(mockTestTakers);
        if (!where.file_type) {
          return Promise.resolve([
            ...mockTestTakers,
            ...mockBooklets,
            ...mockUnits
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await service.validateTestFiles(1);

      expect(result.validationResults[0].definitions.missing).toContain(
        'MISSING-DEFINITION.HTML'
      );
    });

    it('should detect missing player references', async () => {
      const testTakerContent =
        '<TestTakers><Group id="G1"><Login mode="run-hot-return" name="user1"><Booklet>BOOKLET1</Booklet></Login></Group></TestTakers>';
      const bookletContent =
        '<Booklet><Units><Unit id="UNIT1" /></Units></Booklet>';
      const unitContent =
        '<Unit><Metadata><Id>UNIT1</Id></Metadata><DefinitionRef player="MISSING-PLAYER-1.0@0.0.1">definition.html</DefinitionRef></Unit>';
      const mockTestTakers = [
        {
          id: 1,
          file_id: 'TESTTAKER1',
          data: testTakerContent,
          file_type: 'TestTakers'
        }
      ];
      const mockBooklets = [
        { file_id: 'BOOKLET1', data: bookletContent, file_type: 'Booklet' }
      ];
      const mockUnits = [
        { file_id: 'UNIT1', data: unitContent, file_type: 'Unit' }
      ];

      fileUploadRepository.find.mockImplementation(args => {
        if (args.skip && args.skip > 0) return Promise.resolve([]);
        const where = args.where as { file_type?: string };
        if (where.file_type === 'Booklet') return Promise.resolve(mockBooklets);
        if (where.file_type === 'Unit') return Promise.resolve(mockUnits);
        if (isTestTakersQuery(where)) return Promise.resolve(mockTestTakers);
        if (!where.file_type) {
          return Promise.resolve([
            ...mockTestTakers,
            ...mockBooklets,
            ...mockUnits
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await service.validateTestFiles(1);

      expect(result.validationResults[0].player.missing).toContain(
        'MISSING-PLAYER-1.0-0.0.1'
      );
    });

    it('should detect missing metadata references', async () => {
      const testTakerContent =
        '<TestTakers><Group id="G1"><Login mode="run-hot-return" name="user1"><Booklet>BOOKLET1</Booklet></Login></Group></TestTakers>';
      const bookletContent =
        '<Booklet><Units><Unit id="UNIT1" /></Units></Booklet>';
      const unitContent =
        '<Unit><Metadata><Id>UNIT1</Id><Reference>missing-metadata.xml</Reference></Metadata></Unit>';
      const mockTestTakers = [
        {
          id: 1,
          file_id: 'TESTTAKER1',
          data: testTakerContent,
          file_type: 'TestTakers'
        }
      ];
      const mockBooklets = [
        { file_id: 'BOOKLET1', data: bookletContent, file_type: 'Booklet' }
      ];
      const mockUnits = [
        { file_id: 'UNIT1', data: unitContent, file_type: 'Unit' }
      ];

      fileUploadRepository.find.mockImplementation(args => {
        if (args.skip && args.skip > 0) return Promise.resolve([]);
        const where = args.where as { file_type?: string };
        if (where.file_type === 'Booklet') return Promise.resolve(mockBooklets);
        if (where.file_type === 'Unit') return Promise.resolve(mockUnits);
        if (isTestTakersQuery(where)) return Promise.resolve(mockTestTakers);
        if (!where.file_type) {
          return Promise.resolve([
            ...mockTestTakers,
            ...mockBooklets,
            ...mockUnits
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await service.validateTestFiles(1);

      expect(result.validationResults[0].metadata.missing).toContain(
        'MISSING-METADATA.XML'
      );
    });

    it('should detect missing schemer references', async () => {
      const testTakerContent =
        '<TestTakers><Group id="G1"><Login mode="run-hot-return" name="user1"><Booklet>BOOKLET1</Booklet></Login></Group></TestTakers>';
      const bookletContent =
        '<Booklet><Units><Unit id="UNIT1" /></Units></Booklet>';
      const unitContent =
        '<Unit><Metadata><Id>UNIT1</Id></Metadata><CodingSchemeRef schemer="MISSING-SCHEMER-1.0"/></Unit>';
      const mockTestTakers = [
        {
          id: 1,
          file_id: 'TESTTAKER1',
          data: testTakerContent,
          file_type: 'TestTakers'
        }
      ];
      const mockBooklets = [
        { file_id: 'BOOKLET1', data: bookletContent, file_type: 'Booklet' }
      ];
      const mockUnits = [
        { file_id: 'UNIT1', data: unitContent, file_type: 'Unit' }
      ];

      fileUploadRepository.find.mockImplementation(args => {
        if (args.skip && args.skip > 0) return Promise.resolve([]);
        const where = args.where as { file_type?: string };
        if (where.file_type === 'Booklet') return Promise.resolve(mockBooklets);
        if (where.file_type === 'Unit') return Promise.resolve(mockUnits);
        if (isTestTakersQuery(where)) return Promise.resolve(mockTestTakers);
        if (!where.file_type) {
          return Promise.resolve([
            ...mockTestTakers,
            ...mockBooklets,
            ...mockUnits
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await service.validateTestFiles(1);

      expect(result.validationResults[0].schemer.missing).toContain(
        'MISSING-SCHEMER-1.0'
      );
    });
  });

  describe('Error Reporting', () => {
    it('should return testTakersFound=false when no test takers exist', async () => {
      fileUploadRepository.find.mockResolvedValue([]);
      const result = await service.validateTestFiles(1);
      expect(result.testTakersFound).toBe(false);
    });

    it('should include duplicate test taker detection', async () => {
      const testTakerContent1 =
        '<TestTakers><Group id="G1"><Login mode="monitor-group" name="duplicate_user"><Booklet>BOOKLET1</Booklet></Login></Group></TestTakers>';
      const testTakerContent2 =
        '<TestTakers><Group id="G2"><Login mode="monitor-group" name="duplicate_user"><Booklet>BOOKLET1</Booklet></Login></Group></TestTakers>';
      const mockTestTakers = [
        {
          id: 1,
          file_id: 'TESTTAKER1',
          data: testTakerContent1,
          file_type: 'TestTakers'
        },
        {
          id: 2,
          file_id: 'TESTTAKER2',
          data: testTakerContent2,
          file_type: 'TestTakers'
        }
      ];

      // Mock personsRepository to return the duplicate user with consider=true
      personsRepository.find.mockResolvedValue([
        { login: 'duplicate_user', consider: true }
      ]);

      fileUploadRepository.find.mockImplementation(args => {
        if (args.skip && args.skip > 0) return Promise.resolve([]);
        const where = args.where as { file_type?: string | object };
        if (where.file_type === 'Booklet') return Promise.resolve([]);
        if (isTestTakersQuery(where)) {
          return Promise.resolve(mockTestTakers);
        }
        if (!where.file_type) return Promise.resolve(mockTestTakers);
        return Promise.resolve([]);
      });

      const result = await service.validateTestFiles(1);

      expect(result.duplicateTestTakers).toBeDefined();
      expect(
        result.duplicateTestTakers?.some(d => d.login === 'duplicate_user')
      ).toBe(true);
    });

    it('should report filtered test takers with specific modes', async () => {
      const testTakerContent =
        '<TestTakers><Group id="G1"><Login mode="monitor-group" name="filtered_user"><Booklet>BOOKLET1</Booklet></Login></Group></TestTakers>';
      const mockTestTakers = [
        {
          id: 1,
          file_id: 'TESTTAKER1',
          data: testTakerContent,
          file_type: 'TestTakers'
        }
      ];

      // Mock personsRepository to return the filtered user with consider=true
      personsRepository.find.mockResolvedValue([
        { login: 'filtered_user', consider: true }
      ]);

      fileUploadRepository.find.mockImplementation(args => {
        if (args.skip && args.skip > 0) return Promise.resolve([]);
        const where = args.where as { file_type?: string | object };
        if (where.file_type === 'Booklet') return Promise.resolve([]);
        if (isTestTakersQuery(where)) {
          return Promise.resolve(mockTestTakers);
        }
        if (!where.file_type) return Promise.resolve(mockTestTakers);
        return Promise.resolve([]);
      });

      const result = await service.validateTestFiles(1);

      expect(result.filteredTestTakers).toBeDefined();
      expect(
        result.filteredTestTakers?.some(
          t => t.login === 'filtered_user' && t.mode === 'monitor-group'
        )
      ).toBe(true);
    });

    it('should not include run-hot-return logins in filtered test takers', async () => {
      const testTakerContent =
        '<TestTakers><Group id="G1"><Login mode="run-hot-return" name="normal_user"><Booklet>BOOKLET1</Booklet></Login></Group></TestTakers>';
      const mockTestTakers = [
        {
          id: 1,
          file_id: 'TESTTAKER1',
          data: testTakerContent,
          file_type: 'TestTakers'
        }
      ];

      // Mock personsRepository - even if person exists, run-hot-return should not be in filtered list
      personsRepository.find.mockResolvedValue([
        { login: 'normal_user', consider: true }
      ]);

      fileUploadRepository.find.mockImplementation(args => {
        if (args.skip && args.skip > 0) return Promise.resolve([]);
        const where = args.where as { file_type?: string | object };
        if (where.file_type === 'Booklet') return Promise.resolve([]);
        if (isTestTakersQuery(where)) {
          return Promise.resolve(mockTestTakers);
        }
        if (!where.file_type) return Promise.resolve(mockTestTakers);
        return Promise.resolve([]);
      });

      const result = await service.validateTestFiles(1);

      expect(
        result.filteredTestTakers?.some(t => t.login === 'normal_user')
      ).toBeFalsy();
    });

    it('should report unused test files', async () => {
      const testTakerContent =
        '<TestTakers><Group id="G1"><Login mode="run-hot-return" name="user1"><Booklet>BOOKLET1</Booklet></Login></Group></TestTakers>';
      const bookletContent =
        '<Booklet><Units><Unit id="UNIT1" /></Units></Booklet>';
      const mockTestTakers = [
        {
          id: 1,
          file_id: 'TESTTAKER1',
          data: testTakerContent,
          file_type: 'TestTakers'
        }
      ];
      const mockBooklets = [
        {
          id: 2,
          file_id: 'BOOKLET1',
          data: bookletContent,
          file_type: 'Booklet'
        }
      ];
      const mockUnused = [
        {
          id: 3,
          file_id: 'UNUSED_FILE',
          filename: 'unused.xml',
          file_type: 'Resource'
        }
      ];

      fileUploadRepository.find.mockImplementation(args => {
        if (args.skip && args.skip > 0) return Promise.resolve([]);
        const where = args.where as { file_type?: string | object };
        if (where.file_type === 'Booklet') return Promise.resolve(mockBooklets);
        if (where.file_type === 'Unit') return Promise.resolve([]);
        if (isTestTakersQuery(where)) {
          return Promise.resolve(mockTestTakers);
        }
        if (!where.file_type) {
          return Promise.resolve([
            ...mockTestTakers,
            ...mockBooklets,
            ...mockUnused
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await service.validateTestFiles(1);

      expect(result.unusedTestFiles).toBeDefined();
      expect(
        result.unusedTestFiles?.some(f => f.fileId === 'UNUSED_FILE')
      ).toBe(true);
    });

    it('should return empty validation results when no test takers have booklets', async () => {
      const testTakerContent =
        '<TestTakers><Group id="G1"><Login mode="run-hot-return" name="user1"></Login></Group></TestTakers>';
      const mockTestTakers = [
        {
          id: 1,
          file_id: 'TESTTAKER1',
          data: testTakerContent,
          file_type: 'TestTakers'
        }
      ];

      fileUploadRepository.find.mockImplementation(args => {
        if (args.skip && args.skip > 0) return Promise.resolve([]);
        const where = args.where as { file_type?: string | object };
        if (isTestTakersQuery(where)) {
          return Promise.resolve(mockTestTakers);
        }
        if (!where.file_type) return Promise.resolve(mockTestTakers);
        return Promise.resolve([]);
      });

      const result = await service.validateTestFiles(1);

      expect(result.testTakersFound).toBe(true);
      expect(result.validationResults).toHaveLength(1);
      expect(result.validationResults[0].booklets.files).toHaveLength(0);
    });
  });

  it('should treat missing IQB-SCHEMER-1.1 as present (with warning) if IQB-SCHEMER-2.5 exists', async () => {
    const unitContent =
      '<Unit><Metadata><Id>UNIT1</Id></Metadata><CodingSchemeRef schemer="IQB-SCHEMER-1.1"/></Unit>';
    const testTakerContent =
      '<TestTakers><Group id="G1"><Login mode="run-hot-return" name="user1"><Booklet>BOOKLET1</Booklet></Login></Group></TestTakers>';
    const bookletContent =
      '<Booklet><Units><Unit id="UNIT1" /></Units></Booklet>';
    const mockBooklets = [
      { file_id: 'BOOKLET1', data: bookletContent, file_type: 'Booklet' }
    ];
    const mockUnits = [
      { file_id: 'UNIT1', data: unitContent, file_type: 'Unit' }
    ];
    const mockSchemers = [
      {
        file_id: 'IQB-SCHEMER-2.5.HTML',
        filename: 'IQB-SCHEMER-2.5.HTML',
        data: '{}',
        file_type: 'Schemer'
      }
    ];
    const mockTestTakers = [
      { file_id: 'TESTTAKER1', data: testTakerContent, file_type: 'TestTakers' }
    ];
    const mockAllFiles = [
      ...mockBooklets,
      ...mockUnits,
      ...mockSchemers,
      ...mockTestTakers
    ].map((f, i) => ({ ...f, id: i + 1 }));

    fileUploadRepository.find.mockImplementation(args => {
      if (args.skip && args.skip > 0) return Promise.resolve([]);
      const where = args.where as {
        file_type?: string | string[] | { _type: string };
      };
      if (where.file_type === 'Booklet') {
        return Promise.resolve(mockBooklets);
      }
      if (where.file_type === 'Unit') {
        return Promise.resolve(mockUnits);
      }
      if (where.file_type === 'Schemer') {
        return Promise.resolve(mockSchemers);
      }
      if (
        where.file_type &&
        // eslint-disable-next-line no-underscore-dangle
        (Array.isArray(where.file_type) ||
          // eslint-disable-next-line no-underscore-dangle
          (where.file_type as { _type: string })._type === 'in')
      ) {
        return Promise.resolve(mockTestTakers);
      }
      if (!where.file_type) {
        return Promise.resolve(mockAllFiles);
      }
      return Promise.resolve([]);
    });

    const qbMock = fileUploadRepository.createQueryBuilder();
    qbMock.getRawMany
      .mockResolvedValueOnce([
        { file_id: 'IQB-SCHEMER-2.5.HTML', filename: 'IQB-SCHEMER-2.5.HTML' }
      ])
      .mockResolvedValueOnce([]);

    const result = await service.validateTestFiles(1);

    const files = result.validationResults[0].schemer.files || [];
    const schemerFileEntry = files.find(
      f => f.filename === 'IQB-SCHEMER-1.1'
    );

    expect(schemerFileEntry).toBeDefined();
    expect(schemerFileEntry?.exists).toBe(true);
    expect(schemerFileEntry?.schemaErrors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('IQB-SCHEMER-1.1 ist veraltet')
      ])
    );
  });
});
