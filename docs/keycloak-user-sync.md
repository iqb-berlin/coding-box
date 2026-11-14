# Automatische Benutzeruebernahme aus Keycloak

Der API-Backend-Prozess uebernimmt aktivierte Konten (`enabled=true`) beim Start
und danach jede Minute. Ein erster Kodierbox-Login ist fuer die Auswahl einer
Person in der Arbeitsbereichsverwaltung nicht mehr erforderlich. Geoeffnete
Nutzerlisten laden alle 30 Sekunden und bei Rueckkehr zum sichtbaren Tab nach.
Die Uebernahme und die Aktualisierung der Anzeige sind zwei getrennte Schritte;
unter normalen Betriebsbedingungen kann die Anzeige daher bis zu etwa 90 Sekunden
nach der Freischaltung brauchen. Laufzeiten der Abfragen kommen hinzu.

## Automatische Einrichtung

Bei einer Neuinstallation mit der mitgelieferten Keycloak-Infrastruktur richtet
der Installer den Lesezugang beim Start der Anwendung automatisch ein. Wird
der Start aufgeschoben, uebernimmt `make coding-box-up` die Einrichtung.
Auch `make dev-up` erledigt dies
mit einer neuen `.env.dev` aus der Vorlage. Es sind keine manuellen Client-,
Rollen- oder Secret-Eingaben fuer den Benutzerimport noetig.

Der Einrichtungsschritt erzeugt einen eigenen vertraulichen Client
`coding-box-user-sync`, schaltet dessen interaktive Login-Flows aus, vergibt
`realm-management/view-users` und prueft den Zugriff tatsaechlich am User-Endpunkt.
Das generierte Secret wird erst nach erfolgreicher Pruefung in der App-env-Datei
gespeichert (Dateirechte `0600`). Vorhandene Secrets werden nicht rotiert.
Wiederholte Starts pruefen den bereits eingerichteten Lesezugang ohne Admin-Login.

Die Admin-Zugangsdaten werden nur zur Einrichtung aus `.env.dev` bzw. der
Infrastrukturdatei `TRAEFIK_DIR/.env.traefik` gelesen. Sie werden weder in die
App-env-Datei kopiert noch an das API-Backend weitergegeben. Das Backend erhaelt
ausschliesslich den eingeschraenkten Dienstzugang.

### Bestehende Installationen

Nach dem Update einmal ausfuehren:

```sh
make coding-box-keycloak-user-sync-setup
# Entwicklung:
make dev-keycloak-user-sync-setup
```

Die Einrichtung ist wiederholbar und verwendet die Admin-REST-API, keinen
erneuten Realm-Import. Bestehende Konten, Rechte und Clients bleiben erhalten.
Ein gleichnamiger fremder Client oder ein Dienstkonto mit weitergehenden
Administrationsrollen fuehrt zum Abbruch statt zu einer stillen Aenderung.
Nach erfolgreicher Einrichtung startet das Ziel die Anwendung mit neu gelesener
Konfiguration. Auf Docker-Hosts ist kein lokal installiertes Node.js oder jq noetig.

Bei extern verwaltetem Keycloak kann die Einrichtung getrennt ausgefuehrt werden:

```sh
bash scripts/keycloak/setup-user-sync.sh .env.coding-box /secure/keycloak-admin.env
```

Die temporaere Admin-Datei enthaelt `ADMIN_NAME` und `ADMIN_PASSWORD`. Alternativ
werden `KEYCLOAK_SETUP_ADMIN_USERNAME`, `KEYCLOAK_SETUP_ADMIN_PASSWORD` und
optional `KEYCLOAK_SETUP_ADMIN_REALM` aus der Prozessumgebung gelesen. Keine
Secrets als Kommandozeilenargumente uebergeben. Standard ist der Admin-Realm
`master`. Anschliessend das API-Backend mit der neuen Konfiguration neu erstellen.
Der Docker-Helfer verwendet standardmaessig das Netzwerk `app-net`; abweichende
Netze koennen mit `KEYCLOAK_SETUP_NETWORK` angegeben werden.
Bei abweichendem internem Admin-Endpunkt kann in der App-env-Datei
`KEYCLOAK_SETUP_BASE_URL` gesetzt werden. Normalerweise wird er aus dem
`OIDC_TOKEN_ENDPOINT` abgeleitet; der oeffentliche `OIDC_ISSUER` bleibt unveraendert.

`KEYCLOAK_USER_SYNC_AUTO_SETUP=true` aktiviert die Einrichtung beim regulaeren
Make-Start. Zum bewussten Abschalten `KEYCLOAK_USER_SYNC_AUTO_SETUP=false` und
`KEYCLOAK_USER_SYNC_ENABLED=false` setzen. Andere OIDC-Provider bleiben in der
Produktionsvorlage opt-in. Ihre Zugangsdaten werden nicht als Keycloak-Adminzugang
verwendet.

## Manuelle Einrichtung

1. Im selben Realm wie die Kodierbox einen vertraulichen Client
   `coding-box-user-sync` mit Service Account anlegen. Interaktive Login-Flows
   werden fuer diesen Client nicht benoetigt.
2. Dem Service Account die Realm-Management-Leserolle `view-users` zuweisen.
   Keine schreibenden Realm-Administrationsrechte vergeben.
3. In `.env.dev` bzw. `.env.coding-box` setzen:

   ```dotenv
   KEYCLOAK_USER_SYNC_ENABLED=true
   KEYCLOAK_USER_SYNC_USERS_URL=https://login.example/admin/realms/coding-box/users
   KEYCLOAK_USER_SYNC_CLIENT_ID=coding-box-user-sync
   KEYCLOAK_USER_SYNC_CLIENT_SECRET=<Service-Account-Secret>
   ```

   `OIDC_TOKEN_ENDPOINT` muss den Token-Endpunkt dieses Realms enthalten,
   `OIDC_ISSUER` dessen oeffentliche, beim normalen Login verwendete Issuer-URL.
   Die Users-URL darf intern erreichbar sein. Bei Hybridbetrieb die Docker-Adresse
   `keycloak` durch eine vom lokalen Backend erreichbare Adresse ersetzen.
4. API-Backend mit der neuen Konfiguration neu starten. Der Export-Worker fuehrt
   keinen Benutzerabgleich aus. Ohne aktivierte Konfiguration bleibt der bisherige
   OIDC-Login fuer andere Identity Provider verwendbar.

## Verhalten

- Nur aktivierte menschliche Konten werden uebernommen; Servicekonten werden
  ausgeschlossen. Alle aktivierten menschlichen Konten des konfigurierten Realms
  sind damit im zentralen Verzeichnis sichtbar.
- Arbeitsbereichsrechte und Jobs werden weiterhin durch die Verwaltung zugewiesen.
  Eine arbeitsbereichsspezifische Kodierendenliste enthaelt weiterhin nur die dort
  zum Kodieren berechtigten Personen.
- Import und Anmeldung ordnen Konten ueber Issuer und Keycloak-ID zu.
  Ein gleichnamiges Konto mit anderer Identitaet wird beim Import uebersprungen
  und bei der Anmeldung abgewiesen.
  Import und erster Login sperren die Neuanlage derselben Identitaet gegenseitig.
- Bestehende interne IDs, Adminrechte, Mitgliedschaften und Jobs bleiben erhalten.
  Der Import legt keine neuen Adminrechte an und aendert nur Benutzernamen und
  mitgelieferte Vor-/Nachnamen. Deaktivierte oder geloeschte Konten werden nicht aus
  der Kodierbox geloescht. Dies ist eine Uebernahme, kein automatischer Rechteentzug.
- Fehler brechen keine laufenden Anmeldungen ab. Der naechste Minutenlauf versucht
  die Uebernahme erneut. Protokolle enthalten Ereignisse und Zaehler, keine Secrets
  oder vollstaendigen Benutzerprofile.
- Hintergrundaktualisierungen der Nutzerlisten erhalten Auswahl und Suchfilter.
  Im Fehlerfall bleiben zuletzt geladene Daten sichtbar; automatische Abfragen
  oeffnen keine globalen Fehlerdialoge.

## Abnahme

Die Startseite unterscheidet eine erfolgreiche Anmeldung ohne Arbeitsbereich von
einem Ladefehler. Die persoenliche Jobliste unterscheidet fehlende Zuweisungen,
fehlende Filtertreffer und Ladefehler. Normale Wartezustaende brauchen keinen
Aktualisieren-Knopf. Alle 30 Sekunden, bei Rueckkehr zum sichtbaren Tab und bei
Rueckkehr der Netzwerkverbindung wird automatisch nachgeladen. Nur bei einem
Ladefehler bleibt "Erneut versuchen" verfuegbar. Neue Arbeitsbereiche werden
auch auf der bereits geoeffneten Startseite erkannt; reine Kodierende gelangen
dann zu ihren persoenlichen Jobs. Hintergrundabfragen erhalten die vorhandenen
Filterelemente. Die Rechteansicht pausiert den automatischen Austausch ihrer
Daten, sobald ungespeicherte Aenderungen vorliegen.

Mit einem eigenen Testkonto: deaktiviert registrieren, in Keycloak aktivieren,
ohne Kodierbox-Login auf das Erscheinen in der bereits geoeffneten Nutzerliste
warten, Arbeitsbereich/Jobs zuweisen und erst dann anmelden. Die interne ID muss
gleich bleiben und die zugewiesenen Jobs muessen sichtbar sein. Wiederholte
Abgleiche, Provider-Ausfall und Rueckkehr zum Tab ebenfalls pruefen.

### Isolierte echte Keycloak-Pruefung

```sh
npx nx run backend:test-keycloak-user-sync-setup
npx nx run backend:verify-keycloak-user-sync-live
```

Der Live-Test startet ausschliesslich eigene temporaere Keycloak- und
PostgreSQL-Container mit zufaelligen Zugangsdaten und lokalen Ports. Er prueft
wiederholbare Einrichtung, stabile Secrets, verweigerte Schreibzugriffe,
Nichtuebernahme deaktivierter Konten, Import durch den echten Minutenzeitplan,
Arbeitsbereichszuweisung vor dem ersten Login sowie den ersten signierten
Keycloak-Login durch den echten Kodierbox-JWT-Guard. Die interne Benutzer-ID und
die Zuweisung muessen erhalten bleiben. Die Container werden danach entfernt.
Mit `KEYCLOAK_SYNC_TEST_IMAGE` laesst sich eine weitere Keycloak-Version pruefen.
Dies ersetzt keine Pruefung einer bestimmten Produktivinstallation.

Grundlagen: [Keycloak Admin REST API](https://www.keycloak.org/docs-api/latest/rest-api/)
und [Service Accounts und Rollen](https://www.keycloak.org/docs/latest/server_admin/index.html).
