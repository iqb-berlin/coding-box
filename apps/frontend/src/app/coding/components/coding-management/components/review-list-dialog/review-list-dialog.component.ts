import {
  Component, Inject, OnInit, inject, ViewChildren, QueryList, ElementRef, AfterViewInit, OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { CodingManagementUiService } from '../../services/coding-management-ui.service';
import { Success } from '../../../../models/success.model';

export interface ReviewListDialogData {
  responses: Success[];
  title?: string;
}

interface ReviewItem {
  response: Success;
  isLoading: boolean;
  replayUrl: SafeResourceUrl | null;
  isLoaded: boolean;
}

@Component({
  selector: 'app-review-list-dialog',
  templateUrl: './review-list-dialog.component.html',
  styleUrls: ['./review-list-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    TranslateModule
  ]
})
export class ReviewListDialogComponent implements OnInit, AfterViewInit, OnDestroy {
  private sanitizer = inject(DomSanitizer);
  private uiService = inject(CodingManagementUiService);

  reviewItems: ReviewItem[] = [];
  private observer: IntersectionObserver | null = null;
  private inViewIndices = new Set<number>();
  private isAnyItemLoading = false;

  @ViewChildren('reviewItemRef') reviewItemRefs!: QueryList<ElementRef>;

  constructor(
    public dialogRef: MatDialogRef<ReviewListDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ReviewListDialogData
  ) { }

  ngOnInit(): void {
    this.reviewItems = this.data.responses.map(response => ({
      response,
      isLoading: false,
      replayUrl: null,
      isLoaded: false
    }));

    this.reviewItems.sort((a, b) => {
      const codeA = this.getResolvedCode(a.response);
      const codeB = this.getResolvedCode(b.response);

      if (codeA === null && codeB === null) return 0;
      if (codeA === null) return 1;
      if (codeB === null) return -1;

      return codeA - codeB;
    });
  }

  getResolvedCode(response: Success): number | null {
    if (response.code_v3 !== undefined && response.code_v3 !== null) return response.code_v3;
    if (response.code_v2 !== undefined && response.code_v2 !== null) return response.code_v2;
    if (response.code_v1 !== undefined && response.code_v1 !== null) return response.code_v1;

    // Fallback to the generic code field if none of the versions work
    const genericCode = response.code ? parseInt(response.code, 10) : null;
    return Number.isNaN(genericCode as number) ? null : genericCode;
  }

  getResolvedStatus(response: Success): string {
    if (response.status_v3 && response.status_v3 !== 'UNSET') return response.status_v3;
    if (response.status_v2 && response.status_v2 !== 'UNSET') return response.status_v2;
    if (response.status_v1 && response.status_v1 !== 'UNSET') return response.status_v1;
    return response.status || 'UNSET';
  }

  ngAfterViewInit(): void {
    const options = {
      root: null, // viewport
      rootMargin: '200px', // start detecting before it's fully visible
      threshold: 0.1
    };

    this.observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const index = parseInt(entry.target.getAttribute('data-index') || '-1', 10);
        if (index < 0) return;

        if (entry.isIntersecting) {
          this.inViewIndices.add(index);
          this.processQueue();
        } else {
          this.inViewIndices.delete(index);
        }
      });
    }, options);

    this.reviewItemRefs.changes.subscribe(() => {
      this.updateObserver();
    });

    this.updateObserver();
  }

  private updateObserver(): void {
    if (this.observer) {
      this.reviewItemRefs.forEach(ref => {
        this.observer?.observe(ref.nativeElement);
      });
    }
  }

  ngOnDestroy(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  private processQueue(): void {
    if (this.isAnyItemLoading) return;

    // Find the first in-view item that is not loaded and not loading
    const nextIndex = Array.from(this.inViewIndices)
      .sort((a, b) => a - b)
      .find(index => {
        const item = this.reviewItems[index];
        return !item.isLoaded && !item.isLoading;
      });

    if (nextIndex !== undefined) {
      this.loadReplay(nextIndex);
    }
  }

  loadReplay(index: number): void {
    const item = this.reviewItems[index];
    if (item.isLoaded || item.isLoading) return;

    item.isLoading = true;
    this.isAnyItemLoading = true;

    this.uiService.openReplayForResponse(item.response).subscribe({
      next: url => {
        item.isLoading = false;
        if (url) {
          item.replayUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
          item.isLoaded = true;
        }
        this.isAnyItemLoading = false;
        this.processQueue(); // Check if next visible item can start loading
      },
      error: () => {
        item.isLoading = false;
        this.isAnyItemLoading = false;
        this.processQueue();
      }
    });
  }

  close(): void {
    this.dialogRef.close();
  }
}
