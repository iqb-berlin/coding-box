import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { CoderListComponent } from './coder-list.component';

import { environment } from '../../../../environments/environment';
import { SERVER_URL } from '../../../injection-tokens';
import { AppService } from '../../../services/app.service';

class AppServiceMock {
  selectedWorkspaceId = 42;
}

describe('CoderListComponent', () => {
  let component: CoderListComponent;
  let fixture: ComponentFixture<CoderListComponent>;

  const fakeActivatedRoute = {
    snapshot: { data: { } }
  } as ActivatedRoute;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        CoderListComponent,
        TranslateModule.forRoot(),
        NoopAnimationsModule
      ],
      providers: [
        provideHttpClient(),
        {
          provide: ActivatedRoute,
          useValue: fakeActivatedRoute
        },
        { provide: SERVER_URL, useValue: environment.backendUrl },
        { provide: AppService, useClass: AppServiceMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CoderListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
