export function downloadInBrowser(file: Blob | string, filename: string): void {
  const link = document.createElement('a');
  link.href = typeof file === 'string' ? file : window.URL.createObjectURL(file);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (typeof file !== 'string') window.URL.revokeObjectURL(link.href);
}
