#!/bin/sh

# Erstellen des Verzeichnisses für die Konfigurationsdatei
mkdir -p /usr/share/nginx/html/assets/config

# Generieren der Konfigurationsdatei mit Umgebungsvariablen
cat > /usr/share/nginx/html/assets/config/runtime-config.js <<EOF
window.RUNTIME_CONFIG = {
  keycloak: {
    url: "${OIDC_PROVIDER_URL:-https://keycloak.kodierbox.iqb.hu-berlin.de}",
    realm: "${KEYCLOAK_REALM:-iqb}",
    clientId: "${KEYCLOAK_CLIENT_ID:-coding-box}"
  },
  backendUrl: "${BACKEND_URL:-api}"
};
EOF

# Starten von Nginx
exec "$@"
