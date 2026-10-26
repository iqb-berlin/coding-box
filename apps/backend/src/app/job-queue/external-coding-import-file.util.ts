import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const directoryPrefix = 'external-coding-import-';
const importFileName = 'import';

export function createExternalCodingImportFile(content: Buffer): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), directoryPrefix));
  const filePath = path.join(directory, importFileName);
  try {
    fs.writeFileSync(filePath, content, { flag: 'wx', mode: 0o600 });
    return filePath;
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function removeExternalCodingImportFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  // Old queued jobs used a shared directory: never remove their parent.
  const directory = path.dirname(filePath);
  if (path.basename(filePath) === importFileName &&
      path.basename(directory).startsWith(directoryPrefix) &&
      path.resolve(path.dirname(directory)) === path.resolve(os.tmpdir())) {
    try {
      fs.rmdirSync(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
