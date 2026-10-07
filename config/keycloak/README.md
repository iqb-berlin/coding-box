# Kodierbox Login-Theme

Das Theme `kodierbox` verwendet das IQB-Logo und die Cyan-Hauptfarbe der
Anwendung (`#006064`). Es erweitert das mit Keycloak ausgelieferte Theme
`keycloak` durch CSS und deutsche/englische Texte. Login, Registrierung,
Feldfehler, Passwort-Reset, E-Mail-Verifizierung und weitere Anmeldeschritte
verwenden die Templates der installierten Keycloak-Version. Es gibt keine
eigenen FreeMarker-Templates und keine ALTCHA-Abhaengigkeit.

Die Styles des Eltern-Themes werden vor `css/kodierbox.css` geladen. Das Logo
stammt aus `apps/frontend/src/assets/images/IQB-LogoA.png`; bei einem neuen
Anwendungslogo auch `themes/kodierbox/login/resources/img/iqb-logo.png` ersetzen.

## Lokale Vorschau

Im Repository-Verzeichnis starten:

```sh
docker compose -f config/keycloak/docker-compose.theme-preview.yaml up -d
```

Login auf Deutsch mit aktivierter Mehrsprachigkeit:

<http://localhost:8087/realms/coding-box-i18n/protocol/openid-connect/auth?client_id=coding-box&redirect_uri=http%3A%2F%2Flocalhost%3A8087%2Ftheme-callback&response_type=code&scope=openid>

Login ohne aktivierte Mehrsprachigkeit (Keycloak-Standardsprache Englisch):

<http://localhost:8087/realms/coding-box/protocol/openid-connect/auth?client_id=coding-box&redirect_uri=http%3A%2F%2Flocalhost%3A8087%2Ftheme-callback&response_type=code&scope=openid>

Die Vorschau ist ausschliesslich lokal auf Port 8087 erreichbar. Sie verwendet
zwei eigene Test-Realms, eine temporaere Datenbank und keinen SMTP-Server.
Testkonten verschwinden beim Stoppen des Containers. Der Callback ist keine
Anwendung; nach erfolgreichem Login ist dort eine 404-Antwort mit einem
Autorisierungscode in der URL zu erwarten.

Die Standardversion ist 22.0.5, passend zu den vorhandenen Realm-Exporten.
Eine andere Version kann vor dem Start gewaehlt werden:

```sh
KEYCLOAK_THEME_VERSION=26.4.0 docker compose \
  -f config/keycloak/docker-compose.theme-preview.yaml up -d
```

Vorschau beenden:

```sh
docker compose -f config/keycloak/docker-compose.theme-preview.yaml down
```

## In Bestehenden Keycloak Einbinden

Das Theme muss in dem Keycloak-Container verfuegbar sein, auf den die
Anwendung ueber `KEYCLOAK_URL` verweist. Die Kodierbox-Compose-Dateien enthalten
keinen eigenen Keycloak-Service; dieser wird in der Traefik-Installation
betrieben. Die Exporte unter `local/realm/iqb.json` und `remote/realm/iqb.json`
betreffen den Infrastruktur-Realm `iqb` und aktivieren das Theme nicht fuer
den Anwendungs-Realm `coding-box`.

In der Traefik-Compose-Konfiguration kann
`config/keycloak/docker-compose.theme.yaml` als zusaetzliches Override verwendet
werden. `KODIERBOX_THEME_DIR` muss ein absoluter Pfad auf dem Docker-Host sein,
zum Beispiel `/home/iqb/coding-box/config/keycloak/themes/kodierbox`. Der
Mount ist schreibgeschuetzt und betrifft nur das Verzeichnis `kodierbox`.
Die bestehenden Compose-Dateien, Projektoptionen und Umgebungsdateien der
Installation beibehalten und das Override als letzte Datei hinzufuegen:

```sh
export KODIERBOX_THEME_DIR=/home/iqb/coding-box/config/keycloak/themes/kodierbox
# Im Verzeichnis der Traefik-Installation:
docker compose --env-file .env.traefik \
  -f docker-compose.yaml -f docker-compose.traefik.prod.yaml \
  -f /home/iqb/coding-box/config/keycloak/docker-compose.theme.yaml \
  up -d keycloak
```

Dieses Override auch bei spaeteren Updates/Neustarts verwenden. Bei
Installationen, die Dateien einzeln statt per Git beziehen, das gesamte
Verzeichnis `themes/kodierbox` und das Override ebenfalls bereitstellen.

Danach in der Keycloak-Admin-Konsole:

1. Den Realm aus `KEYCLOAK_REALM` auswaehlen (Standard: `coding-box`).
2. Unter **Clients > coding-box > Settings > Login theme** `kodierbox` setzen.
   Bei abweichendem `KEYCLOAK_CLIENT_ID` den entsprechenden Client auswaehlen.
3. Soll das Theme fuer alle Clients dieses Realms gelten, auch unter
   **Realm settings > Themes > Login theme** `kodierbox` setzen. Abweichende
   Client-Einstellungen haben Vorrang.
4. Fuer Deutsch unter **Realm settings > Localization** Internationalisierung
   aktivieren, `de` und `en` freigeben und `de` als Standardsprache setzen.

Ein geaenderter JSON-Export aktualisiert keinen bereits vorhandenen Realm
beim normalen Start mit `--import-realm`. Deshalb bestehende Einstellungen
gezielt in der Admin-Konsole aendern, statt den Realm erneut zu importieren.

## Pruefung Und Ruecknahme

Historische Pruefnotiz aus der Theme-Entwicklung, bei der Abtrennung dieses
Pakets nicht erneut im Browser bestaetigt: Mit Keycloak 22.0.5 wurden Login mit/ohne
Mehrsprachigkeit, Sprachwechsel Deutsch/Englisch, sichtbare Login- und
Registrierungsfehler, erfolgreiche Registrierung und erneuter Login mit
Autorisierungscode-Austausch sowie das Passwort-Reset-Formular. Die Ansichten
wurden bei 1440, 375 und 320 Pixeln Breite geprueft. Ein E-Mail-Versand ist
ohne SMTP-Konfiguration nicht Teil dieser Vorschau. Aktuell erneut geprueft
sind nur Compose-Konfiguration, Realm-JSON, Logo und schreibgeschuetzte
Mounts. Der Docker-Daemon war fuer einen erneuten Login-Test nicht erreichbar.

Vor einer produktiven Aktivierung die tatsaechlich eingesetzte
Keycloak-Version pruefen und das Theme mit dieser Version lokal testen:
Login mit/ohne Mehrsprachigkeit, falsches Passwort, unvollstaendige
Registrierung mit sichtbaren Feldfehlern, erfolgreiche Registrierung,
Passwort-Reset sowie mobile Ansicht und Tastaturbedienung. Die Registrierung
und der Reset-Link folgen weiterhin den Einstellungen des jeweiligen Realms.

Die zuvor gewaehlten Realm- und Client-Themes notieren. Zur Ruecknahme diese
Einstellungen wieder auswaehlen. Vor dem Entfernen des Theme-Mounts alle
Verweise auf `kodierbox` zuruecksetzen. Produktions-Caching bleibt aktiviert;
die Vorschau deaktiviert es fuer die lokale CSS-Entwicklung.

Referenzen: [Keycloak Themes](https://www.keycloak.org/ui-customization/themes),
[Realm-Import](https://www.keycloak.org/server/importExport).
