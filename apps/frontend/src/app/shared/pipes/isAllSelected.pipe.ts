import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'isAllSelected',
  standalone: true
})
export class IsAllSelectedPipe implements PipeTransform {
  transform(selectionCount: number, total: number): boolean {
    return IsAllSelectedPipe.isAllSelected(selectionCount, total);
  }

  static isAllSelected(selectionCount: number, total: number): boolean {
    return selectionCount === total;
  }
}
