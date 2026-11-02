import {
  Component, OnInit, inject, viewChild, effect, signal, DestroyRef, ChangeDetectionStrategy
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateModule } from '@ngx-translate/core';
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
import { MatAnchor, MatButton } from '@angular/material/button';
import {
  NonNullableFormBuilder,
  FormGroup,
  FormControl,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { injectUiTranslator } from '../../../shared/utils/ui-translator';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';
import { CoderService } from '../../services/coder.service';
import { Coder } from '../../models/coder.model';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
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
    ReactiveFormsModule,
    MatButton
  ]
})
export class CoderListComponent implements OnInit {
  private readonly uiTranslate = injectUiTranslator();

  private coderService = inject(CoderService);
  private readonly destroyRef = inject(DestroyRef);
  private snackBar = inject(MatSnackBar);
  private fb = inject(NonNullableFormBuilder);

  protected displayedColumns: string[] = ['selectCheckbox', 'name', 'displayName', 'email', 'assignedJobs'];
  dataSource = new MatTableDataSource<Coder>([]);
  protected selection = new SelectionModel<Coder>(true, []);
  protected readonly isLoading = signal(false);
  coderForm: FormGroup<{
    name: FormControl<string>;
    displayName: FormControl<string>;
    email: FormControl<string>;
  }>;

  isEditing = false;
  editingCoderId: number | null = null;

  readonly sort = viewChild(MatSort);
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

  private readonly synchronizeSort = effect(() => {
    this.dataSource.sort = this.sort() ?? null;
  });

  loadCoders(): void {
    this.isLoading.set(true);

    this.coderService.getCoders().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: coders => {
        this.dataSource.data = coders;
        this.isLoading.set(false);
      },
      error: () => {
        this.snackBar.open(this.uiTranslate('ui-text.coder-list.fehler-beim-laden-der-kodierer'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
        this.isLoading.set(false);
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
      this.snackBar.open(this.uiTranslate('ui-text.coder-list.bitte-fuellen-sie-alle-erforderlichen-felder-aus'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
      return;
    }

    const newCoder = this.coderForm.getRawValue();

    this.coderService.createCoder(newCoder).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.snackBar.open(this.uiTranslate('ui-text.coder-list.kodierer-erfolgreich-erstellt'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
        this.loadCoders();
        this.coderForm.reset();
      },
      error: () => {
        this.snackBar.open(this.uiTranslate('ui-text.coder-list.fehler-beim-erstellen-des-kodierers'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
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
      this.snackBar.open(this.uiTranslate('ui-text.coder-list.bitte-fuellen-sie-alle-erforderlichen-felder-aus'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
      return;
    }

    const updatedCoder = this.coderForm.getRawValue();

    this.coderService.updateCoder(this.editingCoderId, updatedCoder).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.snackBar.open(this.uiTranslate('ui-text.coder-list.kodierer-erfolgreich-aktualisiert'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
        this.loadCoders();
        this.isEditing = false;
        this.editingCoderId = null;
        this.coderForm.reset();
      },
      error: () => {
        this.snackBar.open(this.uiTranslate('ui-text.coder-list.fehler-beim-aktualisieren-des-kodierers'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
      }
    });
  }

  deleteCoders(): void {
    if (this.selection.selected.length === 0) {
      this.snackBar.open(this.uiTranslate('ui-text.coder-list.bitte-waehlen-sie-mindestens-einen-kodierer-aus'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
      return;
    }

    const deletePromises = this.selection.selected.map(coder => this.coderService.deleteCoder(coder.id));

    Promise.all(deletePromises).then(() => {
      this.snackBar.open(this.uiTranslate('ui-text.coder-list.kodierer-erfolgreich-geloescht'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
      this.loadCoders();
      this.selection.clear();
    }).catch(() => {
      this.snackBar.open(this.uiTranslate('ui-text.coder-list.fehler-beim-loeschen-der-kodierer'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
    });
  }

  getAssignedJobsText(coder: Coder): string {
    if (!coder.assignedJobs || coder.assignedJobs.length === 0) {
      return this.uiTranslate('coding.trainings.compare.none');
    }
    return coder.assignedJobs.join(', ');
  }
}
