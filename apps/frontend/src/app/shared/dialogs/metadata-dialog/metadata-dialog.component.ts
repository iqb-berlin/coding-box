import { Component, Inject, OnInit, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogRef,
  MatDialogTitle,
  MatDialogContent,
  MatDialogActions
} from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { MatButton } from '@angular/material/button';
import { MatDivider } from '@angular/material/divider';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatSelect } from '@angular/material/select';
import { MatOption } from '@angular/material/core';
import { bootstrapMetadataWebComponents } from '@iqb/metadata-components';

export interface MetadataDialogData {
  title: string;
  profileUrl?: string;
  itemProfileUrl?: string;
  profileData?: any;
  itemProfileData?: any;
  metadataValues?: any;
  vocabularies?: any[];
  resolver?: any;
  language?: string;
  mode?: 'edit' | 'readonly';
}

interface MetadataItem {
  id: string;
  uuid: string;
  variableId: string | null;
  description: string | null;
}

@Component({
  selector: 'app-metadata-dialog',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [
    CommonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatDivider,
    MatFormField,
    MatLabel,
    MatSelect,
    MatOption
  ],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>

    <mat-dialog-content>
      <div class="selection-container">
        <mat-form-field appearance="outline">
          <mat-label>Metadaten anzeigen für</mat-label>
          <mat-select [(value)]="selectedView" (selectionChange)="onViewChange()">
            <mat-option value="unit">Unit (Aufgabe)</mat-option>
            @for (item of items; track item.uuid) {
              <mat-option [value]="item.uuid">
                Item {{ item.id }}
              </mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>

      @if (selectedView !== 'unit') {
        <div class="item-info">
          <div class="info-field">
            <label>Item-ID</label>
            <div class="info-value">{{ getSelectedItem()?.id }}</div>
          </div>

          @if (getSelectedItem()?.variableId) {
            <div class="info-field">
              <label>Variablen-ID</label>
              <div class="info-value">{{ getSelectedItem()?.variableId }}</div>
            </div>
          }

          @if (getSelectedItem()?.description) {
            <div class="info-field">
              <label>Beschreibung</label>
              <div class="info-value">{{ getSelectedItem()?.description }}</div>
            </div>
          }
        </div>
      }

      <mat-divider />

      <div class="metadata-container">
        <metadata-profile-form
          id="metadata-form"
          [attr.language]="data.language || 'de'"
          [attr.readonly]="data.mode === 'readonly' ? '' : null">
        </metadata-profile-form>
      </div>
    </mat-dialog-content>

    <mat-divider />

    <mat-dialog-actions align="end">
      <button mat-button (click)="close(false)">
        {{ data.mode === 'readonly' ? 'Schließen' : 'Abbrechen' }}
      </button>

      @if (data.mode !== 'readonly') {
        <button mat-raised-button color="primary" (click)="close(true)">
          Speichern
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    .selection-container {
      padding: 1rem;
      padding-bottom: 0;
    }

    mat-form-field {
      width: 100%;
    }

    .item-info {
      padding: 1rem;
      background: #f5f5f5;
      border-radius: 4px;
      margin: 0 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .info-field {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .info-field label {
      font-size: 12px;
      font-weight: 500;
      color: rgba(0, 0, 0, 0.6);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .info-value {
      font-size: 14px;
      color: rgba(0, 0, 0, 0.87);
      padding: 0.5rem;
      background: white;
      border-radius: 4px;
      border: 1px solid rgba(0, 0, 0, 0.12);
    }

    .metadata-container {
      max-height: 60vh;
      overflow-y: auto;
      padding: 1rem;
    }
  `]
})
export class MetadataDialogComponent implements OnInit {
  private currentMetadata: any = null;
  private webComponentInitialized = false;

  selectedView: string = 'unit';
  items: MetadataItem[] = [];

  constructor(
    public dialogRef: MatDialogRef<MetadataDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: MetadataDialogData
  ) {}

  async ngOnInit() {
    await bootstrapMetadataWebComponents();
    console.log('Web components bootstrapped');

    this.extractItems();

    setTimeout(() => {
      this.initializeWebComponent();
    }, 100);
  }

  private extractItems(): void {
    if (!this.data.metadataValues?.items) {
      console.log('No items found in metadata');
      return;
    }

    this.items = this.data.metadataValues.items.map((item: any) => ({
      id: item.id,
      uuid: item.uuid,
      variableId: item.variableId,
      description: item.description
    }));

    console.log(`Found ${this.items.length} items`);
  }

  private initializeWebComponent(): void {
    const form = document.getElementById('metadata-form') as any;

    if (!form) {
      console.error('Web component element not found');
      return;
    }

    try {
      console.log('Initializing web component...');

      this.updateFormData(form);

      form.addEventListener('metadataChange', (event: CustomEvent) => {
        console.log('Metadata changed:', event.detail);
        this.currentMetadata = event.detail;
      });

      if (this.data.mode === 'readonly') {
        form.readonly = true;
        console.log('Setting readonly to true');
      } else {
        form.readonly = false;
      }

      this.webComponentInitialized = true;
      console.log('Web component initialized');

    } catch (err) {
      console.error('Error initializing web component:', err);
    }
  }

  private updateFormData(form: any): void {
    if (this.selectedView === 'unit') {
      form.metadataValues = {
        profiles: this.data.metadataValues?.profiles || []
      };
      form.profileData = this.data.profileData;
      console.log('Displaying unit metadata');
    } else {
      // Show item metadata
      const selectedItem = this.data.metadataValues?.items?.find(
        (item: any) => item.uuid === this.selectedView
      );

      if (selectedItem) {
        form.metadataValues = {
          profiles: selectedItem.profiles || []
        };
        form.profileData = this.data.itemProfileData;
        console.log(`Displaying metadata for item ${selectedItem.id}`);
      }
    }

    form.language = this.data.language || 'de';
    form.resolver = this.data.resolver;
  }

  onViewChange(): void {
    console.log(`View changed to: ${this.selectedView}`);

    const form = document.getElementById('metadata-form') as any;
    if (form && this.webComponentInitialized) {
      this.updateFormData(form);
    }
  }

  close(save: boolean = false): void {
    if (save) {
      const result = {
        selectedView: this.selectedView,
        metadata: this.currentMetadata
      };
      this.dialogRef.close(result);
    } else {
      this.dialogRef.close(null);
    }
  }

  getSelectedItem(): MetadataItem | undefined {
    if (this.selectedView === 'unit') {
      return undefined;
    }
    return this.items.find(item => item.uuid === this.selectedView);
  }
}
