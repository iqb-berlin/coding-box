# syntax=docker/dockerfile:1

ARG REGISTRY_PATH=""


FROM ${REGISTRY_PATH}postgres:14.12-alpine3.19

RUN --mount=type=cache,target=/var/cache/apk \
    apk add --update musl musl-utils musl-locales tzdata

# Localization
ENV LANG=de_DE.utf8
ENV TZ=Europe/Berlin

# Copy custom PostgreSQL configuration
# COPY database/config/postgresql.conf /etc/postgresql/postgresql.conf

# Copy healthcheck script
COPY database/healthcheck/postgres-healthcheck /usr/local/bin/

# RUN chown postgres:postgres /etc/postgresql/postgresql.conf

# CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]

HEALTHCHECK \
    --interval=10s \
    --timeout=3s \
    --start-period=60s \
    --start-interval=1s \
    --retries=5 \
    CMD ["postgres-healthcheck"]

EXPOSE 5432



