import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UploadResultsButtonComponent } from './upload-results-button.component';

describe('UploadResultsButtonComponent', () => {
  let component: UploadResultsButtonComponent;
  let fixture: ComponentFixture<UploadResultsButtonComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UploadResultsButtonComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(UploadResultsButtonComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
