import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { CodingJobsComponent } from './coding-jobs.component';
import { SERVER_URL } from '../../../injection-tokens';
import { environment } from '../../../../environments/environment';

describe('CodingJobsComponent', () => {
  let component: CodingJobsComponent;
  let fixture: ComponentFixture<CodingJobsComponent>;
  const fakeActivatedRoute = {
    snapshot: { data: { } }
  } as ActivatedRoute;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        { provide: SERVER_URL, useValue: environment.backendUrl },

        {
          provide: ActivatedRoute,
          useValue: fakeActivatedRoute
        }, provideHttpClient()],
      imports: [
        TranslateModule.forRoot()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CodingJobsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
