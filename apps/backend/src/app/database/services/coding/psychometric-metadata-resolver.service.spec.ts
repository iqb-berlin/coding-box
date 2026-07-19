import { PsychometricMetadataResolver } from './psychometric-metadata-resolver.service';

describe('PsychometricMetadataResolver', () => {
  const createResolver = (
    vomd: Record<string, unknown>,
    variables: Array<Record<string, unknown>>
  ) => new PsychometricMetadataResolver(
    {
      find: jest.fn().mockResolvedValue([
        {
          id: 1,
          file_id: 'UNIT_A.VOMD',
          filename: 'UNIT_A.vomd',
          data: JSON.stringify(vomd)
        }
      ])
    } as never,
    {
      getUnitVariableDetails: jest.fn().mockResolvedValue([
        {
          unitName: 'UNIT_A',
          unitId: 'UNIT_A',
          variables
        }
      ])
    } as never,
    {} as never
  );

  it('discovers complete, single-valued item domain fields from VOMD', async () => {
    const resolver = createResolver(
      {
        items: [
          {
            id: 'I1',
            variableId: 'V1',
            profiles: [
              {
                profileId: 'profile',
                entries: [
                  {
                    id: 'domain',
                    label: [{ lang: 'de', value: 'Kompetenzbereich' }],
                    value: [{ id: 'D1' }]
                  }
                ]
              }
            ]
          },
          {
            id: 'I2',
            variableId: 'V2',
            profiles: [
              {
                profileId: 'profile',
                entries: [
                  {
                    id: 'domain',
                    label: [{ lang: 'de', value: 'Kompetenzbereich' }],
                    value: [{ id: 'D2' }]
                  }
                ]
              }
            ]
          }
        ]
      },
      [
        {
          id: 'V1',
          alias: 'V1',
          type: 'string',
          hasCodingScheme: true
        },
        {
          id: 'V2',
          alias: 'V2',
          type: 'string',
          hasCodingScheme: true
        }
      ]
    );

    await expect(resolver.getDomainCandidates(7)).resolves.toEqual({
      candidates: [
        expect.objectContaining({
          scope: 'ITEM',
          profileId: 'profile',
          entryId: 'domain',
          label: 'Kompetenzbereich',
          coverage: 2,
          itemCount: 2,
          singleValued: true,
          selectable: true
        })
      ],
      mappingIssueCount: 0
    });
  });

  it('marks incomplete or multi-valued fields as unavailable', async () => {
    const resolver = createResolver(
      {
        items: [
          {
            id: 'I1',
            variableId: 'V1',
            profiles: [
              {
                profileId: 'profile',
                entries: [
                  {
                    id: 'domain',
                    value: [{ id: 'D1' }, { id: 'D2' }]
                  }
                ]
              }
            ]
          },
          {
            id: 'I2',
            variableId: 'V2',
            profiles: []
          }
        ]
      },
      [
        {
          id: 'V1',
          alias: 'V1',
          type: 'string',
          hasCodingScheme: true
        },
        {
          id: 'V2',
          alias: 'V2',
          type: 'string',
          hasCodingScheme: true
        }
      ]
    );

    const { candidates, mappingIssueCount } =
      await resolver.getDomainCandidates(7);

    expect(candidates[0]).toEqual(
      expect.objectContaining({
        coverage: 1,
        itemCount: 2,
        singleValued: false,
        selectable: false
      })
    );
    expect(mappingIssueCount).toBe(0);
  });

  it('ignores obsolete VOMD profile values', async () => {
    const resolver = createResolver(
      {
        items: [
          {
            id: 'I1',
            variableId: 'V1',
            profiles: [
              {
                profileId: 'profile',
                isCurrent: false,
                entries: [{ id: 'old-domain', value: [{ id: 'OLD' }] }]
              },
              {
                profileId: 'profile',
                isCurrent: true,
                entries: [{ id: 'domain', value: [{ id: 'D1' }] }]
              }
            ]
          }
        ]
      },
      [
        {
          id: 'V1',
          alias: 'V1',
          type: 'string',
          hasCodingScheme: true
        }
      ]
    );

    const { candidates } = await resolver.getDomainCandidates(7);

    expect(candidates).toEqual([
      expect.objectContaining({ entryId: 'domain', selectable: true })
    ]);
  });

  it('reports VOMD items whose variableId cannot be resolved', async () => {
    const resolver = createResolver(
      {
        items: [
          {
            id: 'ITEM_MISSING',
            variableId: 'UNKNOWN'
          }
        ]
      },
      [
        {
          id: 'V1',
          alias: 'V1',
          type: 'string',
          hasCodingScheme: true
        }
      ]
    );

    const mapping = await resolver.buildItemMapping(7);

    expect(mapping.items).toHaveLength(0);
    expect(mapping.issues).toContain(
      'UNIT_A/ITEM_MISSING: Variable UNKNOWN nicht gefunden'
    );
    await expect(resolver.getDomainCandidates(7)).resolves.toEqual({
      candidates: [],
      mappingIssueCount: 1
    });
  });

  it('assigns the selected VOMD item field to every mapped item', async () => {
    const resolver = createResolver(
      {
        items: [
          {
            id: 'I1',
            variableId: 'V1',
            profiles: [
              {
                profileId: 'profile',
                entries: [
                  {
                    id: 'domain',
                    value: [{ id: 'D1', label: [{ value: 'Domäne 1' }] }]
                  }
                ]
              }
            ]
          },
          {
            id: 'I2',
            variableId: 'V2',
            profiles: [
              {
                profileId: 'profile',
                entries: [
                  {
                    id: 'domain',
                    value: [{ id: 'D2', label: [{ value: 'Domäne 2' }] }]
                  }
                ]
              }
            ]
          }
        ]
      },
      [
        {
          id: 'V1',
          alias: 'V1',
          type: 'string',
          hasCodingScheme: true
        },
        {
          id: 'V2',
          alias: 'V2',
          type: 'string',
          hasCodingScheme: true
        }
      ]
    );
    const mapping = await resolver.buildItemMapping(7);

    resolver.assignDomains(mapping, {
      mode: 'vomd-field',
      scope: 'ITEM',
      profileId: 'profile',
      entryId: 'domain'
    });

    expect(mapping.items.map(item => item.domain)).toEqual([
      { id: 'D1', label: 'Domäne 1' },
      { id: 'D2', label: 'Domäne 2' }
    ]);
  });
});
