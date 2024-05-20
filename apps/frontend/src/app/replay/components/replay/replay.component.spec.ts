import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ReplayComponent } from './replay.component';

describe('ReplayComponent', () => {
  let component: ReplayComponent;
  let fixture: ComponentFixture<ReplayComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReplayComponent]
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
