import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { AppInfoComponent } from './app-info.component';

describe('AppInfoComponent', () => {
  let component: AppInfoComponent;
  let fixture: ComponentFixture<AppInfoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [

        TranslateModule.forRoot()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AppInfoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
