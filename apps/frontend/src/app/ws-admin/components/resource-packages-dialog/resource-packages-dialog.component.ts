import {
  Component, OnDestroy, OnInit, inject, signal,
  computed, ChangeDetectionStrategy, DestroyRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import {
  MAT_DIALOG_DATA, MatDialog, MatDialogRef, MatDialogModule
} from '@angular/material/dialog';
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
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatAnchor, MatButton, MatIconButton } from '@angular/material/button';
import { DatePipe, DecimalPipe } from '@angular/common';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { HttpErrorResponse, HttpEventType, HttpResponse } from '@angular/common/http';
import { MatTooltip } from '@angular/material/tooltip';
import { injectUiTranslator } from '../../../shared/utils/ui-translator';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';
import { ResourcePackageService } from '../../../shared/services/response/resource-package.service';
import { ResourcePackageDto } from '../../../../../../../api-dto/resource-package/resource-package-dto';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/dialogs/confirm-dialog.component';

export interface ResourcePackagesDialogData {
  // Add any data you want to pass to the dialog
  workspaceId?: number;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-resource-packages-dialog',
  templateUrl: './resource-packages-dialog.component.html',
  styleUrls: ['./resource-packages-dialog.component.scss'],
  standalone: true,
  imports: [
    TranslateModule,
    DatePipe,
    DecimalPipe,
    SearchFilterComponent,
    MatIcon,
    MatHeaderCell,
    MatCell,
    MatHeaderRow,
    MatRow,
    MatProgressSpinner,
    MatProgressBar,
    MatCheckbox,
    MatTable,
    MatAnchor,
    MatButton,
    MatIconButton,
    MatTooltip,
    MatHeaderCellDef,
    MatCellDef,
    MatHeaderRowDef,
    MatRowDef,
    MatColumnDef,
    MatDialogModule
  ]
})
export class ResourcePackagesDialogComponent implements OnInit, OnDestroy {
  private readonly uiTranslate = injectUiTranslator();

  private readonly destroyRef = inject(DestroyRef);

  dialogRef = inject<MatDialogRef<ResourcePackagesDialogComponent>>(MatDialogRef);
  data = inject<ResourcePackagesDialogData>(MAT_DIALOG_DATA);
  resourcePackageService = inject(ResourcePackageService);
  private snackBar = inject(MatSnackBar);
  private translate = inject(TranslateService);
  private dialog = inject(MatDialog);

  // Resource packages
  readonly resourcePackages = signal<ResourcePackageDto[]>([]);
  protected resourcePackageDataSource = new MatTableDataSource<ResourcePackageDto>([]);
  protected resourcePackageSelection = new SelectionModel<ResourcePackageDto>(true, []);
  protected readonly isLoadingResourcePackages = signal(false);
  protected readonly isResourcePackageOperationActive = signal(false);
  protected readonly resourcePackageOperationText = signal('');
  protected readonly resourcePackageProgressPercent = signal(0);
  protected readonly resourcePackageProgressLoadedBytes = signal(0);
  protected readonly resourcePackageProgressTotalBytes = signal(0);
  protected readonly resourcePackageProgressMode = signal<'determinate' | 'indeterminate'>('indeterminate');
  readonly activeDownloadPackageId = signal<number | null>(null);
  readonly resourcePackageTextFilterValue = signal<string>('');
  protected resourcePackageColumns: string[] = [
    'selectCheckbox',
    'name',
    'packageType',
    'scope',
    'detectedVersion',
    'elements',
    'packageSize',
    'createdAt',
    'actions'
  ];

  private resourcePackageTextFilterChanged: Subject<string> = new Subject<string>();
  private resourcePackageTextFilterSubscription: Subscription | undefined;

  ngOnInit(): void {
    this.loadResourcePackages();
    this.resourcePackageTextFilterSubscription = this.resourcePackageTextFilterChanged
      .pipe(debounceTime(300)) // Debounce für 300ms
      .subscribe(() => {
        this.applyResourcePackageFilters();
      });
  }

  ngOnDestroy(): void {
    if (this.resourcePackageTextFilterSubscription) {
      this.resourcePackageTextFilterSubscription.unsubscribe();
    }
  }

  /**
   * Loads all resource packages
   */
  loadResourcePackages(): void {
    const workspaceId = this.getWorkspaceId();
    if (workspaceId === null) {
      this.snackBar.open(
        this.translate.instant('Workspace ID is required'),
        this.translate.instant('error.error_title'),
        { duration: 3000 }
      );
      return;
    }
    this.isLoadingResourcePackages.set(true);
    this.resourcePackageService.getResourcePackages(workspaceId).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (packages: ResourcePackageDto[]) => {
          this.resourcePackages.set(packages);
          this.resourcePackageDataSource = new MatTableDataSource(packages);
          this.setupResourcePackageFilterPredicate();
          this.isLoadingResourcePackages.set(false);
        },
        error: () => {
          this.isLoadingResourcePackages.set(false);
          this.snackBar.open(
            this.translate.instant('Error loading resource packages'),
            this.translate.instant('error.error_title'),
            { duration: 3000 }
          );
        }
      });
  }

  private getWorkspaceId(): number | null {
    const workspaceId = Number(this.data.workspaceId);
    return Number.isInteger(workspaceId) && workspaceId > 0 ? workspaceId : null;
  }

  /** Sets up custom filter predicate for the resource package data source */
  private setupResourcePackageFilterPredicate(): void {
    this.resourcePackageDataSource.filterPredicate = (data: ResourcePackageDto, filter: string) => {
      const filterObj = JSON.parse(filter || '{}');

      if (data.packageSize) {
        const packageSizeText = data.packageSize > 1024 * 1024 ?
          `${(data.packageSize / (1024 * 1024)).toFixed(2)} MB` :
          `${(data.packageSize / 1024).toFixed(2)} KB`;

        const textMatch = !filterObj.text || (
          (data.name && data.name.toLowerCase().includes(filterObj.text.toLowerCase())) ||
          (data.packageType && this.getPackageTypeLabel(data).toLowerCase().includes(filterObj.text.toLowerCase())) ||
          (data.scope && this.getPackageScopeLabel(data).toLowerCase().includes(filterObj.text.toLowerCase())) ||
          (data.detectedVersion && data.detectedVersion.toLowerCase().includes(filterObj.text.toLowerCase())) ||
          (data.elements && data.elements.some(element => element.toLowerCase().includes(filterObj.text.toLowerCase()))) ||
          (data.createdAt && new Date(data.createdAt).toLocaleDateString().includes(filterObj.text.toLowerCase())) ||
          (packageSizeText.toLowerCase().includes(filterObj.text.toLowerCase()))
        );
        return textMatch as boolean;
      }
      return false;
    };
  }

  /** Applies all resource package filters */
  applyResourcePackageFilters(): void {
    const filterObj = {
      text: this.resourcePackageTextFilterValue()
    };
    this.resourcePackageDataSource.filter = JSON.stringify(filterObj);
  }

  /** Handles resource package text filter changes */
  protected onResourcePackageTextFilterChange(value: string): void {
    this.resourcePackageTextFilterValue.set(value.trim());
    this.resourcePackageTextFilterChanged.next(this.resourcePackageTextFilterValue());
  }

  /** Clears all resource package filters */
  protected clearResourcePackageFilters(): void {
    this.resourcePackageTextFilterValue.set('');
    this.applyResourcePackageFilters();
  }

  /**
   * Deletes selected resource packages
   */
  protected deleteResourcePackages(): void {
    const workspaceId = this.getWorkspaceId();
    if (this.resourcePackageSelection.selected.length === 0) {
      return;
    }

    if (workspaceId === null) {
      this.snackBar.open(
        this.translate.instant('Workspace ID is required'),
        this.translate.instant('error.error_title'),
        { duration: 3000 }
      );
      return;
    }

    const selectedPackages = this.resourcePackageSelection.selected;
    const hasGlobalPackage = selectedPackages.some(pkg => pkg.scope === 'global');
    const content = hasGlobalPackage ?
      this.uiTranslate('ui-text.resource-packages-dialog.mindestens-ein-ausgewaehltes-ressourcenpaket-ist-global-es-wird-in-allen-workspaces-geloes') :
      this.uiTranslate('ui-text.resource-packages-dialog.die-ausgewaehlten-ressourcenpakete-werden-aus-diesem-workspace-entfernt-fortfahren');

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '520px',
      data: <ConfirmDialogData>{
        title: this.uiTranslate('access-matrix.feature.delete-resource-packages'),
        content,
        confirmButtonLabel: this.uiTranslate('delete'),
        showCancel: true
      }
    });

    dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((confirmed: boolean) => {
      if (!confirmed) {
        return;
      }
      const packageIds = selectedPackages.map(pkg => pkg.id);
      this.isLoadingResourcePackages.set(true);

      this.resourcePackageService.deleteResourcePackages(workspaceId, packageIds).pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (success: boolean) => {
            this.isLoadingResourcePackages.set(false);
            if (success) {
              this.snackBar.open(
                this.uiTranslate('ui-text.resource-packages-dialog.ressourcenpakete-wurden-geloescht'),
                '',
                { duration: 3000 }
              );
              this.loadResourcePackages();
              this.resourcePackageSelection.clear();
              this.dialogRef.close(true);
            } else {
              this.snackBar.open(
                this.uiTranslate('ui-text.resource-packages-dialog.ressourcenpakete-konnten-nicht-geloescht-werden'),
                this.translate.instant('error.error_title'),
                { duration: 3000 }
              );
            }
          },
          error: () => {
            this.isLoadingResourcePackages.set(false);
            this.snackBar.open(
              this.uiTranslate('ui-text.resource-packages-dialog.ressourcenpakete-konnten-nicht-geloescht-werden'),
              this.translate.instant('error.error_title'),
              { duration: 3000 }
            );
          }
        });
    });
  }

  /**
   * Downloads a resource package
   * @param resourcePackage The resource package to download
   */
  protected downloadResourcePackage(resourcePackage: ResourcePackageDto): void {
    const workspaceId = this.getWorkspaceId();
    if (workspaceId === null) {
      this.snackBar.open(
        this.translate.instant('Workspace ID is required'),
        this.translate.instant('error.error_title'),
        { duration: 3000 }
      );
      return;
    }
    this.activeDownloadPackageId.set(resourcePackage.id);
    this.startResourcePackageOperation(`Download: ${resourcePackage.name}`, 'indeterminate');
    this.resourcePackageService.downloadResourcePackageWithProgress(workspaceId, resourcePackage.name).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: event => {
          if (event.type === HttpEventType.DownloadProgress) {
            this.updateResourcePackageProgress(event.loaded, event.total || 0);
            this.resourcePackageOperationText.set(`Download: ${resourcePackage.name} (${this.resourcePackageProgressPercent()}%)`);
            return;
          }
          if (event instanceof HttpResponse) {
            const blob = event.body;
            this.finishResourcePackageOperation();
            if (!blob || blob.size === 0) {
              this.snackBar.open(
                this.uiTranslate('ui-text.resource-packages-dialog.das-ressourcenpaket-konnte-nicht-heruntergeladen-werden'),
                this.translate.instant('error.error_title'),
                { duration: 3000 }
              );
              return;
            }
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${resourcePackage.name}.itcr.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
          }
        },
        error: () => {
          this.finishResourcePackageOperation();
          this.snackBar.open(
            this.uiTranslate('ui-text.resource-packages-dialog.das-ressourcenpaket-konnte-nicht-heruntergeladen-werden'),
            this.translate.instant('error.error_title'),
            { duration: 3000 }
          );
        }
      });
  }

  /**
   * Uploads a resource package
   * @param target The file input change event target
   */
  protected onResourcePackageSelected(target: EventTarget | null): void {
    const workspaceId = this.getWorkspaceId();
    if (workspaceId === null) {
      this.snackBar.open(
        this.translate.instant('Workspace ID is required'),
        this.translate.instant('error.error_title'),
        { duration: 3000 }
      );
      return;
    }
    if (!target) return;
    const inputElement = target as HTMLInputElement;
    const files = inputElement.files;
    if (files && files.length) {
      const file = files[0];
      this.startResourcePackageOperation(`Upload: ${file.name}`, 'determinate');
      this.resourcePackageService.uploadResourcePackageWithProgress(workspaceId, file).pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: event => {
            if (event.type === HttpEventType.UploadProgress) {
              this.updateResourcePackageProgress(event.loaded, event.total || file.size);
              this.resourcePackageOperationText.set(`Upload: ${file.name} (${this.resourcePackageProgressPercent()}%)`);
              return;
            }
            if (event instanceof HttpResponse) {
              this.resourcePackageOperationText.set(this.uiTranslate('ui-text.resource-packages-dialog.paket-wird-geprueft-und-entpackt'));
              this.resourcePackageProgressMode.set('indeterminate');
              const id = event.body || -1;
              this.finishResourcePackageOperation();
              if (id > 0) {
                this.snackBar.open(
                  this.uiTranslate('ui-text.resource-packages-dialog.ressourcenpaket-wurde-hochgeladen'),
                  '',
                  { duration: 3000 }
                );
                this.loadResourcePackages();
                this.dialogRef.close(true);
              } else {
                this.snackBar.open(
                  this.uiTranslate('ui-text.resource-packages-dialog.ressourcenpaket-konnte-nicht-hochgeladen-werden'),
                  this.translate.instant('error.error_title'),
                  { duration: 3000 }
                );
              }
            }
          },
          error: (error: unknown) => {
            this.finishResourcePackageOperation();
            this.snackBar.open(
              this.getResourcePackageErrorMessage(error, this.uiTranslate('ui-text.resource-packages-dialog.ressourcenpaket-konnte-nicht-hochgeladen-werden')),
              this.translate.instant('error.error_title'),
              { duration: 3000 }
            );
          }
        });
      inputElement.value = '';
    }
  }

  protected installGeoGebraPackage(): void {
    const workspaceId = this.getWorkspaceId();
    if (workspaceId === null) {
      this.snackBar.open(
        this.translate.instant('Workspace ID is required'),
        this.translate.instant('error.error_title'),
        { duration: 3000 }
      );
      return;
    }

    const packageExists = this.hasGeoGebraPackage();
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '560px',
      data: <ConfirmDialogData>{
        title: packageExists ?
          this.uiTranslate('ui-text.resource-packages-dialog.geogebra-math-apps-bundle-pruefen-reparieren') :
          this.uiTranslate('ui-text.resource-packages-dialog.geogebra-math-apps-bundle-installieren'),
        content: this.uiTranslate('ui-text.resource-packages-dialog.das-geogebra-math-apps-bundle-wird-geprueft-falls-kein-gueltiges-bundle-vorhanden-ist-wird'),
        confirmButtonLabel: packageExists ? this.uiTranslate('ui-text.resource-packages-dialog.pruefen-reparieren') : 'Installieren',
        showCancel: true
      }
    });

    dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((confirmed: boolean) => {
      if (!confirmed) {
        return;
      }
      this.startResourcePackageOperation(
        this.uiTranslate('ui-text.resource-packages-dialog.geogebra-math-apps-bundle-wird-heruntergeladen-und-installiert'),
        'indeterminate'
      );
      this.resourcePackageService.installGeoGebraPackage(workspaceId).pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: event => {
            if (event instanceof HttpResponse) {
              this.finishResourcePackageOperation();
              this.snackBar.open(
                this.uiTranslate('ui-text.resource-packages-dialog.geogebra-ist-verfuegbar', { value1: event.body?.detectedVersion ? ` (${event.body.detectedVersion})` : '' }),
                '',
                { duration: 3000 }
              );
              this.loadResourcePackages();
              this.dialogRef.close(true);
            }
          },
          error: (error: unknown) => {
            this.finishResourcePackageOperation();
            this.snackBar.open(
              this.getResourcePackageErrorMessage(
                error,
                this.uiTranslate('ui-text.resource-packages-dialog.geogebra-konnte-nicht-installiert-werden-bitte-download-link-und-zip-format-pruefen')
              ),
              this.translate.instant('error.error_title'),
              { duration: 3000 }
            );
          }
        });
    });
  }

  /**
   * Toggles selection of all resource packages
   */
  protected masterToggleResourcePackages(): void {
    if (this.isAllResourcePackagesSelected()) {
      this.resourcePackageSelection.clear();
    } else {
      this.resourcePackages().forEach(pkg => this.resourcePackageSelection.select(pkg));
    }
  }

  /**
   * Checks if all resource packages are selected
   * @returns True if all resource packages are selected
   */
  protected isAllResourcePackagesSelected(): boolean {
    const numSelected = this.resourcePackageSelection.selected.length;
    const numRows = this.resourcePackages().length;
    return numSelected === numRows && numRows > 0;
  }

  protected readonly hasGeoGebraPackage = computed<boolean>(() => this.resourcePackages().some(pkg => pkg.name.toLowerCase() === 'geogebra' && pkg.scope === 'global'));

  protected getPackageTypeLabel(resourcePackage: ResourcePackageDto): string {
    return resourcePackage.packageType === 'geogebra' ? 'GeoGebra' : 'Ressourcenpaket';
  }

  protected getPackageScopeLabel(resourcePackage: ResourcePackageDto): string {
    return resourcePackage.scope === 'global' ? 'Global' : 'Workspace';
  }

  protected isResourcePackageDownloading(resourcePackage: ResourcePackageDto): boolean {
    return this.activeDownloadPackageId() === resourcePackage.id;
  }

  private startResourcePackageOperation(text: string, mode: 'determinate' | 'indeterminate'): void {
    this.isResourcePackageOperationActive.set(true);
    this.resourcePackageOperationText.set(text);
    this.resourcePackageProgressMode.set(mode);
    this.resourcePackageProgressPercent.set(0);
    this.resourcePackageProgressLoadedBytes.set(0);
    this.resourcePackageProgressTotalBytes.set(0);
  }

  private updateResourcePackageProgress(loaded: number, total: number): void {
    this.resourcePackageProgressLoadedBytes.set(loaded);
    this.resourcePackageProgressTotalBytes.set(total);
    if (total > 0) {
      this.resourcePackageProgressMode.set('determinate');
      this.resourcePackageProgressPercent.set(Math.min(100, Math.round((loaded / total) * 100)));
    } else {
      this.resourcePackageProgressMode.set('indeterminate');
    }
  }

  private finishResourcePackageOperation(): void {
    this.isResourcePackageOperationActive.set(false);
    this.activeDownloadPackageId.set(null);
    this.resourcePackageOperationText.set('');
    this.resourcePackageProgressPercent.set(0);
    this.resourcePackageProgressLoadedBytes.set(0);
    this.resourcePackageProgressTotalBytes.set(0);
    this.resourcePackageProgressMode.set('indeterminate');
  }

  protected formatBytes(bytes: number): string {
    if (!bytes || bytes < 0) {
      return '0 B';
    }
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private getResourcePackageErrorMessage(error: unknown, fallback: string): string {
    if (!(error instanceof HttpErrorResponse)) {
      return fallback;
    }
    const message = error.error?.message;
    if (Array.isArray(message) && message.length > 0) {
      return `${fallback} ${message.join(' ')}`;
    }
    if (typeof message === 'string' && message.trim()) {
      return `${fallback} ${message}`;
    }
    if (typeof error.error === 'string' && error.error.trim()) {
      return `${fallback} ${error.error}`;
    }
    return fallback;
  }

  /**
   * Closes the dialog
   */
  protected close(): void {
    this.dialogRef.close();
  }
}
