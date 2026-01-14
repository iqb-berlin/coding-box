import {
  ComponentFixture, fakeAsync, TestBed, tick
} from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { HttpClientModule } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { of, throwError, Subject } from 'rxjs';
import { TestFilesComponent } from './test-files.component';
import { environment } from '../../../../environments/environment';
import { SERVER_URL } from '../../../injection-tokens';
import { FileService } from '../../../shared/services/file/file.service';
import { AppService } from '../../../core/services/app.service';
import { TestFilesUploadResultDto } from '../../../../../../../api-dto/files/test-files-upload-result.dto';
import { TestFilesUploadConflictsDialogComponent } from './test-files-upload-conflicts-dialog.component';

describe('TestFilesComponent', () => {
  let component: TestFilesComponent;
  let fixture: ComponentFixture<TestFilesComponent>;
  let fileService: jest.Mocked<FileService>;
  let appService: jest.Mocked<AppService>;
  let dialog: jest.Mocked<MatDialog>;
  let snackBar: jest.Mocked<MatSnackBar>;

  const fakeActivatedRoute = {
    snapshot: { data: {} }
  } as ActivatedRoute;

  beforeEach(async () => {
    const fileServiceMock = {
      getFilesList: jest.fn(),
      uploadTestFiles: jest.fn(),
      deleteFiles: jest.fn(),
      downloadFile: jest.fn(),
      validateFiles: jest.fn(),
      createDummyTestTakerFile: jest.fn()
    };

    const appServiceMock = {
      selectedWorkspaceId: 1
    };

    const dialogMock = {
      open: jest.fn()
    };

    const snackBarMock = {
      open: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [TestFilesComponent, HttpClientModule, TranslateModule.forRoot()],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: fakeActivatedRoute
        },
        {
          provide: SERVER_URL,
          useValue: environment.backendUrl
        },
        {
          provide: FileService,
          useValue: fileServiceMock
        },
        {
          provide: AppService,
          useValue: appServiceMock
        },
        {
          provide: MatDialog,
          useValue: dialogMock
        },
        {
          provide: MatSnackBar,
          useValue: snackBarMock
        }
      ]
    }).compileComponents();

    fileService = TestBed.inject(FileService) as jest.Mocked<FileService>;
    appService = TestBed.inject(AppService) as jest.Mocked<AppService>;
    dialog = TestBed.inject(MatDialog) as jest.Mocked<MatDialog>;
    snackBar = TestBed.inject(MatSnackBar) as jest.Mocked<MatSnackBar>;

    fileService.getFilesList.mockReturnValue(of({
      data: [], total: 0, page: 1, limit: 100, fileTypes: []
    }));

    fixture = TestBed.createComponent(TestFilesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('ngOnInit', () => {
    it('should load test files on init', () => {
      expect(fileService.getFilesList).toHaveBeenCalledWith(1, 1, 100, '', '', '');
    });
  });

  describe('onFileSelected', () => {
    let mockFiles: FileList;

    beforeEach(() => {
      const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
      mockFiles = {
        0: file,
        length: 1,
        item: () => file
      } as unknown as FileList;

      // Reset getFilesList mock for specific tests if needed
      fileService.getFilesList.mockClear();
    });

    it('should upload files successfully and refresh list', fakeAsync(() => {
      const uploadResult: TestFilesUploadResultDto = {
        total: 1,
        uploaded: 1,
        failed: 0,
        uploadedFiles: [{ fileId: '1', filename: 'test.txt' }],
        failedFiles: [],
        conflicts: []
      };

      const uploadSubject = new Subject<TestFilesUploadResultDto>();
      fileService.uploadTestFiles.mockReturnValue(uploadSubject.asObservable());
      fileService.getFilesList.mockReturnValue(of({
        data: [], total: 0, page: 1, limit: 100, fileTypes: []
      }));

      const event = {
        target: {
          files: mockFiles
        }
      } as unknown as Event;

      component.onFileSelected(event.target);

      expect(component.isUploading).toBe(true);
      expect(fileService.uploadTestFiles).toHaveBeenCalledWith(1, mockFiles, false);

      uploadSubject.next(uploadResult);
      uploadSubject.complete();

      tick(); // process upload subscription

      expect(component.isUploading).toBe(false);
      expect(snackBar.open).toHaveBeenCalledWith(expect.stringContaining('Upload abgeschlossen'), 'OK', { duration: 5000 });
      expect(dialog.open).toHaveBeenCalled(); // Should open openUploadResultDialog

      tick(1000); // Wait for setTimeout in onUploadSuccess
      expect(fileService.getFilesList).toHaveBeenCalled();
    }));

    it('should handle upload conflicts by opening conflicts dialog', fakeAsync(() => {
      const initialResult: TestFilesUploadResultDto = {
        total: 1,
        uploaded: 0,
        failed: 0,
        uploadedFiles: [],
        failedFiles: [],
        conflicts: [{ fileId: '101', filename: 'test.txt', fileType: 'Test' }]
      };

      fileService.uploadTestFiles.mockReturnValueOnce(of(initialResult));

      const dialogRefMock = {
        afterClosed: jest.fn().mockReturnValue(of({ overwrite: true, overwriteFileIds: ['101'] }))
      } as unknown as MatDialogRef<unknown>;

      dialog.open.mockReturnValue(dialogRefMock as any);

      const overwriteResult: TestFilesUploadResultDto = {
        total: 1,
        uploaded: 1,
        failed: 0,
        uploadedFiles: [{ fileId: '101', filename: 'test.txt' }],
        failedFiles: [],
        conflicts: []
      };
      fileService.uploadTestFiles.mockReturnValueOnce(of(overwriteResult));

      const event = {
        target: {
          files: mockFiles
        }
      } as unknown as Event;

      component.onFileSelected(event.target);
      tick();

      expect(dialog.open).toHaveBeenCalledWith(TestFilesUploadConflictsDialogComponent, expect.anything());
      expect(fileService.uploadTestFiles).toHaveBeenCalledTimes(2);
      expect(fileService.uploadTestFiles).toHaveBeenLastCalledWith(1, mockFiles, true, ['101']);
    }));

    it('should handle upload failure', fakeAsync(() => {
      fileService.uploadTestFiles.mockReturnValue(throwError(() => new Error('Upload failed')));

      const event = {
        target: {
          files: mockFiles
        }
      } as unknown as Event;

      component.onFileSelected(event.target);
      tick();

      expect(component.isUploading).toBe(false);
      expect(snackBar.open).toHaveBeenCalledWith('Fehler beim Hochladen der Dateien.', 'error', { duration: 3000 });
    }));
  });

  describe('Busy State', () => {
    it('should return true if any operation is in progress', () => {
      component.isLoading = false;
      component.isUploading = false;
      component.isDeleting = false;
      component.isValidating = false;
      component.isDownloadingAllFiles = false;
      expect(component.isBusy).toBe(false);

      component.isUploading = true;
      expect(component.isBusy).toBe(true);

      component.isUploading = false;
      component.isLoading = true;
      expect(component.isBusy).toBe(true);
    });

    it('should return correct busy text', () => {
      component.isUploading = true;
      expect(component.busyText).toBe('Datei(en) werden hochgeladen...');

      component.isUploading = false;
      component.isDeleting = true;
      expect(component.busyText).toBe('Datei(en) werden gelöscht...');
    });
  });
});
