import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'fileSize', standalone: true })
export class FileSizePipe implements PipeTransform {
  sizes: string[] = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  transform(bytes: number): string {
    if (Number.isNaN(bytes) || bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${parseFloat((bytes / 1024 ** i).toFixed(2))} ${this.sizes[i]}`;
  }
}
