# Core Module

This directory contains singleton services and application-wide providers that should be instantiated only once in the application lifecycle.

## Structure

- **services/**: Singleton services that should have only one instance throughout the application
  - Authentication services
  - Logging services
  - Global state services
  
- **interceptors/**: HTTP interceptors for handling cross-cutting concerns
  - Authentication interceptors
  - Error handling interceptors
  - Logging interceptors
  
- **guards/**: Global route guards
  - Authentication guards
  - Permission guards
  
- **config/**: Application configuration
  - Environment-specific configuration
  - Feature flags
  - Global constants

## Usage Guidelines

1. Services in the core module should be provided at the root level in `app.config.ts`
2. Do not import the core module in feature modules to avoid circular dependencies
3. Core services should be stateless or manage global application state
4. Interceptors should handle cross-cutting concerns like authentication, error handling, and logging
5. Guards should protect routes based on authentication, permissions, or other global conditions
