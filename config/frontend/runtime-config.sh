#!/bin/sh

# Erstellen des Verzeichnisses für die Konfigurationsdatei
mkdir -p /usr/share/nginx/html/assets/config

json_string() {
  awk -v value="$1" 'BEGIN {
    gsub(/\\/, "\\\\", value);
    gsub(/"/, "\\\"", value);
    gsub(/\r/, "\\r", value);
    gsub(/\n/, "\\n", value);
    gsub(/\t/, "\\t", value);
    printf "\"%s\"", value;
  }'
}

KEYCLOAK_URL_VALUE=${KEYCLOAK_URL:-https://keycloak.kodierbox.iqb.hu-berlin.de/}
KEYCLOAK_REALM_VALUE=${KEYCLOAK_REALM:-coding-box}
KEYCLOAK_CLIENT_ID_VALUE=${KEYCLOAK_CLIENT_ID:-coding-box}
APP_VERSION_VALUE=${APP_VERSION:-local}
BACKEND_URL_VALUE=${BACKEND_URL:-api/}

# Generieren der Konfigurationsdatei mit Umgebungsvariablen
cat > /usr/share/nginx/html/assets/config/runtime-config.js <<EOF
window.RUNTIME_CONFIG = {
  keycloak: {
    url: $(json_string "$KEYCLOAK_URL_VALUE"),
    realm: $(json_string "$KEYCLOAK_REALM_VALUE"),
    clientId: $(json_string "$KEYCLOAK_CLIENT_ID_VALUE")
  },
  appVersion: $(json_string "$APP_VERSION_VALUE"),
  backendUrl: $(json_string "$BACKEND_URL_VALUE")
};
EOF

# Starten von Nginx
exec "$@"
