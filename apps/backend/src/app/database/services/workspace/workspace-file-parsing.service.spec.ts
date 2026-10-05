import * as cheerio from 'cheerio';
import { FileIo } from '../../../admin/workspace/file-io.interface';
import { WorkspaceFileParsingService } from './workspace-file-parsing.service';

const file = (originalname: string, content = ''): FileIo => ({
  originalname,
  buffer: Buffer.from(content),
  fieldname: 'files',
  encoding: 'utf-8',
  mimetype: 'text/html',
  size: Buffer.byteLength(content)
});

describe('WorkspaceFileParsingService', () => {
  let service: WorkspaceFileParsingService;

  beforeEach(() => {
    service = new WorkspaceFileParsingService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('extracts unit metadata, variable flags and normalized coding scheme references', async () => {
    const document = cheerio.load(`
      <Unit>
        <Metadata><Id> UNIT-A </Id><Label> Unit A </Label><Description> Description </Description></Metadata>
        <BaseVariables>
          <Variable id="V1" alias="attribute-alias" type="string" format="text"
            multiple="true" nullable="false" values="A|B" valuesComplete="true" page="2"> text-alias </Variable>
          <Variable id="V2" alias="second" type="integer" format="number" />
        </BaseVariables>
        <CodingSchemeRef> scheme-a.vocs </CodingSchemeRef>
        <CodingSchemeRef> SCHEME-A.XML </CodingSchemeRef>
        <codingSchemeRef> scheme-b.xml </codingSchemeRef>
        <Definition id="main" type="verona-player" />
      </Unit>
    `, { xmlMode: true });

    await expect(service.extractUnitInfo(document)).resolves.toEqual({
      metadata: { id: 'UNIT-A', label: 'Unit A', description: 'Description' },
      variables: [
        {
          id: 'V1',
          alias: 'text-alias',
          type: 'string',
          format: 'text',
          multiple: true,
          nullable: false,
          values: ['A', 'B'],
          valuesComplete: true,
          page: '2'
        },
        {
          id: 'V2',
          alias: 'second',
          type: 'integer',
          format: 'number',
          multiple: false,
          nullable: true
        }
      ],
      codingSchemeRef: 'SCHEME-A.VOCS',
      codingSchemeRefNormalized: 'SCHEME-A',
      codingSchemeRefs: ['SCHEME-A', 'SCHEME-B'],
      definitions: [{ id: 'main', type: 'verona-player' }]
    });
  });

  it('extracts booklet metadata and ordered units including units in nested testlets', async () => {
    const document = cheerio.load(`
      <Booklet>
        <Metadata><Id> BOOKLET-A </Id><Label> Booklet A </Label><Description> Desc </Description></Metadata>
        <Units>
          <Unit id="U1" label="First" labelshort="One" />
          <Testlet id="T1"><Unit id="U2" label="Second" labelshort="Two" /></Testlet>
        </Units>
      </Booklet>
    `, { xmlMode: true });

    await expect(service.extractBookletInfo(document)).resolves.toEqual({
      metadata: { id: 'BOOKLET-A', label: 'Booklet A', description: 'Desc' },
      units: [
        { id: 'U1', label: 'First', labelShort: 'One' },
        { id: 'U2', label: 'Second', labelShort: 'Two' }
      ]
    });
  });

  it('keeps testtaker booklet assignments and group membership separate', async () => {
    const document = cheerio.load(`
      <Testtakers>
        <Testtaker id="P1" login="login-a" code="code-a"><Booklet> B1 </Booklet><Booklet>B2</Booklet></Testtaker>
        <Testtaker id="P2" login="login-b" code="code-b"><Booklet>B3</Booklet></Testtaker>
        <Group id="G1" label="Group A"><Member> P1 </Member><Member>P2</Member></Group>
      </Testtakers>
    `, { xmlMode: true });

    await expect(service.extractTestTakersInfo(document)).resolves.toEqual({
      testTakers: [
        {
          id: 'P1', login: 'login-a', code: 'code-a', booklets: ['B1', 'B2']
        },
        {
          id: 'P2', login: 'login-b', code: 'code-b', booklets: ['B3']
        }
      ],
      groups: [{ id: 'G1', label: 'Group A', members: ['P1', 'P2'] }]
    });
  });

  it.each(['extractUnitInfo', 'extractBookletInfo', 'extractTestTakersInfo'] as const)(
    '%s reports extraction failures and returns an empty result',
    async method => {
      const errorSpy = jest.spyOn(
        (service as unknown as { logger: { error: (message: string) => void } }).logger,
        'error'
      ).mockImplementation(() => undefined);
      const brokenDocument = (() => {
        throw new Error('document unavailable');
      }) as unknown as cheerio.CheerioAPI;

      await expect(service[method](brokenDocument)).resolves.toEqual({});
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('document unavailable'));
    }
  );

  it.each(['id', '@id'])(
    'uses player metadata %s and version rather than the upload filename',
    idField => {
      const player = file('fallback.html', `<script type="application/ld+json">${JSON.stringify({
        [idField]: 'verona-player', version: '2.4.1'
      })}</script>`);

      expect(service.getPlayerId(player)).toBe('VERONA-PLAYER-2.4.1');
    }
  );

  it.each([
    '<script type="application/ld+json">invalid json</script>',
    '<script type="application/ld+json">{"id":"player"}</script>'
  ])('falls back to the resource filename when player metadata is unusable', content => {
    expect(service.getPlayerId(file('folder/player%20upload.html', content)))
      .toBe('PLAYER UPLOAD.HTML');
  });

  it('extracts a schemer ID from its metadata', () => {
    expect(service.getSchemerId(file('fallback.html',
      '<script type="application/ld+json">{"@id":"verona-schemer","version":"1.2.3"}</script>'
    ))).toBe('VERONA-SCHEMER-1.2.3');
  });

  it('decodes resource paths and rejects uploads without a filename', () => {
    expect(service.getResourceId(file('folder%2Fnested%2Funit%20a.xml'))).toBe('UNIT A.XML');
    expect(() => service.getResourceId(file(''))).toThrow('originalname is required');
    expect(() => service.getResourceId(file('folder/'))).toThrow('Could not determine the file name');
    expect(() => service.getResourceId(file('unit%ZZ.xml'))).toThrow(URIError);
  });
});
