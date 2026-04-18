import { CodebookDocxGenerator } from './codebook-docx-generator.class';

jest.mock('docx', () => ({
  ImportedXmlComponent: {
    fromXmlString: jest.fn().mockReturnValue({})
  }
}));

jest.mock('katex', () => ({
  renderToString: jest.fn().mockReturnValue('<math>mocked-mathml</math>')
}));

jest.mock('mathml2omml', () => ({
  mml2omml: jest.fn().mockReturnValue('<m:oMath><m:r><m:t xml:space="preserve">a<b & c</m:t></m:r></m:oMath>')
}));

describe('CodebookDocxGenerator', () => {
  describe('OMML sanitizing', () => {
    it('should sanitize invalid XML chars inside OMML text nodes', () => {
      const generator = CodebookDocxGenerator as unknown as {
        sanitizeOmmlXml: (omml: string) => string;
      };
      const rawOmml = '<m:oMath><m:r><m:t xml:space="preserve">a<b & c</m:t></m:r></m:oMath>';
      const sanitizedOmml = generator.sanitizeOmmlXml(rawOmml);

      expect(sanitizedOmml).toContain('a&lt;b &amp; c');
      expect(sanitizedOmml).not.toContain('a<b & c');
    });

    it('should sanitize OMML before creating ImportedXmlComponent', () => {
      const fromXmlString = (
        jest.requireMock('docx') as {
          ImportedXmlComponent: { fromXmlString: jest.Mock };
        }
      ).ImportedXmlComponent.fromXmlString;
      fromXmlString.mockClear();

      const generator = CodebookDocxGenerator as unknown as {
        latexToOmml: (latex: string) => unknown;
      };
      const result = generator.latexToOmml('a<b');

      expect(result).toEqual({});
      expect(fromXmlString).toHaveBeenCalledWith(
        '<m:oMath><m:r><m:t xml:space="preserve">a&lt;b &amp; c</m:t></m:r></m:oMath>'
      );
    });
  });
});
