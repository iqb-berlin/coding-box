import {
  Component,
  input,
  output
} from '@angular/core';
import { BookletReplay, BookletReplayUnit } from '../../../services/booklet-replay.service';

@Component({
  selector: 'coding-box-booklet-replay',
  templateUrl: './booklet-replay.component.html',
  styleUrls: ['./booklet-replay.component.scss'],
  standalone: true
})
export class BookletReplayComponent {
  bookletData = input<BookletReplay | null>(null);
  unitChanged = output<BookletReplayUnit>();

  currentUnitIndex = 0;
  totalUnits = 0;

  // Getters for the current state
  get currentUnit(): BookletReplayUnit | null {
    const data = this.bookletData();
    if (!data || !data.units || data.units.length === 0) {
      return null;
    }
    return data.units[data.currentUnitIndex];
  }

  // Navigation methods
  nextUnit(): void {
    const data = this.bookletData();
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
    const data = this.bookletData();
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
    const data = this.bookletData();
    if (!data) return false;

    return data.currentUnitIndex < data.units.length - 1;
  }

  hasPreviousUnit(): boolean {
    const data = this.bookletData();
    if (!data) return false;

    return data.currentUnitIndex > 0;
  }

  // Update the current state based on the input
  ngOnChanges(): void {
    const data = this.bookletData();
    if (data) {
      this.currentUnitIndex = data.currentUnitIndex;
      this.totalUnits = data.units.length;
    } else {
      this.currentUnitIndex = 0;
      this.totalUnits = 0;
    }
  }
}
