import {
  prepareEmbeddedReplayAssets,
  releaseEmbeddedReplayAssets
} from './embedded-replay-assets';

describe('embedded replay assets', () => {
  const pngDataUrl = 'data:image/png;base64,aGVsbG8=';

  it('replaces repeated Base64 assets with one shared object URL', () => {
    const createObjectURL = jest.fn().mockReturnValue('blob:shared-image');
    const revokeObjectURL = jest.fn();
    const input = JSON.stringify({
      image: pngDataUrl,
      nested: [{ sameImage: pngDataUrl }],
      ordinaryValue: 'data:image/png,not-base64'
    });

    const prepared = prepareEmbeddedReplayAssets(input, { createObjectURL, revokeObjectURL });
    const definition = prepared.definition as {
      image: string;
      nested: { sameImage: string }[];
      ordinaryValue: string;
    };

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(definition.image).toBe('blob:shared-image');
    expect(definition.nested[0].sameImage).toBe('blob:shared-image');
    expect(definition.ordinaryValue).toBe('data:image/png,not-base64');
    expect(prepared.assetCount).toBe(1);
    expect(prepared.assetReferenceCount).toBe(2);
    expect(prepared.preparedSize).toBeLessThan(prepared.originalSize);

    releaseEmbeddedReplayAssets(prepared, { createObjectURL, revokeObjectURL });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:shared-image');
  });

  it('replaces PNG and JPEG image sources in rich text without changing the surrounding markup', () => {
    const createObjectURL = jest.fn().mockReturnValueOnce('blob:inline-png').mockReturnValueOnce('blob:inline-jpeg');
    const revokeObjectURL = jest.fn();
    const richText = '<p class="prompt">Before <img alt="diagram" src="data:image/png;base64,aGVsbG8=">' +
      ' middle <img src=\'data:image/jpeg;base64,d29ybGQ=\' width="40"> after</p>';

    const prepared = prepareEmbeddedReplayAssets(
      JSON.stringify({ text: richText }),
      { createObjectURL, revokeObjectURL }
    );
    const definition = prepared.definition as { text: string };

    expect(definition.text).toBe(
      '<p class="prompt">Before <img alt="diagram" src="blob:inline-png">' +
      ' middle <img src=\'blob:inline-jpeg\' width="40"> after</p>'
    );
    expect(prepared.assetCount).toBe(2);
    expect(prepared.assetReferenceCount).toBe(2);
  });

  it('does not rewrite executable or non-image data URLs embedded in rich text', () => {
    const createObjectURL = jest.fn();
    const revokeObjectURL = jest.fn();
    const richText = '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">' +
      '<iframe src="data:text/html;base64,PGgxPkhlbGxvPC9oMT4="></iframe>';

    const prepared = prepareEmbeddedReplayAssets(
      JSON.stringify({ text: richText }),
      { createObjectURL, revokeObjectURL }
    );

    expect((prepared.definition as { text: string }).text).toBe(richText);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('keeps only the failed asset unchanged when object URL creation fails', () => {
    const createObjectURL = jest.fn()
      .mockReturnValueOnce('blob:first')
      .mockImplementationOnce(() => {
        throw new Error('object URL unavailable');
      });
    const revokeObjectURL = jest.fn();
    const input = JSON.stringify({
      first: pngDataUrl,
      second: 'data:image/png;base64,d29ybGQ='
    });

    const prepared = prepareEmbeddedReplayAssets(input, { createObjectURL, revokeObjectURL });
    const definition = prepared.definition as { first: string; second: string };

    expect(definition.first).toBe('blob:first');
    expect(definition.second).toBe('data:image/png;base64,d29ybGQ=');
    expect(prepared.assetCount).toBe(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('keeps malformed and unsupported standalone assets unchanged', () => {
    const createObjectURL = jest.fn();
    const revokeObjectURL = jest.fn();
    const input = JSON.stringify({
      malformed: 'data:image/png;base64,***',
      executable: 'data:text/html;base64,PGgxPkhlbGxvPC9oMT4=',
      vector: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='
    });

    const prepared = prepareEmbeddedReplayAssets(input, { createObjectURL, revokeObjectURL });

    expect(prepared.definition).toEqual(JSON.parse(input));
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
