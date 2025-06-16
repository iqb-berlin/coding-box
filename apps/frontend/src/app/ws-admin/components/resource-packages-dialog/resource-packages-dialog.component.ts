import {
  Component, Inject, OnDestroy, OnInit
} from '@angular/core';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
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
import { DatePipe, DecimalPipe } from '@angular/common';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';
import { BackendService } from '../../../services/backend.service';
import { ResourcePackageDto } from '../../../../../../../api-dto/resource-package/resource-package-dto';
import { AppService } from '../../../services/app.service';

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
    MatCheckbox,
    MatTable,
    MatAnchor,
    MatButton,
    MatHeaderCellDef,
    MatCellDef,
    MatHeaderRowDef,
    MatRowDef,
    MatColumnDef,
    MatDialogModule
]
})
export class ResourcePackagesDialogComponent implements OnInit, OnDestroy {
  // Resource packages
  resourcePackages: ResourcePackageDto[] = [];
  resourcePackageDataSource!: MatTableDataSource<ResourcePackageDto>;
  resourcePackageSelection = new SelectionModel<ResourcePackageDto>(true, []);
  isLoadingResourcePackages = false;
  resourcePackageTextFilterValue: string = '';
  resourcePackageColumns: string[] = ['selectCheckbox', 'name', 'elements', 'packageSize', 'createdAt'];

  private resourcePackageTextFilterChanged: Subject<string> = new Subject<string>();
  private resourcePackageTextFilterSubscription: Subscription | undefined;

  constructor(
    public dialogRef: MatDialogRef<ResourcePackagesDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ResourcePackagesDialogData,
    public backendService: BackendService,
    private appService: AppService,
    private snackBar: MatSnackBar,
    private translate: TranslateService
  ) {}

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
    this.backendService.getResourcePackages(this.appService.selectedWorkspaceId)
      .subscribe({
        next: packages => {
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

    const packageIds = this.resourcePackageSelection.selected.map(pkg => pkg.id);
    this.isLoadingResourcePackages = true;

    this.backendService.deleteResourcePackages(this.data.workspaceId, packageIds)
      .subscribe({
        next: success => {
          this.isLoadingResourcePackages = false;
          if (success) {
            this.snackBar.open(
              this.translate.instant('Resource packages deleted successfully'),
              '',
              { duration: 3000 }
            );
            this.loadResourcePackages();
            this.resourcePackageSelection.clear();
            this.dialogRef.close(true); // Notify parent component that packages were deleted
          } else {
            this.snackBar.open(
              this.translate.instant('Failed to delete resource packages'),
              this.translate.instant('error'),
              { duration: 3000 }
            );
          }
        },
        error: () => {
          this.isLoadingResourcePackages = false;
          this.snackBar.open(
            this.translate.instant('Failed to delete resource packages'),
            this.translate.instant('error'),
            { duration: 3000 }
          );
        }
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
    this.isLoadingResourcePackages = true;
    this.backendService.downloadResourcePackage(this.data.workspaceId, resourcePackage.name)
      .subscribe({
        next: blob => {
          this.isLoadingResourcePackages = false;
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${resourcePackage.name}.zip`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        },
        error: () => {
          this.isLoadingResourcePackages = false;
          this.snackBar.open(
            this.translate.instant('Failed to download resource package'),
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
      this.isLoadingResourcePackages = true;
      this.backendService.uploadResourcePackage(this.data.workspaceId, files[0])
        .subscribe({
          next: id => {
            this.isLoadingResourcePackages = false;
            if (id > 0) {
              this.snackBar.open(
                this.translate.instant('Resource package uploaded successfully'),
                '',
                { duration: 3000 }
              );
              this.loadResourcePackages();
              this.dialogRef.close(true); // Notify parent component that packages were uploaded
            } else {
              this.snackBar.open(
                this.translate.instant('Failed to upload resource package'),
                this.translate.instant('error'),
                { duration: 3000 }
              );
            }
          },
          error: () => {
            this.isLoadingResourcePackages = false;
            this.snackBar.open(
              this.translate.instant('Failed to upload resource package'),
              this.translate.instant('error'),
              { duration: 3000 }
            );
          }
        });
    }
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

  /**
   * Closes the dialog
   */
  close(): void {
    this.dialogRef.close();
  }
}
