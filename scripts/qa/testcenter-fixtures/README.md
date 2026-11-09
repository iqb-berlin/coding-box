# Lokale Testcenter-Kompatibilitätsprüfung

Diese Compose-Gruppe ist ausschließlich eine lokale Testumgebung. Sie verwendet
fest gebundene offizielle Backend-Images, eigene Datenbanken im Arbeitsspeicher
und synthetische Zugangsdaten. Nur der Gateway ist auf `127.0.0.1` erreichbar.
Ein Stopp der Datenbanken verwirft deren Testdaten. Einen neuen, unbenutzten
Compose-Projektnamen verwenden; keine vorhandene Anwendungsgruppe angeben.

Voraussetzungen: laufendes Docker Desktop, mehrere GB freier Speicher und RAM,
installierte Kodierbox-Abhängigkeiten und Node laut `.nvmrc`. Die Befehle aus dem
Kodierbox-Hauptverzeichnis ausführen. Die Backend-Images benötigen auf arm64
AMD64-Emulation. Bei belegtem Port vor allen Befehlen `TESTCENTER_FIXTURE_PORT`
auf einen freien Port setzen; Standard ist 43154.

## Gegenstellen vorbereiten

```sh
fixture_project=testcenter-compatibility-fixture
fixture_compose=scripts/qa/testcenter-fixtures/compose.yaml
docker compose -p "$fixture_project" -f "$fixture_compose" up -d
```

Die Datenbankprüfungen werden vor dem Start der Backends abgewartet. Anschließend
die Anwendungsinitialisierung abwarten; jeder Versionsabruf muss die erwartete
Version als JSON liefern:

```sh
for major in 17 18 19; do
  curl --fail --silent --show-error --max-time 5 \
    --retry 30 --retry-all-errors --retry-delay 2 \
    "http://127.0.0.1:${TESTCENTER_FIXTURE_PORT:-43154}/tc${major}/api/version"
done
```

Nur einmal pro frisch angelegter Umgebung die Antwort- und Logdaten einfügen:

```sh
for database in tc17 tc18; do
  docker compose -p "$fixture_project" -f "$fixture_compose" exec -T \
    -e MYSQL_PWD=fixture-only-password mysql mysql -utestcenter "$database" \
    < scripts/qa/testcenter-fixtures/seed-mysql.sql
done
docker compose -p "$fixture_project" -f "$fixture_compose" exec -T \
  postgres psql -U testcenter -d tc19 -v ON_ERROR_STOP=1 \
  < scripts/qa/testcenter-fixtures/seed-postgres.sql
```

## Kodierbox-Client ausführen

```sh
(
for major in 17 18 19; do
  fixture_password=fixture-only-password
  if [ "$major" = 17 ]; then fixture_password=user123; fi
  TESTCENTER_LIVE_URL="http://127.0.0.1:${TESTCENTER_FIXTURE_PORT:-43154}/tc${major}" \
  TESTCENTER_LIVE_USERNAME=super \
  TESTCENTER_LIVE_PASSWORD="$fixture_password" \
  TESTCENTER_LIVE_WORKSPACE=1 \
  TESTCENTER_LIVE_GROUP=compatibility-fixture \
  npx nx run backend:verify-testcenter-live || exit 1
done
)
```

Alle drei Läufe müssen Exit-Code 0 liefern, mit `authenticated`, `groupFound` und
`fileDownloaded` jeweils `true`, einer Antwortzeile, zwei Logzeilen, einer
geparsten Antwort, drei Log-/Sitzungseinträgen und null Parserwarnungen. Ein
fehlgeschlagener Lauf beendet die Schleife und ist kein Gesamterfolg.

Die reinen Methoden-/Pfadprotokolle belegen den Anmeldeweg:

```sh
docker compose -p "$fixture_project" -f "$fixture_compose" logs --no-log-prefix gateway
```

Bei 17: `PUT /tc17/api/session/admin 200`. Bei 18/19: direkter Versuch mit HTTP
400, anschließend `POST .../session/challenge 200` und `PUT .../session 200`.
Anfragekörper und Tokens werden am Gateway nicht protokolliert.

Für den negativen Kennwortfall den echten Anmeldehelfer gegen dieselben lokalen
Gegenstellen aufrufen. Dieser technische Zusatz prüft die HTTP-422-Abbildung;
die Browserregression prüft gesondert den Erhalt der Kodierbox-Sitzung:

```sh
node - <<'JS'
const assert = require('node:assert/strict');
require('reflect-metadata');
require('ts-node').register({ project: 'apps/backend/tsconfig.app.json', transpileOnly: true });
const { HttpService } = require('@nestjs/axios');
const { authenticateTestcenter } = require('./apps/backend/src/app/database/services/test-results/testcenter-authentication.ts');
(async () => {
  for (const major of [17, 18, 19]) {
    const base = `http://127.0.0.1:${process.env.TESTCENTER_FIXTURE_PORT || 43154}/tc${major}`;
    let status;
    try {
      await authenticateTestcenter(new HttpService(), base,
        { username: 'super', password: 'deliberately-invalid-fixture-password' }, { timeout: 30000 });
    } catch (error) { status = error.getStatus?.(); }
    assert.equal(status, 422);
    console.log(JSON.stringify({ major, invalidCredentialsStatus: status }));
  }
})().catch(() => { console.error('Invalid-credential verification failed'); process.exitCode = 1; });
JS
```

## Abschluss und Grenzen

Die neu angelegte Gruppe nach den Prüfungen stoppen:

```sh
docker compose -p "$fixture_project" -f "$fixture_compose" stop
```

Der Prüfclient schreibt keine Ergebnisse in eine Kodierbox-Datenbank. Ein
vollständiger Import mit Persistenz, ein produktives Deployment und die fachliche
Abnahme sind separate Nachweise. Das lokale HTTP-Setup ersetzt auch keine
HTTPS-Prüfung. Bei Testcenter 19 ist die XML-Schemavalidierung für die isolierte
Sample-Vorbereitung deaktiviert; der Admin-Challenge-Schutz bleibt aktiviert.

Siehe [Prüfbericht](../../../docs/qa/testcenter-instances-2026-11-04.md) und
[Zähler mit Image-Digests](../../../docs/qa/testcenter-compatibility-2026-11-04.json).
