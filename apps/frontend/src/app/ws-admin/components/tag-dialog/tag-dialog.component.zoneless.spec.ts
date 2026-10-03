import {
  Component, inject, provideZonelessChangeDetection
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { TagDialogComponent } from './tag-dialog.component';
import { UnitTagService } from '../../../shared/services/unit/unit-tag.service';
import { AppService } from '../../../core/services/app.service';
import { UnitTagDto } from '../../../../../../../api-dto/unit-tags/unit-tag.dto';

jest.unmock('@angular/material/snack-bar');

@Component({
  standalone: true,
  template: '<button (click)="open()">Open tags</button>'
})
class TagsDialogHostComponent {
  readonly dialog = inject(MatDialog);
  tags: UnitTagDto[] = [];

  open(): void {
    this.dialog.open(TagDialogComponent, { data: { unitId: 9, tags: this.tags } });
  }
}

describe('TagDialogComponent zoneless mutations', () => {
  let fixture: ComponentFixture<TagsDialogHostComponent>;
  let createResponse: Subject<UnitTagDto>;
  let deleteResponse: Subject<boolean>;
  let createUnitTag: jest.Mock;
  let deleteUnitTag: jest.Mock;

  const tag: UnitTagDto = {
    id: 1,
    unitId: 9,
    tag: 'Prüfmarkierung',
    createdAt: new Date('2026-01-01T12:00:00Z')
  };

  beforeEach(async () => {
    createResponse = new Subject<UnitTagDto>();
    deleteResponse = new Subject<boolean>();
    createUnitTag = jest.fn().mockReturnValue(createResponse);
    deleteUnitTag = jest.fn().mockReturnValue(deleteResponse);
    await TestBed.configureTestingModule({
      imports: [TagsDialogHostComponent, MatDialogModule, MatSnackBarModule],
      providers: [
        provideZonelessChangeDetection(),
        { provide: UnitTagService, useValue: { createUnitTag, deleteUnitTag } },
        { provide: AppService, useValue: { selectedWorkspaceId: 1 } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(TagsDialogHostComponent);
    await fixture.whenStable();
  });

  afterEach(async () => {
    TestBed.inject(MatSnackBar).dismiss();
    TestBed.inject(MatDialog).closeAll();
    await fixture.whenStable();
    fixture.destroy();
  });

  async function openDialog(tags: UnitTagDto[] = []): Promise<MatDialogRef<TagDialogComponent>> {
    fixture.componentInstance.tags = tags;
    fixture.nativeElement.querySelector('button').click();
    await fixture.whenStable();
    return TestBed.inject(MatDialog).openDialogs[0] as MatDialogRef<TagDialogComponent>;
  }

  it('renders a delayed added tag and clears the input without another interaction', async () => {
    const dialogRef = await openDialog();
    const input = document.querySelector('app-tag-dialog input') as HTMLInputElement;
    input.value = tag.tag;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    (document.querySelector('.add-tag-button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(createUnitTag).toHaveBeenCalledWith(1, { unitId: 9, tag: tag.tag });
    expect(document.querySelector('.tag-item')).toBeNull();

    createResponse.next(tag);
    createResponse.complete();
    await fixture.whenStable();

    expect(dialogRef.componentInstance.tags).toEqual([tag]);
    expect(document.querySelector('.tag-item')?.textContent).toContain(tag.tag);
    expect(document.querySelector('.tag-count')?.textContent).toContain('1 Tags');
    expect(input.value).toBe('');
    expect(document.querySelector('mat-snack-bar-container')?.textContent).toContain('Tag erfolgreich hinzugefügt');
  });

  it('removes a tag after delayed delete success without another interaction', async () => {
    const dialogRef = await openDialog([tag]);
    expect(document.querySelector('.tag-item')?.textContent).toContain(tag.tag);
    (document.querySelector('.tag-action-button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(deleteUnitTag).toHaveBeenCalledWith(1, tag.id);
    expect(document.querySelector('.tag-item')).not.toBeNull();

    deleteResponse.next(true);
    deleteResponse.complete();
    await fixture.whenStable();

    expect(dialogRef.componentInstance.tags).toEqual([]);
    expect(document.querySelector('.tag-item')).toBeNull();
    expect(document.querySelector('.tag-count')?.textContent).toContain('0 Tags');
    expect(document.querySelector('mat-snack-bar-container')?.textContent).toContain('Tag erfolgreich gelöscht');
  });
});
