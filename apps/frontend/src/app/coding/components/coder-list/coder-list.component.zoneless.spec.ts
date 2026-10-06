import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { CoderListComponent } from './coder-list.component';
import { CoderService } from '../../services/coder.service';
import { Coder } from '../../models/coder.model';

describe('Conditional coder table queries without Zone.js', () => {
  let fixture: ComponentFixture<CoderListComponent>;
  let response: Subject<Coder[]>;
  let getCoders: jest.Mock;

  beforeEach(async () => {
    response = new Subject<Coder[]>();
    getCoders = jest.fn(() => response);
    await TestBed.configureTestingModule({
      imports: [CoderListComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: CoderService, useValue: { getCoders } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(CoderListComponent);
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it('connects sorting after a delayed response and reconnects when the table is recreated', async () => {
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('mat-spinner')).not.toBeNull();
    expect(fixture.componentInstance.sort()).toBeUndefined();
    const coders = [{ id: 1, name: 'Zulu' }, { id: 2, name: 'Alpha' }];
    response.next(coders);
    response.complete();
    await fixture.whenStable();
    expect(element.querySelector('mat-spinner')).toBeNull();
    const sortByName = () => (element.querySelector('.mat-column-name .mat-sort-header-container') as HTMLElement).click();
    sortByName();
    await fixture.whenStable();
    expect(element.querySelector('mat-row')?.textContent).toContain('Alpha');
    const previousSort = fixture.componentInstance.sort();

    response = new Subject<Coder[]>();
    fixture.componentInstance.loadCoders();
    await fixture.whenStable();
    expect(fixture.componentInstance.sort()).toBeUndefined();
    expect(fixture.componentInstance.dataSource.sort).toBeNull();
    response.next(coders);
    response.complete();
    await fixture.whenStable();
    expect(fixture.componentInstance.sort()).not.toBe(previousSort);
    expect(fixture.componentInstance.dataSource.sort).toBe(fixture.componentInstance.sort());
    sortByName();
    await fixture.whenStable();
    expect(element.querySelector('mat-row')?.textContent).toContain('Alpha');
  });

  it('cancels the pending list subscription when the view is destroyed', () => {
    expect(response.observed).toBe(true);
    fixture.destroy();
    expect(response.observed).toBe(false);
  });
});
