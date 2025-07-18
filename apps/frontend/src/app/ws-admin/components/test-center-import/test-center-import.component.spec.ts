import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { TestCenterImportComponent } from './test-center-import.component';
import { environment } from '../../../../environments/environment';
import { SERVER_URL } from '../../../injection-tokens';

describe('TestCenterImportComponent', () => {
  let component: TestCenterImportComponent;
  let fixture: ComponentFixture<TestCenterImportComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [{
        provide: SERVER_URL,
        useValue: environment.backendUrl
      }, {
        provide: MAT_DIALOG_DATA,
        useValue: {}
      },
      provideHttpClient()
      ],
      imports: [
        TranslateModule.forRoot(),
        MatDialogModule,
        MatIconModule
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(TestCenterImportComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
