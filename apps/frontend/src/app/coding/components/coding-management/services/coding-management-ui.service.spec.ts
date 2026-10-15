import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, Subject } from 'rxjs';
import { DestroyRef } from '@angular/core';
import { CodingManagementUiService } from './coding-management-ui.service';
import { AppService } from '../../../../core/services/app.service';
import { FileService } from '../../../../shared/services/file/file.service';
import { CodingStatisticsService } from '../../../services/coding-statistics.service';
import { Success } from '../../../models/success.model';
import { SchemeEditorDialogComponent } from '../../scheme-editor-dialog/scheme-editor-dialog.component';

describe('CodingManagementUiService', () => {
  let service: CodingManagementUiService;
  let mockAppService: jest.Mocked<Partial<AppService>>;
  let mockFileService: Partial<jest.Mocked<FileService>>;
  let mockStatisticsService: jest.Mocked<Partial<CodingStatisticsService>>;
  let mockDialog: jest.Mocked<Partial<MatDialog>>;
  let mockSnackBar: jest.Mocked<Partial<MatSnackBar>>;

  beforeEach(() => {
    mockAppService = {
      createOwnToken: jest.fn().mockReturnValue(of('test-token')),
      selectedWorkspaceId: 1,
      selectedWorkspaceId$: new Subject<number>(),
      loggedUser: { sub: 'test-user' }
    } as unknown as jest.Mocked<Partial<AppService>>;
    mockFileService = {
      getUnitContentXml: jest.fn(),
      getCodingSchemeFile: jest.fn()
    } as unknown as Partial<jest.Mocked<FileService>>;
    mockStatisticsService = {
      getReplayUrl: jest.fn()
    } as unknown as jest.Mocked<Partial<CodingStatisticsService>>;
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
        { provide: CodingStatisticsService, useValue: mockStatisticsService },
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

  it('preserves the Schemer and scheme type from the unit XML through opening the preview', () => {
    const reference = { content: 'DLB004.vocs', schemer: 'iqb-schemer@2.5', schemeType: 'iqb@3.0' };
    mockFileService.getUnitContentXml!.mockReturnValue(of(
      '<Unit><CodingSchemeRef schemer="iqb-schemer@2.5" schemeType="iqb@3.0">DLB004.vocs</CodingSchemeRef></Unit>'
    ));
    mockFileService.getCodingSchemeFile!.mockReturnValue(of({ filename: 'DLB004.vocs', base64Data: '{}', mimeType: 'Resource' }));
    service.getCodingSchemeFromUnit(123).subscribe(result => {
      expect(result).toEqual(reference);
      service.showCodingSchemeDialog(result!);
    });
    expect(mockDialog.open).toHaveBeenCalledWith(SchemeEditorDialogComponent, expect.objectContaining({
      data: expect.objectContaining({ content: '{}', codingSchemeRef: reference, readOnly: true })
    }));
  });

  it('should return null for invalid XML', () => {
    const xml = '<root></root>';
    const result = service.extractCodingSchemeRefFromXml(xml);
    expect(result).toBeNull();
  });

  it('should open replay URL in new window', done => {
    const response = { id: 123 } as Success;
    (mockAppService.createOwnToken as jest.Mock).mockReturnValue(of('test-token'));
    (mockStatisticsService.getReplayUrl as jest.Mock).mockReturnValue(of({ replayUrl: 'http://test.com' }));

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

  it('should open SchemeEditorDialogComponent when showing coding scheme', () => {
    const codingSchemeRef = 'test-scheme';
    const mockFileData = { base64Data: 'eyJoZWxsbyI6IndvcmxkIn0=', filename: 'test-scheme.json', mimeType: 'application/json' };
    (mockFileService.getCodingSchemeFile as jest.Mock).mockReturnValue(of(mockFileData));

    service.showCodingSchemeDialog(codingSchemeRef);

    expect(mockFileService.getCodingSchemeFile).toHaveBeenCalledWith(1, codingSchemeRef);
    expect(mockDialog.open).toHaveBeenCalledWith(SchemeEditorDialogComponent, {
      width: '80%',
      height: '80%',
      data: {
        workspaceId: 1,
        fileId: codingSchemeRef,
        fileName: codingSchemeRef,
        content: 'eyJoZWxsbyI6IndvcmxkIn0=',
        readOnly: true
      },
      panelClass: 'scheme-editor-dialog-container'
    });
  });
  it('cancels a pending XML dialog request when its owning view is destroyed', () => {
    const reply = new Subject<string>();
    mockFileService.getUnitContentXml!.mockReturnValue(reply);
    const callbacks: Array<() => void> = [];
    const owner = {
      destroyed: false,
      onDestroy: (callback: () => void) => {
        callbacks.push(callback);
        return () => callbacks.splice(callbacks.indexOf(callback), 1);
      }
    } as DestroyRef;
    service.showUnitXmlDialog(7, owner);
    expect(reply.observed).toBe(true);
    callbacks.forEach(callback => callback());
    expect(reply.observed).toBe(false);
    reply.next('<Unit/>');
    expect(mockDialog.open).not.toHaveBeenCalled();
    expect(mockSnackBar.open).not.toHaveBeenCalled();
  });

  it('does not open a late scheme dialog after a workspace round trip', () => {
    const reply = new Subject<{ base64Data: string }>();
    mockFileService.getCodingSchemeFile!.mockReturnValue(reply as never);
    service.showCodingSchemeDialog('scheme.vocs');
    mockAppService.selectedWorkspaceId = 2;
    (mockAppService.selectedWorkspaceId$ as Subject<number>).next(2);
    mockAppService.selectedWorkspaceId = 1;
    (mockAppService.selectedWorkspaceId$ as Subject<number>).next(1);
    expect(reply.observed).toBe(false);
    reply.next({ base64Data: btoa('{}') });
    expect(mockDialog.open).not.toHaveBeenCalled();
    expect(mockSnackBar.open).not.toHaveBeenCalled();
  });
});
