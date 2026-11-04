#!/usr/bin/env python3
"""Render real CI observations separately from the historical local estimate."""
from pathlib import Path
from datetime import datetime
import csv
import html
import json

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'tmp/backend-build-comparison'
DEST = DATA / 'report'
DEST.mkdir(exist_ok=True)

def read(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default

def esc(value):
    return html.escape(str(value))

def seconds(value):
    if value is None:
        return 'offen'
    return f'{value / 60:.2f}'.replace('.', ',') + ' min'

def stamp(value):
    return datetime.fromisoformat(value).timestamp() if value else None

experiment = read(DATA / 'ci-experiment.json', {'variants': []})
summary = read(DATA / 'ci-results.json', {'runs': []})
runs = {run['variant']: run for run in summary['runs']}
rows = ''
docker_rows = ''
job_sections = ''
metadata = {}
compiler_rows = ''
for variant in experiment['variants']:
    name = variant['variant']
    run = runs.get(name, {})
    pipeline = run.get('pipeline', {})
    jobs = run.get('jobs', [])
    elapsed = None
    if pipeline.get('finished_at'):
        elapsed = stamp(pipeline['finished_at']) - stamp(pipeline['created_at'])
    job_duration = sum(job.get('duration') or 0 for job in jobs)
    job_queue = sum(job.get('queued_duration') or 0 for job in jobs)
    rows += f'''<tr><th>{esc(name)}</th><td><a href="{esc(variant['pipelineUrl'])}">#{variant['pipelineId']}</a></td>
      <td>{esc(pipeline.get('status', 'läuft / wartet'))}</td><td>{seconds(elapsed)}</td>
      <td>{seconds(pipeline.get('duration'))}</td><td>{seconds(pipeline.get('queued_duration'))}</td>
      <td>{seconds(job_duration) if jobs else 'offen'}</td><td>{seconds(job_queue) if jobs else 'offen'}</td></tr>'''
    timing_record = read(DATA / 'ci' / name / 'build-command-timing.json', {})
    compiler_rows += f'<tr><th>{esc(name)}</th><td>{seconds(timing_record.get("elapsedSeconds"))}</td><td>{esc(timing_record.get("source", "offen"))}</td></tr>'
    directory = DATA / 'ci' / name
    timing = directory / 'dist/backend-build-comparison-ci/timings.tsv'
    times = {}
    if timing.exists():
        times = {r['step']: r for r in csv.DictReader(timing.open(), delimiter='\t')}
    image = read(directory / 'dist/backend-build-comparison-ci/image-inspect.json', [])
    entities = read(directory / 'dist/backend-build-comparison-ci/entity-metadata.json')
    if entities is not None:
        metadata[name] = entities
    size = f'{image[0]["Size"] / 1024**2:.1f} MiB' if image else 'offen'
    platform = f'{image[0]["Os"]}/{image[0]["Architecture"]}' if image else 'offen'
    def duration(step):
        entry = times.get(step)
        return seconds(float(entry['elapsed_seconds'])) if entry and entry['status'] == '0' else 'offen / fehlgeschlagen'
    container = next((j for j in jobs if j['name'] == 'test-backend-container'), {})
    docker_rows += f'''<tr><th>{esc(name)}</th><td>{duration('builder')}</td><td>{duration('runtime-base-pull')}</td>
      <td>{duration('production')}</td><td>{esc(size)}</td><td>{esc(platform)}</td>
      <td>{esc(container.get('status', 'offen'))}</td><td>{len(entities) if entities else 'offen'}</td></tr>'''
    job_rows = ''.join(f'''<tr><td><a href="https://scm.cms.hu-berlin.de/iqb/coding-box/-/jobs/{j['id']}">{esc(j['name'])}</a></td>
      <td>{esc(j['status'])}</td><td>{seconds(j.get('duration'))}</td><td>{seconds(j.get('queued_duration'))}</td>
      <td>{esc(j.get('runner', ''))}</td></tr>''' for j in jobs)
    job_sections += f'<h3>{esc(name)} – {len(jobs)} Jobs</h3><table><tr><th>Job</th><th>Status</th><th>Dauer</th><th>Wartezeit</th><th>Runner</th></tr>{job_rows}</table>'

same_metadata = len(metadata) == 3 and len(metadata['webpack']) == 43 and metadata['webpack'] == metadata['rspack'] == metadata['tsc']
metadata_text = 'Alle 43 Entity-Snapshots der frischen Linux-Produktionsimages sind identisch.' if same_metadata else 'Der Vergleich aller Linux-Entity-Snapshots ist noch offen oder weist Unterschiede auf.'
all_passed = len(runs) == 3 and all(r.get('pipeline', {}).get('status') == 'success' for r in runs.values())
state = 'Drei vollständige GitLab-Läufe abgeschlossen.' if all_passed else 'Messung noch nicht vollständig erfolgreich abgeschlossen.'
html_text = f'''<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kodierbox – kritische Nachprüfung und GitLab/Linux-Messung</title>
<style>body{{font:16px/1.55 system-ui,sans-serif;max-width:1250px;margin:32px auto;padding:0 24px;color:#142739}}
h1{{line-height:1.2}}h2{{margin-top:32px}}table{{border-collapse:collapse;width:100%;font-size:13px;margin:16px 0}}th,td{{border:1px solid #cfdbe4;padding:9px;text-align:left;vertical-align:top}}th{{background:#eef3f7}}code{{font-size:12px;overflow-wrap:anywhere}}.notice{{padding:18px;background:#edf3fb;border-left:5px solid #346895}}a{{color:#235f95}}.scroll{{overflow-x:auto}}li{{margin:8px 0}}</style>
<h1>Kodierbox: kritische Nachprüfung des Buildvergleichs</h1>
<p class="notice"><strong>{state}</strong><br>Die frühere lokale Hochrechnung ist kein Beleg für GitLab-Gesamtlaufzeit. Ein Produktivwechsel wird durch diese Hochrechnung nicht begründet.</p>
<h2>Review</h2>
<p><strong>Verdikt für einen Produktivwechsel: NEEDS DISCUSSION.</strong> Die Funktionsnachweise sind konkret; die abschließende Leistungsbewertung braucht die vollständigen CI-Ergebnisse. Die folgenden Befunde betreffen den Pilot und seine Schlussfolgerungen, nicht den bereits abgeschlossenen PR #1157.</p>
<table><tr><th>Priorität</th><th>Befund</th><th>Korrektur / Zustand</th></tr>
<tr><td>P2</td><td>Der Produktions-Dockerfile ersetzt das ESM-Manifest der ursprünglichen ungebündelten Ausgabe durch die Workspace-Paketdatei ohne explizites <code>type</code>. Eine gezielte Gegenprobe mit genau dieser Paketdatei zeigt: Node 24.22.1 lädt auch die alte Ausgabe erfolgreich und liefert identische 43 Entities. Ein Startabsturz ist damit ausdrücklich nicht belegt.</td><td><code>build-tsc.mjs</code> hält jetzt ein eigenes explizites ESM-Manifest unter <code>runtime/</code>. Das vermeidet die Abhängigkeit von impliziter Modulerkennung. Dieser Befund wurde nach der Gegenprobe von einer zunächst vermuteten Funktionsstörung zu einer Robustheitsverbesserung korrigiert.</td></tr>
<tr><td>P2</td><td>Der ursprüngliche Bericht kennzeichnete seine lokale Hochrechnung bereits als Modell. Für die verlangte Umstiegsentscheidung fehlten trotzdem echte CI-Gesamtzeiten und frische Linux-Produktionsimages. Installation, Coverage, Frontend, parallele Jobs, Infrastruktur und Warteschlangen waren im Modell nicht enthalten.</td><td>Die Bewertung wird um den fehlenden Nachweis erweitert. Hier werden vollständige echte Pipelines mit Zeitstempeln und einzelnen Jobs erfasst; der lokale Modellwert wird nicht als gemessener CI-Vorteil verwendet.</td></tr>
<tr><td>P2</td><td>Drei lokale Vollbuilds auf einem anderweitig genutzten Rechner und zwei harmlose Watch-Szenarien belegen keinen stabilen Geschwindigkeitsgewinn. Die Wertebereiche von Webpack und Rspack überlappen.</td><td>Die lokalen Zahlen bleiben als Beobachtung erhalten. Auch ein einzelner CI-Lauf pro Variante erlaubt keine statistisch belastbare Rangfolge.</td></tr>
<tr><td>P2</td><td>Die nach Watch geprüften Ordner enthielten unterschiedliche Paket- und Lizenzdateien. Damit waren die lokalen Ordnergrößen kein fairer Produktionsgrößenvergleich.</td><td>Linux baut frische Vollartefakte und installiert identische produktive Lockfile-Abhängigkeiten. Gemessen wird das tatsächliche vollständige Image.</td></tr>
<tr><td>P2</td><td>Schlägt ein Wiederherstellungsbuild im Watch-Lauf fehl, konnte die bisherige Aufräumroutine vor dem Beenden des Compilers abbrechen.</td><td>Die Quelltextwiederherstellung läuft jetzt pro Datei; der eigene Compilerprozess wird in einem inneren <code>finally</code> beendet.</td></tr></table>
<h2>Echte GitLab-Gesamtlaufzeiten</h2>
<p>Alle drei Branches basieren auf <code>7a4197c5badd19a89c220c4c1c83e85f1cff82dd</code> und demselben gemeinsamen Versuchscommit.
Zwischen den Varianten unterscheidet sich ausschließlich der aktive Backend-Build in <code>apps/backend/project.json</code>. Anwendungscode, Tests, Lockfile und CI-Konfiguration sind identisch.</p>
<div class="scroll"><table><tr><th>Variante</th><th>Pipeline</th><th>Status</th><th>Erstellung bis Ende</th><th>GitLab duration</th><th>Initiale Queue</th><th>Summe Jobdauer</th><th>Summe Jobqueue</th></tr>{rows}</table></div>
<p><strong>Erstellung bis Ende</strong> wird direkt aus den GitLab-Zeitstempeln berechnet und enthält reale Wartezeiten. Die Summe der Jobdauern und die Summe der Jobwartezeiten sind gesonderte Größen; sie werden wegen paralleler Jobs nicht als Gesamtlaufzeit ausgegeben. Das API-Feld <code>duration</code> wird zusätzlich unverändert dokumentiert.</p>
<p>Die Läufe wurden gemeinsam ausgelöst und teilen sich den vorhandenen Runner. Das misst die tatsächlich beobachtete Laufzeit unter dieser Auslastung. Unterschiede bei Queue, Paketdownloads, Image-Proxys oder Artefakttransfer werden nicht dem Compiler zugeschrieben. Eine direkte kausale Rangfolge der Pipeline-Gesamtzeiten erfordert wiederholte Läufe unter kontrollierterer Runnerbelegung.</p>
<h2>Backend-Compiler auf Linux</h2>
<table><tr><th>Variante</th><th>Vollständiger Nx-Aufruf</th><th>Nachweis</th></tr>{compiler_rows}</table>
<p>Die Zeit wird zwischen dem gestarteten Buildbefehl und seiner erfolgreichen Nx-Abschlussmeldung aus dem originalen Joblog gemessen. Sie enthält Nx-Start, Graph und blockierenden Typcheck. Eine Compilerzeit wird nicht als Pipelinezeit ausgegeben.</p>
<h2>Frische Docker-Neubauten unter Linux</h2>
<div class="scroll"><table><tr><th>Variante</th><th>Builder inkl. npm ci und beider Apps</th><th>Runtime-Basis pull</th><th>Produktion inkl. npm ci --omit=dev</th><th>Imagegröße</th><th>Plattform</th><th>Containerjob</th><th>Entities</th></tr>{docker_rows}</table></div>
<p>Der Job verwendet einen eigenen frischen Docker-in-Docker-Daemon. Vor dem Build werden dessen Image-/Cachebestände erfasst.
Builder und Produktionsstufe verwenden <code>--no-cache</code>; der Builder zieht seine Basis mit <code>--pull</code>. Die Runtime-Basis wird separat frisch gezogen, damit der zweite Build nicht versehentlich versucht, den joblokalen Builder aus einer fremden Registry zu laden.
Der Docker-Kontext enthält weder alte <code>dist</code>-Artefakte noch <code>node_modules</code> oder Nx-Cache. Nx-Taskcache und Daemon sind deaktiviert.</p>
<p>Es werden die tatsächlichen Produktions-Dockerfiles verwendet. Der Builder kompiliert Backend und Frontend nacheinander. Die Runtime installiert dieselben produktiven Workspace-Lockfile-Abhängigkeiten samt nativen Modulen. Deshalb wird eine kleinere JavaScript-Ausgabe nicht mit einem entsprechend kleineren Gesamtimage gleichgesetzt.</p>
<p>Der bestehende Containerjob lädt Nest, PostgreSQL, XML und SQLite aus der produktiven Installation, prüft die Ablehnung einer ungültigen JWT-Konfiguration, ESM-Interoperabilität sowie den Start und SIGTERM-Stopp von API und Export-Worker mit eigenen PostgreSQL-/Redis-Containern. {metadata_text}</p>
<h2>Was die Entscheidung tragen kann</h2>
<p>Rspack bleibt ein sinnvoller Kandidat für kürzere Compilerläufe. Seine Einführung braucht weiterhin die expliziten Entity-/Swagger-Typangaben und eine gepflegte Watch-Integration. Der ungebündelte Pilot benötigt rund 110 Zeilen eigene Compiler-/Paketlogik; er ist damit aktuell kein Beleg für weniger Buildkomplexität. Die gemeinsame produktive Dependency-Installation bleibt bei allen Varianten gleich.</p>
<p>Bis ein stabiler praktischer Vorteil und eine vollständig erfolgreiche technische Qualifikation vorliegen, bleibt Webpack der freigegebene Produktionsweg. Das ist eine Entscheidung über den vorhandenen Nachweisstand, keine Aussage, dass die neueren Kandidaten grundsätzlich schlechter sind. Ein Release, Deployment oder eine fachliche Abnahme ist hiermit nicht erfolgt.</p>
<h2>Einzelne CI-Jobs</h2>{job_sections}
<h2>Nachweise und Wiederholung</h2>
<p>Die automatische Modulerkennung wird in der <a href="https://nodejs.org/download/release/v24.22.1/docs/api/packages.html#syntax-detection">Node-24.22.1-Dokumentation</a> beschrieben. Der Paketgrenzen-Befund wurde zusätzlich mit beiden tatsächlichen Ausgabelayouts reproduziert.</p>
<p>Pipeline- und Jobdaten stammen aus der <a href="https://docs.gitlab.com/api/pipelines/">GitLab Pipelines API</a> und der <a href="https://docs.gitlab.com/api/jobs/">Jobs API</a>, gelesen über die angemeldete GitLab-Sitzung.
<code>ci-experiment.json</code> bindet jeden Lauf an seinen exakten SHA. Die Docker-Artefakte enthalten Zeitmessung, vollständige Buildlogs, Daemonzustand, Image-Inspect, Artefakthash und die Entity-Snapshots.</p>
<p>Versuchsbranches: <code>measure-backend-webpack</code>, <code>measure-backend-rspack</code>, <code>measure-backend-tsc</code>. Es werden keine gemeinsamen <code>latest</code>-DB-/Liquibase-Tags bewegt und keine Anwendungsreleases oder Deployments ausgelöst. Vor einer Wiederholung dieselben SHAs verwenden und Pipeline-/Jobdaten erneut bis zum Abschluss erfassen.</p>
<p><a href="bericht.html">Historische lokale Messungen und funktionale Nachweise</a></p></html>'''
(DEST / 'review-und-ci.html').write_text(html_text)
print(DEST / 'review-und-ci.html')
