import { FileSizePipe } from './filesize.pipe';

describe('FileSizePipe', () => {
  let pipe: FileSizePipe;

  beforeEach(() => {
    pipe = new FileSizePipe();
  });

  it('create an instance', () => {
    expect(pipe).toBeTruthy();
  });

  it('should return "0 Bytes" for 0', () => {
    expect(pipe.transform(0)).toBe('0 Bytes');
  });

  it('should return "0 Bytes" for NaN', () => {
    expect(pipe.transform(NaN)).toBe('0 Bytes');
  });

  it('should return bytes for values less than 1024', () => {
    expect(pipe.transform(500)).toBe('500 Bytes');
  });

  it('should return KB for 1024', () => {
    expect(pipe.transform(1024)).toBe('1 KB');
  });

  it('should return MB for 1024 * 1024', () => {
    expect(pipe.transform(1024 * 1024)).toBe('1 MB');
  });

  it('should return GB for 1024 * 1024 * 1024', () => {
    expect(pipe.transform(1024 * 1024 * 1024)).toBe('1 GB');
  });

  it('should return correct decimal format', () => {
    // 1500 bytes is approx 1.46 KB
    expect(pipe.transform(1500)).toBe('1.46 KB');
  });
});
