import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MetadataDialogComponent } from './metadata-dialog.component';

describe('MetadataDialog read-only capability', () => {
  const create = (mode?: 'readonly' | 'edit') => {
    const close = jest.fn();
    const component = new MetadataDialogComponent({ close } as unknown as MatDialogRef<MetadataDialogComponent>, { title: 'Metadata', mode });
    component.localMetadataValues = { items: [] };
    return { component, close };
  };

  it.each([undefined, 'readonly'] as const)('locks editing and saving in mode %s', mode => {
    const { component, close } = create(mode);
    component.isEditing = true;
    component.markAsChanged();
    expect(component.hasChanges).toBe(false);
    component.onEditModeChange();
    expect(component.isEditing).toBe(false);
    expect(component.canEdit).toBe(false);
    component.close(true);
    expect(close).toHaveBeenCalledWith(null);
  });

  it('keeps the explicit file editor initially in viewing mode, then permits saving', () => {
    const { component, close } = create('edit');
    expect(component.canEdit).toBe(true);
    expect(component.isEditing).toBe(false);
    component.isEditing = true;
    component.markAsChanged();
    component.close(true);
    expect(component.hasChanges).toBe(true);
    expect(close).toHaveBeenCalledWith(component.localMetadataValues);
  });

  it('renders a read-only item without edit or save actions, including delayed metadata events', async () => {
    await TestBed.configureTestingModule({
      imports: [MetadataDialogComponent],
      providers: [provideNoopAnimations(),
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            title: 'Metadata',
            mode: 'readonly',
            selectedView: 'uuid-1',
            metadataValues: {
              items: [{
                id: 'item-1', uuid: 'uuid-1', variableId: 'v1', description: 'Original'
              }]
            }
          }
        }
      ]
    }).compileComponents();
    const fixture = TestBed.createComponent(MetadataDialogComponent);
    const component = fixture.componentInstance;
    jest.spyOn(component, 'ngOnInit').mockImplementation(async () => {});
    component.localMetadataValues = {
      items: [{
        id: 'item-1', uuid: 'uuid-1', variableId: 'v1', description: 'Original'
      }]
    };
    component.items = component.localMetadataValues.items!;
    component.selectedView = 'uuid-1';
    component.isLoading = false;
    fixture.detectChanges();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    expect(input.readOnly).toBe(true);
    expect(fixture.nativeElement.querySelector('mat-slide-toggle')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Speichern');
    component.isEditing = true;
    component.updateItemProperty('description', 'Changed');
    component.markAsChanged();
    fixture.detectChanges();
    expect(component.localMetadataValues.items![0].description).toBe('Original');
    expect(component.hasChanges).toBe(false);
    expect(fixture.nativeElement.querySelector('metadata-profile-form').hasAttribute('readonly')).toBe(true);
  });
});
