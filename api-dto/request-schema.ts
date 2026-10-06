

/** JSON contracts shared by client types, server validation and OpenAPI. */
export interface RequestSchema {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'object' | 'array';
  enum?: readonly (string | number | boolean | null)[];
  properties?: Readonly<Record<string, RequestSchema>>;
  required?: readonly string[];
  items?: RequestSchema;
  anyOf?: readonly RequestSchema[];
  additionalProperties?: boolean | RequestSchema;
  minimum?: number;
}

export const string = { type: 'string' } as const;

export const number = { type: 'number' } as const;

export const boolean = { type: 'boolean' } as const;

export const array = <const S extends RequestSchema>(items: S) => ({ type: 'array' as const, items });

export const values = <const V extends readonly (string | number)[]>(...choices: V) => ({
  type: typeof choices[0] as 'string' | 'number', enum: choices
});

export const either = <const S extends readonly RequestSchema[]>(...choices: S) => ({ anyOf: choices });

export function object<const P extends Record<string, RequestSchema>>(properties: P): {
  type: 'object'; properties: P; required: readonly []; additionalProperties: true;
};

export function object<const P extends Record<string, RequestSchema>, const R extends readonly (keyof P & string)[]>(properties: P, required: R): {
  type: 'object'; properties: P; required: R; additionalProperties: true;
};

export function object(properties: Record<string, RequestSchema>, required: readonly string[] = []) {
  // Existing clients send display fields. Preserve them; persistence must use
  // explicit write fields rather than spreading an entire request into entities.
  return { type: 'object' as const, properties, required, additionalProperties: true as const };
}

type RequiredKeys<S> = S extends { required: readonly (infer K)[] } ? K : never;

type ObjectBody<S, P> = {
  -readonly [K in keyof P as K extends RequiredKeys<S> ? K : never]: InferRequest<P[K]>;
} & {
  -readonly [K in keyof P as K extends RequiredKeys<S> ? never : K]?: InferRequest<P[K]>;
};

export type InferRequest<S> =
  S extends { enum: readonly (infer V)[] } ? V :
  S extends { anyOf: readonly (infer V)[] } ? InferRequest<V> :
  S extends { type: 'string' } ? string :
  S extends { type: 'number' | 'integer' } ? number :
  S extends { type: 'boolean' } ? boolean :
  S extends { type: 'null' } ? null :
  S extends { type: 'array'; items: infer I } ? InferRequest<I>[] :
  S extends { type: 'object'; properties: infer P } ? ObjectBody<S, P> :
  S extends { type: 'object'; additionalProperties: infer A extends RequestSchema } ? Record<string, InferRequest<A>> :
  S extends { type: 'object' } ? Record<string, unknown> : unknown;
