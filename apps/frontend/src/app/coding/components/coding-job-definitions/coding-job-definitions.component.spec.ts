import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CodingJobDefinitionsComponent } from './coding-job-definitions.component';

describe('CodingJobDefinitionsComponent', () => {
  let component: CodingJobDefinitionsComponent;
  let fixture: ComponentFixture<CodingJobDefinitionsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodingJobDefinitionsComponent]
    })
      .compileComponents();

    fixture = TestBed.createComponent(CodingJobDefinitionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
