import {
  MatTableDataSource
} from '@angular/material/table';
import { Component, OnInit, ViewChild } from '@angular/core';
import { MatSort } from '@angular/material/sort';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { SelectionModel } from '@angular/cdk/collections';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { TestGroupsInListDto } from '../../../../../../../api-dto/test-groups/testgroups-in-list.dto';

interface P {
  code: string;
  group: string;
  login: string;
  uploaded_at: Date;

}

@Component({
  selector: 'coding-box-unit-results',
  templateUrl: './unit-results.component.html',
  styleUrls: ['./unit-results.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [FormsModule, MatPaginatorModule, TranslateModule]
})
export class UnitResultsComponent implements OnInit {
  tableSelectionCheckboxes = new SelectionModel<TestGroupsInListDto>(true, []);
  dataSource !: MatTableDataSource<P>;
  displayedColumns: string[] = ['code', 'group', 'login', 'uploaded_at'];
  data: any = [];
  booklets: any = [];
  results: any = [];
  logs: any = [];
  totalRecords: number = 0; // Gesamtanzahl der Datensätze
  pageSize: number = 10; // Standardanzahl der Seiten

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private backendService: BackendService,
    private appService: AppService
  ) {
  }

  ngOnInit(): void {
    this.createTestResultsList();
  }

  onRowClick(row: P): void {
    const foundPerson = this.data.find((person: { code: string; }) => person.code === row.code);
    if (foundPerson && foundPerson.booklets) {
      this.booklets = foundPerson.booklets;
    }
  }

  applyFilter(event: Event): void {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();

    // Paginator auf die erste Seite zurücksetzen
    if (this.dataSource.paginator) {
      this.dataSource.paginator.firstPage();
    }
  }

  createTestResultsList(page: number = 0, limit: number = 10): void {
    this.backendService.getTestResults(this.appService.selectedWorkspaceId, page, limit)
      .subscribe(response => {
        // `response` soll die Ergebnisse und die Gesamtanzahl zurückgeben, z. B.:
        // { data: [], totalRecords: number }.
        const { data, totalRecords } = response;
        this.data = data;

        const mappedResults = data.map((result: any) => ({
          code: result.code,
          group: result.group,
          login: result.login,
          uploaded_at: result.uploaded_at
        }));

        this.dataSource = new MatTableDataSource(mappedResults);
        this.totalRecords = totalRecords; // Gesamtanzahl der Datensätze vom Backend
        this.dataSource.sort = this.sort;
      });
  }

}
