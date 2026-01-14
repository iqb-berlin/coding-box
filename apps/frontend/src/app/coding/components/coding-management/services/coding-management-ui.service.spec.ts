import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { CodingManagementUiService } from './coding-management-ui.service';
import { AppService } from '../../../../core/services/app.service';
import { FileService } from '../../../../shared/services/file/file.service';
import { CodingService } from '../../../services/coding.service';
import { Success } from '../../../models/success.model';

describe('CodingManagementUiService', () => {
  let service: CodingManagementUiService;
  let mockAppService: jest.Mocked<Partial<AppService>>;
  let mockFileService: jest.Mocked<Partial<FileService>>;
  let mockCodingService: jest.Mocked<Partial<CodingService>>;
  let mockDialog: jest.Mocked<Partial<MatDialog>>;
  let mockSnackBar: jest.Mocked<Partial<MatSnackBar>>;

  beforeEach(() => {
    mockAppService = {
      createToken: jest.fn().mockReturnValue(of('test-token')),
      selectedWorkspaceId: 1,
      loggedUser: { sub: 'test-user' }
    } as unknown as jest.Mocked<Partial<AppService>>;
    mockFileService = {
      getUnitContentXml: jest.fn(),
      getCodingSchemeFile: jest.fn()
    } as unknown as jest.Mocked<Partial<FileService>>;
    mockCodingService = {
      getReplayUrl: jest.fn()
    } as unknown as jest.Mocked<Partial<CodingService>>;
    mockDialog = {
      open: jest.fn()
    } as unknown as jest.Mocked<Partial<MatDialog>>;
    mockSnackBar = {
      open: jest.fn()
    } as unknown as jest.Mocked<Partial<MatSnackBar>>;

    TestBed.configureTestingModule({
      providers: [
        CodingManagementUiService,
        { provide: AppService, useValue: mockAppService },
        { provide: FileService, useValue: mockFileService },
        { provide: CodingService, useValue: mockCodingService },
        { provide: MatDialog, useValue: mockDialog },
        { provide: MatSnackBar, useValue: mockSnackBar }
      ]
    });
    service = TestBed.inject(CodingManagementUiService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should extract coding scheme ref from XML', () => {
    const xml = '<root><CodingSchemeRef>test-scheme</CodingSchemeRef></root>';
    const result = service.extractCodingSchemeRefFromXml(xml);
    expect(result).toBe('test-scheme');
  });

  it('should return null for invalid XML', () => {
    const xml = '<root></root>';
    const result = service.extractCodingSchemeRefFromXml(xml);
    expect(result).toBeNull();
  });

  it('should open replay URL in new window', done => {
    const response = { id: 123 } as Success;
    (mockAppService.createToken as jest.Mock).mockReturnValue(of('test-token'));
    (mockCodingService.getReplayUrl as jest.Mock).mockReturnValue(of({ replayUrl: 'http://test.com' }));

    service.openReplayForResponse(response).subscribe(url => {
      expect(url).toBe('http://test.com');
      done();
    });
  });

  it('should show error when response has no ID', done => {
    const response = {} as Success;

    service.openReplayForResponse(response).subscribe(url => {
      expect(url).toBe('');
      expect(mockSnackBar.open).toHaveBeenCalled();
      done();
    });
  });
});
