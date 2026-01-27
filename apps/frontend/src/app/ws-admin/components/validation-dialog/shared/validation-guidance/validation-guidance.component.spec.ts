import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconModule } from '@angular/material/icon';
import { ValidationGuidanceComponent } from './validation-guidance.component';

describe('ValidationGuidanceComponent', () => {
  let component: ValidationGuidanceComponent;
  let fixture: ComponentFixture<ValidationGuidanceComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        MatIconModule,
        ValidationGuidanceComponent
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ValidationGuidanceComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display the description', () => {
    component.description = 'Follow these steps';
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.validation-details-intro')?.textContent).toContain('Follow these steps');
  });

  it('should display whyText when provided', () => {
    component.whyText = 'It is crucial for data integrity';
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Warum ist das wichtig?');
    expect(compiled.textContent).toContain('It is crucial for data integrity');
  });

  it('should display fixHint when provided', () => {
    component.fixHint = 'Click the fix button';
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('So beheben Sie es:');
    expect(compiled.textContent).toContain('Click the fix button');
  });
});
