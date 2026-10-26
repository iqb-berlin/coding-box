# Testcenter: HTTPS und private Zertifizierungsstellen

Alle eingebauten Testcenter-Adressen verwenden HTTPS. Die Kodierbox prüft bei
jedem HTTPS-Aufruf die Zertifikatskette und den Hostnamen. Das gilt auch für
Adressen, die Nutzer unter **individuelle Testcenter URL** eintragen, und für
Testcenter hinter einem Pfad wie `https://mein-testcenter.example.org/tci`.

## Vor dem Upgrade

Bei einem öffentlich vertrauenswürdigen Zertifikat ist keine zusätzliche
CA-Konfiguration erforderlich. Verwendet eine angebundene Instanz eine private
CA oder ein selbst signiertes Zertifikat, muss der Betreiber diese Vertrauenskette
vor dem ersten Verbindungsversuch mit der neuen Version einrichten. Andernfalls
scheitert bereits die Anmeldung. Frühere Versionen akzeptierten solche
Zertifikate ohne Prüfung.

Die CA-Datei über einen vertrauenswürdigen Weg vom Testcenter-Betreiber beziehen
und den Fingerabdruck mit ihm abgleichen. Bei einer privaten CA deren öffentliche
CA-Zertifikate im PEM-Format verwenden, bei einem bewusst selbst signierten
Server dessen geprüftes öffentliches Zertifikat. Private Schlüssel gehören
nicht in dieses Verzeichnis. Das Serverzertifikat muss weiterhin gültig sein und
den eingegebenen Hostnamen abdecken; eine zusätzliche CA hebt diese Prüfungen
nicht auf. Fehlende Zwischenzertifikate sollte der Testcenter-Betreiber in seiner
Serverkonfiguration ergänzen.

## Docker-Konfiguration

Im Installationsverzeichnis die CA-Datei ablegen:

```sh
mkdir -p config/trusted-cas
chmod 755 config/trusted-cas
cp /sicherer/pfad/testcenter-ca.pem config/trusted-cas/testcenter-ca.pem
chmod 644 config/trusted-cas/testcenter-ca.pem
```

In `.env.coding-box` (Produktion) bzw. `.env.dev` (Entwicklung) ergänzen:

```dotenv
NODE_EXTRA_CA_CERTS=/etc/coding-box/trusted-cas/testcenter-ca.pem
```

Die mitgelieferte Basis-Compose-Datei reicht die Variable an den API-Backend-
Container weiter und bindet `./config/trusted-cas` schreibgeschützt unter
`/etc/coding-box/trusted-cas` ein. Ohne gesetzte Variable werden keine weiteren
CAs geladen. Die Konfiguration gilt für ausgehende HTTPS-Verbindungen des
gesamten API-Backend-Prozesses; deshalb nur benötigte, geprüfte CAs aufnehmen.

Bei einer bestehenden Installation müssen auch die aktualisierten Compose-
Dateien installiert sein. Das Update-Skript benennt die Basisdatei als
`docker-compose.coding-box.yaml`. Anschließend den Backend-Container neu erstellen:

```sh
docker compose --env-file .env.coding-box \
  -f docker-compose.coding-box.yaml \
  -f docker-compose.coding-box.prod.yaml \
  up -d --no-deps --force-recreate backend
```

Bei einem Git-Checkout heißt die erste Datei stattdessen `docker-compose.yaml`.
Für die Docker-Entwicklung aus dem Git-Checkout:

```sh
docker compose --env-file .env.dev \
  -f docker-compose.yaml -f docker-compose.override.yaml \
  up -d --no-deps --force-recreate backend
```

Die normalen Make- und Update-Befehle verwenden dieselbe Basis-Konfiguration;
eine zusätzliche Compose-Datei ist nicht erforderlich. Ein bloßes `restart`
übernimmt geänderte Container-Umgebungsvariablen nicht. Auch bei einer erneuerten
CA-Datei den Backend-Prozess neu starten: Node liest zusätzliche CAs nur beim
Prozessstart. Bei lokalem Backend ohne Docker ist `NODE_EXTRA_CA_CERTS` vor dem
Start auf den absoluten lokalen Dateipfad zu setzen, nicht auf den Containerpfad.

## Verbindung prüfen

1. Im neu erstellten Backend prüfen, dass `NODE_EXTRA_CA_CERTS` auf die lesbare
   PEM-Datei zeigt und im Startprotokoll keine Warnung über deren Laden erscheint.
2. In der Oberfläche **individuelle Testcenter URL** auswählen und die vollständige
   HTTPS-Basisadresse einschließlich eines gegebenenfalls benötigten Pfades
   eintragen. Die Auswahl bleibt auch für `iqb-testcenter6.de` bis
   `iqb-testcenter10.de` verwendbar.
3. Mit einem freigegebenen Testkonto anmelden, den vorgesehenen Test-Arbeitsbereich
   auswählen und einen kleinen Import in einen dafür freigegebenen Kodierbox-
   Arbeitsbereich durchführen. Anmeldung, Gruppen und ausgewählte Dateien bzw.
   Antworten und Logs getrennt kontrollieren.

Ein erfolgreicher Abruf von `/api/version` belegt HTTPS-Erreichbarkeit und
Zertifikatsvertrauen. Er ersetzt keinen angemeldeten Importtest. Die lokalen
automatisierten Tests verwenden synthetische Daten und einen eigenen HTTPS-Server.

Bei `self signed certificate` oder `unable to verify the first certificate`
CA-Bundle, Dateirechte, Containerpfad und Server-Zertifikatskette prüfen. Bei einem
Hostnamenfehler die korrekte Basisadresse oder das Serverzertifikat korrigieren.
Die Zertifikatsprüfung bleibt aktiv; `NODE_TLS_REJECT_UNAUTHORIZED=0` ist keine
Migrationslösung.

Referenzen: [Node: NODE_EXTRA_CA_CERTS](https://nodejs.org/api/cli.html#node_extra_ca_certsfile),
[Docker: Bind-Mounts](https://docs.docker.com/reference/compose-file/services/#volumes).
