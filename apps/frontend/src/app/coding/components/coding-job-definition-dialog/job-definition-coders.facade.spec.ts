import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { Coder } from '../../models/coder.model';
import { CoderService } from '../../services/coder.service';
import { JobDefinitionCodersFacade } from './job-definition-coders.facade';

describe('JobDefinitionCodersFacade', () => {
  let facade: JobDefinitionCodersFacade;
  let getCoders: jest.Mock;
  let getAssigned: jest.Mock;
  const coders: Coder[] = [{ id: 1, name: 'First' }, { id: 2, name: 'Second' }];

  beforeEach(() => {
    getCoders = jest.fn().mockReturnValue(of(coders));
    getAssigned = jest.fn().mockReturnValue(of([coders[1]]));
    TestBed.configureTestingModule({
      providers: [JobDefinitionCodersFacade,
        { provide: CoderService, useValue: { getCoders, getCodersByJobId: getAssigned } }]
    });
    facade = TestBed.inject(JobDefinitionCodersFacade);
  });

  it('loads configured capacities and selects assigned coders by ID without mutating the catalog', () => {
    facade.loadAvailable({
      isEdit: true,
      codingJob: { assignedCoders: [2], assignedCoderConfigs: [{ coderId: 2, capacityPercent: 150 }] }
    });
    expect(facade.available()).toEqual([{ ...coders[0], capacityPercent: 100 }, { ...coders[1], capacityPercent: 150 }]);
    expect(facade.selection().selected).toEqual([facade.available()[1]]);
    expect(facade.selectedConfigs()).toEqual([{ coderId: 2, capacityPercent: 150 }]);
    expect(coders[1].capacityPercent).toBeUndefined();
    expect(getAssigned).not.toHaveBeenCalled();
  });

  it.each(['catalog', 'assignments'])('retains job assignments when %s arrives first', first => {
    const catalog = new Subject<Coder[]>();
    const assigned = new Subject<Coder[]>();
    getCoders.mockReturnValue(catalog);
    getAssigned.mockReturnValue(assigned);
    facade.loadAvailable({ isEdit: true });
    facade.loadAssigned(42);
    expect(facade.isLoadingAvailable()).toBe(true);
    expect(facade.isLoadingAssigned()).toBe(true);
    if (first === 'catalog') catalog.next(coders);
    assigned.next([coders[1]]);
    if (first === 'assignments') catalog.next(coders);
    expect(getAssigned).toHaveBeenCalledWith(42);
    expect(facade.selection().selected).toEqual([facade.available()[1]]);
    expect(facade.assigned()).toEqual([coders[1]]);
    expect(facade.isLoadingAvailable()).toBe(false);
    expect(facade.isLoadingAssigned()).toBe(false);
  });

  it('replaces selected coder identities after a capacity change and detaches the old model', () => {
    facade.loadAvailable({ isEdit: false });
    const oldRows = facade.available();
    const previous = facade.selection();
    previous.select(...oldRows);
    const changed = jest.fn();
    facade.changed$.subscribe(changed);

    facade.updateCapacity(oldRows[0], '150');
    expect(facade.available()[0]).toEqual({ ...coders[0], capacityPercent: 150 });
    expect(oldRows[0].capacityPercent).toBe(100);
    expect(facade.selection().selected[0]).toBe(facade.available()[0]);
    expect(facade.selection().selected[1]).toBe(oldRows[1]);
    expect(changed).toHaveBeenCalledTimes(1);
    previous.clear();
    expect(changed).toHaveBeenCalledTimes(1);
    facade.selection().toggle(oldRows[0]);
    expect(facade.selection().selected).toEqual([oldRows[1]]);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('restores normalized capacities and omits missing coders from save and distribution payloads', () => {
    facade.loadAvailable({ isEdit: false });
    facade.restore([
      { coderId: 1, capacityPercent: 999 }, { coderId: 2, capacityPercent: 0 }, { coderId: 99, capacityPercent: 100 }
    ]);
    expect(facade.selectedConfigs()).toEqual([{ coderId: 1, capacityPercent: 300 }, { coderId: 2, capacityPercent: 10 }]);
    expect(facade.distributionCoders()).toEqual([
      {
        id: 1, name: 'First', username: 'First', capacityPercent: 300
      },
      {
        id: 2, name: 'Second', username: 'Second', capacityPercent: 10
      }
    ]);
    const selected = facade.selectedCoders();
    expect(selected[0]).not.toBe(facade.selection().selected[0]);
    expect(facade.distributionCoders([{ id: 7, name: 'Bulk', capacityPercent: Number.NaN }]))
      .toEqual([{
        id: 7, name: 'Bulk', username: 'Bulk', capacityPercent: 100
      }]);
  });

  it('finishes a failed catalog load so recovery can proceed, then accepts a retry', () => {
    getCoders.mockReturnValueOnce(throwError(() => new Error('offline')));
    const finished = jest.fn();
    facade.availableFinished$.subscribe(finished);
    facade.loadAvailable({ isEdit: false });
    expect(finished).toHaveBeenCalledTimes(1);
    expect(facade.isLoadingAvailable()).toBe(false);
    facade.loadAvailable({ isEdit: false });
    expect(finished).toHaveBeenCalledTimes(2);
    expect(facade.available()).toHaveLength(2);
  });

  it('preserves the selection after a failed assignment load and allows retry', () => {
    facade.loadAvailable({ isEdit: true, codingJob: { assignedCoders: [1] } });
    getAssigned.mockReturnValueOnce(throwError(() => new Error('offline')));
    facade.loadAssigned(42);
    expect(facade.isLoadingAssigned()).toBe(false);
    expect(facade.selection().selected.map(coder => coder.id)).toEqual([1]);
    facade.loadAssigned(42);
    expect(facade.selection().selected.map(coder => coder.id)).toEqual([2]);
  });

  it('replaces pending requests and ignores their late replies', () => {
    const catalog = new Subject<Coder[]>();
    const assigned = new Subject<Coder[]>();
    getCoders.mockReturnValueOnce(catalog);
    getAssigned.mockReturnValueOnce(assigned);
    facade.loadAvailable({ isEdit: false });
    facade.loadAssigned(1);
    facade.loadAvailable({ isEdit: false });
    facade.loadAssigned(2);
    expect(catalog.observed).toBe(false);
    expect(assigned.observed).toBe(false);
    catalog.next([]);
    assigned.next([]);
    expect(facade.available()).toHaveLength(2);
    expect(facade.selectedConfigs()).toEqual([{ coderId: 2, capacityPercent: 100 }]);
  });

  it('keeps a reentrant catalog load active when the prior synchronous load finishes', () => {
    const pending = new Subject<Coder[]>();
    getCoders.mockReturnValueOnce(of(coders)).mockReturnValueOnce(pending);
    facade.availableFinished$.subscribe(() => facade.loadAvailable({ isEdit: false }));
    facade.loadAvailable({ isEdit: false });
    expect(facade.isLoadingAvailable()).toBe(true);
    expect(pending.observed).toBe(true);
  });

  it('cancels both requests and selection notifications when its dialog is destroyed', () => {
    const catalog = new Subject<Coder[]>();
    const assigned = new Subject<Coder[]>();
    getCoders.mockReturnValue(catalog);
    getAssigned.mockReturnValue(assigned);
    facade.loadAvailable({ isEdit: false });
    facade.loadAssigned(42);
    const changed = jest.fn();
    facade.changed$.subscribe(changed);
    TestBed.resetTestingModule();
    expect(catalog.observed).toBe(false);
    expect(assigned.observed).toBe(false);
    expect(facade.isLoadingAvailable()).toBe(false);
    expect(facade.isLoadingAssigned()).toBe(false);
    facade.selection().select(coders[0]);
    expect(changed).not.toHaveBeenCalled();
  });
});
