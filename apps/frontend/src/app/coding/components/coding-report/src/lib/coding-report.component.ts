import {
  Component,
  Input,
  OnInit,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { CodingReportDto } from './coding-report.dto';

@Component({
  selector: 'coding-box-coding-report',
  templateUrl: './coding-report.component.html',
  styleUrls: ['./coding-report.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    TranslateModule,
    MatDialogModule,
    MatButtonModule,
    MatTableModule,
    MatTabsModule,
    MatSortModule,
    MatProgressSpinnerModule,
    MatSlideToggle,
    MatFormField,
    MatInput,
    MatLabel
  ]
})
export class CodingReportComponent implements OnInit {
  @Input() codingReport: CodingReportDto[] = [];

  displayedColumns: string[] = ['unit', 'variable', 'item', 'validation', 'codingType'];
  dataSource!: MatTableDataSource<CodingReportDto>;
  codedVariablesOnly = true;
  isLoading = false;

  @ViewChild(MatSort) set matSort(sort: MatSort) {
    if (this.dataSource) {
      this.dataSource.sort = sort;
    }
  }

  ngOnInit(): void {
    this.updateDataSource();
  }

  private updateDataSource(): void {
    const filteredRows = this.codedVariablesOnly ?
      this.codingReport.filter((row: CodingReportDto) => row.codingType !== 'keine Regeln') :
      this.codingReport;
    this.dataSource = new MatTableDataSource(filteredRows);
  }

  applyFilter(event: Event): void {
    const inputElement = event.target as HTMLInputElement;
    if (inputElement) {
      this.dataSource.filter = inputElement.value.trim().toLowerCase();
    }
  }

  toggleChange(): void {
    this.codedVariablesOnly = !this.codedVariablesOnly;
    this.updateDataSource();
  }
}
