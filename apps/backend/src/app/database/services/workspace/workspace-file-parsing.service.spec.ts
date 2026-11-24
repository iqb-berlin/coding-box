import * as cheerio from 'cheerio';
import { WorkspaceFileParsingService } from './workspace-file-parsing.service';

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
      const html = `<script type="application/ld+json">${JSON.stringify({
        [idField]: 'verona-player', version: '2.4.1'
      })}</script>`;

      expect(service.identifyHtmlFile('fallback.html', html)).toMatchObject({
        fileId: 'VERONA-PLAYER-2.4.1', fileType: 'Resource', usesFilename: false
      });
    }
  );

  it.each([
    '',
    'invalid json',
    'null',
    '[]',
    '{"id":"player"}',
    '{"@type":"schemer","version":"1.0"}',
    '{"@type":"schemer","@id":"schemer"}',
    '{"@type":"schemer","@id":"schemer","version":"invalid"}'
  ])('uses the decoded resource filename for unusable metadata %j', json => {
    const html = json && `<script type="application/ld+json">${json}</script>`;
    expect(service.identifyHtmlFile('folder/player%20upload.html', html)).toMatchObject({
      fileId: 'PLAYER UPLOAD.HTML', fileType: 'Resource', usesFilename: true
    });
  });

  it('extracts a schemer ID from its metadata', () => {
    const html = '<script type="application/ld+json">{"@type":"schemer","@id":"verona-schemer","version":"1.2.3-beta.1+build"}</script>';
    expect(service.identifyHtmlFile('fallback.html', html)).toMatchObject({
      fileId: 'VERONA-SCHEMER-1.2.3', fileType: 'Schemer', metadata: { version: '1.2.3-beta.1+build' }, usesFilename: false
    });
  });

  it.each(['before', 'after'])('recognizes a schemer with unrelated JSON-LD %s the module', order => {
    const metadata = { '@type': 'schemer', '@id': 'module', version: '1.2.3' };
    const schemer = `<script type="application/ld+json">${JSON.stringify(metadata)}</script>`;
    const other = '<script type="application/ld+json">{"@type":"WebPage","@id":"page","version":"2.0"}</script>';
    const html = order === 'before' ? other + schemer : schemer + other;
    expect(service.identifyHtmlFile('module.html', html)).toEqual({
      fileId: 'MODULE-1.2.3', fileType: 'Schemer', metadata, usesFilename: false
    });
  });

  it('preserves the versioned resource key for a single legacy module block', () => {
    const html = '<script type="application/ld+json">{"type":"editor","id":"old-editor","version":"2.4"}</script>';
    expect(service.identifyHtmlFile('editor.html', html)).toMatchObject({
      fileId: 'OLD-EDITOR-2.4.0', fileType: 'Resource', usesFilename: false
    });
  });

  it('prefers an explicitly typed player over an earlier untyped candidate', () => {
    const html = `
      <script type="application/ld+json">{"id":"page","version":"1"}</script>
      <script type="application/ld+json">{"type":"PLAYER","id":"iqb-player-aspect","version":"3.1.2"}</script>`;
    expect(service.identifyHtmlFile('module.html', html)).toMatchObject({
      fileId: 'IQB-PLAYER-ASPECT-3.1.2', fileType: 'Resource', usesFilename: false
    });
  });

  it('reads legacy player metadata alongside malformed and unrelated JSON-LD', () => {
    const html = `
      <script type="application/ld+json">{broken</script>
      <script type="application/ld+json">{"@type":"WebPage","@id":"page","version":"2.0"}</script>
      <script type="application/ld+json">{"id":"old-player","version":"1.0"}</script>`;
    expect(service.identifyHtmlFile('module.html', html)).toMatchObject({
      fileId: 'OLD-PLAYER-1.0.0', fileType: 'Resource', usesFilename: false
    });
  });

  it('decodes resource paths and rejects uploads without a filename', () => {
    expect(service.getResourceId('folder%2Fnested%2Funit%20a.xml')).toBe('UNIT A.XML');
    expect(() => service.getResourceId('')).toThrow('originalname is required');
    expect(() => service.getResourceId('folder/')).toThrow('Could not determine the file name');
    expect(() => service.getResourceId('unit%ZZ.xml')).toThrow(URIError);
  });
});
