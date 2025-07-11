// eslint-disable-next-line max-classes-per-file
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { provideHttpClient } from '@angular/common/http';
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { environment } from '../../../../environments/environment';
import { TestGroupsComponent } from './test-groups.component';
import { SERVER_URL } from '../../../injection-tokens';

describe('UsersComponent', () => {
  let component: TestGroupsComponent;
  let fixture: ComponentFixture<TestGroupsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({

      imports: [
        MatSnackBarModule,
        MatCheckboxModule,
        MatTooltipModule,
        MatIconModule,
        MatTableModule,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
      providers: [
        {
          provide: SERVER_URL,
          useValue: environment.backendUrl
        },
        provideHttpClient()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(TestGroupsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
