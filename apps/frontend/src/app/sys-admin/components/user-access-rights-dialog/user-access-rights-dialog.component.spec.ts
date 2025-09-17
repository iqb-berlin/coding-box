import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { UserAccessRightsDialogComponent } from './user-access-rights-dialog.component';
import { environment } from '../../../../environments/environment';
import { SERVER_URL } from '../../../injection-tokens';

describe('UserAccessRightsDialogComponent', () => {
  let component: UserAccessRightsDialogComponent;
  let fixture: ComponentFixture<UserAccessRightsDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [{
        provide: MAT_DIALOG_DATA,
        useValue: {}

      }, {
        provide: SERVER_URL,
        useValue: environment.backendUrl
      },
      provideHttpClient()
      ],
      imports: [
        TranslateModule.forRoot(),
        MatDialogModule,
        MatIconModule
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UserAccessRightsDialogComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
