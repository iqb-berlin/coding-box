export interface MessageDialogData {
  title: string;
  content: string;
  type: 'info' | 'warning' | 'error';
  closeButtonLabel: string;
}
