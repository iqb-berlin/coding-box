import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  PayloadTooLargeException
} from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';
import {
  REQUEST_ID_HEADER,
  RequestWithRequestId,
  createRequestId
} from './request-id';

interface ErrorResponseBody {
  statusCode: number;
  message: string | string[];
  error?: string;
  requestId: string;
  timestamp: string;
  path: string;
}

@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalHttpExceptionFilter.name);

  catch(caughtException: unknown, host: ArgumentsHost): void {
    const exception = this.normalizeRequestParsingError(caughtException);
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithRequestId>();
    const response = context.getResponse<Response>();
    const status = this.getStatus(exception);
    const requestId = request.requestId || createRequestId();

    request.requestId = requestId;
    if (!response.headersSent) {
      response.setHeader(REQUEST_ID_HEADER, requestId);
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logServerError(exception, request, status, requestId);
    }

    if (response.headersSent) {
      return;
    }

    response.status(status).json(this.createResponseBody(exception, request, status, requestId));
  }

  private normalizeRequestParsingError(exception: unknown): unknown {
    // Nest's adapter does not yet map these newer Multer field parsing errors.
    if (exception instanceof MulterError && [
      'INVALID_FIELD_NAME',
      'LIMIT_FIELD_ARRAY_INDEX'
    ].includes(exception.code)) {
      return new BadRequestException('Invalid multipart field name');
    }
    if (!(exception instanceof Error)) {
      return exception;
    }
    const parserError = exception as Error & { type?: string; status?: number };
    if (parserError.type === 'entity.parse.failed' && parserError.status === 400) {
      return new BadRequestException('Malformed JSON request body');
    }
    if (parserError.type === 'entity.too.large' && parserError.status === 413) {
      return new PayloadTooLargeException('Request body too large');
    }
    return exception;
  }

  private getStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private createResponseBody(
    exception: unknown,
    request: RequestWithRequestId,
    status: number,
    requestId: string
  ): ErrorResponseBody {
    const baseBody = {
      statusCode: status,
      requestId,
      timestamp: new Date().toISOString(),
      path: request.originalUrl || request.url
    };

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      return {
        ...baseBody,
        message: 'Internal server error'
      };
    }

    if (exception instanceof HttpException) {
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        return {
          ...baseBody,
          message: exceptionResponse
        };
      }

      if (this.isObject(exceptionResponse)) {
        const responseBody = exceptionResponse as Record<string, unknown>;
        return {
          ...baseBody,
          ...responseBody,
          statusCode: status,
          message: this.getClientErrorMessage(responseBody),
          requestId,
          timestamp: baseBody.timestamp,
          path: baseBody.path
        };
      }
    }

    return {
      ...baseBody,
      message: 'Internal server error'
    };
  }

  private logServerError(
    exception: unknown,
    request: RequestWithRequestId,
    status: number,
    requestId: string
  ): void {
    const message = exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;
    // Queries can contain Testcenter credentials; keep only the request path.
    const requestPath = (request.originalUrl || request.url || '/').split('?', 1)[0];

    this.logger.error(
      `[${requestId}] ${request.method} ${requestPath} failed with ${status}: ${message}`,
      stack
    );
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private getClientErrorMessage(responseBody: Record<string, unknown>): string | string[] {
    if (typeof responseBody.message === 'string' || Array.isArray(responseBody.message)) {
      return responseBody.message as string | string[];
    }

    if (typeof responseBody.error === 'string' && responseBody.error.trim()) {
      return responseBody.error;
    }

    return 'Request failed';
  }
}
