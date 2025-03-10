import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientModule } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ReplayComponent } from './replay.component';
import { environment } from '../../../../environments/environment';

describe('ReplayComponent', () => {
  let component: ReplayComponent;
  let fixture: ComponentFixture<ReplayComponent>;
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
      imports: [ReplayComponent, HttpClientModule, TranslateModule.forRoot()]
    })
      .compileComponents();

    fixture = TestBed.createComponent(ReplayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
