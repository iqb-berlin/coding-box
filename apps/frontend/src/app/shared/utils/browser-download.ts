import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

export function prepareBrowserDownload(http: HttpClient, downloadUrl: string): Observable<string> {
  return http.get(`${downloadUrl}/prepare`).pipe(map(() => `${downloadUrl}/file`));
}

export function downloadInBrowser(file: Blob | string, filename: string): void {
  const link = document.createElement('a');
  link.href = typeof file === 'string' ? file : window.URL.createObjectURL(file);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (typeof file !== 'string') window.URL.revokeObjectURL(link.href);
}
