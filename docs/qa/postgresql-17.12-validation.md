# PostgreSQL 14.25 und 17.12 – technische Prüfung am 20.11.2026

Geprüft wurde der Stand von PR #1199 auf `develop` (`88a6a4127`) mit lokal
getaggten Kodierbox-Images, Docker Compose und synthetischen Daten.

| Prüfung | Ergebnis |
| --- | --- |
| Neuinstallation mit Release-Vorlage | Das Projektvolume startete auf 17.12. Liquibase konnte das Anwendungsschema anlegen. |
| Bestandskonfiguration ohne `POSTGRES_IMAGE_SUFFIX` | Der reguläre DB-Dienst startete auf 14.25. |
| `backend:test-integration` auf PostgreSQL 14.25 und Redis | 28 Suites, 221 bestandene Tests. Zwei optionale Benchmarks ausgelassen. |
| `backend:test-integration` auf PostgreSQL 17.12 und Redis | 28 Suites, 221 bestandene Tests. Zwei optionale Benchmarks ausgelassen. |
| `frontend:test-quality-gates` | 92 bestandene Prüfungen. |

Die Integrationstests lassen sich je Version mit einer eigenen PostgreSQL-Instanz und
Redis wiederholen. `BACKEND_INTEGRATION_TEST_DATABASE_URL` muss auf eine entbehrliche
Testinstanz mit Berechtigung zur Datenbankerstellung zeigen. Zusätzlich
`BULLMQ_TEST_REDIS_HOST`, `BULLMQ_TEST_REDIS_PORT` und
`BACKEND_INTEGRATION_POSTGRES_VERSION` (14.25 oder 17.12) setzen. Anschließend
`npx nx run backend:test-integration` ausführen.

## Manueller Transfer und Rückfall

Die Befehle aus der [Betreiberanleitung](../postgresql-17-migration.md) wurden
mit einem isolierten Docker-Netz, separaten Volumes und dem realen
Liquibase-Schema geprüft. Der synthetische Bestand umfasste unter anderem
Antworten, Kodierwerte, Logs, Sessions und Sequenzen. Für die Probe wurden
die Release-Images lokal getaggt. Die drei Anwendungscontainer waren
Platzhalter für Stoppen und Wiederanlauf.

- **Rückfall vor Schreibfreigabe.** Rollen und Daten mit den 17er-Werkzeugen
  gesichert und auf ein neues Volume restauriert. Quelle, Ziel, umgeschalteter
  DB-Dienst und wieder gestartete Quelle auf 14.25 lieferten identische
  Prüfsummen für Tabelleninhalte und Sequenzstände.
- **Freigabe auf 17.12.** Transfer in ein weiteres frisches Volume wiederholt.
  Die Prüfung ergab übereinstimmende Zugriffsdaten laut Anleitung, 184
  Liquibase-Changesets und null ungültige Indizes. Nach der Freigabe wurde ein
  Score auf 42 gesetzt. Der reguläre DB-Dienst lieferte nach erzwungener
  Neuerstellung weiterhin 42 aus.

Die Backend-Integration lief separat mit echten PostgreSQL- und Redis-Instanzen.
Der Probelauf mit synthetischen Daten liefert keine Laufzeitprognose für einen
Produktionsbestand.
