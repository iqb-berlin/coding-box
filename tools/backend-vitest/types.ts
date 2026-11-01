import type { Mock as NativeMock, MockInstance as NativeMockInstance } from 'vitest';

/** Preserve the legacy return/argument generic order while checking real Vitest APIs. */
export type Mock<R = any, A extends any[] = any[], C = any> = NativeMock<(this: C, ...args: A) => R>;
export type MockInstance<R = any, A extends any[] = any[]> = NativeMockInstance<(...args: A) => R>;
export type SpyInstance<R = any, A extends any[] = any[]> = MockInstance<R, A>;
export type Mocked<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? MockInstance<ReturnType<T[K]>, Parameters<T[K]>> & T[K] : T[K];
} & T;
export type MockedFunction<T extends (...args: any[]) => any> = MockInstance<ReturnType<T>, Parameters<T>> & T;
export type ArgsType<T> = T extends (...args: infer A) => any ? A : never;
