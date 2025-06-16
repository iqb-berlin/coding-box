import { Component, Inject, OnInit } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle
} from '@angular/material/dialog';
import { NgStyle } from '@angular/common';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { MatTooltip } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { UnitTagDto } from '../../../../../../../api-dto/unit-tags/unit-tag.dto';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { CreateUnitTagDto } from '../../../../../../../api-dto/unit-tags/create-unit-tag.dto';

@Component({
  selector: 'app-tag-dialog',
  template: `
    <div class="dialog-header">
      <h1 mat-dialog-title>{{ data.title || 'Unit Tags' }}</h1>
      <div class="header-info">
        <span class="tag-count">{{ tags.length }} Tags</span>
      </div>
    </div>
    
    <div mat-dialog-content>
      <div class="tags-section">
        <div class="section-header">
          <h2>Tags</h2>
        </div>
    
        <div class="tags-container">
          <div class="tags-list">
            @for (tag of tags; track tag) {
              <div class="tag-item" [ngStyle]="{'background-color': tag.color || '#e3f2fd'}">
                <span class="tag-text" [ngStyle]="{'color': getContrastColor(tag.color)}">{{ tag.tag }}</span>
                <div class="tag-actions">
                  <button mat-icon-button (click)="deleteTag(tag.id)" class="tag-action-button" matTooltip="Tag löschen">
                    <mat-icon [ngStyle]="{'color': getContrastColor(tag.color)}">close</mat-icon>
                  </button>
                </div>
              </div>
            }
          </div>
          <div class="add-tag-form">
            <mat-form-field appearance="outline" class="tag-input">
              <mat-label>Neuer Tag</mat-label>
              <input matInput [(ngModel)]="newTagText" placeholder="Tag eingeben">
            </mat-form-field>
            <button mat-raised-button color="primary" (click)="addTag()" class="add-tag-button">
              <mat-icon>add</mat-icon>
              Hinzufügen
            </button>
          </div>
        </div>
      </div>
    </div>
    
    <div mat-dialog-actions align="end">
      <button mat-stroked-button (click)="closeDialog()">Schließen</button>
    </div>
    `,
  styles: [`
    /* Dialog Header */
    .dialog-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 16px;
      margin-bottom: 8px;
    }

    h1 {
      margin: 0;
      font-size: 24px;
      color: #1976d2;
    }

    .header-info {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
    }

    .tag-count {
      background-color: #e3f2fd;
      color: #1976d2;
      padding: 4px 8px;
      border-radius: 16px;
      font-size: 14px;
      font-weight: 500;
    }

    /* Section Headers */
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      border-bottom: 1px solid #e0e0e0;
      padding-bottom: 8px;
    }

    h2 {
      margin: 0;
      font-size: 18px;
      color: #333;
      font-weight: 500;
    }

    /* Tags Section */
    .tags-section {
      background-color: #f9f9f9;
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    }

    .tags-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .tags-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .tag-item {
      display: flex;
      align-items: center;
      padding: 4px 8px;
      border-radius: 16px;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    }

    .tag-text {
      margin-right: 4px;
    }

    .tag-actions {
      display: flex;
      align-items: center;
    }

    .tag-action-button {
      width: 24px;
      height: 24px;
      line-height: 24px;
    }

    .tag-action-button mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      line-height: 16px;
    }

    .add-tag-form {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
    }

    .tag-input {
      flex: 1;
    }

    /* Dialog Content and Actions */
    mat-dialog-content {
      max-height: 400px;
      overflow-y: auto;
      padding: 0 16px;
    }

    mat-dialog-actions {
      margin-top: 16px;
      padding: 8px 16px;
      border-top: 1px solid #eee;
    }

    button[mat-stroked-button] {
      min-width: 100px;
    }
  `],
  imports: [
    MatDialogContent,
    MatDialogTitle,
    MatDialogActions,
    MatButton,
    MatIconButton,
    MatIcon,
    NgStyle,
    MatFormField,
    MatLabel,
    MatInput,
    FormsModule,
    MatTooltip
],
  standalone: true
})
export class TagDialogComponent implements OnInit {
  tags: UnitTagDto[] = [];
  newTagText: string = '';

  constructor(
    public dialogRef: MatDialogRef<TagDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: {
      unitId: number;
      tags: UnitTagDto[];
      title?: string;
    },
    private backendService: BackendService,
    private appService: AppService,
    private snackBar: MatSnackBar
  ) { }

  ngOnInit(): void {
    this.tags = [...this.data.tags];
  }

  /**
   * Add a new tag to the unit
   */
  addTag(): void {
    if (!this.newTagText.trim()) {
      this.snackBar.open(
        'Bitte geben Sie einen Tag-Text ein',
        'Fehler',
        { duration: 3000 }
      );
      return;
    }

    const createTagDto: CreateUnitTagDto = {
      unitId: this.data.unitId,
      tag: this.newTagText.trim()
    };

    this.backendService.createUnitTag(
      this.appService.selectedWorkspaceId,
      createTagDto
    ).subscribe({
      next: tag => {
        this.tags.push(tag);
        this.newTagText = ''; // Clear the input field

        this.snackBar.open(
          'Tag erfolgreich hinzugefügt',
          'Erfolg',
          { duration: 3000 }
        );
      },
      error: () => {
        this.snackBar.open(
          'Fehler beim Hinzufügen des Tags',
          'Fehler',
          { duration: 3000 }
        );
      }
    });
  }

  /**
   * Delete a tag from the unit
   * @param tagId The ID of the tag to delete
   */
  deleteTag(tagId: number): void {
    this.backendService.deleteUnitTag(
      this.appService.selectedWorkspaceId,
      tagId
    ).subscribe({
      next: success => {
        if (success) {
          this.tags = this.tags.filter(tag => tag.id !== tagId);

          this.snackBar.open(
            'Tag erfolgreich gelöscht',
            'Erfolg',
            { duration: 3000 }
          );
        } else {
          this.snackBar.open(
            'Fehler beim Löschen des Tags',
            'Fehler',
            { duration: 3000 }
          );
        }
      },
      error: () => {
        this.snackBar.open(
          'Fehler beim Löschen des Tags',
          'Fehler',
          { duration: 3000 }
        );
      }
    });
  }

  /**
   * Determines the appropriate text color (black or white) based on the background color
   * @param backgroundColor The background color in any valid CSS format (hex, rgb, etc.)
   * @returns Either 'black' or 'white' depending on the background brightness
   */
  getContrastColor(backgroundColor?: string): string {
    // If no color is provided, return black (for default light backgrounds)
    if (!backgroundColor) {
      return '#000000';
    }

    // Convert the color to RGB
    let r = 0;
    let g = 0;
    let b = 0;

    // Handle hex colors
    if (backgroundColor.startsWith('#')) {
      const hex = backgroundColor.slice(1);

      // Handle shorthand hex (#RGB)
      if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
      } else if (hex.length === 6) {
        // Handle full hex (#RRGGBB)
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
      } else {
        // Invalid hex, return black
        return '#000000';
      }
    } else if (backgroundColor.startsWith('rgb')) {
      // Handle rgb/rgba colors
      const rgbMatch = backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
      if (rgbMatch) {
        r = parseInt(rgbMatch[1], 10);
        g = parseInt(rgbMatch[2], 10);
        b = parseInt(rgbMatch[3], 10);
      } else {
        // Invalid rgb format, return black
        return '#000000';
      }
    } else {
      // Unsupported color format, return black
      return '#000000';
    }

    // Calculate brightness using the YIQ formula
    // This formula gives more weight to colors that the human eye is more sensitive to
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;

    // Return white for dark backgrounds, black for light backgrounds
    return brightness >= 128 ? '#000000' : '#ffffff';
  }

  /**
   * Closes the dialog and returns the updated tags
   */
  closeDialog(): void {
    this.dialogRef.close(this.tags);
  }
}
