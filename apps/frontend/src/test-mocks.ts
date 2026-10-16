import 'jest-canvas-mock';

// Mock jwt-decode
jest.mock('jwt-decode', () => ({
  jwtDecode: jest.fn(() => ({ workspace: '1' }))
}));

// Mock Angular Material components that have CSS parsing issues in jsdom
jest.mock('@angular/material/snack-bar', () => {
  const actual = jest.requireActual('@angular/material/snack-bar');
  return {
    ...actual,
    MatSnackBar: class MatSnackBarMock {
      open = jest.fn();
    }
  };
});

// Suppress jsdom CSS parsing errors for CDK overlay styles
// eslint-disable-next-line no-console
const originalError = console.error;
beforeAll(() => {
  // eslint-disable-next-line no-console
  console.error = jest.fn((...args) => {
    if (args[0]?.message?.includes('Could not parse CSS stylesheet') ||
        args[0]?.message?.includes('Not implemented: navigation')) {
      return;
    }
    // Handle the case where the error is just a string or has a different structure
    const errorMessage = typeof args[0] === 'string' ? args[0] : (args[0]?.message || '');
    if (errorMessage.includes('Not implemented: navigation')) {
      return;
    }
    originalError.call(console, ...args);
  });
});

afterAll(() => {
  // eslint-disable-next-line no-console
  console.error = originalError;
});
