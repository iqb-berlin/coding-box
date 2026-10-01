import {
  Component, Inject, OnInit, OnDestroy, ChangeDetectorRef, ElementRef, ViewChild, inject, CUSTOM_ELEMENTS_SCHEMA
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogRef,
  MatDialogTitle,
  MatDialogContent,
  MatDialogActions
} from '@angular/material/dialog';

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
import { UnitMetadataValues, VocabularyProvider, TopConcept } from '@iqb/metadata-components';
import { MetadataResolver, VocabConcept } from '@iqb/metadata-resolver';
import { MetadataWebComponentService } from '../../services/metadata-web-component.service';

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
  vocabularyProvider?: VocabularyProvider;
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
  selectedView?: string;
}

@Component({
  selector: 'app-metadata-dialog',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [
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
                     [value]="getSelectedItem()!.id"
                     [readonly]="!isEditing"
                     (input)="updateItemProperty('id', $any($event.target).value)">
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Variablen-ID</mat-label>
              <input matInput
                     [value]="getSelectedItem()!.variableId"
                     [readonly]="!isEditing"
                     (input)="updateItemProperty('variableId', $any($event.target).value)">
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Beschreibung</mat-label>
              <textarea matInput
                        [value]="getSelectedItem()!.description"
                        [readonly]="!isEditing"
                        rows="3"
                        (input)="updateItemProperty('description', $any($event.target).value)"></textarea>
            </mat-form-field>
          </div>
        }

        <mat-divider />

        <div class="metadata-container">
          <metadata-profile-form
            #metadataForm
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
export class MetadataDialogComponent implements OnInit, OnDestroy {
  @ViewChild('metadataForm') private metadataFormElement?: ElementRef<MetadataProfileFormElement>;
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly webComponents = inject(MetadataWebComponentService);
  private destroyed = false;
  private initializationTimer?: ReturnType<typeof setTimeout>;
  private metadataForm?: MetadataProfileFormElement;
  private readonly metadataChangeListener = (event: Event) => {
    this.currentWebComponentMetadata = (event as CustomEvent).detail;
    this.saveCurrentViewDataToLocal();
    this.markAsChanged();
  };

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

    if (this.data.selectedView) {
      this.selectedView = this.data.selectedView;
    }

    await this.webComponents.ensureRegistered();
    if (this.destroyed) return;
    this.extractItems();

    this.initializationTimer = setTimeout(() => {
      this.initializationTimer = undefined;
      this.initializeWebComponent();
    }, 100);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.initializationTimer !== undefined) clearTimeout(this.initializationTimer);
    this.metadataForm?.removeEventListener('metadataChange', this.metadataChangeListener);
  }

  private extractItems(): void {
    if (!this.localMetadataValues?.items) {
      return;
    }
    // Items are references to objects inside localMetadataValues, so editing them updates localMetadataValues
    this.items = this.localMetadataValues.items;
  }

  private initializeWebComponent(): void {
    const form = this.metadataFormElement?.nativeElement;

    if (!form) {
      return;
    }

    try {
      this.updateFormData(form);

      this.metadataForm = form;
      form.addEventListener('metadataChange', this.metadataChangeListener);

      form.readonly = !this.isEditing;
      this.webComponentInitialized = true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error initializing web component:', err);
    } finally {
      this.isLoading = false;
      this.cdr.markForCheck();
    }
  }

  private updateFormData(form: MetadataProfileFormElement): void {
    if (this.selectedView === 'unit') {
      form.metadataValues = {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        profiles: this.localMetadataValues?.profiles || []
      };
      // Force reference change to trigger update if needed
      form.profileData = this.data.profileData ? JSON.parse(JSON.stringify(this.data.profileData)) : undefined;
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
        // Force reference change to trigger update if needed
        form.profileData = this.data.itemProfileData ? JSON.parse(JSON.stringify(this.data.itemProfileData)) : undefined;
      }
    }

    form.language = this.data.language || 'de';
    form.vocabularyProvider = this.getVocabularyProvider();
    form.readonly = !this.isEditing;
  }

  private getVocabularyProvider(): VocabularyProvider | undefined {
    const resolver = this.data.resolver;
    if (!resolver) return undefined;
    const normalize = (concept: VocabConcept): TopConcept => ({
      ...concept,
      notation: concept.notation ?? [],
      prefLabel: { ...concept.prefLabel, de: concept.prefLabel?.de ?? concept.prefLabel?.en ?? '' },
      narrower: (concept.narrower ?? []).map(normalize)
    });
    return {
      getVocabularies: () => resolver.getVocabularies().map(vocabulary => ({
        url: vocabulary.url,
        data: { ...vocabulary.data, hasTopConcept: vocabulary.data.hasTopConcept?.map(normalize) }
      })),
      getVocabularyDictionary: () => resolver.getVocabularyDictionary()
    };
  }

  onViewChange(): void {
    // We don't save here because the listener already updates local state on every change
    // But we need to update the form with the new view's data
    const form = this.metadataFormElement?.nativeElement;
    if (form && this.webComponentInitialized) {
      this.updateFormData(form);
    }
  }

  onEditModeChange(): void {
    const form = this.metadataFormElement?.nativeElement;
    if (form) {
      form.readonly = !this.isEditing;
    }
  }

  markAsChanged(): void {
    this.hasChanges = true;
    this.cdr.markForCheck();
  }

  updateItemProperty(prop: 'id' | 'variableId' | 'description', value: string): void {
    const item = this.getSelectedItem();
    if (item) {
      item[prop] = value;
      this.markAsChanged();
    }
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
