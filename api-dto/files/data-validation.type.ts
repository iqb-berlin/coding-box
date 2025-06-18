import { FileStatus } from './file-status.type';

export type DataValidation = {
  complete: boolean;
  missing: string[];
  files: FileStatus[];
};
