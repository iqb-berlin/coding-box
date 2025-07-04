import {
  Component, Inject, inject, ViewChild, AfterViewInit, OnInit
} from '@angular/core';
import {
  MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef
} from '@angular/material/dialog';
import { MatStepperModule } from '@angular/material/stepper';
import { MatButtonModule } from '@angular/material/button';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatPaginator, MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { InvalidVariableDto } from '../../../../../../../api-dto/files/variable-validation.dto';
import { TestTakersValidationDto, MissingPersonDto } from '../../../../../../../api-dto/files/testtakers-validation.dto';
import { ContentDialogComponent } from '../../../shared/dialogs/content-dialog/content-dialog.component';

@Component({
  selector: 'coding-box-validation-dialog',
  templateUrl: './validation-dialog.component.html',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatStepperModule,
    MatButtonModule,
    FormsModule,
    ReactiveFormsModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatExpansionModule,
    MatSnackBarModule,
    MatPaginatorModule,
    MatIconModule
  ],
  styles: [`
    .actions-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 16px;
    }

    .mat-expansion-panel {
      margin-bottom: 16px;
    }

    .mat-spinner {
      display: inline-block;
      margin-right: 8px;
      vertical-align: middle;
    }

    table {
      width: 100%;
    }

    .validation-result {
      display: flex;
      align-items: center;
      margin: 10px 0;
      padding: 8px 16px;
      border-radius: 4px;
      font-weight: 500;
    }

    .validation-success {
      background-color: rgba(76, 175, 80, 0.1);
      color: #4CAF50;
      border: 1px solid #4CAF50;
    }

    .validation-error {
      background-color: rgba(244, 67, 54, 0.1);
      color: #F44336;
      border: 1px solid #F44336;
    }

    .validation-result mat-icon {
      margin-right: 8px;
    }
  `]
})
export class ValidationDialogComponent implements AfterViewInit, OnInit {
  @ViewChild('variablePaginator') variablePaginator!: MatPaginator;
  @ViewChild('variableTypePaginator') variableTypePaginator!: MatPaginator;
  @ViewChild('statusVariablePaginator') statusVariablePaginator!: MatPaginator;
  @ViewChild('groupResponsesPaginator') groupResponsesPaginator!: MatPaginator;

  firstStepCompleted = true;
  backendService = inject(BackendService);
  appService = inject(AppService);

  // Variable validation properties
  invalidVariables: InvalidVariableDto[] = [];
  totalInvalidVariables: number = 0;
  currentVariablePage: number = 1;
  variablePageSize: number = 10;

  // Variable type validation properties
  invalidTypeVariables: InvalidVariableDto[] = [];
  totalInvalidTypeVariables: number = 0;
  currentTypeVariablePage: number = 1;
  typeVariablePageSize: number = 10;

  // Response status validation properties
  invalidStatusVariables: InvalidVariableDto[] = [];
  totalInvalidStatusVariables: number = 0;
  currentStatusVariablePage: number = 1;
  statusVariablePageSize: number = 10;

  // Group responses validation properties
  groupResponsesResult: {
    testTakersFound: boolean;
    groupsWithResponses: { group: string; hasResponse: boolean }[];
    allGroupsHaveResponses: boolean;
  } | null = null;

  isGroupResponsesValidationRunning: boolean = false;

  groupResponsesValidationWasRun: boolean = false;

  expandedGroupResponsesPanel: boolean = false;

  paginatedGroupResponses = new MatTableDataSource<{ group: string; hasResponse: boolean }>([]);

  // Group responses pagination properties
  currentGroupResponsesPage: number = 1;
  groupResponsesPageSize: number = 10;
  totalGroupResponses: number = 0;

  // TestTakers validation properties
  testTakersValidationResult: TestTakersValidationDto | null = null;
  isTestTakersValidationRunning: boolean = false;
  testTakersValidationWasRun: boolean = false;
  expandedMissingPersonsPanel: boolean = false;
  paginatedMissingPersons = new MatTableDataSource<MissingPersonDto>([]);

  // Validation running flags
  isVariableValidationRunning: boolean = false;
  isVariableTypeValidationRunning: boolean = false;
  isResponseStatusValidationRunning: boolean = false;

  // Validation was run flags
  validateVariablesWasRun: boolean = false;
  validateVariableTypesWasRun: boolean = false;
  validateResponseStatusWasRun: boolean = false;
  isDeletingResponses: boolean = false;
  expandedPanel: boolean = false;
  expandedTypePanel: boolean = false;
  expandedStatusPanel: boolean = false;
  selectedResponses: Set<number> = new Set<number>();
  selectedTypeResponses: Set<number> = new Set<number>();
  selectedStatusResponses: Set<number> = new Set<number>();

  // Pagination properties
  pageSizeOptions = [5, 10, 25, 50];

  // Paginated data
  paginatedVariables = new MatTableDataSource<InvalidVariableDto>([]);
  paginatedTypeVariables = new MatTableDataSource<InvalidVariableDto>([]);
  paginatedStatusVariables = new MatTableDataSource<InvalidVariableDto>([]);

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: unknown,
    private dialogRef: MatDialogRef<ValidationDialogComponent>,
    private snackBar: MatSnackBar,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    // Initialize component
  }

  ngAfterViewInit(): void {
    // Set up paginators after view is initialized
    this.paginatedVariables.paginator = this.variablePaginator;
    this.paginatedTypeVariables.paginator = this.variableTypePaginator;
    this.paginatedStatusVariables.paginator = this.statusVariablePaginator;
    this.paginatedGroupResponses.paginator = this.groupResponsesPaginator;
  }

  updatePaginatedVariables(): void {
    this.paginatedVariables.data = this.invalidVariables;
  }

  updatePaginatedMissingPersons(): void {
    if (this.testTakersValidationResult) {
      this.paginatedMissingPersons.data = this.testTakersValidationResult.missingPersons;
    }
  }

  updatePaginatedGroupResponses(): void {
    if (this.groupResponsesResult) {
      this.paginatedGroupResponses.data = this.groupResponsesResult.groupsWithResponses;
      // totalGroupResponses is now set from the server response
    }
  }

  onGroupResponsesPageChange(event: PageEvent): void {
    this.currentGroupResponsesPage = event.pageIndex + 1;
    this.groupResponsesPageSize = event.pageSize;

    // Reload data from server with new pagination parameters
    this.isGroupResponsesValidationRunning = true;
    this.backendService.validateGroupResponses(
      this.appService.selectedWorkspaceId,
      this.currentGroupResponsesPage,
      this.groupResponsesPageSize
    ).subscribe(result => {
      this.groupResponsesResult = result;
      this.totalGroupResponses = result.total;
      this.updatePaginatedGroupResponses();
      this.isGroupResponsesValidationRunning = false;
    });
  }

  validateTestTakers(): void {
    this.isTestTakersValidationRunning = true;
    this.testTakersValidationResult = null;
    this.testTakersValidationWasRun = false;
    this.backendService.validateTestTakers(this.appService.selectedWorkspaceId)
      .subscribe(result => {
        this.testTakersValidationResult = result;
        this.updatePaginatedMissingPersons();
        this.isTestTakersValidationRunning = false;
        this.testTakersValidationWasRun = true;
      });
  }

  toggleMissingPersonsExpansion(): void {
    this.expandedMissingPersonsPanel = !this.expandedMissingPersonsPanel;
  }

  toggleGroupResponsesExpansion(): void {
    this.expandedGroupResponsesPanel = !this.expandedGroupResponsesPanel;
  }

  validateGroupResponses(): void {
    this.isGroupResponsesValidationRunning = true;
    this.groupResponsesResult = null;
    this.groupResponsesValidationWasRun = false;
    this.currentGroupResponsesPage = 1;
    this.backendService.validateGroupResponses(
      this.appService.selectedWorkspaceId,
      this.currentGroupResponsesPage,
      this.groupResponsesPageSize
    ).subscribe(result => {
      this.groupResponsesResult = result;
      this.totalGroupResponses = result.total;
      this.updatePaginatedGroupResponses();
      this.isGroupResponsesValidationRunning = false;
      this.groupResponsesValidationWasRun = true;
    });
  }

  updatePaginatedTypeVariables(): void {
    this.paginatedTypeVariables.data = this.invalidTypeVariables;
  }

  updatePaginatedStatusVariables(): void {
    this.paginatedStatusVariables.data = this.invalidStatusVariables;
  }

  validateVariables(): void {
    this.isVariableValidationRunning = true;
    this.invalidVariables = [];
    this.totalInvalidVariables = 0;
    this.validateVariablesWasRun = false;
    this.selectedResponses.clear();
    this.backendService.validateVariables(
      this.appService.selectedWorkspaceId,
      this.currentVariablePage,
      this.variablePageSize
    ).subscribe(result => {
      this.invalidVariables = result.data;
      this.totalInvalidVariables = result.total;
      this.currentVariablePage = result.page;
      this.variablePageSize = result.limit;
      this.updatePaginatedVariables();
      this.isVariableValidationRunning = false;
      this.validateVariablesWasRun = true;
    });
  }

  onVariablePageChange(event: PageEvent): void {
    this.currentVariablePage = event.pageIndex + 1;
    this.variablePageSize = event.pageSize;
    this.validateVariables();
  }

  toggleResponseSelection(responseId: number | undefined): void {
    if (responseId === undefined) return;

    if (this.selectedResponses.has(responseId)) {
      this.selectedResponses.delete(responseId);
    } else {
      this.selectedResponses.add(responseId);
    }
  }

  isResponseSelected(responseId: number | undefined): boolean {
    return responseId !== undefined && this.selectedResponses.has(responseId);
  }

  selectAllResponses(): void {
    this.invalidVariables.forEach(variable => {
      if (variable.responseId !== undefined) {
        this.selectedResponses.add(variable.responseId);
      }
    });
  }

  deselectAllResponses(): void {
    this.selectedResponses.clear();
  }

  deleteSelectedResponses(): void {
    if (this.selectedResponses.size === 0) {
      this.snackBar.open('Keine Antworten ausgewählt', 'Schließen', { duration: 3000 });
      return;
    }

    this.isDeletingResponses = true;
    const responseIds = Array.from(this.selectedResponses);

    this.backendService.deleteInvalidResponses(this.appService.selectedWorkspaceId, responseIds)
      .subscribe(deletedCount => {
        this.isDeletingResponses = false;
        this.snackBar.open(`${deletedCount} Antworten gelöscht`, 'Schließen', { duration: 3000 });

        // Refresh the data after deletion
        this.validateVariables();
        this.selectedResponses.clear();
      });
  }

  deleteAllResponses(): void {
    if (this.invalidVariables.length === 0) {
      this.snackBar.open('Keine ungültigen Variablen vorhanden', 'Schließen', { duration: 3000 });
      return;
    }

    // Create confirmation dialog
    const dialogRef = this.dialog.open(ContentDialogComponent, {
      width: '400px',
      data: {
        title: 'Alle Einträge löschen',
        content: `Wirklich alle ${this.totalInvalidVariables} ungültigen Variablen löschen?`,
        isJson: false,
        isXml: false,
        showDeleteButton: true
      }
    });

    dialogRef.afterClosed().subscribe(deleteFromDb => {
      if (deleteFromDb) {
        this.isDeletingResponses = true;
        // Get all response IDs
        const responseIds = this.invalidVariables
          .filter(variable => variable.responseId !== undefined)
          .map(variable => variable.responseId as number);

        this.backendService.deleteInvalidResponses(this.appService.selectedWorkspaceId, responseIds)
          .subscribe(deletedCount => {
            this.isDeletingResponses = false;
            this.snackBar.open(`${deletedCount} Antworten gelöscht`, 'Schließen', { duration: 3000 });

            // Refresh the data after deletion
            this.validateVariables();
            this.selectedResponses.clear();
          });
      }
    });
  }

  toggleExpansion(): void {
    this.expandedPanel = !this.expandedPanel;
  }

  validateVariableTypes(): void {
    this.isVariableTypeValidationRunning = true;
    this.invalidTypeVariables = [];
    this.totalInvalidTypeVariables = 0;
    this.validateVariableTypesWasRun = false;
    this.selectedTypeResponses.clear();
    this.backendService.validateVariableTypes(
      this.appService.selectedWorkspaceId,
      this.currentTypeVariablePage,
      this.typeVariablePageSize
    ).subscribe(result => {
      this.invalidTypeVariables = result.data;
      this.totalInvalidTypeVariables = result.total;
      this.currentTypeVariablePage = result.page;
      this.typeVariablePageSize = result.limit;
      this.updatePaginatedTypeVariables();
      this.isVariableTypeValidationRunning = false;
      this.validateVariableTypesWasRun = true;
    });
  }

  validateResponseStatus(): void {
    this.isResponseStatusValidationRunning = true;
    this.invalidStatusVariables = [];
    this.totalInvalidStatusVariables = 0;
    this.validateResponseStatusWasRun = false;
    this.selectedStatusResponses.clear();
    this.backendService.validateResponseStatus(
      this.appService.selectedWorkspaceId,
      this.currentStatusVariablePage,
      this.statusVariablePageSize
    ).subscribe(result => {
      this.invalidStatusVariables = result.data;
      this.totalInvalidStatusVariables = result.total;
      this.currentStatusVariablePage = result.page;
      this.statusVariablePageSize = result.limit;
      this.updatePaginatedStatusVariables();
      this.isResponseStatusValidationRunning = false;
      this.validateResponseStatusWasRun = true;
    });
  }

  onTypeVariablePageChange(event: PageEvent): void {
    this.currentTypeVariablePage = event.pageIndex + 1;
    this.typeVariablePageSize = event.pageSize;
    this.validateVariableTypes();
  }

  onStatusVariablePageChange(event: PageEvent): void {
    this.currentStatusVariablePage = event.pageIndex + 1;
    this.statusVariablePageSize = event.pageSize;
    this.validateResponseStatus();
  }

  toggleTypeResponseSelection(responseId: number | undefined): void {
    if (responseId === undefined) return;

    if (this.selectedTypeResponses.has(responseId)) {
      this.selectedTypeResponses.delete(responseId);
    } else {
      this.selectedTypeResponses.add(responseId);
    }
  }

  isTypeResponseSelected(responseId: number | undefined): boolean {
    return responseId !== undefined && this.selectedTypeResponses.has(responseId);
  }

  selectAllTypeResponses(): void {
    this.invalidTypeVariables.forEach(variable => {
      if (variable.responseId !== undefined) {
        this.selectedTypeResponses.add(variable.responseId);
      }
    });
  }

  deselectAllTypeResponses(): void {
    this.selectedTypeResponses.clear();
  }

  deleteSelectedTypeResponses(): void {
    if (this.selectedTypeResponses.size === 0) {
      this.snackBar.open('Keine Antworten ausgewählt', 'Schließen', { duration: 3000 });
      return;
    }

    this.isDeletingResponses = true;
    const responseIds = Array.from(this.selectedTypeResponses);

    this.backendService.deleteInvalidResponses(this.appService.selectedWorkspaceId, responseIds)
      .subscribe(deletedCount => {
        this.isDeletingResponses = false;
        this.snackBar.open(`${deletedCount} Antworten gelöscht`, 'Schließen', { duration: 3000 });

        // Refresh the data after deletion
        this.validateVariableTypes();
        this.selectedTypeResponses.clear();
      });
  }

  deleteAllTypeResponses(): void {
    if (this.invalidTypeVariables.length === 0) {
      this.snackBar.open('Keine ungültigen Variablentypen vorhanden', 'Schließen', { duration: 3000 });
      return;
    }

    // Create confirmation dialog
    const dialogRef = this.dialog.open(ContentDialogComponent, {
      width: '400px',
      data: {
        title: 'Alle Einträge löschen',
        content: `Wirklich alle ${this.totalInvalidTypeVariables} ungültigen Variablentypen löschen?`,
        isJson: false,
        isXml: false,
        showDeleteButton: true
      }
    });

    dialogRef.afterClosed().subscribe(deleteFromDb => {
      if (deleteFromDb) {
        this.isDeletingResponses = true;
        // Get all response IDs
        const responseIds = this.invalidTypeVariables
          .filter(variable => variable.responseId !== undefined)
          .map(variable => variable.responseId as number);

        this.backendService.deleteInvalidResponses(this.appService.selectedWorkspaceId, responseIds)
          .subscribe(deletedCount => {
            this.isDeletingResponses = false;
            this.snackBar.open(`${deletedCount} Antworten gelöscht`, 'Schließen', { duration: 3000 });

            // Refresh the data after deletion
            this.validateVariableTypes();
            this.selectedTypeResponses.clear();
          });
      }
    });
  }

  toggleTypeExpansion(): void {
    this.expandedTypePanel = !this.expandedTypePanel;
  }

  toggleStatusResponseSelection(responseId: number | undefined): void {
    if (responseId === undefined) return;

    if (this.selectedStatusResponses.has(responseId)) {
      this.selectedStatusResponses.delete(responseId);
    } else {
      this.selectedStatusResponses.add(responseId);
    }
  }

  isStatusResponseSelected(responseId: number | undefined): boolean {
    return responseId !== undefined && this.selectedStatusResponses.has(responseId);
  }

  selectAllStatusResponses(): void {
    this.invalidStatusVariables.forEach(variable => {
      if (variable.responseId !== undefined) {
        this.selectedStatusResponses.add(variable.responseId);
      }
    });
  }

  deselectAllStatusResponses(): void {
    this.selectedStatusResponses.clear();
  }

  deleteSelectedStatusResponses(): void {
    if (this.selectedStatusResponses.size === 0) {
      this.snackBar.open('Keine Antworten ausgewählt', 'Schließen', { duration: 3000 });
      return;
    }

    this.isDeletingResponses = true;
    const responseIds = Array.from(this.selectedStatusResponses);

    this.backendService.deleteInvalidResponses(this.appService.selectedWorkspaceId, responseIds)
      .subscribe(deletedCount => {
        this.isDeletingResponses = false;
        this.snackBar.open(`${deletedCount} Antworten gelöscht`, 'Schließen', { duration: 3000 });

        // Refresh the data after deletion
        this.validateResponseStatus();
        this.selectedStatusResponses.clear();
      });
  }

  deleteAllStatusResponses(): void {
    if (this.invalidStatusVariables.length === 0) {
      this.snackBar.open('Keine ungültigen Antwortstatus vorhanden', 'Schließen', { duration: 3000 });
      return;
    }

    // Create confirmation dialog
    const dialogRef = this.dialog.open(ContentDialogComponent, {
      width: '400px',
      data: {
        title: 'Alle Einträge löschen',
        content: `Wirklich alle ${this.totalInvalidStatusVariables} ungültigen Antwortstatus löschen?`,
        isJson: false,
        isXml: false,
        showDeleteButton: true
      }
    });

    dialogRef.afterClosed().subscribe(deleteFromDb => {
      if (deleteFromDb) {
        this.isDeletingResponses = true;
        // Get all response IDs
        const responseIds = this.invalidStatusVariables
          .filter(variable => variable.responseId !== undefined)
          .map(variable => variable.responseId as number);

        this.backendService.deleteInvalidResponses(this.appService.selectedWorkspaceId, responseIds)
          .subscribe(deletedCount => {
            this.isDeletingResponses = false;
            this.snackBar.open(`${deletedCount} Antworten gelöscht`, 'Schließen', { duration: 3000 });

            // Refresh the data after deletion
            this.validateResponseStatus();
            this.selectedStatusResponses.clear();
          });
      }
    });
  }

  toggleStatusExpansion(): void {
    this.expandedStatusPanel = !this.expandedStatusPanel;
  }

  closeWithResults(): void {
    this.dialogRef.close({
      invalidVariables: this.invalidVariables,
      totalInvalidVariables: this.totalInvalidVariables,
      invalidTypeVariables: this.invalidTypeVariables,
      totalInvalidTypeVariables: this.totalInvalidTypeVariables,
      invalidStatusVariables: this.invalidStatusVariables,
      totalInvalidStatusVariables: this.totalInvalidStatusVariables
    });
  }

  /**
   * Extracts the unit ID from the fileName
   * @param fileName The fileName in the format "Unit unitName"
   * @returns The unit name
   */
  extractUnitName(fileName: string): string {
    // The fileName is in the format "Unit unitName"
    const match = fileName.match(/^Unit\s+(.+)$/);
    return match ? match[1] : fileName;
  }

  /**
   * Shows the unit XML content in a dialog
   * @param fileName The fileName in the format "Unit unitName"
   */
  showUnitXml(fileName: string): void {
    const unitName = this.extractUnitName(fileName);

    this.backendService.getUnitContentXml(this.appService.selectedWorkspaceId, Number(unitName))
      .subscribe(xmlContent => {
        if (xmlContent) {
          this.dialog.open(ContentDialogComponent, {
            width: '80%',
            data: {
              title: `Unit XML: ${unitName}`,
              content: xmlContent,
              isXml: true
            }
          });
        } else {
          this.snackBar.open(`Keine XML-Daten für Unit ${unitName} gefunden`, 'Schließen', { duration: 3000 });
        }
      });
  }
}
