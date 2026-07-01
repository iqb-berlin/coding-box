# syntax=docker/dockerfile:1

ARG REGISTRY_PATH=""
ARG BASE_IMAGE_NAME=coding-box-base


FROM $BASE_IMAGE_NAME AS base


FROM base AS dev
ARG PROJECT

RUN sed -i "s/localhost.*$/backend:3333\",/" apps/${PROJECT}/proxy.conf.json

EXPOSE 8080

ENTRYPOINT ["npx", "nx"]


FROM ${REGISTRY_PATH}nginxinc/nginx-unprivileged:stable AS prod
ARG PROJECT
ARG APP_VERSION=1.16.3
ENV APP_VERSION=$APP_VERSION

USER root
RUN chown -R nginx:root /usr/share/nginx/html

# Kopieren und ausführbar machen des Konfigurationsscripts
COPY --chown=nginx:root config/frontend/runtime-config.sh /docker-entrypoint.d/
RUN chmod +x /docker-entrypoint.d/runtime-config.sh

USER nginx

COPY --chown=nginx:root config/frontend/default.conf.http-template /etc/nginx/templates/default.conf.template
COPY --chown=nginx:root --from=base /usr/src/coding-box-base/dist/apps/${PROJECT} /usr/share/nginx/html
COPY --chown=nginx:root config/frontend/50x.html /usr/share/nginx/html/50x.html
COPY --chown=nginx:root config/frontend/iqb-logo-red.svg /usr/share/nginx/html/iqb-logo-red.svg

EXPOSE 8080 8443

CMD ["nginx", "-g", "daemon off;"]
