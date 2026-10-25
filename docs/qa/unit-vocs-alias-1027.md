# Unit-/VOCS-Aliasabgleich – technische Prüfung zu #1027

Status: lokal technisch geprüft; fachliche Abnahme und Deployment stehen aus. Ticket bleibt offen.

## Ausgangspunkt und isolierte Reproduktion

Basis ist `origin/develop` auf `0a35d2512e0198e5ff5e512e4b07b18cc536f1e9`.
Die Änderungen liegen auf `issue-1027-unit-vocs-alias-check` in einem separaten Checkout.
Testinstanz, vorhandene Kodierungen, Sicherungen und parallele Änderungen wurden nicht verwendet oder verändert.

Die synthetische MMV032-Konstellation verwendet die technischen IDs aus dem Ticket:

| Technische ID | Unit-Alias | VOCS-Alias |
| --- | --- | --- |
| `text-field-simple_1776092737364_1` | `01a` | `text-field-simple_1` |
| `text-field-simple_1776092748928_1` | `01b` | `text-field-simple_2` |

Zwei zuerst gegen die unveränderte Implementierung ausgeführte Bereitschaftstests schlugen erwartungsgemäß fehl: Der Alias-Konflikt wurde als `READY` akzeptiert. Das galt sowohl für die fehlerhafte Unit allein als auch gemeinsam mit einer gültigen Unit. Die 317 Antworten werden dabei als synthetische Kandidatenanzahl abgebildet; die ursprünglichen Produktionsdaten werden nicht nachgebildet oder geladen.

## Gemeinsame Prüfung und Startblockade

`unit-coding-scheme-compatibility.util.ts` prüft die ursprünglichen technischen IDs und öffentlichen Aliase, bevor der Autocoder intern Aliase durch technische IDs ersetzt:

- fehlende und doppelte technische Basis-IDs;
- unterschiedliche effektive Aliase zwischen Unit und VOCS;
- doppelte Unit-Aliase und unzulässige doppelte VOCS-Ausgabealiase;
- nicht vorhandene technische Ableitungsquellen.

Aliase sind laut den vorhandenen Verträgen optional. Fehlt ein Alias, gilt die technische ID. Dadurch wird ein fehlender Alias erkannt, wenn die Gegenseite einen anderen öffentlichen Alias verwendet; ein gültiges Paar mit beidseitig implizitem Alias bleibt zulässig. Vergleiche berücksichtigen wie das bestehende Autocoder-Routing Groß-/Kleinschreibung nicht.

Die bereits vorhandene Shadowing-Prüfung wird wiederverwendet. Zulässige BASE-/Derived- und strukturelle BASE_NO_VALUE-/Derived-Konstellationen bleiben erlaubt. Für virtuelle ältere BASE_NO_VALUE-Variablen bleibt die bestehende Engine-Prüfung im konfigurierten Kompatibilitätsmodus maßgeblich.

Dieselbe Prüfung wird verwendet:

1. Bei der Testdateien-Validierung: Fehler erscheinen an der betroffenen Unit und am referenzierten VOCS, jeweils mit Unit, Schema, technischer ID und beiden Aliasen. Bei gemeinsam verwendeten VOCS werden die Units einzeln geprüft. Die vorgeladene Referenzstruktur behält hierfür nur IDs und Aliase, keine zusätzlichen vollständigen Unit-XML-Dateien.
2. In der Autocoder-Bereitschaft: Ein fehlerhaftes Schema blockiert auch bei anderen kodierbaren Units den Start. Bereitschaft wird pro Unit-/VOCS-Dateipaar einmal abgeglichen.
3. Im Worker-Preflight: Der Bereitschaftsfilter prüft alle Units mit eingehenden Antworten und bricht bei einem Kompatibilitätsfehler ab. Auch Antworten mit inzwischen veraltetem Alias dürfen nicht vorher unbemerkt herausgefiltert werden. Zusätzlich erfolgt der Abgleich der aktuellen Unit über das übergebene Transaktions-Repository, vor Kodierung und erstem Schreiben. Fehlende oder mehrdeutige Unit-Dateien werden nicht akzeptiert.

Keine automatische Alias-Korrektur, kein Umschreiben von Antworten oder Kodierergebnissen, keine zusätzliche Upload-Sperre beim Austausch einzelner Dateien.

Die Testdateien-Fingerprint-Version steigt auf 6, der Bereitschafts-Cache auf `coding_readiness:v3`. Alte positive Prüfergebnisse werden damit nicht übernommen.

## Nachweise

- Rot-Nachweis: zwei MMV032-Bereitschaftsfälle gegen den unveränderten Stand, `READY` statt `BLOCKED`.
- Gemeinsame Prüflogik: MMV032 mit beiden Alias-Konflikten, fehlende/implizite Aliase, doppelte IDs/Aliase, fehlende Quellen, gültige Ableitungsketten, beide zulässigen Shadowing-Muster und ungültiges XML.
- Testdateien-Service: öffentliche Validierung mit synthetischen TestTakers-/Booklet-/Unit-/VOCS-Dateien; beide betroffenen Units und das gemeinsame VOCS erhalten die Diagnose. Eingaben bleiben unverändert.
- Bereitschaft und Startprüfung: fehlerhafte Unit allein und gemeinsam mit einer gültigen Unit führen zu `BLOCKED` bzw. einer Startablehnung.
- Worker: Alias-Konflikt bricht vor Engine-Aufruf, Schreibtransaktion und Ergebnis-Persistierung ab.
- Dateizugriff: Workspace-Filter und Transaktions-Repository, fehlende/mehrdeutige Dateien sowie der erlaubte implizite Alias sind getestet.

### Lokale Ergebnisse (25.10.2026)

| Prüfung | Ergebnis |
| --- | --- |
| Vollständiger Backend-Lauf nach Review | 231 Suites / 3.851 Tests bestanden; 75 optionale Tests in 9 Suites übersprungen |
| Gezielter Nachlauf aller betroffenen Services einschließlich Queue-Filter | 6 Suites / 275 Tests bestanden |
| Backend-Lint | bestanden |
| Backend-Strict-Prüfung | bestanden, 0 Diagnosen; 8 Quality-Gate-Tests bestanden; Metadaten aller 43 Entities gültig |
| Backend-Produktionsbuild | bestanden |
| Lokale Cypress-Browserfälle | 2/2 bestanden, Electron headless; ausschließlich synthetische API-Fixtures |
| Abschließender Diff | `git diff --check` bestanden |

Die Backend-Prüfungen wurden über Nx mit `NX_DAEMON=false NX_NO_CLOUD=true` ausgeführt. Vollständige Tests: `npx --no-install nx test backend --runInBand --skipNxCache --cache=false`. Weitere Ziele: `nx lint backend`, `nx run backend:typecheck` und `nx build backend`.

Der gezielte Nachlauf umfasst `unit-coding-scheme-compatibility.util.spec.ts`, `coding-readiness.service.spec.ts`, `workspace-test-files-validation.service.spec.ts`, `coding-process.service.spec.ts`, `workspace-files.service.spec.ts` und `workspace-test-results.service.spec.ts`.

Browseraufruf: `npx --no-install nx e2e frontend --spec=cypress/e2e/unit-vocs-compatibility.cy.ts --browser=electron --port=cypress-auto --skipNxCache`. Frontend- und Backend-Prüfungen liefen getrennt.

#1027 bleibt bis zur bestätigten fachlichen Abnahme offen. Der PR darf das Ticket nicht automatisch schließen.

## Code Review

**Verdict**: APPROVE
**Confidence**: HIGH

### Summary

Der gemeinsame Abgleich ist in Testdateien-Validierung, Bereitschaft und Worker eingebunden. Die vorhandenen Shadowing-Regeln, impliziten Aliase, Workspace-Grenzen und Transaktions-Repositorys bleiben berücksichtigt.

### Findings

Keine verbleibenden blockierenden P0-/P1-Befunde.

### Details

Ein P1-Befund im Queue-Pfad wurde vor dem Commit korrigiert: Der Bereitschaftsfilter entfernte inkompatible Units, bevor deren zusätzlicher Preflight greifen konnte. Drei zuerst fehlschlagende Regressionen wiesen das stille Überspringen nach: fehlerhafte Unit allein, gemeinsam mit einer gültigen Unit und mit bereits veraltetem importiertem Alias. Der finale Filter meldet den Kompatibilitätsfehler, bevor er den Kodierscope bildet. Die Regressionen bestehen nun; der vollständige Backend-Lauf ist grün.

### Recommendation

Technisch zur PR-Prüfung bereit. Remote-CI und fachliche Abnahme sind getrennte Nachweise; die Testinstanz bleibt unverändert.

## Prüfgrenzen

Die Backend-Prüfungen verwenden synthetische Dateien und Repository-Fixtures. Die Browserfälle prüfen die vorhandene Anzeige mit kontrollierten API-Fixtures. Eine Live-Prüfung gegen Produktivdaten oder die Testinstanz sowie ein Deployment gehören nicht zu diesem Nachweis. Die fachliche Abnahme ist weiterhin separat erforderlich.

Refs #1027
