# syntax=docker/dockerfile:1

ARG REGISTRY_PATH=""


FROM ${REGISTRY_PATH}node:24.22.1-bookworm AS builder
ARG NX_SKIP_NX_CACHE=false
ENV NX_SKIP_NX_CACHE=${NX_SKIP_NX_CACHE} NX_DAEMON=false NX_NO_CLOUD=true

# Use the same npm version for build and runtime dependency installation.
RUN npm --version
RUN --mount=type=cache,target=/root/.npm \
    npm install -g --no-fund npm@11.19.1
RUN npm --version

WORKDIR /usr/src/coding-box-base

# Source changes must not invalidate the locked dependency installation.
# npm also resolves the local override/link targets in vendor during npm ci.
COPY package.json package-lock.json ./
COPY vendor ./vendor

# Install dependencies
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline --no-fund

COPY . .

# Build projects with separate, sequential Nx invocations.
RUN npx nx --version
RUN --mount=type=cache,target=./.nx/cache \
    npx nx build backend --configuration=production
RUN --mount=type=cache,target=./.nx/cache \
    npx nx build frontend --configuration=production
