import {
  Component,
  input,
  output,
  inject
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { UnitsReplay, UnitsReplayUnit } from '../../../services/units-replay.service';
import { ReplayCodingService } from '../../services/replay-coding.service';

@Component({
  selector: 'coding-box-units-replay',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, TranslateModule],
  templateUrl: './units-replay.component.html',
  styleUrls: ['./units-replay.component.scss'],
  standalone: true
})
export class UnitsReplayComponent {
  private codingService = inject(ReplayCodingService);

  unitsData = input<UnitsReplay | null>(null);
  isCodingActive = input<boolean>(false);
  unitChanged = output<UnitsReplayUnit>();
  openNavigateDialog = output<void>();
  openCommentDialog = output<void>();
  pauseCodingJob = output<void>();

  nextUnit(): void {
    const data = this.unitsData();
    if (!data) {
      return;
    }

    const currentIndex = data.currentUnitIndex;
    const nextIndex = this.codingService.findNextUncodedUnitIndex(data, currentIndex + 1);
    if (nextIndex >= 0 && nextIndex < data.units.length) {
      this.unitChanged.emit(data.units[nextIndex]);
    }
  }

  previousUnit(): void {
    const data = this.unitsData();
    if (!data || !this.hasPreviousUnit()) {
      return;
    }

    const prevIndex = data.currentUnitIndex - 1;
    if (prevIndex >= 0) {
      const prevUnit = data.units[prevIndex];
      this.unitChanged.emit(prevUnit);
    }
  }

  hasNextUnit(): boolean {
    const data = this.unitsData();
    if (!data || !data.units.length) return false;

    const currentUnit = data.units[data.currentUnitIndex];
    if (!currentUnit) return false;

    const compositeKey = this.codingService.generateCompositeKey(
      currentUnit.testPerson || '',
      currentUnit.name,
      currentUnit.variableId || ''
    );

    const hasSelection = this.codingService.selectedCodes.has(compositeKey) ||
                        this.codingService.openSelections.has(compositeKey);
    const nextUncodedIndex = this.codingService.findNextUncodedUnitIndex(data, data.currentUnitIndex + 1);
    return hasSelection && nextUncodedIndex >= 0;
  }

  hasPreviousUnit(): boolean {
    const data = this.unitsData();
    if (!data) return false;

    return data.currentUnitIndex > 0;
  }

  getCompletedCount(): number {
    return this.codingService.getCompletedCount(this.unitsData());
  }

  getOpenCount(): number {
    return this.codingService.getOpenCount(this.unitsData());
  }

  getProgressPercentage(): number {
    return this.codingService.getProgressPercentage(this.unitsData());
  }

  onNavigateClick(): void {
    this.openNavigateDialog.emit();
  }

  onCommentClick(): void {
    this.openCommentDialog.emit();
  }

  onPauseClick(): void {
    this.pauseCodingJob.emit();
  }

  get isPausingJob(): boolean {
    return this.codingService.isPausingJob;
  }

  get isCodingJobCompleted(): boolean {
    return this.codingService.isCodingJobCompleted;
  }

  hasCodingJob(): boolean {
    return !!this.codingService.codingJobId;
  }

  get totalUnits(): number {
    return this.unitsData()?.units.length || 0;
  }
}
