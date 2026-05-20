import {
  getCurrentUserWorkspaceAccesses,
  getEffectiveCanCode,
  hasActiveCodingAccess,
  hasManagementWorkspaceAccess,
  hasMinimumWorkspaceAccess,
  hasOnlyPersonalCodingAccess
} from './workspace-access';

describe('workspace access utilities', () => {
  it('uses explicit canCode=false instead of falling back to access level 1', () => {
    expect(getEffectiveCanCode({ accessLevel: 1, canCode: false })).toBe(false);
  });

  it('keeps the legacy coder fallback only when canCode is missing', () => {
    expect(getEffectiveCanCode({ accessLevel: 1 })).toBe(true);
    expect(getEffectiveCanCode({ accessLevel: 2 })).toBe(false);
  });

  it('requires canCode for level-1 workspace access', () => {
    expect(hasMinimumWorkspaceAccess({ accessLevel: 1, canCode: false }, 1)).toBe(false);
    expect(hasMinimumWorkspaceAccess({ accessLevel: 1, canCode: true }, 1)).toBe(true);
    expect(hasMinimumWorkspaceAccess({ accessLevel: 2, canCode: false }, 1)).toBe(true);
  });

  it('detects active coding access only for workspace users with access', () => {
    expect(hasActiveCodingAccess({ accessLevel: 0, canCode: true })).toBe(false);
    expect(hasActiveCodingAccess({ accessLevel: 1, canCode: true })).toBe(true);
    expect(hasActiveCodingAccess({ accessLevel: 2, canCode: true })).toBe(true);
  });

  it('detects management workspace access independently from coding rights', () => {
    expect(hasManagementWorkspaceAccess({ accessLevel: 1, canCode: true })).toBe(false);
    expect(hasManagementWorkspaceAccess({ accessLevel: 2, canCode: false })).toBe(true);
    expect(hasManagementWorkspaceAccess({ accessLevel: 3, canCode: true })).toBe(true);
  });

  it('treats only users without management access as personal-coding-only users', () => {
    expect(hasOnlyPersonalCodingAccess([{ accessLevel: 1, canCode: true }])).toBe(true);
    expect(hasOnlyPersonalCodingAccess([{ accessLevel: 1 }])).toBe(true);
    expect(hasOnlyPersonalCodingAccess([{ accessLevel: 2, canCode: true }])).toBe(false);
    expect(hasOnlyPersonalCodingAccess([
      { accessLevel: 1, canCode: true },
      { accessLevel: 3, canCode: true }
    ])).toBe(false);
  });

  it('extracts the current users workspace access rows from id and legacy userId shapes', () => {
    expect(getCurrentUserWorkspaceAccesses([
      [
        { id: 1, accessLevel: 3, canCode: false },
        { id: 7, accessLevel: 1, canCode: true }
      ],
      [
        { userId: 7, accessLevel: 2, canCode: true }
      ]
    ], 7)).toEqual([
      { id: 7, accessLevel: 1, canCode: true },
      { userId: 7, accessLevel: 2, canCode: true }
    ]);
  });

  it.each([
    {
      label: 'no workspace access',
      accessLevel: 0,
      canCode: false,
      expectedCanCode: false,
      expectedLevel1: false,
      expectedLevel2: false,
      expectedLevel3: false
    },
    {
      label: 'inconsistent no-access row with canCode',
      accessLevel: 0,
      canCode: true,
      expectedCanCode: true,
      expectedLevel1: false,
      expectedLevel2: false,
      expectedLevel3: false
    },
    {
      label: 'coder',
      accessLevel: 1,
      canCode: true,
      expectedCanCode: true,
      expectedLevel1: true,
      expectedLevel2: false,
      expectedLevel3: false
    },
    {
      label: 'coder role with coding disabled',
      accessLevel: 1,
      canCode: false,
      expectedCanCode: false,
      expectedLevel1: false,
      expectedLevel2: false,
      expectedLevel3: false
    },
    {
      label: 'coding manager without coding',
      accessLevel: 2,
      canCode: false,
      expectedCanCode: false,
      expectedLevel1: true,
      expectedLevel2: true,
      expectedLevel3: false
    },
    {
      label: 'coding manager with coding',
      accessLevel: 2,
      canCode: true,
      expectedCanCode: true,
      expectedLevel1: true,
      expectedLevel2: true,
      expectedLevel3: false
    },
    {
      label: 'study manager without coding',
      accessLevel: 3,
      canCode: false,
      expectedCanCode: false,
      expectedLevel1: true,
      expectedLevel2: true,
      expectedLevel3: true
    },
    {
      label: 'study manager with coding',
      accessLevel: 3,
      canCode: true,
      expectedCanCode: true,
      expectedLevel1: true,
      expectedLevel2: true,
      expectedLevel3: true
    }
  ])('evaluates the role and coding matrix for $label', ({
    accessLevel,
    canCode,
    expectedCanCode,
    expectedLevel1,
    expectedLevel2,
    expectedLevel3
  }) => {
    const user = { accessLevel, canCode };

    expect(getEffectiveCanCode(user)).toBe(expectedCanCode);
    expect(hasMinimumWorkspaceAccess(user, 1)).toBe(expectedLevel1);
    expect(hasMinimumWorkspaceAccess(user, 2)).toBe(expectedLevel2);
    expect(hasMinimumWorkspaceAccess(user, 3)).toBe(expectedLevel3);
  });
});
