import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { TestFilesComponent } from './test-files.component';

describe('TestFilesComponent', () => {
  let component: TestFilesComponent;
  let fixture: ComponentFixture<TestFilesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [

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
