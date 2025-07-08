# Frontend Application Structure

This document outlines the structure of the frontend application and provides guidance for future development.

## Directory Structure

The application follows a feature-based organization with shared components and core services:

```
src/
  app/
    core/                 # Singleton services and application-wide providers
    shared/               # Reusable components, directives, pipes, and utilities
    [feature-modules]/    # Various feature modules (auth, coding, replay, etc.)
    app.component.*       # Root component files
    app.config.ts         # Application configuration
    app.routes.ts         # Root routing configuration
```

## Feature Module Structure

Each feature module follows a consistent directory structure:

```
feature/
  components/     # UI components specific to this feature
  services/       # Services specific to this feature
  models/         # Data models and interfaces
  utils/          # Utility functions
  guards/         # Route guards
  feature.routes.ts  # Feature-specific routes
```

## Routing

The application uses a modular routing approach:

1. Each feature module has its own routes file (e.g., `replay.routes.ts`, `sys-admin.routes.ts`)
2. The root routes file (`app.routes.ts`) imports and combines all feature routes
3. Routes are lazy-loaded to improve performance

## Development Guidelines

1. **Components**: 
   - Place components in the appropriate feature module's `components` directory
   - Use smart/dumb component pattern (containers vs. presentational components)

2. **Services**:
   - Place global services in the `core/services` directory
   - Place feature-specific services in the feature module's `services` directory

3. **Models**:
   - Define interfaces and types in the appropriate feature module's `models` directory
   - Place shared models in the `shared/models` directory

4. **Guards**:
   - Place global guards in the `core/guards` directory
   - Place feature-specific guards in the feature module's `guards` directory

5. **Utils**:
   - Place utility functions in the appropriate feature module's `utils` directory
   - Place shared utilities in the `shared/utils` directory
