import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WrappedIconComponent } from './wrapped-icon.component';

describe('WrappedIconComponent', () => {
  let component: WrappedIconComponent;
  let fixture: ComponentFixture<WrappedIconComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WrappedIconComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(WrappedIconComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('icon', 'home');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
