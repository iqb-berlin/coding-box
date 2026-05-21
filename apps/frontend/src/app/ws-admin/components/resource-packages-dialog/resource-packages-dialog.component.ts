import {
  Component, OnDestroy, OnInit, inject
} from '@angular/core';
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
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';
import { ResourcePackageService } from '../../../shared/services/response/resource-package.service';
import { ResourcePackageDto } from '../../../../../../../api-dto/resource-package/resource-package-dto';
import { AppService } from '../../../core/services/app.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/dialogs/confirm-dialog.component';

export interface ResourcePackagesDialogData {
  // Add any data you want to pass to the dialog
  workspaceId?: number;
}

@Component({
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
  dialogRef = inject<MatDialogRef<ResourcePackagesDialogComponent>>(MatDialogRef);
  data = inject<ResourcePackagesDialogData>(MAT_DIALOG_DATA);
  resourcePackageService = inject(ResourcePackageService);
  private appService = inject(AppService);
  private snackBar = inject(MatSnackBar);
  private translate = inject(TranslateService);
  private dialog = inject(MatDialog);

  // Resource packages
  resourcePackages: ResourcePackageDto[] = [];
  resourcePackageDataSource!: MatTableDataSource<ResourcePackageDto>;
  resourcePackageSelection = new SelectionModel<ResourcePackageDto>(true, []);
  isLoadingResourcePackages = false;
  isResourcePackageOperationActive = false;
  resourcePackageOperationText = '';
  resourcePackageProgressPercent = 0;
  resourcePackageProgressLoadedBytes = 0;
  resourcePackageProgressTotalBytes = 0;
  resourcePackageProgressMode: 'determinate' | 'indeterminate' = 'indeterminate';
  activeDownloadPackageId: number | null = null;
  resourcePackageTextFilterValue: string = '';
  resourcePackageColumns: string[] = [
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
    this.isLoadingResourcePackages = true;
    this.resourcePackageService.getResourcePackages(this.appService.selectedWorkspaceId)
      .subscribe({
        next: (packages: ResourcePackageDto[]) => {
          this.resourcePackages = packages;
          this.resourcePackageDataSource = new MatTableDataSource(packages);
          this.setupResourcePackageFilterPredicate();
          this.isLoadingResourcePackages = false;
        },
        error: () => {
          this.isLoadingResourcePackages = false;
          this.snackBar.open(
            this.translate.instant('Error loading resource packages'),
            this.translate.instant('error'),
            { duration: 3000 }
          );
        }
      });
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
      text: this.resourcePackageTextFilterValue
    };
    this.resourcePackageDataSource.filter = JSON.stringify(filterObj);
  }

  /** Handles resource package text filter changes */
  onResourcePackageTextFilterChange(value: string): void {
    this.resourcePackageTextFilterValue = value.trim();
    this.resourcePackageTextFilterChanged.next(this.resourcePackageTextFilterValue);
  }

  /** Clears all resource package filters */
  clearResourcePackageFilters(): void {
    this.resourcePackageTextFilterValue = '';
    this.applyResourcePackageFilters();
  }

  /**
   * Deletes selected resource packages
   */
  deleteResourcePackages(): void {
    if (this.resourcePackageSelection.selected.length === 0) {
      return;
    }

    if (!this.data.workspaceId) {
      this.snackBar.open(
        this.translate.instant('Workspace ID is required'),
        this.translate.instant('error'),
        { duration: 3000 }
      );
      return;
    }

    const selectedPackages = this.resourcePackageSelection.selected;
    const hasGlobalPackage = selectedPackages.some(pkg => pkg.scope === 'global');
    const content = hasGlobalPackage ?
      'Mindestens ein ausgewähltes Ressourcenpaket ist global. Es wird in allen Workspaces gelöscht und Aufgaben, die dieses Paket verwenden, können anschließend nicht mehr funktionieren. Fortfahren?' :
      'Die ausgewählten Ressourcenpakete werden aus diesem Workspace entfernt. Fortfahren?';

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '520px',
      data: <ConfirmDialogData>{
        title: 'Ressourcenpakete löschen',
        content,
        confirmButtonLabel: 'Löschen',
        showCancel: true
      }
    });

    dialogRef.afterClosed().subscribe((confirmed: boolean) => {
      if (!confirmed) {
        return;
      }
      const packageIds = selectedPackages.map(pkg => pkg.id);
      this.isLoadingResourcePackages = true;

      this.resourcePackageService.deleteResourcePackages(this.data.workspaceId!, packageIds)
        .subscribe({
          next: (success: boolean) => {
            this.isLoadingResourcePackages = false;
            if (success) {
              this.snackBar.open(
                'Ressourcenpakete wurden gelöscht.',
                '',
                { duration: 3000 }
              );
              this.loadResourcePackages();
              this.resourcePackageSelection.clear();
              this.dialogRef.close(true);
            } else {
              this.snackBar.open(
                'Ressourcenpakete konnten nicht gelöscht werden.',
                this.translate.instant('error'),
                { duration: 3000 }
              );
            }
          },
          error: () => {
            this.isLoadingResourcePackages = false;
            this.snackBar.open(
              'Ressourcenpakete konnten nicht gelöscht werden.',
              this.translate.instant('error'),
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
  downloadResourcePackage(resourcePackage: ResourcePackageDto): void {
    if (!this.data.workspaceId) {
      this.snackBar.open(
        this.translate.instant('Workspace ID is required'),
        this.translate.instant('error'),
        { duration: 3000 }
      );
      return;
    }
    this.activeDownloadPackageId = resourcePackage.id;
    this.startResourcePackageOperation(`Download: ${resourcePackage.name}`, 'indeterminate');
    this.resourcePackageService.downloadResourcePackageWithProgress(this.data.workspaceId, resourcePackage.name)
      .subscribe({
        next: event => {
          if (event.type === HttpEventType.DownloadProgress) {
            this.updateResourcePackageProgress(event.loaded, event.total || 0);
            this.resourcePackageOperationText = `Download: ${resourcePackage.name} (${this.resourcePackageProgressPercent}%)`;
            return;
          }
          if (event instanceof HttpResponse) {
            const blob = event.body;
            this.finishResourcePackageOperation();
            if (!blob || blob.size === 0) {
              this.snackBar.open(
                'Das Ressourcenpaket konnte nicht heruntergeladen werden.',
                this.translate.instant('error'),
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
            'Das Ressourcenpaket konnte nicht heruntergeladen werden.',
            this.translate.instant('error'),
            { duration: 3000 }
          );
        }
      });
  }

  /**
   * Uploads a resource package
   * @param target The file input change event target
   */
  onResourcePackageSelected(target: EventTarget | null): void {
    if (!this.data.workspaceId) {
      this.snackBar.open(
        this.translate.instant('Workspace ID is required'),
        this.translate.instant('error'),
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
      this.resourcePackageService.uploadResourcePackageWithProgress(this.data.workspaceId, file)
        .subscribe({
          next: event => {
            if (event.type === HttpEventType.UploadProgress) {
              this.updateResourcePackageProgress(event.loaded, event.total || file.size);
              this.resourcePackageOperationText = `Upload: ${file.name} (${this.resourcePackageProgressPercent}%)`;
              return;
            }
            if (event instanceof HttpResponse) {
              this.resourcePackageOperationText = 'Paket wird geprüft und entpackt...';
              this.resourcePackageProgressMode = 'indeterminate';
              const id = event.body || -1;
              this.finishResourcePackageOperation();
              if (id > 0) {
                this.snackBar.open(
                  'Ressourcenpaket wurde hochgeladen.',
                  '',
                  { duration: 3000 }
                );
                this.loadResourcePackages();
                this.dialogRef.close(true);
              } else {
                this.snackBar.open(
                  'Ressourcenpaket konnte nicht hochgeladen werden.',
                  this.translate.instant('error'),
                  { duration: 3000 }
                );
              }
            }
          },
          error: (error: unknown) => {
            this.finishResourcePackageOperation();
            this.snackBar.open(
              this.getResourcePackageErrorMessage(error, 'Ressourcenpaket konnte nicht hochgeladen werden.'),
              this.translate.instant('error'),
              { duration: 3000 }
            );
          }
        });
      inputElement.value = '';
    }
  }

  installGeoGebraPackage(): void {
    if (!this.data.workspaceId) {
      this.snackBar.open(
        this.translate.instant('Workspace ID is required'),
        this.translate.instant('error'),
        { duration: 3000 }
      );
      return;
    }

    const packageExists = this.hasGeoGebraPackage;
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '560px',
      data: <ConfirmDialogData>{
        title: packageExists ?
          'GeoGebra Math Apps Bundle prüfen/reparieren' :
          'GeoGebra Math Apps Bundle installieren',
        content: 'Das GeoGebra Math Apps Bundle wird geprüft. Falls kein gültiges Bundle vorhanden ist, wird es von download.geogebra.org geladen, als globales Ressourcenpaket installiert und steht danach in allen Workspaces zur Verfügung. Bitte beachten Sie die GeoGebra-Lizenzbedingungen.',
        confirmButtonLabel: packageExists ? 'Prüfen/reparieren' : 'Installieren',
        showCancel: true
      }
    });

    dialogRef.afterClosed().subscribe((confirmed: boolean) => {
      if (!confirmed) {
        return;
      }
      this.startResourcePackageOperation(
        'GeoGebra Math Apps Bundle wird heruntergeladen und installiert...',
        'indeterminate'
      );
      this.resourcePackageService.installGeoGebraPackage(this.data.workspaceId!)
        .subscribe({
          next: event => {
            if (event instanceof HttpResponse) {
              this.finishResourcePackageOperation();
              this.snackBar.open(
                `GeoGebra ist verfügbar${event.body?.detectedVersion ? ` (${event.body.detectedVersion})` : ''}.`,
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
                'GeoGebra konnte nicht installiert werden. Bitte Download-Link und ZIP-Format prüfen.'
              ),
              this.translate.instant('error'),
              { duration: 3000 }
            );
          }
        });
    });
  }

  /**
   * Toggles selection of all resource packages
   */
  masterToggleResourcePackages(): void {
    if (this.isAllResourcePackagesSelected()) {
      this.resourcePackageSelection.clear();
    } else {
      this.resourcePackages.forEach(pkg => this.resourcePackageSelection.select(pkg));
    }
  }

  /**
   * Checks if all resource packages are selected
   * @returns True if all resource packages are selected
   */
  isAllResourcePackagesSelected(): boolean {
    const numSelected = this.resourcePackageSelection.selected.length;
    const numRows = this.resourcePackages.length;
    return numSelected === numRows && numRows > 0;
  }

  get hasGeoGebraPackage(): boolean {
    return this.resourcePackages.some(pkg => pkg.name.toLowerCase() === 'geogebra' && pkg.scope === 'global');
  }

  getPackageTypeLabel(resourcePackage: ResourcePackageDto): string {
    return resourcePackage.packageType === 'geogebra' ? 'GeoGebra' : 'Ressourcenpaket';
  }

  getPackageScopeLabel(resourcePackage: ResourcePackageDto): string {
    return resourcePackage.scope === 'global' ? 'Global' : 'Workspace';
  }

  isResourcePackageDownloading(resourcePackage: ResourcePackageDto): boolean {
    return this.activeDownloadPackageId === resourcePackage.id;
  }

  private startResourcePackageOperation(text: string, mode: 'determinate' | 'indeterminate'): void {
    this.isResourcePackageOperationActive = true;
    this.resourcePackageOperationText = text;
    this.resourcePackageProgressMode = mode;
    this.resourcePackageProgressPercent = 0;
    this.resourcePackageProgressLoadedBytes = 0;
    this.resourcePackageProgressTotalBytes = 0;
  }

  private updateResourcePackageProgress(loaded: number, total: number): void {
    this.resourcePackageProgressLoadedBytes = loaded;
    this.resourcePackageProgressTotalBytes = total;
    if (total > 0) {
      this.resourcePackageProgressMode = 'determinate';
      this.resourcePackageProgressPercent = Math.min(100, Math.round((loaded / total) * 100));
    } else {
      this.resourcePackageProgressMode = 'indeterminate';
    }
  }

  private finishResourcePackageOperation(): void {
    this.isResourcePackageOperationActive = false;
    this.activeDownloadPackageId = null;
    this.resourcePackageOperationText = '';
    this.resourcePackageProgressPercent = 0;
    this.resourcePackageProgressLoadedBytes = 0;
    this.resourcePackageProgressTotalBytes = 0;
    this.resourcePackageProgressMode = 'indeterminate';
  }

  formatBytes(bytes: number): string {
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
  close(): void {
    this.dialogRef.close();
  }
}
