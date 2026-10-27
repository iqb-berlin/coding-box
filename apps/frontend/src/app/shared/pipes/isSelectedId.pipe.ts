import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'isSelectedId',
  standalone: true
})
export class IsSelectedIdPipe implements PipeTransform {
  transform(element: { id: number }, id: number): boolean {
    return element.id === id;
  }
}
