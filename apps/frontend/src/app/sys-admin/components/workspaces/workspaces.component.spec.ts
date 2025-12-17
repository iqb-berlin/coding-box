// eslint-disable-next-line max-classes-per-file
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideHttpClient } from '@angular/common/http';
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule } from '@angular/material/dialog';

import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { WorkspacesComponent } from './workspaces.component';
import { environment } from '../../../../environments/environment';
import { SERVER_URL } from '../../../injection-tokens';

describe('WorkspaceGroupsComponent', () => {
  let component: WorkspacesComponent;
  let fixture: ComponentFixture<WorkspacesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        MatDialogModule,
        MatCheckboxModule,
        MatTooltipModule,
        MatIconModule,
        MatTableModule,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
      providers: [
        provideHttpClient(),
        {
          provide: SERVER_URL,
          useValue: environment.backendUrl
        },
        {
          provide: MatSnackBar,
          useValue: { open: jest.fn() }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WorkspacesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
