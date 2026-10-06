import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { MetadataResolver } from '@iqb/metadata-resolver';
import { of, Subject } from 'rxjs';
import { ItemListDialogComponent } from './item-list-dialog.component';
import { AppService } from '../../../core/services/app.service';
import { FileService } from '../../services/file/file.service';

type Profile = Awaited<ReturnType<MetadataResolver['loadProfileWithVocabularies']>>;

const profile = { profile: {}, vocabularies: [] } as unknown as Profile;
const group = { fileId: 'UNIT.vomd', id: 12, items: [] };
const file = { base64Data: btoa(JSON.stringify({ profiles: [{ profileId: 'https://profile.test/unit' }], items: [] })) };

describe('Metadata dialog async ownership without ZoneJS', () => {
  let fixture: ComponentFixture<ItemListDialogComponent>;
  let closing: Subject<void>;
  let workspace: { selectedWorkspaceId: number; selectedWorkspaceId$: Subject<number> };
  let downloads: Subject<typeof file>[];
  let resolvers: Array<{ resolve: (value: Profile) => void; reject: (error: Error) => void }>;
  let dialogs: { open: jest.Mock };
  let snackBar: { open: jest.Mock };

  beforeEach(async () => {
    downloads = [];
    resolvers = [];
    closing = new Subject<void>();
    workspace = { selectedWorkspaceId: 5, selectedWorkspaceId$: new Subject<number>() };
    dialogs = { open: jest.fn(() => ({ close: jest.fn() })) };
    snackBar = { open: jest.fn(() => ({ dismiss: jest.fn() })) };
    jest.spyOn(MetadataResolver.prototype, 'loadProfileWithVocabularies').mockImplementation(() => new Promise((resolve, reject) => {
      resolvers.push({ resolve, reject });
    }));
    await TestBed.configureTestingModule({
      imports: [ItemListDialogComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AppService, useValue: workspace },
        { provide: MatDialogRef, useValue: { close: () => closing.next(), beforeClosed: () => closing } },
        {
          provide: FileService,
          useValue: {
            getItemIdsFromMetadata: () => of([]),
            downloadFile: () => { const reply = new Subject<typeof file>(); downloads.push(reply); return reply; }
          }
        }
      ]
    }).overrideProvider(MatDialog, { useValue: dialogs })
      .overrideProvider(MatSnackBar, { useValue: snackBar }).compileComponents();
    fixture = TestBed.createComponent(ItemListDialogComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  afterEach(() => { fixture.destroy(); jest.restoreAllMocks(); });

  function cancel(reason: string): void {
    if (reason === 'close') closing.next();
    if (reason === 'destroy') fixture.destroy();
    if (reason === 'workspace') {
      workspace.selectedWorkspaceId = 6;
      workspace.selectedWorkspaceId$.next(6);
      workspace.selectedWorkspaceId = 5;
      workspace.selectedWorkspaceId$.next(5);
    }
  }

  it.each(['close', 'destroy', 'workspace'])('cancels the HTTP download on %s and settles silently', async reason => {
    const pending = fixture.componentInstance.openMetadata(group);
    cancel(reason);
    expect(downloads[0].observed).toBe(false);
    downloads[0].next(file);
    await pending;
    expect(dialogs.open).not.toHaveBeenCalled();
    expect(resolvers).toHaveLength(0);
    expect(snackBar.open).toHaveBeenCalledTimes(1);
  });

  it.each(['close', 'destroy', 'workspace'])('ignores the uncancellable resolver promise after %s', async reason => {
    const pending = fixture.componentInstance.openMetadata(group);
    downloads[0].next(file);
    await fixture.whenStable();
    expect(resolvers).toHaveLength(1);
    cancel(reason);
    resolvers[0].resolve(profile);
    await pending;
    expect(dialogs.open).not.toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledTimes(1);
  });

  it('shows only the newer metadata request and suppresses the older promise rejection', async () => {
    const old = fixture.componentInstance.openMetadata(group);
    downloads[0].next(file);
    await fixture.whenStable();
    const latest = fixture.componentInstance.openMetadata({ ...group, id: 13, fileId: 'CURRENT.vomd' });
    downloads[1].next(file);
    await fixture.whenStable();
    resolvers[1].resolve(profile);
    await latest;
    resolvers[0].reject(new Error('late resolver failure'));
    await old;
    expect(dialogs.open).toHaveBeenCalledTimes(1);
    expect(dialogs.open.mock.calls[0][1].data.title).toBe('CURRENT.vomd');
    expect(snackBar.open).toHaveBeenCalledTimes(2);
    workspace.selectedWorkspaceId = 6;
    workspace.selectedWorkspaceId$.next(6);
    expect(dialogs.open.mock.results[0].value.close).toHaveBeenCalledTimes(1);
  });
});
