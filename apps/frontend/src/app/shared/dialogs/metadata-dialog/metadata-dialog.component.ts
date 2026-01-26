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
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MDProfile } from '@iqbspecs/metadata-profile/metadata-profile.interface';
import { MetadataProfileValues, VocabularyEntry } from '@iqbspecs/metadata-values/metadata-values.interface';
import { bootstrapMetadataWebComponents, UnitMetadataValues } from '@iqb/metadata-components';
import { MetadataResolver } from '@iqb/metadata-resolver';

export interface MetadataItem {
  id: string;
  uuid: string;
  variableId: string | null;
  description: string | null;
  profiles?: MetadataProfileValues[];
}

export interface VomdMetadata {
  items?: MetadataItem[];
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
  metadataValues?: VomdMetadata;
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
    MatInputModule,
    MatLabel,
    MatSelect,
    MatOption,
    MatProgressSpinnerModule,
    FormsModule,
    MatSlideToggleModule
  ],
  template: `
    <div class="dialog-header">
      <h2 mat-dialog-title>{{ data.title }}</h2>
      <div class="header-controls">
        <mat-slide-toggle
          [(ngModel)]="isEditing"
          (change)="onEditModeChange()"
          color="primary">
          {{ isEditing ? 'Bearbeiten aktiv' : 'Bearbeiten' }}
        </mat-slide-toggle>
      </div>
    </div>

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
            <mat-form-field appearance="outline">
              <mat-label>Item-ID</mat-label>
              <input matInput
                     [(ngModel)]="getSelectedItem()!.id"
                     [disabled]="!isEditing"
                     (ngModelChange)="markAsChanged()">
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Variablen-ID</mat-label>
              <input matInput
                     [(ngModel)]="getSelectedItem()!.variableId"
                     [disabled]="!isEditing"
                     (ngModelChange)="markAsChanged()">
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Beschreibung</mat-label>
              <textarea matInput
                        [(ngModel)]="getSelectedItem()!.description"
                        [disabled]="!isEditing"
                        rows="3"
                        (ngModelChange)="markAsChanged()"></textarea>
            </mat-form-field>
          </div>
        }

        <mat-divider />

        <div class="metadata-container">
          <metadata-profile-form
            id="metadata-form"
            [attr.language]="data.language || 'de'"
            [attr.readonly]="isEditing ? null : ''">
          </metadata-profile-form>
        </div>
      </div>
    </mat-dialog-content>

    <mat-divider />

    <mat-dialog-actions align="end">
      <button mat-button (click)="close(false)">
        {{ isEditing && hasChanges ? 'Abbrechen' : 'Schließen' }}
      </button>

      @if (isEditing && hasChanges) {
        <button mat-raised-button color="primary" (click)="close(true)">
          Speichern
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-right: 24px;
    }

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

    .metadata-container {
      padding: 1rem;
    }
  `]
})
export class MetadataDialogComponent implements OnInit {
  private currentWebComponentMetadata: Partial<UnitMetadataValues> | null = null;
  private webComponentInitialized = false;
  isLoading = true;

  selectedView: string = 'unit';
  items: MetadataItem[] = [];
  localMetadataValues: VomdMetadata | undefined; // Local copy of full metadata

  isEditing = false;
  hasChanges = false;

  constructor(
    public dialogRef: MatDialogRef<MetadataDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: MetadataDialogData
  ) { }

  async ngOnInit() {
    // Deep copy metadata values to avoid mutating reference passed in
    this.localMetadataValues = JSON.parse(JSON.stringify(this.data.metadataValues));

    await bootstrapMetadataWebComponents();
    this.extractItems();

    setTimeout(() => {
      this.initializeWebComponent();
    }, 100);
  }

  private extractItems(): void {
    if (!this.localMetadataValues?.items) {
      return;
    }
    // Items are references to objects inside localMetadataValues, so editing them updates localMetadataValues
    this.items = this.localMetadataValues.items;
  }

  private initializeWebComponent(): void {
    const form = document.getElementById('metadata-form') as unknown as MetadataProfileFormElement;

    if (!form) {
      return;
    }

    try {
      this.updateFormData(form);

      form.addEventListener('metadataChange', ((event: CustomEvent) => {
        this.currentWebComponentMetadata = event.detail;
        this.saveCurrentViewDataToLocal();
        this.markAsChanged();
      }) as EventListener);

      form.readonly = !this.isEditing;
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
        profiles: this.localMetadataValues?.profiles || []
      };
      form.profileData = this.data.profileData;
    } else {
      const selectedItem = this.items.find(
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
    form.readonly = !this.isEditing;
  }

  onViewChange(): void {
    // We don't save here because the listener already updates local state on every change
    // But we need to update the form with the new view's data
    const form = document.getElementById('metadata-form') as unknown as MetadataProfileFormElement;
    if (form && this.webComponentInitialized) {
      this.updateFormData(form);
    }
  }

  onEditModeChange(): void {
    const form = document.getElementById('metadata-form') as unknown as MetadataProfileFormElement;
    if (form) {
      form.readonly = !this.isEditing;
    }
  }

  markAsChanged(): void {
    this.hasChanges = true;
  }

  private saveCurrentViewDataToLocal(): void {
    if (!this.currentWebComponentMetadata) return;

    if (this.selectedView === 'unit') {
      if (!this.localMetadataValues) this.localMetadataValues = {};
      this.localMetadataValues.profiles = this.currentWebComponentMetadata.profiles as unknown as MetadataProfileValues[];
    } else {
      const itemIndex = this.items.findIndex(i => i.uuid === this.selectedView);
      if (itemIndex > -1) {
        this.items[itemIndex].profiles = this.currentWebComponentMetadata.profiles as unknown as MetadataProfileValues[];
      }
    }
  }

  close(save: boolean = false): void {
    if (save) {
      // Ensure latest web component state is captured (should be covered by listener, but good to be sure)
      this.dialogRef.close(this.localMetadataValues);
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
