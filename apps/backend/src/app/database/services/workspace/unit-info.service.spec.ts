import { Repository } from 'typeorm';
import FileUpload from '../../entities/file_upload.entity';
import { UnitInfoService } from './unit-info.service';

describe('Unit XML boundaries', () => {
  const findOne = jest.fn();
  const service = new UnitInfoService({ findOne } as unknown as Repository<FileUpload>);

  it('keeps optional definition attributes and variable values', async () => {
    findOne.mockResolvedValue({
      data: `
      <Unit>
        <Metadata><Id>U1</Id><Label>Example</Label></Metadata>
        <Definition player="player">content</Definition>
        <BaseVariables><Variable id="V1" type="string">
          <Values><Value><label>Yes</label><value>1</value></Value></Values>
        </Variable></BaseVariables>
      </Unit>`
    });
    await expect(service.getUnitInfo(7, 'U1')).resolves.toMatchObject({
      metadata: { id: 'U1', label: 'Example' },
      definition: { player: 'player', content: 'content' },
      baseVariables: [{ id: 'V1', values: [{ label: 'Yes', value: '1' }] }]
    });
  });

  it.each([
    ['<Unit><Metadata><Id>U1</Id></Metadata><Definition player="p"/></Unit>', 'Missing required Label'],
    ['<Unit><Metadata><Id>U1</Id><Label>L</Label></Metadata></Unit>', 'Missing Definition or DefinitionRef'],
    ['<Unit><Metadata><Id>U1</Id><Label>L</Label></Metadata><Definition/></Unit>', 'Missing required player']
  ])('rejects incomplete XML before using unchecked properties', async (data, message) => {
    findOne.mockResolvedValue({ data });
    await expect(service.getUnitInfo(7, 'U1')).rejects.toThrow(message);
  });
});
