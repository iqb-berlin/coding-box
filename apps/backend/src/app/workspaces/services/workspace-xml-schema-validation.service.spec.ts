import { WorkspaceXmlSchemaValidationService } from './workspace-xml-schema-validation.service';

function getNormalizedUrl(
  service: WorkspaceXmlSchemaValidationService,
  url: string
): string {
  return (
    service as unknown as { normalizeXsdUrl: (x: string) => string }
  ).normalizeXsdUrl(url);
}

describe('WorkspaceXmlSchemaValidationService.normalizeXsdUrl', () => {
  it('should rewrite github blob URL to raw URL', () => {
    type CtorParams = ConstructorParameters<
      typeof WorkspaceXmlSchemaValidationService
    >;
    const service = new WorkspaceXmlSchemaValidationService(
      {} as unknown as CtorParams[0]
    );

    const input =
      'https://github.com/iqb-berlin/testcenter/blob/master/definitions/vo_Booklet.xsd';
    const out = getNormalizedUrl(service, input);

    expect(out).toBe(
      'https://raw.githubusercontent.com/iqb-berlin/testcenter/master/definitions/vo_Booklet.xsd'
    );
  });

  it('should keep non-github URLs unchanged', () => {
    type CtorParams = ConstructorParameters<
      typeof WorkspaceXmlSchemaValidationService
    >;
    const service = new WorkspaceXmlSchemaValidationService(
      {} as unknown as CtorParams[0]
    );

    const input = 'https://example.com/schemas/foo.xsd';
    const out = getNormalizedUrl(service, input);

    expect(out).toBe(input);
  });
});
