# syntax=docker/dockerfile:1

ARG REGISTRY_PATH=""
ARG BASE_IMAGE_NAME=coding-box-base


FROM $BASE_IMAGE_NAME AS base


FROM base AS dev
ENTRYPOINT ["npx", "nx"]


FROM ${REGISTRY_PATH}node:22-bookworm-slim AS build
ARG PROJECT
ENV NODE_ENV=production

RUN --mount=type=cache,target=/var/cache/apt \
    apt update && \
    apt install -y --no-install-recommends tini

RUN --mount=type=cache,target=/root/.npm \
    npm install -g --no-fund npm@11.18.0

USER node

WORKDIR /usr/src/coding-box-${PROJECT}
RUN mkdir packages

# Install dependencies (use the reviewed shared-codebook release candidate).
COPY --chown=node:node --from=base /usr/src/coding-box-base/vendor/iqb-ngx-coding-components-4.1.0.tgz ./vendor/iqb-ngx-coding-components-4.1.0.tgz
COPY --chown=node:node --from=base /usr/src/coding-box-base/dist/apps/${PROJECT}/package.json .
RUN --mount=type=cache,target=~/.npm \
    npm pkg set dependencies.@iqb/ngx-coding-components=file:vendor/iqb-ngx-coding-components-4.1.0.tgz && \
    npm install --omit=dev --no-fund

# Install PostgreSQL client (missing in dist/apps/backend/package.json - nx bug?)
RUN --mount=type=cache,target=~/.npm \
    npm install pg --save --no-fund

EXPOSE 3333


FROM build AS source
ARG PROJECT

# Copy the build artifacts from the previous stage
COPY --chown=node:node --from=base /usr/src/coding-box-base/dist/apps/${PROJECT} .


FROM source AS prod
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "main.js"]
