export interface FileIo {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
  path?: string;
  destination?: string;
  filename?: string;
}
