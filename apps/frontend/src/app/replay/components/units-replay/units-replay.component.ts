import {
  Component,
  input,
  output,
  inject
} from '@angular/core';
import { UnitsReplay, UnitsReplayUnit } from '../../../services/units-replay.service';
import { ReplayCodingService } from '../../services/replay-coding.service';

@Component({
  selector: 'coding-box-units-replay',
  templateUrl: './units-replay.component.html',
  styleUrls: ['./units-replay.component.scss'],
  standalone: true
})
export class UnitsReplayComponent {
  private codingService = inject(ReplayCodingService);

  unitsData = input<UnitsReplay | null>(null);
  unitChanged = output<UnitsReplayUnit>();

  currentUnitIndex = 0;
  totalUnits = 0;

  nextUnit(): void {
    const data = this.unitsData();
    if (!data) {
      return;
    }

    const nextIndex = data.currentUnitIndex + 1;
    if (nextIndex < data.units.length) {
      const nextUnit = data.units[nextIndex];
      if (!this.codingService.isUnitCoded(nextUnit)) {
        this.unitChanged.emit(nextUnit);
      }
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
    if (!data) return false;

    const nextIndex = data.currentUnitIndex + 1;
    if (nextIndex >= data.units.length) return false;

    const nextUnit = data.units[nextIndex];
    return !this.codingService.isUnitCoded(nextUnit);
  }

  hasPreviousUnit(): boolean {
    const data = this.unitsData();
    if (!data) return false;

    return data.currentUnitIndex > 0;
  }
}
