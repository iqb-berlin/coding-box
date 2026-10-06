# Manuelle Review-Anleitung für PR #1039

Stand: 06.10.2026. Analysierter Migrationsstand: `3fa3779c` gegen
`develop` (`39468e5a`): 71 Commits, 533 geänderte Dateien.
Diese Anleitung ersetzt die frühere Zuordnung vor der veröffentlichten Konsolidierung.
Sie ordnet alle 71 Commits genau einem Thema zu; sie schreibt die Historie nicht um.

## Vorgehen

1. Pro Thema zuerst den endgültigen Code und die unten genannten Regressionen
   prüfen. Danach die zugeordneten Commits nachvollziehen. Spätere Pakete ändern
   teilweise dieselben Dateien; ein älterer Commit allein beschreibt deshalb
   nicht immer das abschließende Verhalten.
2. Produktkorrektur und Test zusammen lesen: provoziert der Test den Fehler,
   und prüft er das sichtbare Ergebnis oder die gespeicherten Werte?
3. Große mechanische Änderungen (Signals, OnPush, Stil und `inject()`) von
   fachlichen Änderungen wie Speicherreihenfolge, Rechteprüfung und Abbruch trennen.
4. Lockfile und generiertes `zoneless-coverage.json` separat lesen. Das Inventar
   hilft beim Finden von Quellen; eine Referenz ist kein ausgeführter Test.
5. Erfolgreiche CI dem exakten finalen SHA zuordnen. Einzelne Zwischenstände
   dieser Historie sind nicht sämtlich als eigenständig grün nachgewiesen.

Für den endgültigen Diff im aktuellen Checkout:

```sh
git diff 39468e5a28a24dc9ec860aee46daf8d4ed5c8682...HEAD -- apps/frontend/src/app/replay
# Einzelnen Commit einschließlich seines Tests ansehen:
git show 5c9375b2
```

## Themen und Commit-Zuordnung

Die Reihenfolge ist eine Lesereihenfolge, keine neue Commit-Historie.
Frontend-Verzeichnisse ohne `apps/frontend/src/app/` sind relativ zu diesem Ordner.
Cypress- und scripts-Pfade sind relativ zum Repository.

### 1. Einstieg, Auth und bisherige Kodierabläufe (9 Commits)

**Prüffokus:** Asynchrone Anmeldung und Rechte, Speicherrennen, Workspace-Zuordnung, Metadatenformulare und VOCS-Vorschau.

**Quellen:** core/services, replay/services, ws-admin/components, shared/dialogs/metadata-dialog.

**Test-Einstieg:** cypress/auth/coding-session.cy.ts; replay/services/replay-coding.service.spec.ts; shared/dialogs/metadata-dialog/metadata-dialog.zoneless.spec.ts.

- [`5c9375b2`](https://github.com/iqb-berlin/coding-box/commit/5c9375b2bbfe39e4c5b2f4c48e45a11ad83df4d0) — Prepare reactive authentication and queued coding saves
- [`d88e4f38`](https://github.com/iqb-berlin/coding-box/commit/d88e4f38952e2ffa782dc77dffd1685a158ed958) — Add isolated authentication, replay and administration coverage
- [`e35742f7`](https://github.com/iqb-berlin/coding-box/commit/e35742f75c217f2ba34ae8271f031ce39a81103f) — Preserve coding results and asynchronous workspace rights
- [`d2039376`](https://github.com/iqb-berlin/coding-box/commit/d2039376f406c21f11dd330097e39ab664df2adf) — Activate zoneless builds and required integration checks
- [`11cb344e`](https://github.com/iqb-berlin/coding-box/commit/11cb344e0e0a087c6fdb06e886acbae2846c159d) — Fix delayed progress and validation mutation recovery
- [`a129724c`](https://github.com/iqb-berlin/coding-box/commit/a129724c16404606ca8b80251776ee66b0b6ce80) — Keep information dialogs scoped to their workspace and lifetime
- [`c8dd98f8`](https://github.com/iqb-berlin/coding-box/commit/c8dd98f864fa8675b01e202167063b221a8f95c0) — Isolate metadata forms and stabilize vocabulary and duration inputs
- [`f1efc8c6`](https://github.com/iqb-berlin/coding-box/commit/f1efc8c61bc7afb2ec14ae834cb838468aef3466) — Scope file operations and verify risk-based zoneless coverage
- [`5f3405da`](https://github.com/iqb-berlin/coding-box/commit/5f3405da6a264245b105183132b046cc9a18fcc4) — fix(frontend): render referenced VOCS schemes without ZoneJS

### 2. Abhängigkeiten, Backend und Audit (8 Commits)

**Prüffokus:** Paketversionen und Lockfile, beschädigte ZIP-Einträge, Prozessfehler, verbindliches Audit und Node-Version.

**Quellen:** package.json, package-lock.json, apps/backend/src/app/database/services/workspace/resource-package.service.ts.

**Test-Einstieg:** resource-package.service.spec.ts und resource-package-extraction.fixture.cjs; scripts/qa/dependency-patches.test.mjs.

- [`7e4c3cef`](https://github.com/iqb-berlin/coding-box/commit/7e4c3cefe40893d54f32924469ca5677d323b14a) — fix(deps): resolve runtime and tooling audit findings
- [`287ff8d8`](https://github.com/iqb-berlin/coding-box/commit/287ff8d8ad71024c0e5fb5748509018a6bb6f0bb) — fix(backend): contain corrupt resource package extraction failures
- [`db8c7877`](https://github.com/iqb-berlin/coding-box/commit/db8c7877f647a97f3b0035aac6064573e0ab102b) — ci: block pipelines on high and critical dependency findings
- [`e50f8b61`](https://github.com/iqb-berlin/coding-box/commit/e50f8b6167828ef4eb7df7368b52cca080d4fd1c) — test(backend): use fixed paths in corrupt archive fixture
- [`eb0a4cb4`](https://github.com/iqb-berlin/coding-box/commit/eb0a4cb42e15347ddb11b69a62329a502d2a1b9c) — fix(deps): remove vulnerable forge chain from Rspack tooling
- [`45cf2e09`](https://github.com/iqb-berlin/coding-box/commit/45cf2e09ea4c92a5f9e971fc14081d1ca0fcc28a) — ci: align validation images with supported Node 22
- [`f82d5fcc`](https://github.com/iqb-berlin/coding-box/commit/f82d5fcc7733a8e72f8ab6fa6540a54fef7383ee) — fix(ci): patch vulnerable build dependencies
- [`ddf245fb`](https://github.com/iqb-berlin/coding-box/commit/ddf245fb98450b150adf1229b27aa4f4a4775464) — fix(ci): restore missing file watcher lock entries

### 3. Signals als Zustandsmodell (5 Commits)

**Prüffokus:** Gemeinsamer App-Zustand, unveränderliche Collections, abgeleitete Werte und verzögerte Replay-Daten.

**Quellen:** core/services, coding/components, replay/services.

**Test-Einstieg:** replay/services/replay-coding.service.spec.ts; Tests zu Replay-Ankern und Ergebnis-Metadaten.

- [`e1dd1693`](https://github.com/iqb-berlin/coding-box/commit/e1dd169331c3874dbbda20a8675777e63a7011a4) — refactor(frontend): store shared application state in signals
- [`e5276171`](https://github.com/iqb-berlin/coding-box/commit/e527617119b472ca6ac56629ccb1d2b4bf686451) — refactor(frontend): use signals consistently across views
- [`fb99388e`](https://github.com/iqb-berlin/coding-box/commit/fb99388e0835154ea24bd1f5d19e6a8f083cfc40) — test(frontend): cover delayed replay anchors and result metadata
- [`2574ea80`](https://github.com/iqb-berlin/coding-box/commit/2574ea80c2591887ac2a3a693f1b578df79b1281) — perf(frontend): build validation maps in linear time
- [`2351fc10`](https://github.com/iqb-berlin/coding-box/commit/2351fc108e2dae9cfbfc07bb3b3b41959de1b2bd) — docs(frontend): record signal migration and validation evidence

### 4. Asynchrone Feature-Abläufe (13 Commits)

**Prüffokus:** Statistik, Jobabschluss, Rechte, Schulung, Dialoge, Filter und Bulk-Bestätigung bei Workspace-Wechsel.

**Quellen:** coding/components, ws-admin/components.

**Test-Einstieg:** cypress/zoneless/manual-preparation.cy.ts; review-notifications.cy.ts; training-comparison.cy.ts; zugehörige *.zoneless.spec.ts.

- [`214646b0`](https://github.com/iqb-berlin/coding-box/commit/214646b01814bfcc18376c349612e9f145425de9) — fix(frontend): update replay statistics and codebook export with signals
- [`b639e193`](https://github.com/iqb-berlin/coding-box/commit/b639e193942de93b60c1f8f8008015ac5a42d4a0) — fix(frontend): update Cohen kappa statistics with signals
- [`f92c7379`](https://github.com/iqb-berlin/coding-box/commit/f92c73793f3c1e075ab4b795d80195fb55a0ca4a) — Fix delayed zoneless UI updates and unify auth state
- [`e816b34f`](https://github.com/iqb-berlin/coding-box/commit/e816b34f6819b4a8f1b9e316644dccddde8ee59c) — Fix auto-coding feedback when job lists finish first
- [`7f89e457`](https://github.com/iqb-berlin/coding-box/commit/7f89e457a1a18eabac65ce46789107f803a6ffac) — fix(frontend): refresh asynchronous zoneless dialog state
- [`ec84464c`](https://github.com/iqb-berlin/coding-box/commit/ec84464cd974161c0e39dab757156f2a5c3e2731) — fix(frontend): refresh zoneless coding dialogs after async updates
- [`1f7af8e5`](https://github.com/iqb-berlin/coding-box/commit/1f7af8e577cb9777966236a62c735978eb8cd8c6) — fix(frontend): make coding dialogs and access rights reactive
- [`c9e61c03`](https://github.com/iqb-berlin/coding-box/commit/c9e61c037ee6505338480ff7235697adad434919) — fix(frontend): refresh zoneless imports and manager drafts
- [`0cef3169`](https://github.com/iqb-berlin/coding-box/commit/0cef31690e96b5850797449f2a84c2e1cfc89d04) — fix(frontend): keep zoneless selections and signal state reactive
- [`d03c2f4e`](https://github.com/iqb-berlin/coding-box/commit/d03c2f4ef70b15d292686a4de8504a8389f8a716) — Fix zoneless Schemer feedback and workspace user refresh
- [`f1c05e48`](https://github.com/iqb-berlin/coding-box/commit/f1c05e4809ec304ace2c08295e55293b4e71d68f) — Fix zoneless training comparison state updates
- [`1e29acee`](https://github.com/iqb-berlin/coding-box/commit/1e29acee1bdb7d75fc22137465ea37f16c0c60bf) — Fix zoneless regex feedback and immutable journal filters
- [`1a8fac0c`](https://github.com/iqb-berlin/coding-box/commit/1a8fac0c65f2198e4c301d2536b926a5f0380dfb) — fix(frontend): guard bulk workflow across workspace navigation

### 5. Diagramme und Animationen (2 Commits)

**Prüffokus:** Chart.js-Verträge, Darstellung, Größenänderung sowie Freigabe von Chart-Instanzen und Listenern.

**Quellen:** shared/components/vertical-bar-chart, ws-admin/components/replay-statistics-dialog.

**Test-Einstieg:** vertical-bar-chart.component.zoneless.spec.ts; cypress/zoneless/statistics-codebook.cy.ts.

- [`dd81d74d`](https://github.com/iqb-berlin/coding-box/commit/dd81d74d263bf562e42a91d6bcaa1b4d2aea37fe) — refactor(frontend): replace legacy chart animations and simplify export signals
- [`fe5caf6a`](https://github.com/iqb-berlin/coding-box/commit/fe5caf6a718cb89e098f63e6e8e8aa8de43148cb) — refactor(frontend): adopt modular charts and remove animation test helpers

### 6. Formulartypen und Komponentenverträge (5 Commits)

**Prüffokus:** Signal-Inputs/-Outputs/-Queries, lokale Entwürfe, Nullwerte und erneutes Verbinden bedingt sichtbarer Tabellen.

**Quellen:** shared, coding/components, replay/components, ws-admin/components.

**Test-Einstieg:** coder-list.component.zoneless.spec.ts; response-filters.component.zoneless.spec.ts; unit-schemer.component.zoneless.spec.ts.

- [`5fd872a2`](https://github.com/iqb-berlin/coding-box/commit/5fd872a28f8b9194e579422d977a431e6273ea79) — refactor(frontend): type reactive forms and dialog contracts
- [`d6945327`](https://github.com/iqb-berlin/coding-box/commit/d6945327ce29f7950f8ef25badc6823759629c42) — refactor(frontend): migrate shared and admin component APIs
- [`50a164fd`](https://github.com/iqb-berlin/coding-box/commit/50a164fd8402990a49da9e557461e1e8ca4edb71) — refactor(frontend): migrate coding APIs and isolate input drafts
- [`76678f59`](https://github.com/iqb-berlin/coding-box/commit/76678f59e69337933f984c18964ac763629fb500) — refactor(frontend): migrate replay and schemer signal APIs
- [`7c82aea0`](https://github.com/iqb-berlin/coding-box/commit/7c82aea082949f006a02c5fb806541ef614a3d44) — docs(qa): record component API migration coverage

### 7. OnPush, Eingabe und Browser-Synchronisierung (8 Commits)

**Prüffokus:** Benachrichtigung nach HTTP/Timer-Ereignissen, native Eingabe ohne keyup, Enter in Formularen und Fokus.

**Quellen:** shared/search-filter, core/services, Komponenten und Cypress-Fixtures.

**Test-Einstieg:** search-filter.component.zoneless.spec.ts; app.service.zoneless.spec.ts; cypress/zoneless/test-results-quick-search.cy.ts.

- [`f7a688d4`](https://github.com/iqb-berlin/coding-box/commit/f7a688d4238230e7df805bf1bbe47fdb226bc869) — fix(frontend): notify OnPush views after asynchronous state changes
- [`5c2d44ec`](https://github.com/iqb-berlin/coding-box/commit/5c2d44ec6f84d4dd52dca44a3ef835f3748e2376) — refactor(frontend): enable OnPush for every application component
- [`3670ba4e`](https://github.com/iqb-berlin/coding-box/commit/3670ba4edff2c6e4b512a4eff60caa15f1de898c) — docs(qa): record complete OnPush migration checks
- [`a0d797cc`](https://github.com/iqb-berlin/coding-box/commit/a0d797cc3eca5b712e1221b39e0d68557bbcd464) — fix(frontend): refresh global auth messages after navigation
- [`efb8d401`](https://github.com/iqb-berlin/coding-box/commit/efb8d40131aeeba8cb3cf8ebf773931b7ef324ac) — fix(frontend): synchronize search filters on native input
- [`44a7bfdf`](https://github.com/iqb-berlin/coding-box/commit/44a7bfdfcc3f4f1dcce55760d01b3c91f22f351a) — fix(frontend): keep dialog filters from submitting forms
- [`3e5d1961`](https://github.com/iqb-berlin/coding-box/commit/3e5d196154e765dd0ce52655f4a4c9bc2c40a678) — test(frontend): type native bundle fixture queries
- [`f5b7a091`](https://github.com/iqb-berlin/coding-box/commit/f5b7a0910596767900ef3705ce5c7994d17c4a5a) — test(e2e): synchronize bootstrap and dialog fixtures

### 8. Lebensdauer, alte Antworten und Hintergrundarbeit (10 Commits)

**Prüffokus:** Anfragen und Timer beenden, alte Ergebnisse verwerfen, Wiederherstellung erneut versuchen und globale Uploads/Exporte weiterführen.

**Quellen:** replay/services, ws-admin/components, shared/services, coding/components.

**Test-Einstieg:** replay-coding-lifecycle.zoneless.spec.ts; workspace-request.operator.zoneless.spec.ts; export-start-lifecycle.zoneless.spec.ts; cypress/zoneless/test-files-upload.cy.ts.

- [`ccf54ca8`](https://github.com/iqb-berlin/coding-box/commit/ccf54ca8164a9e67afbef4e58c69676726fd6b94) — fix(frontend): own provider lifetimes and global auth refreshes
- [`cab9cd7c`](https://github.com/iqb-berlin/coding-box/commit/cab9cd7cff8406289748e9533ee48d5a6ccb8832) — fix(frontend): scope view subscriptions and queued timers
- [`9d1a524e`](https://github.com/iqb-berlin/coding-box/commit/9d1a524e0a2f057b6b56b7076ae5f8922218ce01) — fix(frontend): discard obsolete selection and workspace responses
- [`1af9e703`](https://github.com/iqb-berlin/coding-box/commit/1af9e703d8cfac07ddb19e2fd9ab8a5aaec3d242) — docs(qa): record lifecycle and response-order validation
- [`a16099d7`](https://github.com/iqb-berlin/coding-box/commit/a16099d72d6f9bf0ee612ac2b976d83afc2b5384) — fix(replay): propagate restoration errors and allow retries
- [`28aa375f`](https://github.com/iqb-berlin/coding-box/commit/28aa375faa95f04f1cfcea4fb273ee1d0b23a8bb) — fix(frontend): retain background upload and export handoff
- [`c982050b`](https://github.com/iqb-berlin/coding-box/commit/c982050b1d03abf7b301bdb898c4c62154af934a) — fix(dialogs): preserve actions and release loading snackbars
- [`58a7bf4f`](https://github.com/iqb-berlin/coding-box/commit/58a7bf4f1c6246be212a5f82c169407ede38ccc6) — docs(qa): record lifecycle review fixes and regression evidence
- [`5e08b2fd`](https://github.com/iqb-berlin/coding-box/commit/5e08b2fd499f4e71fc71b6a00fbaa842e1265e0a) — fix(exports): report background startup failures globally
- [`63355346`](https://github.com/iqb-berlin/coding-box/commit/63355346241aa62010382e74367a4074e6a25213) — docs(qa): record export startup error regression coverage

### 9. Angular-Konventionen, Lint und Testberichte (6 Commits)

**Prüffokus:** Jest-Konfiguration, zugängliche Controls, Selektoren, Control Flow, inject(), optionale Abhängigkeiten und Coverage-Gates.

**Quellen:** apps/frontend/.eslintrc.cjs, jest.config.ts, .gitlab-ci, Angular-Komponenten.

**Test-Einstieg:** scripts/qa/frontend-quality-gates.test.mjs; Tastatur-Regressionen und angepasste TestBed-Tests.

- [`f16bb794`](https://github.com/iqb-berlin/coding-box/commit/f16bb794d054cc3d47c00478b701b44a276b73c0) — fix(test): load TypeScript Jest configurations consistently
- [`85048f7e`](https://github.com/iqb-berlin/coding-box/commit/85048f7e2d825948b34e1e246fdb3bc53607a69c) — feat(frontend): enforce Angular lint rules and accessible controls
- [`da924156`](https://github.com/iqb-berlin/coding-box/commit/da924156a39c90aa7d6c5df1816312ab96f688af) — ci(frontend): enforce coverage gates and publish test reports
- [`089d3cce`](https://github.com/iqb-berlin/coding-box/commit/089d3cced40d25e674ce81108b14104d569af1b3) — refactor(frontend): align components with Angular style conventions
- [`c1d530f5`](https://github.com/iqb-berlin/coding-box/commit/c1d530f57e18ade26dab79d34722b798a481dafa) — refactor(frontend): migrate dependencies to inject
- [`ea8da0e9`](https://github.com/iqb-berlin/coding-box/commit/ea8da0e9d209a3afe8ee89d37df2e11bd3f70611) — chore(frontend): enforce inject in Angular classes

### 10. Native Zoneless-Tests und konsolidierte CI (5 Commits)

**Prüffokus:** Eine Unit-Suite, ein Browserjob, korrekt ausgeführte Component-Specs, Proxy-Fallback, vollständiges Lint und Artefakt-Cache.

**Quellen:** apps/frontend/src/test-setup.ts, cypress.config.ts, apps/frontend/project.json, .gitlab-ci, scripts/qa.

**Test-Einstieg:** scripts/qa/frontend-quality-gates.test.mjs; scripts/qa/zoneless-inventory.test.mjs; Component-, E2E- und Live-Suites.

- [`151cddda`](https://github.com/iqb-berlin/coding-box/commit/151cddda78011d2ae6b6c90a5d805a3a699b5ada) — test(frontend): finish zoneless migration and consolidate CI
- [`7a7a5a81`](https://github.com/iqb-berlin/coding-box/commit/7a7a5a81af076f5a75557f97d8ce8c7cc567cc40) — test(browser): reject component specs without executed tests
- [`684f404c`](https://github.com/iqb-berlin/coding-box/commit/684f404c7794ce51c7e04b6a842df6103ec79148) — fix(ci): compile component specs before starting the test runner
- [`da06d404`](https://github.com/iqb-berlin/coding-box/commit/da06d4046e7127e76f4fe6873a630634fa2fb715) — fix(ci): use public base images for external pull request jobs
- [`3fa3779c`](https://github.com/iqb-berlin/coding-box/commit/3fa3779cc8adc924659ae6bedd96746bbd5ddbb1) — fix(ci): enforce full lint and hash served frontend artifacts

## Was die Tests absichern

| Gefahr | Aussagekräftiger Einstieg | Grenze |
|---|---|---|
| Fehlende UI-Aktualisierung | `validation-dialog.zoneless.spec.ts`: verspätetes XML und Pagination; echte Templates nach `whenStable()` | Nicht jede Template-Bindung einzeln geprüft |
| Verlorene Kodierungen und Notizen | `replay-coding.service.spec.ts`: überlappende Speicherungen, erfasster Job/Token, Fehler und Wiederholung; `cypress/auth/coding-session.cy.ts`: erneut gelesene Werte nach Reload | Keine Produktionslast oder beliebige Netzwerkausfälle |
| Alte Daten nach Navigation | `replay-coding-lifecycle.zoneless.spec.ts`, `workspace-request.operator.zoneless.spec.ts`, `cypress/zoneless/manual-preparation.cy.ts` | Angenommene Backend-Jobs werden durch Dialogschließung nicht zurückgerollt |
| Sitzungs- und Rechtefehler | Live-Keycloak, Entwurfswiederherstellung und direkte Backend-Prüfungen für ausgewählte Aktionen mit Rollen 0–3/Admin | Weitere UI-Szenarien verwenden synthetische Anmeldung/API-Antworten; historische Stufe 4 ist nur synthetisch geprüft |
| Globale Arbeit nach Ansichtsschließung | Upload-Handoff, Exportregistrierung und globale Startfehler mit Unit-/Browser-Regressionen | Reale Content-Pool-Verbindungen und Deployment sind nicht Teil des Nachweises |
| Falsches Grün durch Testinfrastruktur | `frontend-quality-gates.test.mjs`: tatsächliche Lint-/Backend-Jobs in Nx/Git-Fixtures, Coverage-Gegenprobe, leere Browser-Specs und Artefakt-Hash | CI und GitHub-Pflichtstatus müssen zusätzlich am finalen SHA erfolgreich sein |

Alle Frontend-Unit-Tests laufen in `setupZonelessTestEnv()` und prüfen vor/nach
jedem Test die Abwesenheit von Zone.js. Component-Tests verwenden
`cypress/angular-zoneless`; reguläre E2E-Tests laufen auf dem Produktionsartefakt.
Die Live-Suites verwenden zusätzlich ihre wegwerfbaren Backend-/Keycloak-Umgebungen.
Die vollständigen Grenzen stehen in [zoneless-risk-coverage.json](zoneless-risk-coverage.json).

## Ergänzung aus diesem Review

Der Backend-Testjob verglich bisher nur `HEAD~1`. Am analysierten SHA wählt das
kein Backend-Testprojekt aus, obwohl der Vergleich zur PR-Basis das Backend
betrifft. Ein grüner Job konnte damit ohne Backendtests enden.

Der vorhandene Job läuft jetzt mit:

```sh
npx nx run-many --target=test --exclude=frontend --parallel=1 -- --maxWorkers=2 --passWithNoTests=false
```

Die Testauswahl umfasst alle Projekte mit Testziel außerhalb des Frontends;
gültige Nx-Ergebnisse können weiterhin aus dem Cache kommen. Das Frontend läuft
im eigenen vollständigen Job. Ein zusätzlicher Job wird dafür nicht benötigt.
Die neue Regression erzeugt einen echten Nx/Git-Workspace mit Backend-Änderung
und anschließendem Dokumentationscommit, führt das tatsächliche CI-Script aus,
prüft den Ausschluss des Frontends und erzwingt anschließend einen Backendfehler.

Details zu CI und lokalen Prüfbefehlen:
[frontend-quality-gates.md](frontend-quality-gates.md).
