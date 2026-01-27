import * as fileUtils from './file-utils';

describe('file-utils', () => {
  describe('getFileIcon', () => {
    it('should return "code" for XML files', () => {
      expect(fileUtils.getFileIcon('test.xml')).toBe('code');
      expect(fileUtils.getFileIcon('TEST.XML')).toBe('code');
    });

    it('should return "folder_zip" for ZIP files', () => {
      expect(fileUtils.getFileIcon('test.zip')).toBe('folder_zip');
    });

    it('should return "html" for HTML files', () => {
      expect(fileUtils.getFileIcon('test.html')).toBe('html');
    });

    it('should return "table_chart" for CSV files', () => {
      expect(fileUtils.getFileIcon('test.csv')).toBe('table_chart');
    });

    it('should return "description" for voud and vocs files', () => {
      expect(fileUtils.getFileIcon('test.voud')).toBe('description');
      expect(fileUtils.getFileIcon('test.vocs')).toBe('description');
    });

    it('should return "insert_drive_file" for unknown files', () => {
      expect(fileUtils.getFileIcon('test.txt')).toBe('insert_drive_file');
    });
  });

  describe('extractUnitName', () => {
    it('should extract unit name from "Unit unitName" format', () => {
      expect(fileUtils.extractUnitName('Unit Unit 10')).toBe('Unit 10');
      expect(fileUtils.extractUnitName('Unit TaskName')).toBe('TaskName');
    });

    it('should return original name if it does not start with "Unit "', () => {
      expect(fileUtils.extractUnitName('Task 10')).toBe('Task 10');
      expect(fileUtils.extractUnitName('Unit10')).toBe('Unit10');
    });
  });
});
