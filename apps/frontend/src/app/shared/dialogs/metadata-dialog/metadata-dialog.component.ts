import {
  Component, Inject, OnInit, CUSTOM_ELEMENTS_SCHEMA
} from '@angular/core';
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
import { MatLabel, MatFormFieldModule } from '@angular/material/form-field';
import { MatSelect } from '@angular/material/select';
import { MatOption } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormsModule } from '@angular/forms';
import { MDProfile } from '@iqbspecs/metadata-profile/metadata-profile.interface';
import { MetadataProfileValues, VocabularyEntry } from '@iqbspecs/metadata-values/metadata-values.interface';
import { bootstrapMetadataWebComponents, UnitMetadataValues } from '@iqb/metadata-components';
import { MetadataResolver } from '@iqb/metadata-resolver';

interface MetadataItem {
  id: string;
  uuid: string;
  variableId: string | null;
  description: string | null;
  profiles?: MetadataProfileValues[];
}

interface MetadataProfileFormElement extends HTMLElement {
  resolver?: MetadataResolver;
  profileData?: MDProfile;
  metadataValues: Partial<UnitMetadataValues>;
  language?: string;
  readonly: boolean;
}

export interface MetadataDialogData {
  title: string;
  profileUrl?: string;
  itemProfileUrl?: string;
  profileData?: MDProfile;
  itemProfileData?: MDProfile;
  metadataValues?: { items?: MetadataItem[], profiles?: MetadataProfileValues[] };
  vocabularies?: VocabularyEntry[];
  resolver?: MetadataResolver;
  language?: string;
  mode?: 'edit' | 'readonly';
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
    MatFormFieldModule,
    MatLabel,
    MatSelect,
    MatOption,
    MatProgressSpinnerModule,
    FormsModule
  ],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>

    <mat-dialog-content>
      @if (isLoading) {
        <div class="spinner-container">
          <mat-progress-spinner mode="indeterminate"></mat-progress-spinner>
        </div>
      }

      <div [style.display]="isLoading ? 'none' : 'block'">
        <div class="selection-container">
          <mat-form-field appearance="outline">
            <mat-label>Metadaten anzeigen für</mat-label>
            <mat-select [(ngModel)]="selectedView" (selectionChange)="onViewChange()">
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
    .spinner-container {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 300px;
    }

    .selection-container {
      padding: 1rem 1rem 0;
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
      padding: 1rem;
    }
  `]
})
export class MetadataDialogComponent implements OnInit {
  private currentMetadata: Partial<UnitMetadataValues> | null = null;
  private webComponentInitialized = false;
  isLoading = true;

  selectedView: string = 'unit';
  items: MetadataItem[] = [];

  constructor(
    public dialogRef: MatDialogRef<MetadataDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: MetadataDialogData
  ) { }

  async ngOnInit() {
    await bootstrapMetadataWebComponents();
    this.extractItems();

    setTimeout(() => {
      this.initializeWebComponent();
    }, 100);
  }

  private extractItems(): void {
    if (!this.data.metadataValues?.items) {
      return;
    }

    this.items = this.data.metadataValues.items.map((item: MetadataItem) => ({
      id: item.id,
      uuid: item.uuid,
      variableId: item.variableId,
      description: item.description
    }));
  }

  private initializeWebComponent(): void {
    const form = document.getElementById('metadata-form') as unknown as MetadataProfileFormElement;

    if (!form) {
      return;
    }

    try {
      this.updateFormData(form);

      form.addEventListener('metadataChange', ((event: CustomEvent) => {
        this.currentMetadata = event.detail;
      }) as EventListener);

      form.readonly = this.data.mode === 'readonly';
      this.webComponentInitialized = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error initializing web component:', err);
    } finally {
      this.isLoading = false;
    }
  }

  private updateFormData(form: MetadataProfileFormElement): void {
    if (this.selectedView === 'unit') {
      form.metadataValues = {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        profiles: this.data.metadataValues?.profiles || []
      };
      form.profileData = this.data.profileData;
    } else {
      const selectedItem = this.data.metadataValues?.items?.find(
        (item: MetadataItem) => item.uuid === this.selectedView
      );

      if (selectedItem) {
        form.metadataValues = {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          profiles: selectedItem.profiles || []
        };
        form.profileData = this.data.itemProfileData;
      }
    }

    form.language = this.data.language || 'de';
    form.resolver = this.data.resolver;
  }

  onViewChange(): void {
    const form = document.getElementById('metadata-form') as unknown as MetadataProfileFormElement;
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
