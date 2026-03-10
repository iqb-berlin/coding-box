import { Component } from '@angular/core';
import { CodingManagementComponent } from '../coding-management/coding-management.component';

@Component({
  selector: 'coding-box-coding-statistics-view',
  template: '<app-coding-management [hideActionButtons]="true"></app-coding-management>',
  standalone: true,
  imports: [CodingManagementComponent]
})
export class CodingStatisticsViewComponent {}
