# Replay Health Check

Der Replay-Health-Check prueft fuer einen Workspace alle erzeugbaren Replay-Kandidaten in zwei Stufen:

- Payload-Check im Backend
- optionaler Browser-Check gegen eine echte Frontend-Instanz

## Was geprueft wird

### Payload-Check

- Replay-URL-Erzeugung auf Basis echter Response-Daten
- Vorhandensein von `UNIT.VOUD`
- Vorhandensein der Unit-Datei
- Aufloesung von Testperson, Booklet und Unit fuer den Replay-Payload
- Extraktion und Aufloesung des benoetigten Players

### Browser-Check

- Oeffnen der echten Replay-URL gegen `--baseUrl`
- Redirects weg vom Replay, z. B. nach `#/home?error=token_invalid`
- sichtbare `snackbar-error`-Meldungen im Frontend
- erfolgreiches Rendering bis der Replay-Container den Status `ready` erreicht

Der Browser-Check laeuft nur fuer Replays, deren Payload-Check bereits erfolgreich war.

## Was im Browser-Lauf nicht passiert

- automatische Vermischung mit den normalen Replay-Statistiken  
  Der Browser-Lauf haengt `healthCheck=1` an die URL. Dadurch ueberspringt das Frontend das Speichern von Replay-Statistiken fuer diese automatischen Pruefungen.

## Aufruf

```bash
nx run backend:replay-health --workspaceId=12
```

Mit `make`:

```bash
make replay-health WORKSPACE_ID=12
```

Mit Begrenzung:

```bash
nx run backend:replay-health --workspaceId=12 --limit=500
```

Nur fuer konkrete Responses:

```bash
nx run backend:replay-health --workspaceId=12 --responseIds=101,202,303
```

JSON-Report schreiben:

```bash
nx run backend:replay-health --workspaceId=12 --output=tmp/replay-health-ws12.json
```

Mit Browser-Check und vorhandenem JWT:

```bash
nx run backend:replay-health --workspaceId=12 --browser --baseUrl=https://coding.example.org --authToken=<jwt> --output=tmp/replay-health-ws12.json
```

Mit sicherem `make`-Target fuer Produktion:

```bash
make replay-health-prod WORKSPACE_ID=12 BASE_URL=https://coding.example.org AUTH_TOKEN=<jwt>
```

Mit Browser-Check und lokal signiertem JWT:

```bash
nx run backend:replay-health --workspaceId=12 --browser --baseUrl=https://coding.example.org --authIdentity=my-identity --screenshotsDir=tmp/replay-health-shots
```

Mit `make` und lokal signiertem JWT:

```bash
make replay-health-prod WORKSPACE_ID=12 BASE_URL=https://coding.example.org AUTH_IDENTITY=my-identity
```

Fuer einen kompletten Produktionslauf ohne das sichere Default-Limit:

```bash
make replay-health-prod-full WORKSPACE_ID=12 BASE_URL=https://coding.example.org AUTH_TOKEN=<jwt>
```

Weitere Browser-Optionen:

- `--authTokenDays=1`
- `--browserConcurrency=3`
- `--browserTimeoutMs=30000`
- `--headed`
- `--screenshotsDir=tmp/replay-health-shots`

Weitere `make`-Variablen:

- `LIMIT=20`
- `RESPONSE_IDS=101,202,303`
- `OUTPUT=tmp/replay-health-prod.json`
- `BROWSER_CONCURRENCY=1`
- `BROWSER_TIMEOUT_MS=30000`
- `SCREENSHOTS_DIR=tmp/replay-health-prod`
- `HEADED=1`
- `AUTH_TOKEN_DAYS=1`

Uebersicht:

```bash
make replay-health-help
```

## Voraussetzungen

- Postgres muss erreichbar sein
- die DB-Variablen kommen aus der Shell oder aus `.env.dev`
- bei lokaler Docker-Entwicklung ist `localhost:5432` der Default-Fallback
- fuer `--authIdentity` wird ausserdem `JWT_SECRET` benoetigt
- fuer `--browser` muss Playwright Chromium installiert sein  
  Einmalig: `npx playwright install chromium`

## Produktion

Fuer einen Produktionslauf braucht der Check:

- Zugriff auf die Produktionsdatenbank oder einen passenden Read-Replica-/Tunnel-Zugang
- dieselbe `workspaceId` wie im Zielsystem
- eine produktive Frontend-URL per `--baseUrl`
- entweder ein gueltiges Produktions-JWT per `--authToken`
- oder `JWT_SECRET` plus eine gueltige Benutzer-`identity` per `--authIdentity`

Empfohlener Minimalaufruf:

```bash
nx run backend:replay-health --workspaceId=12 --browser --baseUrl=https://coding.example.org --authToken=<jwt> --screenshotsDir=tmp/replay-health-prod
```

## Rueckgabecode

- `0`: alle geprueften Payload- und Browser-Kandidaten erfolgreich
- `1`: mindestens ein Replay-Kandidat fehlgeschlagen oder der Lauf selbst ist abgebrochen
