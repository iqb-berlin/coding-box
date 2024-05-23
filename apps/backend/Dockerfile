# syntax=docker/dockerfile:1

ARG REGISTRY_PATH
ARG BASE_IMAGE=${REGISTRY_PATH}node:20.13-bookworm-slim


FROM ${BASE_IMAGE} AS build
ARG PROJECT

RUN mkdir /coding-box
WORKDIR /coding-box

COPY . .

# Update npm to latest version
RUN npm --version
RUN --mount=type=cache,target=~/.npm \
    npm install -g --no-fund npm
RUN npm --version

# Install dependencies
RUN --mount=type=cache,target=~/.npm \
    npm ci --no-fund

# Build project
RUN npx nx --version
RUN --mount=type=cache,target=./.nx/cache \
    npx nx build ${PROJECT} --prod


FROM build AS dev

ENTRYPOINT ["npx", "nx"]


FROM ${BASE_IMAGE} AS base
RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update && \
    apt-get install -y --no-install-recommends tini

ARG PROJECT
ENV NODE_ENV=production

RUN mkdir /coding-box-${PROJECT} && chown -R node:node /coding-box-${PROJECT}
WORKDIR /coding-box-${PROJECT}

USER node
EXPOSE 3333

COPY --chown=node:node --from=build /coding-box/dist/apps/${PROJECT}/package.json .
RUN --mount=type=cache,target=~/.npm \
    npm install --only=production --no-fund
RUN --mount=type=cache,target=~/.npm \
    npm install pg --save --no-fund ## workaround nx bug


FROM base AS source
ARG PROJECT

# Copy the build artifacts from the previous stage
COPY --chown=node:node --from=build /coding-box/dist/apps/${PROJECT} .
RUN mkdir packages && chown -R node:node packages


FROM source AS prod
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "main.js"]
