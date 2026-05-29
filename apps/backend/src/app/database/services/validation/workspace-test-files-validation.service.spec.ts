import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import {
  TEST_FILES_VALIDATION_CACHE_VERSION,
  WorkspaceTestFilesValidationService
} from './workspace-test-files-validation.service';
import FileUpload from '../../entities/file_upload.entity';
import Persons from '../../entities/persons.entity';
import { WorkspaceXmlSchemaValidationService } from '../workspace/workspace-xml-schema-validation.service';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { ResourcePackageService } from '../workspace/resource-package.service';

describe('WorkspaceTestFilesValidationService', () => {
  let service: WorkspaceTestFilesValidationService;
  let fileUploadRepository: Partial<Record<keyof Repository<FileUpload>, jest.Mock>>;
  let personsRepository: Partial<Record<keyof Repository<Persons>, jest.Mock>>;
  let workspaceExclusionService: {
    resolveExclusionsForQueries: jest.Mock;
    getExclusions: jest.Mock;
    isExcluded: jest.Mock;
  };
  let resourcePackageService: {
    getGeoGebraPackageStatus: jest.Mock;
  };

  beforeEach(async () => {
    fileUploadRepository = {
      find: jest.fn(),
      count: jest.fn(),
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
    workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({ globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: [] }),
      getExclusions: jest.fn().mockResolvedValue({ ignoredUnits: [], ignoredBooklets: [], ignoredTestlets: [] }),
      isExcluded: jest.fn().mockReturnValue(false)
    };
    resourcePackageService = {
      getGeoGebraPackageStatus: jest.fn().mockResolvedValue({
        exists: false,
        valid: false,
        errors: ['GeoGebra Math Apps Bundle ist nicht installiert.']
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
          useValue: personsRepository
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
        },
        {
          provide: WorkspaceExclusionService,
          useValue: workspaceExclusionService
        },
        {
          provide: ResourcePackageService,
          useValue: resourcePackageService
        }
      ]
    }).compile();

    service = module.get<WorkspaceTestFilesValidationService>(WorkspaceTestFilesValidationService);
  });

  it('should include the validation algorithm version in the fingerprint', async () => {
    fileUploadRepository.find.mockResolvedValue([]);
    workspaceExclusionService.getExclusions.mockResolvedValue({
      ignoredUnits: [],
      ignoredBooklets: [],
      ignoredTestlets: []
    });
    personsRepository.find?.mockResolvedValue([]);

    const fingerprint = await service.getTestFilesFingerprint(1);

    const expectedHash = crypto.createHash('sha256');
    expectedHash.update(JSON.stringify({
      cacheVersion: 4,
      exclusions: {
        ignoredUnits: [],
        ignoredBooklets: [],
        ignoredTestlets: []
      },
      persons: []
    }));
    expectedHash.update('\n');

    expect(TEST_FILES_VALIDATION_CACHE_VERSION).toBe(4);
    expect(fingerprint).toBe(expectedHash.digest('hex'));
  });

  it('should include ignored test file settings in the validation fingerprint', async () => {
    const files = [{
      id: 1,
      file_id: 'UNIT1',
      filename: 'UNIT1.XML',
      file_type: 'Unit',
      file_size: 42,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      data: '<Unit />'
    }];
    fileUploadRepository.find.mockResolvedValue(files);
    workspaceExclusionService.getExclusions
      .mockResolvedValueOnce({
        ignoredUnits: [],
        ignoredBooklets: [],
        ignoredTestlets: []
      })
      .mockResolvedValueOnce({
        ignoredUnits: ['UNIT1'],
        ignoredBooklets: [],
        ignoredTestlets: []
      });

    const initialFingerprint = await service.getTestFilesFingerprint(1);
    const ignoredUnitFingerprint = await service.getTestFilesFingerprint(1);

    expect(initialFingerprint).not.toBe(ignoredUnitFingerprint);
  });

  it('should build the validation fingerprint independent of exclusion order and case', async () => {
    const files = [{
      id: 1,
      file_id: 'UNIT1',
      filename: 'UNIT1.XML',
      file_type: 'Unit',
      file_size: 42,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      data: '<Unit />'
    }];
    fileUploadRepository.find.mockResolvedValue(files);
    workspaceExclusionService.getExclusions
      .mockResolvedValueOnce({
        ignoredUnits: ['unit2.xml', 'UNIT1'],
        ignoredBooklets: ['booklet-b', 'BOOKLET-A'],
        ignoredTestlets: [
          { bookletId: 'booklet-b', testletId: 't2' },
          { bookletId: 'BOOKLET-A', testletId: 'T1' }
        ]
      })
      .mockResolvedValueOnce({
        ignoredUnits: ['unit1', 'UNIT2'],
        ignoredBooklets: ['booklet-a', 'BOOKLET-B'],
        ignoredTestlets: [
          { bookletId: 'booklet-a', testletId: 't1' },
          { bookletId: 'BOOKLET-B', testletId: 'T2' }
        ]
      });

    const firstFingerprint = await service.getTestFilesFingerprint(1);
    const secondFingerprint = await service.getTestFilesFingerprint(1);

    expect(firstFingerprint).toBe(secondFingerprint);
  });

  it('should include person consider status in the validation fingerprint', async () => {
    const files = [{
      id: 1,
      file_id: 'TESTTAKER1',
      filename: 'TESTTAKER1.XML',
      file_type: 'TestTakers',
      file_size: 42,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      data: '<TestTakers />'
    }];
    fileUploadRepository.find.mockResolvedValue(files);
    workspaceExclusionService.getExclusions.mockResolvedValue({
      ignoredUnits: [],
      ignoredBooklets: [],
      ignoredTestlets: []
    });
    personsRepository.find
      ?.mockResolvedValueOnce([{ login: 'student-a', consider: true }])
      .mockResolvedValueOnce([{ login: 'student-a', consider: false }]);

    const consideredFingerprint = await service.getTestFilesFingerprint(1);
    const excludedFingerprint = await service.getTestFilesFingerprint(1);

    expect(consideredFingerprint).not.toBe(excludedFingerprint);
  });

  it('should build the validation fingerprint independent of person order', async () => {
    const files = [{
      id: 1,
      file_id: 'TESTTAKER1',
      filename: 'TESTTAKER1.XML',
      file_type: 'TestTakers',
      file_size: 42,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      data: '<TestTakers />'
    }];
    fileUploadRepository.find.mockResolvedValue(files);
    workspaceExclusionService.getExclusions.mockResolvedValue({
      ignoredUnits: [],
      ignoredBooklets: [],
      ignoredTestlets: []
    });
    personsRepository.find
      ?.mockResolvedValueOnce([
        { login: 'student-b', consider: false },
        { login: 'student-a', consider: true }
      ])
      .mockResolvedValueOnce([
        { login: 'student-a', consider: true },
        { login: 'student-b', consider: false }
      ]);

    const firstFingerprint = await service.getTestFilesFingerprint(1);
    const secondFingerprint = await service.getTestFilesFingerprint(1);

    expect(firstFingerprint).toBe(secondFingerprint);
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

    fileUploadRepository.count.mockResolvedValue(mockTestTakers.length);

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

  it('should validate coding schemes with current IQB processing properties', async () => {
    const scheme = {
      version: '3.4',
      variableCodings: [
        {
          id: 'VAR-1',
          alias: 'VAR_ALIAS-1',
          sourceType: 'BASE',
          processing: ['CODER_TRAINING_REQUIRED'],
          codeModel: 'MANUAL_ONLY',
          codes: [{ id: 1 }]
        }
      ]
    };
    fileUploadRepository.find.mockResolvedValue([{
      file_id: 'UNIT_A.VOCS',
      filename: 'UNIT_A.VOCS',
      data: JSON.stringify(scheme),
      file_type: 'Resource'
    }]);

    const validateCodingSchemes = (
      service as unknown as {
        validateAllCodingSchemes: (workspaceId: number) => Promise<Map<string, { schemaValid: boolean; errors: string[]; warnings?: string[] }>>;
      }
    ).validateAllCodingSchemes.bind(service);

    const results = await validateCodingSchemes(1);
    const result = results.get('UNIT_A.VOCS');

    expect(result).toEqual({ schemaValid: true, errors: [], warnings: [] });
  });

  it('should tolerate legacy codeModel NONE as a validation warning', async () => {
    const scheme = {
      version: '3.4',
      variableCodings: [
        {
          id: 'VAR_OLD',
          sourceType: 'BASE',
          codeModel: 'NONE',
          codes: [{ id: 1 }]
        }
      ]
    };
    fileUploadRepository.find.mockResolvedValue([{
      file_id: 'UNIT_LEGACY.VOCS',
      filename: 'UNIT_LEGACY.VOCS',
      data: JSON.stringify(scheme),
      file_type: 'Resource'
    }]);

    const validateCodingSchemes = (
      service as unknown as {
        validateAllCodingSchemes: (workspaceId: number) => Promise<Map<string, { schemaValid: boolean; errors: string[]; warnings?: string[] }>>;
      }
    ).validateAllCodingSchemes.bind(service);

    const results = await validateCodingSchemes(1);
    const result = results.get('UNIT_LEGACY.VOCS');

    expect(result).toEqual({
      schemaValid: true,
      errors: [],
      warnings: [
        'Legacy codeModel "NONE" wurde bei Variable "VAR_OLD" als fehlender Wert behandelt.'
      ]
    });
    expect(scheme.variableCodings[0].codeModel).toBe('NONE');
  });

  it('should aggregate legacy codeModel NONE warnings per coding scheme file', async () => {
    const scheme = {
      version: '3.4',
      variableCodings: [
        {
          id: 'VAR_ONE',
          sourceType: 'BASE',
          codeModel: 'NONE',
          codes: [{ id: 1 }]
        },
        {
          id: 'VAR_TWO',
          sourceType: 'BASE',
          codeModel: 'NONE',
          codes: [{ id: 2 }]
        },
        {
          id: 'VAR_THREE',
          sourceType: 'BASE',
          codeModel: 'NONE',
          codes: [{ id: 3 }]
        },
        {
          id: 'VAR_FOUR',
          sourceType: 'BASE',
          codeModel: 'NONE',
          codes: [{ id: 4 }]
        }
      ]
    };
    fileUploadRepository.find.mockResolvedValue([{
      file_id: 'UNIT_LEGACY_MULTI.VOCS',
      filename: 'UNIT_LEGACY_MULTI.VOCS',
      data: JSON.stringify(scheme),
      file_type: 'Resource'
    }]);

    const validateCodingSchemes = (
      service as unknown as {
        validateAllCodingSchemes: (workspaceId: number) => Promise<Map<string, { schemaValid: boolean; errors: string[]; warnings?: string[] }>>;
      }
    ).validateAllCodingSchemes.bind(service);

    const results = await validateCodingSchemes(1);
    const result = results.get('UNIT_LEGACY_MULTI.VOCS');

    expect(result).toEqual({
      schemaValid: true,
      errors: [],
      warnings: [
        'Legacy codeModel "NONE" wurde bei 4 Variablen als fehlender Wert behandelt (z. B. "VAR_ONE", "VAR_TWO", "VAR_THREE", ...).'
      ]
    });
  });

  it('should keep rejecting unsupported coding scheme properties after legacy normalization', async () => {
    const scheme = {
      version: '3.4',
      variableCodings: [
        {
          id: 'VAR_OLD',
          sourceType: 'BASE',
          codeModel: 'NONE',
          legacyComment: 'not part of the coding-scheme schema',
          codes: [{ id: 1 }]
        }
      ]
    };
    fileUploadRepository.find.mockResolvedValue([{
      file_id: 'UNIT_INVALID.VOCS',
      filename: 'UNIT_INVALID.VOCS',
      data: JSON.stringify(scheme),
      file_type: 'Resource'
    }]);

    const validateCodingSchemes = (
      service as unknown as {
        validateAllCodingSchemes: (workspaceId: number) => Promise<Map<string, { schemaValid: boolean; errors: string[]; warnings?: string[] }>>;
      }
    ).validateAllCodingSchemes.bind(service);

    const results = await validateCodingSchemes(1);
    const result = results.get('UNIT_INVALID.VOCS');

    expect(result?.schemaValid).toBe(false);
    expect(result?.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('legacyComment')
    ]));
    expect(result?.warnings).toEqual([
      'Legacy codeModel "NONE" wurde bei Variable "VAR_OLD" als fehlender Wert behandelt.'
    ]);
  });

  it('should refresh GeoGebra package status without rerunning test file validation', async () => {
    const result = await service.refreshGeoGebraPackageStatus(1, {
      testTakersFound: true,
      validationResults: [],
      geogebra: {
        hasTasks: true,
        units: ['UNIT1'],
        packageStatus: {
          exists: true,
          valid: true,
          name: 'Geogebra'
        }
      }
    });

    expect(resourcePackageService.getGeoGebraPackageStatus)
      .toHaveBeenCalledWith(1);
    expect(result).toEqual({
      testTakersFound: true,
      validationResults: [],
      geogebra: {
        hasTasks: true,
        units: ['UNIT1'],
        packageStatus: {
          exists: false,
          valid: false,
          errors: ['GeoGebra Math Apps Bundle ist nicht installiert.']
        }
      }
    });
  });
});
