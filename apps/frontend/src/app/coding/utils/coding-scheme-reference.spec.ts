import { readCodingSchemeReference, selectSchemerFile } from './coding-scheme-reference';

const files = [
  { id: 28, filename: 'iqb-schemer@2.8.1.html', created_at: '2026-07-23' },
  { id: 25, filename: 'iqb-schemer@2.5.0.html', created_at: '2026-05-08' },
  { id: 20, filename: 'iqb-schemer@2.5.2.html', created_at: '2026-05-01' },
  { id: 99, filename: 'other-schemer@2.5.9.html', created_at: '2026-08-01' }
];

describe('coding scheme references', () => {
  it('preserves the XML filename, Schemer and scheme type', () => {
    expect(readCodingSchemeReference('<Unit><CodingSchemeRef schemer="iqb-schemer@2.5" schemeType="iqb@3.0"> DLB004.vocs </CodingSchemeRef></Unit>'))
      .toEqual({ content: 'DLB004.vocs', schemer: 'iqb-schemer@2.5', schemeType: 'iqb@3.0' });
  });

  it.each(['<Unit/>', '<Unit><CodingSchemeRef/></Unit>', '<Unit><CodingSchemeRef>broken</Unit>'])('rejects missing or malformed references: %s', xml => {
    expect(readCodingSchemeReference(xml)).toBeNull();
  });

  it('resolves a minor version to the highest installed patch without switching minor versions or module', () => {
    expect(selectSchemerFile(files, 'iqb-schemer@2.5')?.id).toBe(20);
    expect(selectSchemerFile(files.filter(file => file.id !== 20), 'iqb-schemer@2.5')?.id).toBe(25);
  });

  it('honors an explicit patch even when another version was uploaded later', () => {
    expect(selectSchemerFile(files, 'iqb-schemer@2.5.0')?.id).toBe(25);
  });

  it('uses the canonical file ID when the uploaded HTML has been renamed', () => {
    expect(selectSchemerFile([{ id: 25, filename: 'renamed.html', file_id: 'IQB-SCHEMER-2.5.0' }], 'iqb-schemer@2.5')?.id).toBe(25);
  });

  it.each(['iqb-schemer@2.6', 'iqb-schemer@3', 'iqb-schemer@2.5.1', 'invalid'])('does not silently substitute an unavailable reference: %s', ref => {
    expect(selectSchemerFile(files, ref)).toBeUndefined();
  });

  it('excludes prereleases unless explicitly referenced', () => {
    const prerelease = [{ id: 1, filename: 'iqb-schemer@2.5.3-beta.html' }];
    expect(selectSchemerFile(prerelease, 'iqb-schemer@2.5')).toBeUndefined();
    expect(selectSchemerFile(prerelease, 'iqb-schemer@2.5.3-beta')?.id).toBe(1);
  });

  it('retains the newest-upload fallback for files without a Schemer reference', () => {
    expect(selectSchemerFile(files)?.id).toBe(99);
  });
});
