import { HttpEvent, HttpEventType, HttpResponse } from '@angular/common/http';
import { Observable, Subscription } from 'rxjs';

type SegmentRequest = (offset: number, archiveId?: string) => Observable<HttpEvent<Blob>>;

function readSegment(event: HttpResponse<Blob>, offset: number, archiveId?: string, total?: number) {
  const range = event.headers.get('X-Archive-Range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  const id = event.headers.get('X-Archive-Id');
  const body = event.body;
  if (!id || !range || !body || !body.size) return null;
  const [, start, end, size] = range.map(Number);
  if (
    (archiveId && archiveId !== id) || start !== offset || end + 1 !== offset + body.size ||
    (total !== undefined && total !== size) || end >= size
  ) return null;
  return { id, size, body };
}

export function downloadZipSegments(request: SegmentRequest): Observable<HttpEvent<Blob>> {
  return new Observable(subscriber => {
    const requests = new Subscription();
    const parts: Blob[] = [];
    let archiveId: string | undefined;
    let total: number | undefined;
    let offset = 0;

    const complete = (response: HttpResponse<Blob>) => {
      subscriber.next(response);
      subscriber.complete();
    };

    const handleEvent = (event: HttpEvent<Blob>) => {
      if (event.type === HttpEventType.ResponseHeader) {
        const size = event.headers.get('X-Archive-Range')?.match(/\/(\d+)$/)?.[1];
        if (size) total = Number(size);
      }
      if (event.type === HttpEventType.DownloadProgress) {
        subscriber.next({ ...event, loaded: offset + event.loaded, total: total ?? event.total });
        return;
      }
      if (event.type !== HttpEventType.Response) {
        subscriber.next(event);
        return;
      }
      if (!archiveId && !event.headers.has('X-Archive-Range') && !event.headers.has('X-Archive-Id')) {
        complete(event);
        return;
      }

      const segment = readSegment(event, offset, archiveId, total);
      if (!segment) {
        subscriber.error(new Error('Invalid ZIP segment received'));
        return;
      }
      archiveId = segment.id;
      total = segment.size;
      offset += segment.body.size;
      parts.push(segment.body);
      if (offset === total) {
        complete(event.clone({ body: new Blob(parts, { type: 'application/zip' }) }));
        return;
      }
      requestNext();
    };

    const requestNext = () => {
      requests.add(request(offset, archiveId).subscribe({
        next: handleEvent,
        error: error => subscriber.error(error)
      }));
    };
    requestNext();
    return requests;
  });
}
