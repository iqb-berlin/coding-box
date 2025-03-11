import {
  MatTable,
  MatHeaderCellDef,
  MatCellDef,
  MatHeaderRowDef,
  MatRowDef,
  MatTableDataSource, MatCell, MatColumnDef, MatHeaderCell, MatHeaderRow, MatRow
} from '@angular/material/table';
import { Component, OnInit, ViewChild } from '@angular/core';
import { MatSort, MatSortHeader } from '@angular/material/sort';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { SelectionModel } from '@angular/cdk/collections';
import { MatLabel } from '@angular/material/form-field';
import {
  MatAccordion,
  MatExpansionPanel, MatExpansionPanelHeader,
  MatExpansionPanelTitle
} from '@angular/material/expansion';
import { MatList, MatListItem } from '@angular/material/list';
import { MatTooltip } from '@angular/material/tooltip';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { TestGroupsInListDto } from '../../../../../../../api-dto/test-groups/testgroups-in-list.dto';
import { MatInput } from '@angular/material/input';

interface P {
  code: string;
  group: string;
  login: string;
  uploaded_at: Date;

}

@Component({
  selector: 'coding-box-test-results',
  templateUrl: './test-results.component.html',
  styleUrls: ['./test-results.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [FormsModule, MatExpansionPanelHeader, MatLabel, MatPaginatorModule, TranslateModule, MatTable, MatCellDef, MatHeaderCellDef, MatHeaderRowDef, MatRowDef, MatCell, MatColumnDef, MatHeaderCell, MatHeaderRow, MatRow, MatSort, MatSortHeader, MatAccordion, MatExpansionPanel, MatExpansionPanelTitle, MatList, MatListItem, MatTooltip, MatInput]
})
export class TestResultsComponent implements OnInit {
  tableSelectionCheckboxes = new SelectionModel<TestGroupsInListDto>(true, []);
  dataSource !: MatTableDataSource<P>;
  displayedColumns: string[] = ['code', 'group', 'login', 'uploaded_at'];
  data: any = [];
  booklets: any = [];
  results: any = [];
  responses: any = [];
  logs: any = [];
  totalRecords: number = 0; // Gesamtanzahl der Datensätze
  pageSize: number = 10; // Standardanzahl der Seiten
  selectedUnit: any;

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private backendService: BackendService,
    private appService: AppService
  ) {
  }

  ngOnInit(): void {
    this.createTestResultsList();
    // Setze Paginator und Sortierung
    console.log(this.displayedColumns);
    console.log(this.dataSource);
  }

  onRowClick(row: P): void {
    console.log(row);
    const foundPerson = this.data.find((person: { code: string; }) => person.code === row.code);
    if (foundPerson && foundPerson.booklets) {
      this.booklets = foundPerson.booklets;
    }

    // this.router.navigate(['/detail-view', row.code]);
  }

  applyFilter(event: Event): void {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();

    // Paginator auf die erste Seite zurücksetzen
    if (this.dataSource.paginator) {
      this.dataSource.paginator.firstPage();
    }
  }

  onListItemClick(unit: any): void {
    console.log('Clicked unit:', unit);
    this.responses = unit.subforms[0].responses;
    this.logs = this.createUnitHistory(unit);
    this.selectedUnit = unit;
    // Hier kannst du weitere Logik implementieren
  }

  calculateDetailedTimeDifferences = (data: { ts: string, key: string, parameter: string }[]) => {
    const results = [];

    for (let i = 0; i < data.length - 1; i++) {
      const currentTs = parseInt(data[i].ts, 10);
      const nextTs = parseInt(data[i + 1].ts, 10);
      const differenceInSeconds = (nextTs - currentTs) / 1000;

      results.push({
        from: data[i].key,
        to: data[i + 1].key,
        timeDifferenceInSeconds: differenceInSeconds
      });
    }

    return results;
  };

  groupByPlayerLoading = (array: any[]) => {
    const grouped = []; // Array zum Speichern der Blöcke
    let currentBlock: any[] = []; // Aktueller Block

    for (const item of array) {
      if (item.key === 'PLAYER' && item.parameter === 'LOADING') {
        // Wenn ein neuer PLAYER_LOADING gefunden wird
        if (currentBlock.length > 0) {
          grouped.push(currentBlock); // Aktuellen Block speichern
        }
        currentBlock = []; // Neuen Block starten
      }
      currentBlock.push(item); // Aktuelles Item hinzufügen
    }

    // Den letzten Block speichern (falls vorhanden)
    if (currentBlock.length > 0) {
      grouped.push(currentBlock);
    }

    return grouped;
  };

  createUnitHistory(unit: { logs: any[]; }): any {
    // Aufruf der Funktion
    return this.groupByPlayerLoading(unit.logs);
  }

  // Konvertiere Timestamp in lesbares Datum
  formatTimestamp(timestamp: string): string {
    const date = new Date(Number(timestamp));
    return date.toLocaleString(); // z.B. "31.12.2023, 23:59:59"
  }

  getColor(status: string): string {
    switch (status) {
      case 'VALUE_CHANGED':
        return 'green';
      case 'NOT_REACHED':
        return 'blue';
      default:
        return 'lightgrey';
    }
  }

  createTestResultsList(): void {
    this.backendService.getTestResults(this.appService.selectedWorkspaceId)
      .subscribe(results => {
        this.data = results;
        console.log(results);
        const mappedResults = results.map(result => ({
          code: result.code,
          group: result.group,
          login: result.login,
          uploaded_at: result.uploaded_at

        }));
        // console.log(mappedResults);
        this.dataSource = new MatTableDataSource(mappedResults);
        this.totalRecords = mappedResults.length;
        this.dataSource.paginator = this.paginator;
        this.dataSource.sort = this.sort;
        console.log(this.dataSource, 'this.dataSource');
        console.log(this.displayedColumns);
      });
  }
}
