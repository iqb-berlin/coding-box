import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { HttpClientModule } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { TestFilesComponent } from './test-files.component';
import { environment } from '../../../../environments/environment';

describe('TestFilesComponent', () => {
  let component: TestFilesComponent;
  let fixture: ComponentFixture<TestFilesComponent>;
  const fakeActivatedRoute = {
    snapshot: { data: { } }
  } as ActivatedRoute;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [{
        provide: ActivatedRoute,
        useValue: fakeActivatedRoute
      },
      {
        provide: 'SERVER_URL',
        useValue: environment.backendUrl
      }],
      imports: [
        HttpClientModule,
        TranslateModule.forRoot()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(TestFilesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
