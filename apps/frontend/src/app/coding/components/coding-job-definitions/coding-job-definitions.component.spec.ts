import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { provideHttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';

import { CodingJobDefinitionsComponent } from './coding-job-definitions.component';
import { SERVER_URL } from '../../../injection-tokens';
import { environment } from '../../../../environments/environment';

describe('CodingJobDefinitionsComponent', () => {
  let component: CodingJobDefinitionsComponent;
  let fixture: ComponentFixture<CodingJobDefinitionsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        { provide: SERVER_URL, useValue: environment.backendUrl },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        provideHttpClient()
      ],
      imports: [CodingJobDefinitionsComponent, TranslateModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(CodingJobDefinitionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
