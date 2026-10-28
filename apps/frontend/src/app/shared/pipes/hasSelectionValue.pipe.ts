import { Pipe, PipeTransform } from '@angular/core';
import { SelectionModel } from '@angular/cdk/collections';

@Pipe({
  name: 'hasSelectionValue',
  standalone: true
})
export class HasSelectionValuePipe implements PipeTransform {
  transform<T>(selectionModel: SelectionModel<T>, selectionLength: number): boolean {
    return !!selectionLength && selectionModel.hasValue();
  }
}
