# syntax=docker/dockerfile:1

ARG REGISTRY_PATH=""
ARG BASE_IMAGE_NAME=coding-box-base


FROM $BASE_IMAGE_NAME AS base


FROM base AS dev
ENTRYPOINT ["npx", "nx"]


# The full builder supplies Python/make/g++ when a native prebuild requires a
# newer glibc. Compile against Bookworm and keep the toolchain out of runtime.
FROM base AS dependencies
ARG PROJECT
ENV NODE_ENV=production

USER node

WORKDIR /usr/src/coding-box-${PROJECT}
RUN mkdir packages

# Preserve the workspace lockfile's dependency locations. Nx's pruned lockfile
# can relocate incompatible nested dependencies (for example Express 4 and 5).
COPY --chown=node:node --from=base /usr/src/coding-box-base/package.json /usr/src/coding-box-base/package-lock.json ./
# npm validates local override/link targets even when dev dependencies are omitted.
COPY --chown=node:node --from=base /usr/src/coding-box-base/vendor ./vendor
RUN --mount=type=cache,target=/home/node/.npm,uid=1000,gid=1000 \
    npm ci --omit=dev --no-fund


FROM ${REGISTRY_PATH}node:24.22.1-bookworm-slim AS build
ARG PROJECT
ENV NODE_ENV=production

RUN --mount=type=cache,target=/var/cache/apt \
    apt update && \
    apt install -y --no-install-recommends tini

RUN --mount=type=cache,target=/root/.npm \
    npm install -g --no-fund npm@11.19.1

USER node
WORKDIR /usr/src/coding-box-${PROJECT}
COPY --chown=node:node --from=dependencies /usr/src/coding-box-${PROJECT}/ ./

EXPOSE 3333


FROM build AS source
ARG PROJECT

# Copy the build artifacts from the previous stage
COPY --chown=node:node --from=base /usr/src/coding-box-base/dist/apps/${PROJECT} .
# Keep the installed tree's manifest and lockfile, rather than Nx's pruned copies.
COPY --chown=node:node --from=build /usr/src/coding-box-${PROJECT}/package.json /usr/src/coding-box-${PROJECT}/package-lock.json ./


FROM source AS prod
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "main.js"]
