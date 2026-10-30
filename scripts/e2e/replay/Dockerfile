FROM node:24.22.1-bookworm

WORKDIR /usr/src/coding-box

COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN --mount=type=cache,target=/root/.npm \
  npm ci --no-fund

COPY . .

EXPOSE 3333 4200
