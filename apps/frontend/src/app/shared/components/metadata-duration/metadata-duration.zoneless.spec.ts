import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { FormControl } from '@angular/forms';
import { MetadataDurationComponent } from './metadata-duration.component';

describe('Metadata duration input without Zone', () => {
  beforeEach(() => TestBed.configureTestingModule({
    imports: [MetadataDurationComponent, TranslateModule.forRoot()],
    providers: [provideZonelessChangeDetection()]
  }));

  it('preserves typed digits and formats only on blur while publishing seconds', async () => {
    const fixture = TestBed.createComponent(MetadataDurationComponent);
    const control = new FormControl(90);
    fixture.componentInstance.field = { formControl: control, props: {} };
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const inputs = fixture.nativeElement.querySelectorAll('input') as NodeListOf<HTMLInputElement>;
    expect(inputs[0].value).toBe('01');
    expect(inputs[1].value).toBe('30');
    inputs[1].dispatchEvent(new Event('focus'));
    for (const value of ['', '1', '15']) {
      inputs[1].value = value;
      inputs[1].dispatchEvent(new Event('input'));
      // The actual profile form echoes native numeric input through the control.
      control.setValue(60 + Number(value));
      await fixture.whenStable();
      expect(inputs[1].value).toBe(value);
    }
    inputs[1].dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(inputs[1].value).toBe('15');
    expect(control.value).toBe(75);
    control.setValue(125);
    await fixture.whenStable();
    expect(inputs[0].value).toBe('02');
    expect(inputs[1].value).toBe('05');
  });

  it('keeps read-only fields disabled and releases control listeners on destroy', async () => {
    const fixture = TestBed.createComponent(MetadataDurationComponent);
    const control = new FormControl(90);
    fixture.componentInstance.field = { formControl: control, props: { readonly: true } };
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const inputs = fixture.nativeElement.querySelectorAll('input') as NodeListOf<HTMLInputElement>;
    expect(inputs[0].disabled).toBe(true);
    expect(inputs[1].disabled).toBe(true);
    fixture.destroy();
    control.setValue(125);
    expect(fixture.componentInstance.duration).toEqual({ minutes: '01', seconds: '30' });
  });
});
