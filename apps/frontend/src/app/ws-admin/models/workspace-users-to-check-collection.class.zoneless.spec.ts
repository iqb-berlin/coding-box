import { computed } from '@angular/core';
import { WorkspaceUserToCheckCollection } from './workspace-users-to-check-collection.class';

describe('Workspace users reactive entries and baselines', () => {
  it('updates derived checks when persisted removal changes the baseline', () => {
    const collection = new WorkspaceUserToCheckCollection([
      {
        id: 1, name: 'user1', isAdmin: false, accessLevel: 1, canCode: true
      }
    ]);
    const checks = computed(() => collection.getChecks());
    expect(checks()).toEqual([{ id: 1, accessLevel: 1, canCode: true }]);

    collection.updateEntry(1, user => ({
      ...user, isChecked: false, accessLevel: 0, canCode: false
    }));
    expect(checks()).toEqual([{ id: 1, accessLevel: 0, canCode: false }]);
    expect(collection.hasChanged).toBe(true);

    collection.setHasChangedFalse();
    expect(checks()).toEqual([]);
    expect(collection.hasChanged).toBe(false);

    collection.updateEntry(1, user => ({
      ...user, isChecked: true, accessLevel: 3, canCode: false
    }));
    expect(checks()).toEqual([{ id: 1, accessLevel: 3, canCode: false }]);
    expect(collection.hasChanged).toBe(true);
  });

  it('replaces checks without changing previous entry snapshots', () => {
    const collection = new WorkspaceUserToCheckCollection([
      {
        id: 1, name: 'user1', isAdmin: false, accessLevel: 1, canCode: true
      },
      {
        id: 2, name: 'user2', isAdmin: false, accessLevel: 0, canCode: false
      }
    ]);
    const originalEntries = collection.entries;
    const checks = computed(() => collection.getChecks());
    expect(checks()).toEqual([{ id: 1, accessLevel: 1, canCode: true }]);

    collection.setChecks([
      {
        id: 2, name: 'user2', username: 'user2', isAdmin: false, accessLevel: 2, canCode: false
      }
    ]);
    expect(checks()).toEqual([{ id: 2, accessLevel: 2, canCode: false }]);
    expect(collection.entries[0]).toMatchObject({ isChecked: false, accessLevel: 0, canCode: false });
    expect(collection.entries[1]).toMatchObject({ isChecked: true, accessLevel: 2, canCode: false });
    expect(collection.hasChanged).toBe(false);
    expect(originalEntries[0]).toMatchObject({ isChecked: true, accessLevel: 1, canCode: true });
    expect(originalEntries[1]).toMatchObject({ isChecked: false, accessLevel: 0, canCode: false });

    collection.setChecks();
    expect(checks()).toEqual([]);
    expect(collection.hasChanged).toBe(false);
  });
});
