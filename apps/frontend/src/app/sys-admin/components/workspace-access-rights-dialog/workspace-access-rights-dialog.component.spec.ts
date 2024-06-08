import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientModule } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { WorkspaceAccessRightsDialogComponent } from './workspace-access-rights-dialog.component';
import { environment } from '../../../../environments/environment';

describe('WorkspaceAccessRightsDialogComponent', () => {
  let component: WorkspaceAccessRightsDialogComponent;
  let fixture: ComponentFixture<WorkspaceAccessRightsDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [{
        provide: MAT_DIALOG_DATA,
        useValue: {}
      },
        {
          provide: 'SERVER_URL',
          useValue: environment.backendUrl
        }
      ],
      imports: [
        HttpClientModule,
        TranslateModule.forRoot(),
        MatDialogModule,
        MatIconModule
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WorkspaceAccessRightsDialogComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
