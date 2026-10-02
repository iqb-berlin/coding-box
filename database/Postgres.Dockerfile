# syntax=docker/dockerfile:1

ARG REGISTRY_PATH=""

FROM ${REGISTRY_PATH}golang:1.24.13-alpine3.23@sha256:8bee1901f1e530bfb4a7850aa7a479d17ae3a18beb6e09064ed54cfd245b7191 AS gosu-builder

ARG GOSU_COMMIT=6456aaa0f3c854d199d0f037f068eb97515b7513
ARG GOSU_SOURCE_SHA256=33d7537d588ea49458b9509bcf4554bdf5ceacc66da71e5caa1058ea3b689c3b

WORKDIR /src/gosu

RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    wget --output-document=gosu.tar.gz \
        "https://github.com/tianon/gosu/archive/${GOSU_COMMIT}.tar.gz" \
    && echo "${GOSU_SOURCE_SHA256}  gosu.tar.gz" | sha256sum -c \
    && tar --extract --gzip --file=gosu.tar.gz --strip-components=1 \
    && CGO_ENABLED=0 go build -trimpath -ldflags '-d -w' -o /out/gosu . \
    && /out/gosu --version | grep -F '1.19 (go1.24.13 '

FROM ${REGISTRY_PATH}postgres:14.23-alpine3.24@sha256:f1341c01408dc7278e9d365ed4f860cd3f87dd16b4464ac326fc0f422083a579

COPY --from=gosu-builder --chmod=0755 /out/gosu /usr/local/bin/gosu

RUN --mount=type=cache,target=/var/cache/apk \
    apk add --update musl musl-utils musl-locales tzdata \
    && gosu --version | grep -F '1.19 (go1.24.13 '

# Localization
ENV LANG=de_DE.utf8
ENV TZ=Europe/Berlin

# Copy healthcheck script
COPY database/healthcheck/postgres-healthcheck /usr/local/bin/

HEALTHCHECK \
    --interval=10s \
    --timeout=3s \
    --start-period=60s \
    --start-interval=1s \
    --retries=5 \
    CMD ["postgres-healthcheck"]

EXPOSE 5432

