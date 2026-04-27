import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { CoderListComponent } from './coder-list.component';
import { CoderService } from '../../services/coder.service';
import { MatSnackBar } from '@angular/material/snack-bar';

describe('CoderListComponent', () => {
  let fixture: ComponentFixture<CoderListComponent>;
  let component: CoderListComponent;
  let coderService: Record<string, jest.Mock>;
  let snackBar: { open: jest.Mock };

  const coders = [
    { id: 1, name: 'one', displayName: 'One', email: 'one@example.org', assignedJobs: ['A'] },
    { id: 2, name: 'two', displayName: 'Two', email: 'two@example.org', assignedJobs: [] }
  ];

  beforeEach(async () => {
    coderService = {
      getCoders: jest.fn().mockReturnValue(of(coders)),
      createCoder: jest.fn().mockReturnValue(of({})),
      updateCoder: jest.fn().mockReturnValue(of({})),
      deleteCoder: jest.fn().mockResolvedValue(true)
    };
    snackBar = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [CoderListComponent, NoopAnimationsModule, TranslateModule.forRoot()],
      providers: [
        { provide: CoderService, useValue: coderService },
        { provide: MatSnackBar, useValue: snackBar }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CoderListComponent);
    component = fixture.componentInstance;
  });

  it('loads, filters, selects and edits coders', async () => {
    component.ngOnInit();
    component.ngAfterViewInit();

    expect(component.dataSource.data).toEqual(coders);
    component.applyFilter('ONE');
    expect(component.dataSource.filter).toBe('one');
    expect(component.isAllSelected()).toBe(false);
    component.masterToggle();
    expect(component.isAllSelected()).toBe(true);
    expect(component.isIndeterminate()).toBe(false);
    component.selectRow(coders[0] as never);
    expect(component.isIndeterminate()).toBe(true);

    component.coderForm.setValue({ name: 'new', displayName: 'New', email: 'new@example.org' });
    component.createCoder();
    expect(coderService.createCoder).toHaveBeenCalledWith({ name: 'new', displayName: 'New', email: 'new@example.org' });

    component.startEditCoder(coders[0] as never);
    expect(component.isEditing).toBe(true);
    component.updateCoder();
    expect(coderService.updateCoder).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'one' }));
    component.cancelEdit();
    expect(component.isEditing).toBe(false);

    component.masterToggle();
    component.deleteCoders();
    await Promise.resolve();
    expect(coderService.deleteCoder).toHaveBeenCalled();
    expect(component.getAssignedJobsText(coders[0] as never)).toBe('A');
    expect(component.getAssignedJobsText(coders[1] as never)).toBe('Keine');
  });

  it('shows validation and service errors', () => {
    component.coderForm.reset();
    component.createCoder();
    component.updateCoder();
    component.deleteCoders();

    coderService.getCoders.mockReturnValueOnce(throwError(() => new Error('load')));
    component.loadCoders();
    coderService.createCoder.mockReturnValueOnce(throwError(() => new Error('create')));
    component.coderForm.setValue({ name: 'new', displayName: '', email: '' });
    component.createCoder();
    coderService.updateCoder.mockReturnValueOnce(throwError(() => new Error('update')));
    component.startEditCoder(coders[0] as never);
    component.updateCoder();

    expect(snackBar.open).toHaveBeenCalled();
  });
});
