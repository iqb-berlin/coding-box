import { Component, OnInit, ViewChild, AfterViewInit, inject } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSort, MatSortModule } from '@angular/material/sort';
import {
  MatCell, MatCellDef, MatColumnDef,
  MatHeaderCell,
  MatHeaderCellDef,
  MatHeaderRow, MatHeaderRowDef,
  MatRow, MatRowDef,
  MatTable,
  MatTableDataSource
} from '@angular/material/table';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SelectionModel } from '@angular/cdk/collections';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatAnchor } from '@angular/material/button';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { SearchFilterComponent } from '../../shared/search-filter/search-filter.component';
import { CoderService } from '../services/coder.service';
import { Coder } from '../models/coder.model';

@Component({
  selector: 'coding-box-coder-list',
  templateUrl: './coder-list.component.html',
  styleUrls: ['./coder-list.component.scss'],
  standalone: true,
  imports: [
    TranslateModule,
    SearchFilterComponent,
    MatIcon,
    MatHeaderCell,
    MatCell,
    MatHeaderRow,
    MatRow,
    MatProgressSpinner,
    MatCheckbox,
    MatTable,
    MatAnchor,
    MatHeaderCellDef,
    MatCellDef,
    MatHeaderRowDef,
    MatRowDef,
    MatColumnDef,
    MatSortModule,
    ReactiveFormsModule
  ]
})
export class CoderListComponent implements OnInit, AfterViewInit {
  private coderService = inject(CoderService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private translate = inject(TranslateService);
  private fb = inject(FormBuilder);

  displayedColumns: string[] = ['selectCheckbox', 'name', 'displayName', 'email', 'assignedJobs'];
  dataSource = new MatTableDataSource<Coder>([]);
  selection = new SelectionModel<Coder>(true, []);
  isLoading = false;
  coderForm: FormGroup;
  isEditing = false;
  editingCoderId: number | null = null;

  @ViewChild(MatSort) sort!: MatSort;
  constructor() {
    this.coderForm = this.fb.group({
      name: ['', Validators.required],
      displayName: [''],
      email: ['', [Validators.email]]
    });
  }

  ngOnInit(): void {
    this.loadCoders();
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
  }

  loadCoders(): void {
    this.isLoading = true;

    this.coderService.getCoders().subscribe({
      next: coders => {
        this.dataSource.data = coders;
        this.isLoading = false;
      },
      error: error => {
        console.error('Error loading coders:', error);
        this.snackBar.open('Fehler beim Laden der Kodierer', 'Schließen', { duration: 3000 });
        this.isLoading = false;
      }
    });
  }

  applyFilter(filterValue: string): void {
    this.dataSource.filter = filterValue.trim().toLowerCase();
  }

  isAllSelected(): boolean {
    const numSelected = this.selection.selected.length;
    const numRows = this.dataSource.data.length;
    return numSelected === numRows;
  }

  isIndeterminate(): boolean {
    return this.selection.selected.length > 0 && !this.isAllSelected();
  }

  masterToggle(): void {
    if (this.isAllSelected()) {
      this.selection.clear();
    } else {
      this.dataSource.data.forEach(row => this.selection.select(row));
    }
  }

  selectRow(row: Coder): void {
    this.selection.toggle(row);
  }

  createCoder(): void {
    if (this.coderForm.invalid) {
      this.snackBar.open('Bitte füllen Sie alle erforderlichen Felder aus', 'Schließen', { duration: 3000 });
      return;
    }

    const newCoder = this.coderForm.value;

    this.coderService.createCoder(newCoder).subscribe({
      next: () => {
        this.snackBar.open('Kodierer erfolgreich erstellt', 'Schließen', { duration: 3000 });
        this.loadCoders();
        this.coderForm.reset();
      },
      error: error => {
        console.error('Error creating coder:', error);
        this.snackBar.open('Fehler beim Erstellen des Kodierers', 'Schließen', { duration: 3000 });
      }
    });
  }

  startEditCoder(coder: Coder): void {
    this.isEditing = true;
    this.editingCoderId = coder.id;
    this.coderForm.patchValue({
      name: coder.name,
      displayName: coder.displayName || '',
      email: coder.email || ''
    });
  }

  cancelEdit(): void {
    this.isEditing = false;
    this.editingCoderId = null;
    this.coderForm.reset();
  }

  updateCoder(): void {
    if (this.coderForm.invalid || !this.editingCoderId) {
      this.snackBar.open('Bitte füllen Sie alle erforderlichen Felder aus', 'Schließen', { duration: 3000 });
      return;
    }

    const updatedCoder = this.coderForm.value;

    this.coderService.updateCoder(this.editingCoderId, updatedCoder).subscribe({
      next: () => {
        this.snackBar.open('Kodierer erfolgreich aktualisiert', 'Schließen', { duration: 3000 });
        this.loadCoders();
        this.isEditing = false;
        this.editingCoderId = null;
        this.coderForm.reset();
      },
      error: error => {
        console.error('Error updating coder:', error);
        this.snackBar.open('Fehler beim Aktualisieren des Kodierers', 'Schließen', { duration: 3000 });
      }
    });
  }

  deleteCoders(): void {
    if (this.selection.selected.length === 0) {
      this.snackBar.open('Bitte wählen Sie mindestens einen Kodierer aus', 'Schließen', { duration: 3000 });
      return;
    }

    const deletePromises = this.selection.selected.map(coder => this.coderService.deleteCoder(coder.id));

    // Using Promise.all to wait for all delete operations to complete
    Promise.all(deletePromises).then(() => {
      this.snackBar.open('Kodierer erfolgreich gelöscht', 'Schließen', { duration: 3000 });
      this.loadCoders();
      this.selection.clear();
    }).catch(error => {
      console.error('Error deleting coders:', error);
      this.snackBar.open('Fehler beim Löschen der Kodierer', 'Schließen', { duration: 3000 });
    });
  }

  getAssignedJobsText(coder: Coder): string {
    if (!coder.assignedJobs || coder.assignedJobs.length === 0) {
      return 'Keine';
    }
    return coder.assignedJobs.join(', ');
  }
}
