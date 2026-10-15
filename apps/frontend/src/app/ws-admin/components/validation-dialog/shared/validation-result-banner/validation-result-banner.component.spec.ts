import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconModule } from '@angular/material/icon';
import { ValidationResultBannerComponent } from './validation-result-banner.component';

describe('ValidationResultBannerComponent', () => {
  let component: ValidationResultBannerComponent;
  let fixture: ComponentFixture<ValidationResultBannerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        MatIconModule,
        ValidationResultBannerComponent
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ValidationResultBannerComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display headline and subline', () => {
    fixture.componentRef.setInput('headline', 'Main Heading');
    fixture.componentRef.setInput('subline', 'Secondary text');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.headline')?.textContent).toContain('Main Heading');
    expect(compiled.querySelector('.subline')?.textContent).toContain('Secondary text');
  });

  it('should apply the correct class based on status', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('status', 'success');
    fixture.detectChanges();
    expect(compiled.querySelector('.validation-result')?.classList).toContain('validation-success');

    fixture.componentRef.setInput('status', 'failed');
    fixture.detectChanges();
    expect(compiled.querySelector('.validation-result')?.classList).toContain('validation-failed');

    fixture.componentRef.setInput('status', 'running');
    fixture.detectChanges();
    expect(compiled.querySelector('.validation-result')?.classList).toContain('validation-running');
  });

  it('should show recommendation when provided and status is failed', () => {
    fixture.componentRef.setInput('status', 'failed');
    fixture.componentRef.setInput('recommendation', 'Try again');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.recommendation')?.textContent).toContain('Try again');
  });
});
