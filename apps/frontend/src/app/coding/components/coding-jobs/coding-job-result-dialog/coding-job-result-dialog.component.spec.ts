import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { CodingJobResultDialogComponent } from './coding-job-result-dialog.component';
import { CodingJobBackendService } from '../../../services/coding-job-backend.service';
import { FileService } from '../../../../shared/services/file/file.service';
import { AppService } from '../../../../core/services/app.service';

class MatSnackBarMock {
  open = jest.fn(() => ({
    dismiss: jest.fn()
  }));
}

describe('CodingJobResultDialogComponent', () => {
  let component: CodingJobResultDialogComponent;
  let fixture: ComponentFixture<CodingJobResultDialogComponent>;

  const mockDialogRef = {
    close: jest.fn()
  };

  const mockDialogData = {
    codingJob: { id: 1, name: 'Test Job' },
    workspaceId: 123
  };

  const mockCodingJobBackendService = {
    getCodingJobUnits: jest.fn(() => of([])),
    getCodingProgress: jest.fn(() => of({})),
    getCodingNotes: jest.fn(() => of({}))
  };

  const mockFileService = {
    getCodingSchemeFile: jest.fn()
  };

  const mockAppService = {
    createToken: jest.fn(() => of('test-token')),
    loggedUser: { sub: 'test-user' }
  };

  const mockRouter = {
    createUrlTree: jest.fn(() => ({})),
    serializeUrl: jest.fn(() => '/replay/path')
  };

  const mockMatDialog = {
    open: jest.fn()
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [CodingJobResultDialogComponent, TranslateModule.forRoot()],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: mockDialogData },
        { provide: MatSnackBar, useClass: MatSnackBarMock },
        { provide: CodingJobBackendService, useValue: mockCodingJobBackendService },
        { provide: FileService, useValue: mockFileService },
        { provide: AppService, useValue: mockAppService },
        { provide: Router, useValue: mockRouter },
        { provide: MatDialog, useValue: mockMatDialog }
      ]
    })
      .compileComponents();

    fixture = TestBed.createComponent(CodingJobResultDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should open replay with a valid hash route URL', () => {
    const windowOpenSpy = jest.spyOn(window, 'open').mockImplementation(() => null);

    component.reviewCodingResult({
      unitName: 'UNIT_1',
      unitAlias: 'UNIT_1',
      variableId: 'VAR_1',
      variableAnchor: 'VAR_1',
      bookletName: 'BOOKLET_A',
      personLogin: 'login',
      personCode: 'code',
      personGroup: 'group',
      testPerson: 'login@code@group@BOOKLET_A',
      codingIssueOptionLabel: 'Unsichere Kodierung'
    } as never);

    expect(windowOpenSpy).toHaveBeenCalledWith(expect.any(String), '_blank');
    const openedUrl = windowOpenSpy.mock.calls[0][0] as string;
    expect(openedUrl).toContain('/#/replay/path');
    expect(openedUrl).not.toContain('#//replay');

    windowOpenSpy.mockRestore();
  });
});
