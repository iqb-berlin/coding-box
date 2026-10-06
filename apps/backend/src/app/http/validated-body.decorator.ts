import { Body } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { requestBodySchemas, RequestBodyName } from '../../../../../api-dto/request-contracts';
import { RequestSchema } from '../../../../../api-dto/request-schema';
import { JsonSchemaValidationPipe } from './json-schema-validation.pipe';

export function toOpenApiSchema(schema: RequestSchema): SchemaObject {
  // OpenAPI 3.0 represents null with nullable rather than JSON Schema's null type.
  const choices = schema.anyOf;
  if (choices?.some(choice => choice.type === 'null')) {
    const nonNull = choices.filter(choice => choice.type !== 'null');
    return nonNull.length === 1 ? { ...toOpenApiSchema(nonNull[0]), nullable: true } : {
      anyOf: nonNull.map(toOpenApiSchema), nullable: true
    };
  }
  return {
    ...schema,
    ...(schema.anyOf ? { anyOf: schema.anyOf.map(toOpenApiSchema) } : {}),
    ...(schema.properties ? {
      properties: Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, toOpenApiSchema(value)]))
    } : {}),
    ...(schema.items ? { items: toOpenApiSchema(schema.items) } : {}),
    ...(typeof schema.additionalProperties === 'object' ? {
      additionalProperties: toOpenApiSchema(schema.additionalProperties)
    } : {})
  } as SchemaObject;
}

/** One named contract supplies both validation and the request documentation. */
export function ValidatedBody(name: RequestBodyName, optional = false): ParameterDecorator {
  const schema = requestBodySchemas[name];
  return (target, propertyKey, index) => {
    if (propertyKey === undefined) throw new Error('ValidatedBody requires a route method');
    const descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);
    if (!descriptor) throw new Error('ValidatedBody requires a route descriptor');
    ApiBody({ schema: toOpenApiSchema(schema), required: !optional })(target, propertyKey, descriptor);
    Body(new JsonSchemaValidationPipe(schema, optional))(target, propertyKey, index);
  };
}
