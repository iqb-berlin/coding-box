import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { SelectReplayComponent } from './select-replay.component';
import { environment } from '../../../environments/environment';
import { HttpClientModule } from '@angular/common/http';

describe('SelectReplayComponent', () => {
  let component: SelectReplayComponent;
  let fixture: ComponentFixture<SelectReplayComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [{
        provide: 'SERVER_URL',
        useValue: environment.backendUrl
      }],
      imports: [
        HttpClientModule,
        TranslateModule.forRoot()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SelectReplayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
