# Nest 12: CommonJS-Anwendung mit ESM-Abhängigkeiten

## Basis und Umfang

Eigenständige Änderung auf `harden-backend-exports` (PR #1138 gegen `develop`).
Ursprünglicher Ausgangspunkt war `cc9cb2971072d403d613cc65f3fa4f21244a93da`.
Nach der Neuschreibung und Erweiterung des Basisbranches wurde das Upgrade
ausdrücklich zur Aktualisierung freigegeben und auf
`60b16a5e24bbce02fe051b11f55668b6893c01c0` rebasiert. Die vier Upgrade- und
CI-Korrekturcommits blieben dabei laut `git range-diff` inhaltlich unverändert.
Solange #1138 offen ist, richtet sich der Upgrade-PR gegen diesen Branch.
Die fachlichen Änderungen von #1138 sind eine Voraussetzung; sie werden hier
nicht erneut implementiert. Keine automatische Zusammenführung oder Release-Veröffentlichung.

Nach ausdrücklicher Entscheidung bleibt der Anwendungscode CommonJS. Nest 12
liefert seine Pakete als ESM; Node lädt sie über `require(esm)`. Das ist der im
[Nest-Migrationsleitfaden](https://docs.nestjs.com/migration-guide) unterstützte
Upgrade-Pfad. Eine vollständige Umstellung des eigenen Codes und aller Tests auf
native ESM-Imports ist eine separate Migration.

## Unterstützte Werkzeugkette

- Node **24.22.1**, durch `.nvmrc`, `engines.node`, Builder-, Runtime-, Replay-
  und GitLab-Testimages abgestimmt. Das Cypress-Browserimage ist ebenfalls auf
  diese Node-Version festgelegt. Die veröffentlichten Node- und Cypress-Tags
  wurden gegen die Docker-Hub-Metadaten geprüft.
- npm **11.19.1**, die mit dieser Node-Version ausgelieferte Version; auch die
  Docker-Installationen und die isolierte Produktionspaketprüfung verwenden sie.
- Nest-Core, Common, Platform-Express und Testing **12.3.2**; die verwendeten
  Integrationen Axios, Config, JWT, Passport, Schedule, Swagger und TypeORM auf
  kompatiblen 12er-Versionen. BullMQ 12 und Throttler 6.7.1 unterstützen Nest 12.
- `@nestjs-modules/ioredis` **2.3.1** und Terminus **12.1.0**: Die alte
  Redis-Integration 2.0.2 lädt noch die in Terminus 12 entfernte
  `HealthIndicator`-Basisklasse. Das neue Paket unterstützt die neue API.
- Nx **22.7.12**, TypeScript **5.9.3**, Jest **30.5.2**, ts-jest **29.4.15**.
  Angular 21 und dessen Jest-Preset bleiben unverändert und werden separat geprüft.
  Das von Nx mitgebrachte Nest-Schematics-11-Paket ist ein Entwicklungswerkzeug;
  es wird weder zum Bauen noch zum Starten der bestehenden Anwendung benötigt.

Primärquellen:
[Nest-Migration](https://docs.nestjs.com/migration-guide),
[Jest: require von ESM](https://jestjs.io/docs/ecmascript-modules#require-of-esm),
[Node 24.22.1](https://nodejs.org/en/blog/release/v24.22.1),
[Angular-Kompatibilität](https://angular.dev/reference/versions),
[Nx-Kompatibilität](https://nx.dev/docs/technologies/node/introduction),
[TypeScript-Moduloptionen](https://www.typescriptlang.org/tsconfig/module.html).
Die Peer-Abhängigkeiten wurden zusätzlich anhand der veröffentlichten
Paketmetadaten auf registry.npmjs.org geprüft; der Lockfile hält die Auflösung fest.

## Build und Tests

Der reguläre Produktionsbuild verwendet inzwischen `tsconfig.build.json` mit
`module: esnext` und `moduleResolution: bundler`; Webpack erzeugt `main.mjs`.
Die Anwendungskonfiguration im Node20-Modus bleibt für separate Prüfwerkzeuge
erhalten. `esModuleInterop: true` und explizite Default-Imports berücksichtigen
aufrufbare CommonJS-Pakete. Details: [ESM-Laufzeit](backend-esm-runtime.md).

Der reguläre Backend-Testpfad verwendet nun Vitest mit ESM und separater
Typprüfung. Der frühere Jest-Launcher und das interne Jest-Target wurden entfernt.
Die fixierten Werkzeuge benötigen Node 24.22.1 innerhalb der Hauptversion 24.
`--experimental-vm-modules` bleibt für die gezielten VM-Verträge aktiviert;
die Produktionsanwendung startet ohne diesen Schalter. Bestehende Jest-Mocks
werden ausschließlich in Testquellen angepasst. Die Anwendung selbst wird
nicht mehr im Pilotadapter korrigiert. Die Regression prüft Dekoratormetadaten
und die Identität nativer externer Nest-Module. Aufrufe, Installation und
verbleibende Modulgrenzen: [Backend-Tests](backend-tests.md).

Nach dem Wechsel der Node-Version Abhängigkeiten mit `npm ci` neu installieren.
Insbesondere `libxmljs2` enthält ein natives Modul mit anderer Node-ABI.
Für einen bereits vorhandenen lokalen Installationsbaum ist
`npm rebuild libxmljs2` nötig; ein frischer CI-/Docker-Build erledigt das beim
Installieren. PostgreSQL und Redis brauchen keine Datenmigration.

Die Produktionsabhängigkeiten werden in einer separaten Stufe des vollständigen
Bookworm-Builders installiert. Das `libxmljs2`-Prebuild für Node 24 verlangt
eine neuere glibc; der Builder kann deshalb auf den Quellbuild ausweichen. Der
fertige Produktionsbaum wird in Bookworm-Slim übernommen, mit derselben
Node-ABI und Debian-Basis, ohne Compiler oder Entwicklungsabhängigkeiten im
Runtime-Image. Der Linux-Containerjob prüft native Module nach diesem Kopieren.

Prüfergebnisse und verbleibende Einschränkungen stehen im
[Testbericht](qa/nest12-upgrade-2026-10-30.md).

Nest 12 begrenzt außerdem verschachtelte Multipart-Feldnamen und Array-Indizes.
Der manipulierte Upload aus der vorhandenen Regression bleibt HTTP 400; seine
Meldung lautet nun `Field name array index too large - items[4294967294]`.
Normale Uploads werden weiterhin verarbeitet. Die Test-Erwartung bildet diese
konkrete vorgelagerte Ablehnung ab.
