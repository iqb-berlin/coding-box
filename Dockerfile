# syntax=docker/dockerfile:1

ARG REGISTRY_PATH=""


FROM ${REGISTRY_PATH}node:24.22.1-bookworm AS builder

# Use the same npm version for build and runtime dependency installation.
RUN npm --version
RUN --mount=type=cache,target=/root/.npm \
    npm install -g --no-fund npm@11.19.1
RUN npm --version

WORKDIR /usr/src/coding-box-base
COPY . .

# Install dependencies
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-fund

# Build projects with separate, sequential Nx invocations.
RUN npx nx --version
RUN --mount=type=cache,target=./.nx/cache \
    npx nx build backend --configuration=production
RUN --mount=type=cache,target=./.nx/cache \
    npx nx build frontend --configuration=production
