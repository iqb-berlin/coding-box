import { translateGerman } from '../../../testing/german-translations';
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

  describe('getFileTypeLabel', () => {
    it('should localize known base types', () => {
      expect(fileUtils.getFileTypeLabel(translateGerman, 'Resource')).toBe('Ressource');
      expect(fileUtils.getFileTypeLabel(translateGerman, 'Unit')).toBe('Aufgaben');
      expect(fileUtils.getFileTypeLabel(translateGerman, 'Booklet')).toBe('Testhefte');
      expect(fileUtils.getFileTypeLabel(translateGerman, 'TestTakers')).toBe('Testteilnehmer');
      expect(fileUtils.getFileTypeLabel(translateGerman, 'Testtakers')).toBe('Testteilnehmer');
      expect(fileUtils.getFileTypeLabel(translateGerman, 'Schemer')).toBe('Schemer');
      expect(fileUtils.getFileTypeLabel(translateGerman, 'SysCheck')).toBe('Systemcheck');
    });

    it('should localize resource subtypes by extension', () => {
      expect(fileUtils.getFileTypeLabel(translateGerman, 'Resource (.vocs)')).toBe('Ressource (.vocs)');
      expect(fileUtils.getFileTypeLabel(translateGerman, 'Resource(.voud)')).toBe('Ressource (.voud)');
      expect(fileUtils.getFileTypeLabel(translateGerman, 'resource ( .vomd )')).toBe('Ressource (.vomd)');
      expect(fileUtils.getFileTypeLabel(translateGerman, 'RESOURCE (.HTML)')).toBe('Ressource (.html)');
    });

    it('should return original value for unknown types', () => {
      expect(fileUtils.getFileTypeLabel(translateGerman, 'CustomType')).toBe('CustomType');
    });
  });
});
