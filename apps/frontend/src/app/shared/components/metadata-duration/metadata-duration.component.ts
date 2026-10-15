import {
  ChangeDetectorRef, Component, DestroyRef, inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateModule } from '@ngx-translate/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormlyDurationComponent } from '@iqb/metadata-components';

@Component({
  selector: 'iqb-formly-duration',
  standalone: true,
  imports: [TranslateModule, MatFormFieldModule, MatInputModule],
  template: `
    <div class="duration-input-group">
      <mat-form-field>
        <input type="number" matInput [attr.aria-label]="'metadata-duration.minutes' | translate"
          [disabled]="props.readonly ?? false" [min]="minMinutes"
          [attr.max]="maxMinutes > 0 ? maxMinutes : null"
          [value]="minutes" (focus)="editing = true" (input)="setMinutes($event)"
          (blur)="normalizeDuration()" />
      </mat-form-field>
      <span>:</span>
      <mat-form-field>
        <input type="number" matInput [attr.aria-label]="'metadata-duration.seconds' | translate"
          [disabled]="props.readonly ?? false" [min]="minSeconds"
          [attr.max]="maxSeconds > 0 ? maxSeconds : null"
          [value]="seconds" (focus)="editing = true" (input)="setSeconds($event)"
          (blur)="normalizeDuration()" />
      </mat-form-field>
    </div>
  `,
  styles: [`
    .duration-input-group { display: inline-flex; align-items: baseline; gap: 8px; }
    mat-form-field { width: 88px; }
  `]
})
export class MetadataDurationComponent extends FormlyDurationComponent {
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  minutes = '';
  seconds = '';
  editing = false;

  override ngOnInit(): void {
    super.ngOnInit();
    this.syncInputValues();
    this.formControl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (!this.editing) this.syncInputValues();
        this.changeDetectorRef.markForCheck();
      });
  }

  setMinutes(event: Event): void {
    this.minutes = (event.target as HTMLInputElement).value;
  }

  setSeconds(event: Event): void {
    this.seconds = (event.target as HTMLInputElement).value;
  }

  private syncInputValues(): void {
    this.minutes = this.duration.minutes;
    this.seconds = this.duration.seconds;
  }

  // Normalize after editing, keeping library model echoes from moving the caret.
  normalizeDuration(): void {
    this.editing = false;
    this.duration = { minutes: this.minutes, seconds: this.seconds };
    super.durationChange();
    this.syncInputValues();
  }
}
