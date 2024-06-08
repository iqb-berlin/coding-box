import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UnitPlayerComponent } from './unit-player.component';
import { TranslateModule } from '@ngx-translate/core';
import { environment } from '../../../../environments/environment';
import { HttpClientModule } from '@angular/common/http';

describe('UnitPlayerComponent', () => {
  let component: UnitPlayerComponent;
  let fixture: ComponentFixture<UnitPlayerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [{
        provide: 'SERVER_URL',
        useValue: environment.backendUrl
      }],
      imports: [
        UnitPlayerComponent,
        TranslateModule.forRoot(),
        HttpClientModule]
    })
    .compileComponents();

    fixture = TestBed.createComponent(UnitPlayerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
