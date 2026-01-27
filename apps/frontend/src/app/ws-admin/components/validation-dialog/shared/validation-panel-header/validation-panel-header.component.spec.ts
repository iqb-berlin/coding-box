import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ValidationPanelHeaderComponent } from './validation-panel-header.component';

describe('ValidationPanelHeaderComponent', () => {
  let component: ValidationPanelHeaderComponent;
  let fixture: ComponentFixture<ValidationPanelHeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        MatExpansionModule,
        MatIconModule,
        MatProgressSpinnerModule,
        ValidationPanelHeaderComponent
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ValidationPanelHeaderComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should display the title', () => {
    component.title = 'Test Title';
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.title-text')?.textContent).toContain('Test Title');
  });

  it('should display error count when status is failed', () => {
    component.status = 'failed';
    component.errorCount = 5;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.validation-badge')?.textContent).toContain('5');
  });

  it('should show check circle icon when status is success', () => {
    component.status = 'success';
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('mat-icon')?.textContent).toContain('check_circle');
  });

  it('should show error icon when status is failed', () => {
    component.status = 'failed';
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('mat-icon')?.textContent).toContain('error');
  });

  it('should show hourglass icon when status is running', () => {
    component.status = 'running';
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('mat-icon')?.textContent).toContain('hourglass_empty');
  });
});
