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
      itemCount: 2,
      mappingIssueCount: 0,
      mappingFallbackCount: 0,
      mappingIssuePreview: [],
      mappingFallbackPreview: []
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
      itemCount: 0,
      mappingIssueCount: 1,
      mappingFallbackCount: 0,
      mappingIssuePreview: [
        'UNIT_A/ITEM_MISSING: Variable UNKNOWN nicht gefunden'
      ],
      mappingFallbackPreview: []
    });
  });

  it('requires explicit VOMD item IDs only for strict item mappings', async () => {
    const resolver = createResolver(
      {
        items: [
          {
            variableId: 'V1'
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

    const defaultMapping = await resolver.buildItemMapping(7);
    const strictMapping = await resolver.buildItemMapping(7, {
      requireItemIds: true
    });

    expect(defaultMapping.items).toEqual([
      expect.objectContaining({
        itemId: 'V1',
        variableId: 'V1'
      })
    ]);
    expect(defaultMapping.issues).toEqual([]);
    expect(strictMapping.items).toHaveLength(0);
    expect(strictMapping.issues).toEqual([
      'UNIT_A/V1: VOMD-Item ohne ID'
    ]);
  });

  it('does not map or report issues for explicitly excluded units', async () => {
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

    const mapping = await resolver.buildItemMapping(7, {
      excludedUnitNames: ['unit_a.xml']
    });

    expect(mapping.items).toEqual([]);
    expect(mapping.issues).toEqual([]);
    expect(mapping.fallbacks).toEqual([]);
  });

  it('does not parse malformed VOMD files of explicitly excluded units', async () => {
    const resolver = new PsychometricMetadataResolver(
      {
        find: jest.fn().mockResolvedValue([
          {
            id: 1,
            file_id: 'UNIT_A.VOMD',
            filename: 'UNIT_A.vomd',
            data: '{invalid'
          }
        ])
      } as never,
      {
        getUnitVariableDetails: jest.fn().mockResolvedValue([
          {
            unitName: 'UNIT_A',
            unitId: 'UNIT_A',
            variables: []
          }
        ])
      } as never,
      {} as never
    );

    await expect(
      resolver.buildItemMapping(7, { excludedUnitNames: ['UNIT_A'] })
    ).resolves.toEqual({
      items: [],
      byLogicalKey: new Map(),
      issues: [],
      fallbacks: []
    });
  });

  it('uses an unambiguous item id when variableId is missing', async () => {
    const resolver = createResolver(
      {
        items: [
          {
            id: 'V1',
            variableId: null
          }
        ]
      },
      [
        {
          id: 'source-v1',
          alias: 'V1',
          type: 'string',
          hasCodingScheme: true
        }
      ]
    );

    const mapping = await resolver.buildItemMapping(7);

    expect(mapping.items).toHaveLength(1);
    expect(mapping.items[0]).toEqual(
      expect.objectContaining({
        itemId: 'V1',
        variableId: 'V1',
        sourceVariableId: 'source-v1'
      })
    );
    expect(mapping.issues).toEqual([]);
    expect(mapping.fallbacks).toEqual([
      'UNIT_A/V1: variableId fehlt; ' +
        'Item-ID V1 als eindeutiger Fallback erkannt und verwendet'
    ]);
    await expect(resolver.getDomainCandidates(7)).resolves.toEqual({
      candidates: [],
      itemCount: 1,
      mappingIssueCount: 0,
      mappingFallbackCount: 1,
      mappingIssuePreview: [],
      mappingFallbackPreview: [
        'UNIT_A/V1: variableId fehlt; ' +
          'Item-ID V1 als eindeutiger Fallback erkannt und verwendet'
      ]
    });
  });

  it('uses an unambiguous item id when variableId is stale', async () => {
    const resolver = createResolver(
      {
        items: [
          {
            id: 'V1',
            variableId: 'OLD'
          }
        ]
      },
      [
        {
          id: 'source-v1',
          alias: 'V1',
          type: 'string',
          hasCodingScheme: true
        }
      ]
    );

    const mapping = await resolver.buildItemMapping(7);

    expect(mapping.items).toHaveLength(1);
    expect(mapping.issues).toEqual([]);
    expect(mapping.fallbacks).toEqual([
      'UNIT_A/V1: Variable OLD nicht gefunden; ' +
        'Item-ID V1 als eindeutiger Fallback erkannt und verwendet'
    ]);
  });

  it('prefers a direct mapping over a redundant legacy fallback', async () => {
    const resolver = createResolver(
      {
        items: [
          {
            id: 'V1',
            variableId: null
          },
          {
            id: 'CURRENT_ITEM',
            variableId: 'V1'
          }
        ]
      },
      [
        {
          id: 'source-v1',
          alias: 'V1',
          type: 'string',
          hasCodingScheme: true
        }
      ]
    );

    const mapping = await resolver.buildItemMapping(7);

    expect(mapping.items).toHaveLength(1);
    expect(mapping.items[0].itemId).toBe('CURRENT_ITEM');
    expect(mapping.issues).toEqual([]);
    expect(mapping.fallbacks).toEqual([
      'UNIT_A/V1: variableId fehlt; ' +
        'Item-ID V1 als eindeutiger Fallback erkannt, aber wegen bereits ' +
        'direkter Zuordnung ignoriert'
    ]);
  });

  it('still rejects duplicate fallback mappings without a direct mapping', async () => {
    const resolver = createResolver(
      {
        items: [
          {
            id: 'V1',
            variableId: null
          },
          {
            id: 'V1',
            variableId: null
          }
        ]
      },
      [
        {
          id: 'source-v1',
          alias: 'V1',
          type: 'string',
          hasCodingScheme: true
        }
      ]
    );

    const mapping = await resolver.buildItemMapping(7);

    expect(mapping.items).toHaveLength(1);
    expect(mapping.issues).toEqual([
      'UNIT_A/V1: mehrere VOMD-Items'
    ]);
    expect(mapping.fallbacks).toEqual([
      'UNIT_A/V1: variableId fehlt; ' +
        'Item-ID V1 als eindeutiger Fallback erkannt und verwendet'
    ]);
  });

  it('rejects an ambiguous item id fallback', async () => {
    const resolver = createResolver(
      {
        items: [
          {
            id: 'COMMON',
            variableId: null
          }
        ]
      },
      [
        {
          id: 'V1',
          alias: 'COMMON',
          type: 'string',
          hasCodingScheme: true
        },
        {
          id: 'V2',
          alias: 'COMMON',
          type: 'string',
          hasCodingScheme: true
        }
      ]
    );

    const mapping = await resolver.buildItemMapping(7);

    expect(mapping.items).toEqual([]);
    expect(mapping.fallbacks).toEqual([]);
    expect(mapping.issues).toEqual([
      'UNIT_A/COMMON: Item-ID COMMON ist als Variablenfallback mehrdeutig'
    ]);
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
