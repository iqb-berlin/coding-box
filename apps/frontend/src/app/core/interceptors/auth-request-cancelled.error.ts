export class AuthRequestCancelledError extends Error {
  constructor() {
    super('HTTP request cancelled because the authentication session changed or expired');
    this.name = 'AuthRequestCancelledError';
  }
}
