import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientModule } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { UserAccessRightsDialogComponent } from './user-access-rights-dialog.component';

describe('UserAccessRightsDialogComponent', () => {
  let component: UserAccessRightsDialogComponent;
  let fixture: ComponentFixture<UserAccessRightsDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [{
        provide: MAT_DIALOG_DATA,
        useValue: {}
      }
      ],
      imports: [
        HttpClientModule,
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
