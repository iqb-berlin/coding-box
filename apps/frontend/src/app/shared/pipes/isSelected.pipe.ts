import { Pipe, PipeTransform } from '@angular/core';
import { SelectionModel } from '@angular/cdk/collections';

@Pipe({
  name: 'isSelected',
  standalone: true
})
export class IsSelectedPipe implements PipeTransform {
  transform<T>(selectionModel: SelectionModel<T>, element: T, selectionCount: number): boolean {
    return !!selectionCount && selectionModel.isSelected(element);
  }
}
