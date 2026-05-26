import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { ResourcePackagesDialogComponent } from './resource-packages-dialog.component';
import { ResourcePackageService } from '../../../shared/services/response/resource-package.service';

describe('ResourcePackagesDialogComponent', () => {
  let fixture: ComponentFixture<ResourcePackagesDialogComponent>;
  let resourcePackageService: jest.Mocked<Pick<ResourcePackageService, 'getResourcePackages'>>;
  let snackBar: jest.Mocked<Pick<MatSnackBar, 'open'>>;

  beforeEach(async () => {
    resourcePackageService = {
      getResourcePackages: jest.fn().mockReturnValue(of([]))
    };
    snackBar = {
      open: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [
        ResourcePackagesDialogComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { workspaceId: 7 } },
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        { provide: MatDialog, useValue: { open: jest.fn() } },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: ResourcePackageService, useValue: resourcePackageService }
      ]
    }).compileComponents();
  });

  const createComponent = (): void => {
    fixture = TestBed.createComponent(ResourcePackagesDialogComponent);
    fixture.detectChanges();
  };

  it('loads resource packages for the dialog workspace id', () => {
    createComponent();

    expect(resourcePackageService.getResourcePackages).toHaveBeenCalledWith(7);
  });

  it('shows an error when resource packages cannot be loaded', () => {
    resourcePackageService.getResourcePackages.mockReturnValue(
      throwError(() => new Error('Unauthorized'))
    );

    createComponent();

    expect(snackBar.open).toHaveBeenCalledWith(
      'Error loading resource packages',
      'error',
      { duration: 3000 }
    );
  });
});
