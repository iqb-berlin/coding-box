#!/usr/bin/env python3
"""Render the measured comparison and its explicitly bounded validation scope."""
from pathlib import Path
import html
import json
import statistics

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'tmp/backend-build-comparison'
DEST = DATA / 'report'
DEST.mkdir(parents=True, exist_ok=True)

def read(file, default=None):
    path = DATA / file
    return json.loads(path.read_text()) if path.exists() else default

def esc(value):
    return html.escape(str(value))

def number(value, places=2):
    return f'{value:.{places}f}'.replace('.', ',')

measurements = read('measurements.json')
common = read('common-checks.json', {'steps': []})
metadata = read('runtime-metadata-result.json', {})
units = read('unit-results.json', {})
integration_file = ROOT / 'coverage/apps/backend/integration-results.json'
integration = json.loads(integration_file.read_text()) if integration_file.exists() else {}
openapi = read('openapi-equivalence.json', {'variants': {}})
openapi_rows = ''.join(f'<tr><th>{esc(variant)}</th><td>{"Identisch" if result["equal"] else str(len(result["differences"])) + " dokumentierte Abweichung"}</td><td>' +
    '<br>'.join(esc(change['path']) for change in result['differences']) + '</td></tr>'
    for variant, result in openapi['variants'].items())
variants = ['webpack', 'rspack', 'tsc']
names = {'webpack': 'Webpack + TypeScript', 'rspack': 'Rspack + SWC', 'tsc': 'Ungebündeltes ESM + tsc'}
medians = {v: statistics.median(r['elapsedMs'] for r in measurements['builds'] if r['variant'] == v) for v in variants}
common_ms = sum(step['elapsedMs'] for step in common['steps'])

rows = ''
for variant in variants:
    fields = []
    for file in ['apps/backend/src/app/http/request-id.ts', 'api-dto/workspaces/workspace-settings-dto.ts']:
        edits = [r for r in measurements['watch'] if r['variant'] == variant and r.get('file') == file]
        first = next(r['elapsedMs'] for r in edits if r['round'] == 1)
        warm = statistics.median(r['elapsedMs'] for r in edits if r['round'] > 1)
        fields.extend([number(first / 1000) + ' s', number(warm, 0) + ' ms'])
    rows += '<tr><th>' + names[variant] + '</th><td>' + number(medians[variant] / 1000) + ' s</td>' + ''.join('<td>' + item + '</td>' for item in fields) + '</tr>'

def status(value):
    return '<span class="pass">Bestanden</span>' if value is True else '<span class="pending">Offen / nicht bestanden</span>'

checks = ''
for variant in variants:
    codebook = read(f'codebook-{variant}/runtime-result.json', {})
    worker = read(f'worker-{variant}/runtime-result.json', {})
    browser = read(f'browser-{variant}/runtime-result.json', {})
    tests = browser.get('browser', {})
    checks += f'''<tr><th>{names[variant]}</th>
      <td>{status(metadata.get('allVariantsEqual'))}<br>43 Entities</td>
      <td>{status(codebook.get('passed'))}<br>{codebook.get('exports', '–')} Exporte, {codebook.get('autocoder', '–')} Autokodierfälle</td>
      <td>{status(worker.get('passed'))}<br>SIGTERM ohne SIGKILL</td>
      <td>{status(browser.get('passed'))}<br>{tests.get('totalPassed', '–')} / {tests.get('totalTests', '–')} Browsertests</td></tr>'''

steps = ''.join(f"<tr><td>{esc(s['name'])}</td><td>{number(s['elapsedMs']/1000)} s</td><td>{'Bestanden' if s['code']==0 else 'Fehlgeschlagen'}</td></tr>" for s in common['steps'])
pipeline = ''.join(f'<tr><th>{names[v]}</th><td>{number((common_ms + medians[v])/1000)} s</td><td>{number((medians["webpack"]-medians[v])/1000)} s</td></tr>' for v in variants)
artifacts = ''.join(f'<tr><th>{names[a["variant"]]}</th><td>{a["files"]}</td><td>{number(a["totalBytes"]/1024**2)} MiB</td><td class="mono">{a.get("treeSha256", "–")}</td></tr>' for a in metadata.get('artifacts', []))

document = f'''<!doctype html><html lang="de"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kodierbox – technischer Vergleich der Backend-Builds</title>
<style>
:root{{font-family:system-ui,sans-serif;color:#172635;background:#eef2f6;line-height:1.5}}
body{{max-width:1160px;margin:30px auto;padding:0 24px}}article{{background:white;padding:40px;border-radius:12px;box-shadow:0 4px 24px #142b4210}}
h1{{font-size:30px;line-height:1.2;margin:8px 0 20px}}h2{{font-size:21px;margin:32px 0 12px}}h3{{font-size:17px;margin:24px 0 8px}}
.eyebrow{{color:#425f7b;font-weight:650}}.decision{{background:#eaf2fb;border-left:5px solid #32649a;padding:16px 20px}}
table{{border-collapse:collapse;width:100%;margin:14px 0;font-size:14px}}th,td{{text-align:left;padding:10px 12px;border:1px solid #d8e1e8;vertical-align:top}}thead{{background:#edf3f8}}tbody th{{font-weight:600}}
code,pre,.mono{{font-family:ui-monospace,monospace;font-size:12px}}pre{{background:#edf2f7;padding:16px;white-space:pre-wrap;overflow-wrap:anywhere}}.mono{{overflow-wrap:anywhere;max-width:230px}}
.pass{{color:#14613c;font-weight:650}}.pending{{color:#8a4d10;font-weight:650}}.small{{font-size:13px;color:#455a6d}}a{{color:#245c95}}li{{margin:7px 0}}
@media(max-width:800px){{body{{padding:0 10px}}article{{padding:20px}}.table{{overflow-x:auto}}}}
@media print{{body{{margin:0;background:white;max-width:none;padding:0}}article{{box-shadow:none;padding:0}}h2{{break-after:avoid}}tr{{break-inside:avoid}}}}
</style><body><article>
<div class="eyebrow">Technischer Versuch · 04.11.2026 · Entwicklung</div>
<h1>Kodierbox: Webpack, Rspack/SWC und ungebündeltes ESM</h1>
<div class="decision"><strong>Empfehlung: den produktiven Webpack-Build vorerst beibehalten.</strong>
Rspack zeigt einen messbaren, kleinen Vorteil. Der zusätzliche Aufwand für Metadaten und Watch-Integration ist damit noch nicht überzeugend gerechtfertigt.
Der tsc-Pilot zeigt, dass eine Ausführung ohne Bundler möglich ist; er benötigt derzeit jedoch eigene Ausgabeaufbereitung.</div>
<p>Basis ist <code>7a4197c5badd19a89c220c4c1c83e85f1cff82dd</code>, der Merge von
<a href="https://github.com/iqb-berlin/coding-box/pull/1157">PR #1157</a> auf <code>develop</code>.
Der Versuch liegt im separaten Branch <code>compare-backend-builds</code>. Der Standard-Build wurde nicht umgestellt.
Dieser Bericht bestätigt weder ein Release noch ein Deployment oder eine fachliche Abnahme.</p>

<h2>Messmethode und Ergebnisse</h2>
<p>Node {esc(measurements['node'])}, {esc(measurements['cpu'])}, {esc(measurements['platform'])}/{esc(measurements['arch'])}.
Je Variante drei Vollbuilds in wechselnder Reihenfolge, nacheinander und ohne Nx-Taskcache. Jeder Lauf startet einen frischen Prozess und entfernt seine vorherige Ausgabe.
Die Dateisystem-Caches bleiben warm; es wurde kein künstlicher Rechner-Neustart oder Cache-Flush durchgeführt. Andere aktive Arbeiten auf dem Rechner wurden nicht beendet. Die Systemlast steht in den Rohmessungen; die Zahlen sind lokale Orientierungswerte und kein dedizierter Runner-Benchmark.</p>
<p>Alle Varianten prüfen Typen. Beide Bundler warten auf den Typechecker. Ein absichtlicher Typfehler wurde von allen drei Wegen abgelehnt.
Zielstandard ES2021, keine Minifizierung, keine Source Maps. Im Watch-Modus werden Paketmanifest und Lizenzliste bei beiden Bundlern nicht pro Quelltextänderung neu erzeugt.</p>
<div class="table"><table><thead><tr><th>Variante</th><th>Vollbuild, Median</th><th>Erste Codeänderung</th><th>Warme Codeänderung</th><th>Erste DTO-Änderung</th><th>Warme DTO-Änderung</th></tr></thead><tbody>{rows}</tbody></table></div>
<p class="small">Watch: je drei harmlose Änderungen an <code>request-id.ts</code> und einem gemeinsam verwendeten DTO.
„Warm“ ist der Median der zweiten und dritten Änderung; die erste Änderung nach dem Start steht gesondert in der Tabelle.
Die Originaldateien werden anschließend wiederhergestellt. Die Ergebnisse gelten für diese zwei Änderungsszenarien und diese Maschine.</p>
<p>Rspack spart beim Vollbuild {number((medians['webpack']-medians['rspack'])/1000)} Sekunden
({number((1-medians['rspack']/medians['webpack'])*100,1)} %).
Gemessen wurde die bestehende Lockfile-Kombination Nx 22.7.12, Rspack 1.6.8 und TypeScript 5.9.3.
Ein zusätzlicher Wechsel auf eine neue Nx-/Rspack-Hauptversion war nicht Bestandteil des Vergleichs.</p>

<h2>Technische und funktionale Prüfung</h2>
<div class="table"><table><thead><tr><th>Variante</th><th>PostgreSQL-Metadaten</th><th>API / Exporte / Autokodierung</th><th>Export-Worker</th><th>Browser-Abläufe</th></tr></thead><tbody>{checks}</tbody></table></div>
<p>Die Metadaten stammen aus den tatsächlich erzeugten Anwendungsartefakten. Verglichen werden TypeORMs PostgreSQL-Tabellenrepräsentation,
Spalten, Schlüssel, Indizes, Constraints, Fremdschlüssel und Relationen. Alle 43 Entities entsprechen auch der ursprünglichen Referenz ohne die zusätzliche explizite Spaltenangabe.</p>
<p>Die API-Prüfung verwendet echte OIDC-Tokens aus Keycloak, echte PostgreSQL-Daten und echte Redis/BullMQ-Jobs.
Pro Variante werden 24 JSON-/DOCX-Exporte und sechs SOLVER-/Autokodierfälle geprüft. Fehlgeschlagene Vorabprüfungen müssen gespeicherte Antworten unverändert lassen.
Die Browsertests importieren echte synthetische Dateien, speichern Kodierungen über einen Neuladevorgang hinweg, geben sie ab und exportieren dieselben Ergebnisse.
Zusätzlich werden Rollen, Eigentumsgrenzen, Sitzungsaktualisierung und Transaktions-Rollback geprüft.</p>
<p>Die Infrastruktur besteht ausschließlich aus eigenen lokalen Instanzen: PostgreSQL 14.24, Redis 7.4.2 und Keycloak 26.4.0.
Liquibase 4.28.0 hat die 169 aktuellen Changesets tatsächlich eingespielt. Docker war nicht erreichbar; dieser Bericht behauptet deshalb keinen Docker-, Linux/amd64- oder Produktions-Installationsnachweis.</p>
<p>Für den bestehenden Browser-Harness werden ausschließlich dessen Transportaufrufe <code>docker exec … psql/redis-cli</code> auf die eigenen lokalen Dienste umgesetzt.
Die SQL-Anweisungen, HTTP-Abläufe und fachlichen Assertions bleiben erhalten. Der Codebook-Prüfer erhält lokale Ports sowie den aktuellen Migrationsstand 169 statt der veralteten Erwartung 163.</p>

<h2>Gemeinsame Prüfstrecke und Aussage zur CI</h2>
<table><thead><tr><th>Gemeinsamer Prüfschritt</th><th>Lokale Dauer</th><th>Ergebnis</th></tr></thead><tbody>{steps}</tbody></table>
<p>Unitlauf ohne Coverage: {units.get('numPassedTests','–')} bestanden, {units.get('numPendingTests','–')} vorgesehene Skips.
Integrationslauf: {integration.get('numPassedTests','–')} bestanden, {integration.get('numPendingTests','–')} optionaler Benchmark übersprungen.
Die gemeinsame Testsuite gilt für alle drei Varianten, weil sie dieselben Anwendungs- und Testquellen verwenden. Ein erster, fehlgeschlagener Vorbereitungslauf wurde nach Korrektur wiederholt; die Tabelle verwendet den abschließenden Lauf.</p>
<table><thead><tr><th>Variante</th><th>Gemeinsame lokale Prüfungen + Buildmedian</th><th>Ersparnis gegenüber Webpack</th></tr></thead><tbody>{pipeline}</tbody></table>
<p><strong>Das ist ein transparentes lokales Rechenmodell, keine gemessene GitLab-Gesamtlaufzeit.</strong>
Es wurden keine Vergleichspipelines veröffentlicht. Runner-Wartezeiten, Downloads, parallele Jobs, Frontend-Jobs und vollständige Docker-Neubauten sind hier nicht enthalten.
Eine Aussage über die tatsächliche kritische Laufzeit der Remote-CI ist daraus nicht ableitbar. Die absolute Buildersparnis beträgt auf diesem Rechner {number((medians['webpack']-medians['rspack'])/1000)} Sekunden.</p>

<h2>Festgestellter Migrationsaufwand</h2>
<ol>
<li><strong>Entity-Metadaten:</strong> SWC lieferte für <code>ValidationTask.validation_type</code> zunächst <code>Object</code>; TypeORM verweigerte den Start.
Eine explizite Angabe <code>@Column({{ type: 'varchar' }})</code> behebt das. Der vollständige Metadatenvergleich bestätigt, dass das bisherige Datenbankschema erhalten bleibt.</li>
<li><strong>Swagger-Metadaten:</strong> Das nur aus dem Initialwert abgeleitete Logo-Feld <code>alt</code> erhielt unter SWC keine ausreichenden Metadaten.
Die explizite Annotation <code>alt: string</code> ermöglicht den Start. Das dokumentierte Feld wird damit ausdrücklich als String beschrieben.</li>
<li><strong>Typecheck:</strong> Der imperative Nx/Rspack-Prüfpfad erfasste mit relativem tsconfig-Pfad im ersten Versuch keine Dateien.
Diese unvollständigen Zeiten wurden verworfen. Der verwendete Checker-Plugin-Pfad arbeitet mit absolut aufgelöster Konfiguration und wurde durch einen echten Fehlerfall überprüft.</li>
<li><strong>Watch:</strong> Die bestehende Lizenzextraktion verursachte mit Rspack einen Fehler <code>ResourceData has been dropped by Rust</code>.
Paket- und Lizenzgenerierung finden im Pilot bei beiden Bundlern ausschließlich im Vollbuild statt.</li>
<li><strong>Ohne Bundler:</strong> Der tsc-Pilot ergänzt lokale Dateiendungen und JSON-Importattribute in der Ausgabe, kopiert Assets und hält den generierten Autocoder ausdrücklich als <code>.cjs</code>.
Eine dauerhafte Einführung müsste entscheiden, ob diese Schritte in den Quellen oder als gepflegte Buildlogik umgesetzt werden.</li>
</ol>
<p>Die vollständigen OpenAPI-Dokumente werden zusätzlich erfasst. Parameter-Reihenfolgen werden bei der semantischen Auswertung normalisiert;
abweichende Typangaben werden als Befund dokumentiert. Keine unerwartete Dokumentationsänderung wird als fachliche Freigabe ausgegeben.</p>
<table><thead><tr><th>Vergleich mit Webpack</th><th>OpenAPI-Ergebnis</th><th>Ort der Abweichung</th></tr></thead><tbody>{openapi_rows}</tbody></table>
<p>Der tsc-Pilot beschreibt den bereits vorhandenen Query-Parameter <code>type</code> beim Anlegen von Validierungsaufträgen zusätzlich als String.
Das ist eine Dokumentationsabweichung; die geprüften HTTP- und Browser-Abläufe bleiben erfolgreich. Eine unveränderte OpenAPI-Definition wird für diese Variante nicht behauptet.</p>

<p>Der erste Volltest wurde durch zwei Testvorbedingungen beeinträchtigt: Ein verlinkter node_modules-Pfad änderte die reproduzierte Autocoder-Ausgabe, und dem Controller-Importtest fehlte der ausdrückliche Import von reflect-metadata. Die Wiederholung verwendet eine eigene Installation mit identischen Paketdateien und den ergänzten Import. Die ursprünglichen Fehlerberichte bleiben als Nachweis erhalten.</p><h2>Ausgabegröße und Bindung an die geprüften Artefakte</h2>
<div class="table"><table><thead><tr><th>Variante</th><th>Dateien</th><th>Gesamtausgabe</th><th>SHA-256 des Ausgabebaums</th></tr></thead><tbody>{artifacts}</tbody></table></div>
<p class="small">Enthalten sind die erzeugten Programmdateien, Schemas und gegebenenfalls Paket-/Lizenzdateien; <code>node_modules</code> ist nicht enthalten.
Beim tsc-Pilot ist <code>main.mjs</code> nur der Einstieg in die einzelnen Module. Seine 37 Bytes werden ausdrücklich nicht als Größe der Anwendung ausgegeben.</p>
<p class="small">Die Tabelle beschreibt die tatsächlich geprüften Verzeichnisse nach der Watch-Messung. Rspack entfernt dabei seine nicht erneut erzeugten Paket-/Lizenzdateien;
der verpflichtende Vollbuild erzeugt diese Dateien weiterhin. Aus diesen lokalen Ordnergrößen wird keine Ersparnis bei Produktionsimages abgeleitet.</p>

<h2>Wiederholung</h2>
<p>Voraussetzungen: Node 24.22.1, Abhängigkeiten des Lockfiles, PostgreSQL-Werkzeuge, ein echter Redis-Server mit CLI,
Java sowie die lokalen Keycloak- und Liquibase-Distributionen. Alle Server dürfen ausschließlich die eigene synthetische Fixture verwenden.</p>
<pre>NX_DAEMON=false NX_NO_CLOUD=true npx nx run backend:compare-builds --skip-nx-cache
NX_DAEMON=false NX_NO_CLOUD=true npx nx run backend:compare-build-common-checks --skip-nx-cache

# Für webpack, rspack und tsc jeweils separat ausführen:
npx nx run backend:verify-build-runtime-pilot --variant=rspack --phase=codebook --skip-nx-cache
npx nx run backend:verify-build-runtime-pilot --variant=rspack --phase=worker --skip-nx-cache
npx nx run backend:verify-build-runtime-pilot --variant=rspack --phase=browser --skip-nx-cache

python3 tools/backend-build-comparison/report.py</pre>
<p>Die Rohmessungen, Laufzeitberichte, Metadaten, OpenAPI-Dokumente und Logs werden unter <code>tmp/backend-build-comparison</code> gespeichert.
Private Authentifizierungszustände und Fixture-Passwörter gehören nicht in ein veröffentlichtes Beweisarchiv.</p>
<p class="small">Referenzen: <a href="https://docs.nestjs.com/migration-guide#webpack-deprecation-in-cli-workflows">NestJS 12 / Rspack</a>,
<a href="https://nx.dev/docs/technologies/build-tools/rspack/executors">Nx-Rspack-Executor</a>,
<a href="https://docs.nestjs.com/recipes/swc">SWC und Metadaten</a>.</p>
</article></body></html>'''
(DEST / 'bericht.html').write_text(document)
print(DEST / 'bericht.html')
