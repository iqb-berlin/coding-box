# syntax=docker/dockerfile:1

ARG REGISTRY_PATH=""


FROM ${REGISTRY_PATH}liquibase/liquibase:4.28@sha256:7c813a2cb861f8b4718a09375c5265909127f4cb99f56bb95c956175c9b91525 AS base

# The application only uses the Liquibase CLI. The bundled LPM binary is not
# needed at runtime and is built with a Go version affected by CVE-2025-68121.
USER root
RUN rm /liquibase/bin/lpm
USER liquibase:liquibase

FROM base AS prod

COPY database/changelog changelog
