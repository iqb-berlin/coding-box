import {
  Component,
  input,
  output
} from '@angular/core';
import { UnitsReplay, UnitsReplayUnit } from '../../../services/units-replay.service';

@Component({
  selector: 'coding-box-units-replay',
  templateUrl: './units-replay.component.html',
  styleUrls: ['./units-replay.component.scss'],
  standalone: true
})
export class UnitsReplayComponent {
  unitsData = input<UnitsReplay | null>(null);
  unitChanged = output<UnitsReplayUnit>();

  currentUnitIndex = 0;
  totalUnits = 0;

  // Getters for the current state
  get currentUnit(): UnitsReplayUnit | null {
    const data = this.unitsData();
    if (!data || !data.units || data.units.length === 0) {
      return null;
    }
    return data.units[data.currentUnitIndex];
  }

  // Navigation methods
  nextUnit(): void {
    const data = this.unitsData();
    if (!data || !this.hasNextUnit()) {
      return;
    }

    const nextIndex = data.currentUnitIndex + 1;
    if (nextIndex < data.units.length) {
      const nextUnit = data.units[nextIndex];
      this.unitChanged.emit(nextUnit);
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

    return data.currentUnitIndex < data.units.length - 1;
  }

  hasPreviousUnit(): boolean {
    const data = this.unitsData();
    if (!data) return false;

    return data.currentUnitIndex > 0;
  }

  // Update the current state based on the input
  ngOnChanges(): void {
    const data = this.unitsData();
    if (data) {
      this.currentUnitIndex = data.currentUnitIndex;
      this.totalUnits = data.units.length;
    } else {
      this.currentUnitIndex = 0;
      this.totalUnits = 0;
    }
  }
}
