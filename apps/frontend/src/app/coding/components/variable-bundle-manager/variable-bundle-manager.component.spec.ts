import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { VariableBundleManagerComponent } from './variable-bundle-manager.component';
import { VariableBundleService } from '../../services/variable-bundle.service';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { AppService } from '../../../core/services/app.service';
import { VariableBundle } from '../../models/coding-job.model';

describe('VariableBundleManagerComponent', () => {
  let component: VariableBundleManagerComponent;

  const bundle: VariableBundle = {
    id: 7,
    name: 'Lesen Basis',
    description: 'Basisvariablen',
    createdAt: new Date('2026-05-13T10:00:00'),
    updatedAt: new Date('2026-05-13T10:00:00'),
    variables: [
      { unitName: 'UNIT1', variableId: 'VAR1' },
      { unitName: 'UNIT1', variableId: 'VAR2' }
    ]
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        VariableBundleManagerComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
      providers: [
        {
          provide: VariableBundleService,
          useValue: {
            getBundles: jest.fn().mockReturnValue(of({
              bundles: [bundle],
              total: 1,
              page: 1,
              limit: 10000
            })),
            createBundle: jest.fn(),
            updateBundle: jest.fn(),
            deleteBundle: jest.fn().mockReturnValue(of(true))
          }
        },
        {
          provide: CodingJobBackendService,
          useValue: {
            getCodingIncompleteVariables: jest.fn().mockReturnValue(of([]))
          }
        },
        { provide: AppService, useValue: { selectedWorkspaceId: 1 } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: MatDialog, useValue: { open: jest.fn(() => ({ afterClosed: () => of(null) })) } }
      ]
    }).compileComponents();

    component = TestBed.createComponent(VariableBundleManagerComponent).componentInstance;
  });

  it('builds descriptive action labels for bundle rows', () => {
    expect(component.getVariableBundleActionAriaLabel('edit', bundle)).toBe('Variablenbündel bearbeiten: Lesen Basis');
    expect(component.getVariableBundleActionAriaLabel('delete', bundle)).toBe('Variablenbündel löschen: Lesen Basis');
    expect(component.getVariableBundleActionAriaLabel('more', bundle)).toBe('Weitere Aktionen: Lesen Basis');
  });

  it('returns the number of variables in a bundle', () => {
    expect(component.getVariableCount(bundle)).toBe(2);
  });
});
