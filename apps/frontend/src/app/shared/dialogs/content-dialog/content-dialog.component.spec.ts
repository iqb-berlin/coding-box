import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ContentDialogComponent, DialogData } from './content-dialog.component';

describe('ContentDialogComponent', () => {
  const createComponent = (data: DialogData) => {
    const dialogRef = {
      close: jest.fn()
    } as unknown as MatDialogRef<ContentDialogComponent>;
    TestBed.configureTestingModule({
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data }
      ]
    });
    return {
      component: TestBed.runInInjectionContext(() => new ContentDialogComponent()),
      dialogRef
    };
  };

  it('should format JSON once for display', () => {
    const { component } = createComponent({
      title: 'response.voud',
      content: '{"pages":[]}',
      isJson: true
    });

    expect(component.displayContent).toBe([
      '{',
      '  "pages": []',
      '}'
    ].join('\n'));
  });

  it('should keep invalid JSON unchanged', () => {
    const { component } = createComponent({
      title: 'response.voud',
      content: '{"pages":',
      isJson: true
    });

    expect(component.displayContent).toBe('{"pages":');
  });

  it('should keep plain content unchanged', () => {
    const { component } = createComponent({
      title: 'notes.txt',
      content: 'plain text'
    });

    expect(component.displayContent).toBe('plain text');
  });

  it('should close with the delete flag', () => {
    const { component, dialogRef } = createComponent({
      title: 'notes.txt',
      content: 'plain text'
    });

    component.close(true);

    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });
});
