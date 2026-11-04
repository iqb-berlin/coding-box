export const resetMock = jest.fn(() => 'initial');
export const typedMock = jest.fn<string, [number]>(value => String(value));
export const genericMock = jest.fn(<T>(value: T): T => value);
export const constructors = { Database: jest.fn().mockImplementation(() => ({ value: 42 })) };

beforeEach(() => resetMock.mockReset());
