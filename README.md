# CodingBox

## Project Structure

The project structure is organized in a way that ensures easy development and maintenance. The main folders and files include:

- **apps/**: Contains the `frontend` and `backend` applications.
- **config/**: Configuration files for various services.
- **database/**: Database configuration and related resources.
- **dist/**: Generated build artifacts.
- **environments/**: Environment variables.
- **node_modules/**: Dependencies from npm.
- **packages/**: Additional packages to extend the project.
- **scripts/**: Scripts for build and deployment processes.
- Unified configuration files (.prettierrc, .eslintrc, etc.) for ensuring code quality.

---

## Requirements

### Dependencies
The project is built using the following main technologies:

- **Frontend**: Angular
- **Backend**: NestJS
- **Testing**: Jest
- **Linting**: ESLint

### System Requirements
- Node.js: Version 16 or higher
- NPM: Version 7 or higher
- Docker (optional for containerization)

---

## Development Process

### Local Development
1. **Start the Development Environment**  
   Run the following command to start the development environment:  
   ```bash
   npm run start-app
   ```
   By default, the application is available at `http://localhost:4200/`. Changes in the source code will trigger an automatic reload of the application.

2. **Start the Backend (Optional)**  
   To run the backend, use:  
   ```bash
   npm run start-backend
   ```

---

## Build

Run the following command to build the project:  
The build artifacts will be stored in the `dist/` folder.

---

## Testing

### Unit Tests
Run unit tests with Jest:

### Linting
Perform linting with ESLint:

---

## Containerization (Docker)

### Start with Docker-Compose
The project provides a Docker-Compose configuration to run the applications in containers with predefined environments. Use the following command:

### Building and Running
For production environments, you can use the file `docker-compose.coding-box.prod.yaml`:

---


## Useful Scripts

- `npm run start-app`: Starts the app.
- `npm run start-backend`: Starts the backend server.
- `npm run build-app`: Builds the project for production.
- `npm run test-app`: Executes unit tests.
- `npm run lint-app`: Performs linting with ESLint.

---

## Additional Information

- **Contributing**: Contributions are welcome. Submit a pull request with detailed changes.
- **License**: This project is licensed under the **MIT License**.
- **Support**: For questions or issues, please contact the project maintainer.
