# Token-Rechte #569: Dokumentations- und Testnachweis

Prüfdatum: 25.10.2026. Basis: frisch abgeglichenes `origin/develop` bei
`0f08d70d2cc1f9bebc852d9996ac01657368ca4a`.
Die Ergänzungen sind lokal geprüft. [#569](https://github.com/iqb-berlin/coding-box/issues/569)
bleibt bis zur ausdrücklich bestätigten Abnahme offen.

## Abgleich mit den Akzeptanzkriterien

| Kriterium | Umsetzung und Nachweis |
| --- | --- |
| Unterstützte externe Zugriffe | Die [DE-Rechteübersicht](../workspace-api-token-rights-de.md) und [EN-Rechteübersicht](../workspace-api-token-rights.md) grenzen Workspace-Tokens von OIDC-Benutzersitzungen und vom Provider-Tokenaustausch ab. Ein neuer eigenständiger Maschinenzugang ist gemäß Ticketumfang nicht Teil dieser Ergänzung. |
| Verbindliche Rechte-Matrix | 25 freigegebene Routen mit HTTP-Methode, Pfad, R/S/C-Freigabe und Workspace-/Job-/Rollenprüfung; Scope-Laufzeiten, Kombinationen und ausdrückliche Ausschlüsse. Beide Sprachfassungen werden gegen denselben unabhängig festgelegten Testvertrag geprüft. |
| Ausstellung, Verwendung, Ablauf und Legacy-Übergang | HTTP-Beispiele mit Platzhaltern, eigene/fremde Identität, Ausstellungsjournal, JSON-String als Bearer, Laufzeitgrenzen und fehlender Workspace-Refresh. Dokumentierter Betreiberablauf für den Legacy-Abschalter einschließlich kontrollierter Rückkehr bei übersehenen Verbrauchern. |
| Abgleich mit Guard-/Strategietests | [262 Vertragsfälle](../../apps/backend/src/app/auth/workspace-token-permissions.spec.ts) und [31 HTTP-Fälle](../../apps/backend/src/app/auth/workspace-token-permissions.integration.spec.ts) ergänzen die vorhandenen Tests. Alle acht Kombinationen der drei Scopes einschließlich leerer Kombination, unbekannte Scopes, geschützte Verwaltungsrouten und die vollständige Inventur expliziter Freigaben werden geprüft. |
| Replay-/Frontend-Ausnahmen | Statistik-POST mit R bleibt bewusst zulässig. C umfasst tatsächlich Job-Lese- und Schreibaktionen, mit zusätzlichen Rollen-/Jobprüfungen. Scope-lose Legacy-Tokens erhalten R; vorhandene Scope-Arrays bleiben erhalten. Die drei Frontend-Profile R, R+S und R+S+C sind beschrieben und bestehende Frontend-Tests erneut geprüft. |

Die bisherigen DE-/EN-Betriebshandbücher verlinken die Matrix und korrigieren den
zu engen bisherigen Hinweis, C erlaube nur das Lesen von Job-Notizen. Die bereits
abgenommenen F06-Diagnoseabschnitte sind bytegleich erhalten.

## Testaufbau und Ergebnisse

Die HTTP-Prüfung verwendet echte Produktionscontroller, Passport-Strategien,
Workspace-/AccessLevel-Guards, `AuthService` und `CodingJobAccessService`.
Repositories und fachliche Schreibdienste sind Testdoubles. Eine kurzlebige lokale
Nest-Anwendung und ein lokaler JWKS-Server verwenden ausschließlich synthetische
Schlüssel und Identitäten. Bestehende Konten oder Anwendungsdaten werden nicht
verwendet.

Zusätzliche HTTP-Fälle belegen insbesondere:

- aktuelle Workspace-Mitgliedschaft und tatsächliche Kodierzuweisung;
- die zusätzliche Managerprüfung des allgemeinen Job-Updates sowie des
  `issueReview`-Zweigs, ohne allgemeine Kodierrechte durch die Managerrolle;
- keine Token-Delegation oder Verwaltungsfreigabe selbst mit allen drei Scopes;
- OIDC-basierte Ausgabe mit Journalisierung ohne Tokenwert, gültigem modernem
  Token und Ablehnung ungültiger Ausgabeparameter;
- Legacy mit und ohne Scope-Array sowie Ablehnung beider alten Formen nach
  Neustart der isolierten Anwendung mit abgeschalteter Kompatibilität, bei
  weiterhin funktionierenden modernen Tokens.

| Prüfung | Ergebnis |
| --- | --- |
| Vollständige Backend-Testsuite | 229 Suites / 3.817 Tests bestanden; 9 vorhandene Suites / 75 Tests übersprungen. Alle 293 neuen Fälle bestanden. |
| Backend-Lint | Bestanden. |
| Nx-Testeingaben | Beide Matrix-Dateien sind explizite Eingaben des Backend-Testtargets. Ein unveränderter Wiederholungslauf verwendete den Cache; eine kontrollierte Änderung jeder Sprachfassung löste jeweils einen neuen erfolgreichen Testlauf aus. Die Dokumente wurden danach exakt wiederhergestellt. |
| Frontend-Kompatibilität | 4 Suites / 166 Tests bestanden: `AppService`, Auth-Session-Konfiguration, Replay und Workspace-Einstellungen. |
| Dokumentationsabgleich | Beide Tabellen entsprechen exakt dem Route-/Scope-Vertrag. 72 lokale Links und 7 unterschiedliche Issue-/Kommentarlinks geprüft; DE-/EN-Env-Beispiele identisch. Keine JWT-Werte oder privaten Schlüssel im heuristischen Dokumentationscheck gefunden. |
| Compose-Konfiguration | Vier reine Konfigurationsprüfungen: Dev/Prod jeweils mit Legacy `true` und 90 Tagen sowie `false` und 60 Tagen. Beide Policy-Variablen kommen korrekt bei API und Export-Worker an. Keine Dienste gestartet oder verändert. |

Reproduzierbare Nx-Prüfungen, jeweils einzeln nacheinander ausführen:

```sh
NX_DAEMON=false NX_NO_CLOUD=true npx --no-install nx test backend --runInBand --testPathPatterns='workspace-token-permissions.*spec.ts$' --skipNxCache --cache=false
NX_DAEMON=false NX_NO_CLOUD=true npx --no-install nx test backend --runInBand --skipNxCache --cache=false
NX_DAEMON=false NX_NO_CLOUD=true npx --no-install nx lint backend --skipNxCache
NX_DAEMON=false NX_NO_CLOUD=true npx --no-install nx test frontend --runInBand --testPathPatterns='(core/services/(app.service|auth-session.config)|replay/components/replay/replay.component|ws-admin/components/ws-settings/ws-settings.component).spec.ts$' --skipNxCache --cache=false
```

## Prüfgrenzen und Abnahme

Geändert sind Dokumentation und Tests; produktive Berechtigungsregeln und
Token-Laufzeiten werden hierdurch nicht geändert. Die HTTP-Tests sind keine
Browser- oder Zielumgebungsabnahme mit realem Provider und realen Daten. Die
vollständige Backend-Suite enthält die genannten übersprungenen Tests.
Ein Build oder erneuter Browserlauf ist für diese Ergänzung nicht erfolgt.

Der Legacy-Schalter wurde ausschließlich in der isolierten HTTP-Prüfung und in
gerenderten Compose-Konfigurationen umgeschaltet. Kein Betreiberwechsel und
keine Schlüsselrotation wurden ausgeführt. Eine spätere Abschaltung setzt das
private Verbraucher-Inventar und den dokumentierten Deploymentablauf voraus.

Review der Ergänzungen: keine verbleibenden blockierenden Befunde. Dabei wurde
die zuvor fehlende Cache-Abhängigkeit von den beiden Matrix-Dateien ergänzt und
durch die oben beschriebenen Wiederholungsläufe geprüft.

Remote-CI und fachliche Abnahme sind getrennte Nachweise; Ergebnisse der Remote-CI
werden im zugehörigen PR geführt. Die bisher bestätigten Abnahmen anderer
Auth-Tickets werden dadurch nicht erweitert. Die separate Entscheidung über #569
bleibt erforderlich.
