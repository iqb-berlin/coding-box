# Dokumentationskonsolidierung zu #571

Geprüfte Basis: `develop` bei `b38ca4c3e9f4ebb796ddb74f41003a6fc412ed72`.
#571 bleibt offen; die Konsolidierung ist noch nicht separat abgenommen.

## Umfang

DE-/EN-Handbücher mit konsistenten Vorlagenbeispielen, globalem `/api`-Präfix,
browsergebundenem Einmalcode, Exchange/Refresh, aktueller Token-Speicherung,
Provider-Voraussetzungen und Workspace-Token-Grenzen. Entwicklung, produktive
Neuinstallation und Upgrade sind getrennt. Der vorhandene Abschnitt F06 bleibt
erhalten. Die Upgrade-/Restore-Anleitung hat eine englische Fassung erhalten.

Die bestätigten Abnahmen von #564 und #565 sind mit ihren Grenzen verlinkt;
#569/#570 bleiben eigenständige Aufgaben. Insbesondere ist `replay:read` durch
den bestehenden Statistik-POST bewusst nicht pauschal schreibfrei. Die
bereitgestellte Client-Konfiguration mit öffentlichem Client, Wildcard-Defaults
und 53-Tage-Client-Override wird als tatsächlicher Export beschrieben, nicht als
empfohlene Produktionskonfiguration.

## Zuordnung zu den Kriterien

| Kriterium aus #571 | Konsolidierter Nachweis |
| --- | --- |
| EN-/DE-Beispiele und Login-/Callback-/Exchange-/Refresh-Verhalten | Beide Handbücher, Abschnitte 2.1 und 3; Abgleich mit Controller, OIDC-Service und Frontend-AuthService. |
| Issuer/Realm, interne Endpunkte und historische Pfade | Identische Env-Beispiele für Produktion und Compose-Entwicklung, mit expliziter Trennung öffentlicher und interner Adressen. |
| Env-Variablen, Client, Rollen und `/api/auth/callback` | Variablentabelle, konkrete Callback-Adressen, Export-/Rollenbeschreibung und Client-/JWT-Voraussetzungen. |
| Getrennte Entwicklung, Neuinstallation und Upgrade | Abschnitt 2.3 und jeweiliger Upgrade-/Restore-Pfad in Abschnitt 7. |
| Übernahme #564/#565, Sicherung und Rücknahme | Dauerhafte Abnahmevermerke, Live-Protokoll/JSON zu #565 und klar benannte Beweisgrenzen. |
| Sichere Fehlerdiagnose | Erhaltene F06-Anleitung und konsolidierte vorangehende Troubleshooting-Kapitel; keine CORS-Plugin-Umgehung und kein pauschaler Realm-Neuimport. |
| Rechte und Providergrenzen aus #569/#570 | Abschnitt 6 mit Links, bestehenden Scopes/Laufzeiten/Legacy-Option, Replay-Ausnahme und belegten Keycloak-Annahmen. Keine separate Abnahme dieser Tickets behauptet. |
| Geprüfte Beispiele und Links | Ergebnisse unten; ausschließlich Vorlagen, Platzhalter und bereinigte Nachweise. |

## Prüfung

- **Sieben Compose-Konfigurationen grün:** ausgelieferte Dev-/Prod-Vorlagen,
  je zwei DE-/EN-Beispiele und die im Installer umbenannte Produktionsbasis.
  Mit echtem `docker compose config --format json` und privaten temporären
  Env-Dateien geprüft. Keine Docker-Daemon-/Dienstoperationen ausgeführt.
- **DE-/EN-Env-Beispiele bytegleich.** Sämtliche gerenderten Auth-Werte stimmen
  mit den jeweiligen Vorlagen überein. Dokumentierte Abweichungen: reservierter
  Beispielhostname und leeres Geheimnis für den öffentlichen Beispielclient.
  Die Prüfung umfasst Issuer, interne Token-/JWKS-Adressen, Callback,
  Backend-/Worker-Weitergabe und fehlende Provider-Secrets im Frontend.
- **70 lokale Links und sechs externe Ticket-/Kommentarlinks geprüft.** Lokale
  Ziele existieren; externe Verweise wurden über ihre GitHub-API-Ressourcen
  zurückgelesen. Zwölf Shell-Blöcke wurden mit `bash -n` auf Syntax geprüft.
  Zustandsändernde Installer-, Start-, Migrations- und Restore-Schritte wurden
  nicht ausgeführt. Die drei zustandsfreien Compose-Renderbefehle wurden mit
  temporären Dateien bzw. dem tatsächlich umbenannten Basisnamen geprüft.
- **Auth-Verträge abgeglichen:** dokumentierte Routen im Controller vorhanden;
  Browser-Challenge, Code/Verifier, Refresh, Token-Speicherung, Redis-TTLs,
  Client-/Issuer-Prüfung und Statistik-Scope-Ausnahme mit dem Quellstand verglichen.
  Beide vorhandenen F06-Abschnitte blieben bytegleich erhalten.
- **Backend: sechs Suiten / 131 Tests grün.** Frontend danach separat:
  **zwei Suiten / 53 Tests grün.** Ohne Task-/Jest-Cache ausgeführt.
- `git diff --check` grün. Heuristische Prüfung ohne Fund wörtlicher JWTs oder
  Private Keys; neue Beispiele enthalten keine realen Zugangsdaten und verwenden
  reservierte Beispieladressen. Das ist kein vollständiger Repository-Secretscan.
- Fingerprints der acht vorher vorhandenen parallelen Dateien im isolierten
  Arbeitsverzeichnis und der 59 geänderten/unversionierten Dateien im Hauptcheckout
  unverändert. Kein Anwendungsserver angesprochen und keine Sicherung verändert.

Gezielte Vertragstests aus der Repository-Wurzel, nacheinander:

```bash
NX_DAEMON=false NX_NO_CLOUD=true npx --no-install nx test backend --runInBand --testPathPatterns='(environment.validation|auth.controller|oidc-auth.service|workspace-token.strategy|jwt-or-workspace-token-auth.guard|jwt.strategy).spec.ts$' --skipNxCache --cache=false
```

Danach separat:

```bash
NX_DAEMON=false NX_NO_CLOUD=true npx --no-install nx test frontend --runInBand --testPathPatterns='(core/services/auth.service|app.component).spec.ts$' --skipNxCache --cache=false
```

Die einmaligen lokalen Konfigurations-/Linkprüfer wurden über `nx exec` ausgeführt.
Die Konfigurationsprüfung ersetzt Variablen in temporären Vorlagen an ihrer
ursprünglichen Position, damit Compose ihre abhängigen Werte korrekt auflöst;
kein nachträgliches Anhängen einer Hostname-Änderung hinter bereits interpolierten
OIDC-Werten. Rohe Testlogs und Prüfhelfer liegen nur im temporären lokalen
Prüfverzeichnis `/tmp/auth-571-doc-check`.

## Beweisgrenzen

Dies ist eine Prüfung der Dokumentation und Konfiguration. Die bisherigen
Live-Abnahmen werden referenziert, nicht erneut ausgeführt. Kein vollständiger
interaktiver Produktionsinstaller, kein neues TLS-Produktionsdeployment,
Keycloak-Hauptversionswechsel, zusätzlicher Provider oder produktiver Queue-
Restore wird dadurch belegt. Die aktuelle Änderung betrifft ausschließlich
Dokumentation; Merge, Remote-CI und fachliche Abnahme sind getrennte Schritte.

## Diff-Review

Die beiden Sprachfassungen, die neue englische Upgrade-Anleitung und sämtliche
Verweise wurden gegen den oben genannten Quellstand geprüft. Dabei wurden zwei
Betriebshinweise präzisiert: Die Entscheidung gegen einen Realm-Import muss vor
dem Installer-Aufruf fallen; ein eigener Compose-Projektname isoliert das feste
Netzwerk `app-net` und Host-Ports nicht. Beide Sprachfassungen nennen diese Grenzen
vor den jeweiligen zustandsändernden Schritten.

Im abschließenden Review verblieben keine blockierenden Befunde. Der Diff enthält
ausschließlich Dokumentation; Anwendungslogik, Vorlagen und bestehende Sicherungen
wurden nicht verändert. Die fachliche Abnahme von #571 bleibt ausstehend.
