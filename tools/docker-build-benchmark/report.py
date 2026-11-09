#!/usr/bin/env python3
"""Render the measured Docker comparison with explicit CI and cache boundaries."""
from pathlib import Path
from datetime import datetime
import argparse
import html
import json

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'tmp/docker-build-benchmark'
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, default=DATA / 'report')
OUT = parser.parse_args().output
OUT.mkdir(parents=True, exist_ok=True)


def read(name, default):
    path = DATA / name
    return json.loads(path.read_text()) if path.exists() else default


def esc(value):
    return html.escape(str(value))


def secs(value):
    if value is None:
        return 'ausstehend'
    if value < 60:
        return f'{value:.1f} s'.replace('.', ',')
    n = round(value)
    return f'{n // 60}:{n % 60:02d} min'


def stamp(value):
    return datetime.fromisoformat(value).timestamp()


experiment = read('experiment.json', {})
summary = read('summary.json', {'variants': {}})
ci = read('ci-results.json', {'runs': []})
runs = {r['variant']: r for r in ci['runs']}
all_done = len(runs) == 2 and all(r['pipeline']['status'] == 'success' for r in runs.values())
labels = {'before': 'Vorher', 'after': 'Nachher'}
cases = {'Kalter Neubau': ['cold-builder', 'cold-runtime-base-pull', 'cold-production'],
         'Unverändert wiederholen': ['warm-builder', 'warm-production'],
         'Nur Quellcode ändern': ['source-builder', 'source-production']}
case_rows = ''
for label, phase_names in cases.items():
    values = {}
    for variant in labels:
        phases = summary['variants'].get(variant, {}).get('phases', {})
        required = phase_names if variant == 'before' else [phase_names[-1]]
        valid = all(p in phases and phases[p]['exitCode'] == 0 for p in required)
        values[variant] = sum(phases[p]['wallSeconds'] for p in required) if valid else None
    improvement = None
    if values['before'] and values['after'] is not None:
        improvement = 100 * (values['before'] - values['after']) / values['before']
    case_rows += f'''<tr><th>{esc(label)}</th><td>{secs(values['before'])}</td><td>{secs(values['after'])}</td>
      <td>{f'{improvement:.1f} %'.replace('.', ',') if improvement is not None else 'ausstehend'}</td></tr>'''

ci_rows = ''
jobs_sections = ''
cache_rows = ''
image_rows = ''
for variant, label in labels.items():
    expected = experiment.get(variant) or {}
    run = runs.get(variant, {})
    p = run.get('pipeline', {})
    if p:
        assert p['id'] == expected['pipelineId'] and p['sha'] == expected['sha']
    elapsed = stamp(p['finished_at']) - stamp(p['created_at']) if p.get('finished_at') else None
    url = f'https://scm.cms.hu-berlin.de/iqb/coding-box/-/pipelines/{expected.get("pipelineId", "")}'
    ci_rows += f'''<tr><th>{label}</th><td><a href="{url}">#{expected.get('pipelineId') or 'ausstehend'}</a></td>
      <td>{esc(p.get('status', 'ausstehend'))}</td><td>{secs(elapsed)}</td><td>{secs(p.get('duration'))}</td>
      <td>{secs(p.get('queued_duration'))}</td><td><code>{esc(expected.get('sha', ''))}</code></td></tr>'''
    data = summary['variants'].get(variant, {})
    size = f'{data["imageBytes"] / 1024**2:.1f} MiB' if data else 'ausstehend'
    image_rows += f'''<tr><th>{label}</th><td>{size}</td><td>{esc(data.get('platform', 'ausstehend'))}</td>
      <td>{data.get('entityCount', 'ausstehend')}</td><td><code>{esc(data.get('artifact', {}).get('artifactSha256', 'ausstehend'))}</code></td></tr>'''
    for phase, details in data.get('phases', {}).items():
        for item in details['installations']:
            cache_rows += f'''<tr><th>{label}</th><td>{esc(phase)}</td><td>{esc(item['stage'])}</td>
              <td>{'CACHED' if item['cached'] else secs(item['seconds'])}</td><td><code>{esc(item['command'])}</code></td></tr>'''
    job_rows = ''.join(f'''<tr><td><a href="https://scm.cms.hu-berlin.de/iqb/coding-box/-/jobs/{j['id']}">{esc(j['name'])}</a></td>
      <td>{esc(j['status'])}</td><td>{secs(j.get('duration'))}</td><td>{secs(j.get('queued_duration'))}</td>
      <td>{esc(j.get('runner', ''))}</td></tr>''' for j in run.get('jobs', []))
    jobs_sections += f'<h3>{label}</h3><table><tr><th>Job</th><th>Status</th><th>Dauer</th><th>Queue</th><th>Runner</th></tr>{job_rows}</table>'

state = ('Beide vollständigen GitLab-Pipelines sind erfolgreich beendet.' if all_done else
         'Die Remote-Messung ist noch nicht vollständig beendet. Zahlen werden erst nach erfolgreichem Abschluss übernommen.')
verdict = 'APPROVE' if all_done and summary.get('entitySnapshotsEqual') else 'QUALIFIKATION AUSSTEHEND'
entities = 'Alle 43 Entity-Snapshots sind identisch.' if summary.get('entitySnapshotsEqual') else 'Der vollständige Vergleich der 43 Entity-Snapshots steht noch aus.'
page = f'''<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kodierbox – Docker-Optimierung mit Webpack</title><style>
body{{font:16px/1.55 system-ui,sans-serif;color:#173047;max-width:1250px;margin:32px auto;padding:0 24px}}
h1{{line-height:1.2}}h2{{margin-top:32px}}table{{border-collapse:collapse;width:100%;font-size:13px;margin:16px 0}}th,td{{border:1px solid #cfdae3;text-align:left;vertical-align:top;padding:9px}}th{{background:#edf3f7}}code{{font-size:12px;overflow-wrap:anywhere}}pre{{white-space:pre-wrap;background:#edf3f7;padding:15px}}.notice{{background:#edf3fb;border-left:5px solid #346895;padding:18px}}.scroll{{overflow-x:auto}}a{{color:#235f95}}</style>
<h1>Kodierbox: Docker-Optimierung mit Webpack</h1>
<p class="notice"><strong>{state}</strong><br>Webpack und Anwendungscode bleiben unverändert. Referenz: <code>{esc(experiment.get('baseline', ''))}</code>, abgerufenes <code>origin/develop</code> vom 6. November 2026.</p>
<h2>Docker vorher und nachher</h2>
<table><tr><th>Fall</th><th>Vorher</th><th>Nachher</th><th>Beobachtete Verkürzung</th></tr>{case_rows}</table>
<p>Gemessen wird die vollständige Bauzeit bis zum lokal nutzbaren Backend-Produktionsimage. Vorher werden Builder, Runtime-Basis-Pull und Produktionsbau nacheinander addiert; nachher erledigt Bake dieselbe Arbeit in einem verbundenen Buildgraphen. Native-/API-/Worker-Prüfungen und Artefaktübertragung stehen außerhalb dieser Bauzeit. Parallele interne Schritte werden nicht addiert.</p>
<h2>Was geändert wurde</h2>
<ol><li>Docker Bake verbindet den bestehenden Root-Builder direkt mit <code>apps/backend/Dockerfile</code>. Der Builder bleibt im BuildKit-Cache; nur das Runtime-Image wird exportiert. Die bisherigen Dockerfiles und der vollständige Entwickler-/Test-Builder bleiben nutzbar.</li>
<li><code>package.json</code>, <code>package-lock.json</code> und <code>vendor</code> werden vor dem Quellcode kopiert. Eine Quellcodeänderung soll die Installation der Entwicklungsabhängigkeiten wiederverwenden.</li>
<li>Die produktive Installation verwendet eine eigene vollständige Bookworm-Node-Stufe statt des bereits kompilierten Workspace-Images. Ihre Eingaben sind weiterhin die Paketdateien und <code>vendor</code> aus dem passenden Builder. Native Module behalten Python/make/g++, Node und die gepinnte npm-Version.</li>
<li>GitLab speichert nur noch den npm-Downloadcache <code>.npm</code> im Cachearchiv. <code>node_modules</code> bleibt als notwendiges Artefakt für alle Folgejobs erhalten. <code>npm ci</code> erzeugt diesen Baum ohnehin neu; das zusätzliche Cachearchiv ist redundant. Der neue Schlüssel <code>npm-downloads-v1</code> verhindert eine Vermischung mit alten Cachearchiven. Der erste Lauf baut diesen neuen Downloadcache auf; ein sofortiger Warm-Cache-Vorteil wird für ihn nicht unterstellt.</li>
<li>Beide Installationen verwenden <code>--prefer-offline</code>. Lockfile, Paketversionen und Integritätsprüfungen bleiben erhalten. Die APT-Paketlisten werden aus dem fertigen Runtime-Layer entfernt.</li></ol>
<h2>Installation und Cache: tatsächlicher Nachweis</h2>
<table><tr><th>Stand</th><th>Messphase</th><th>Stufe</th><th>Zeit / Cache</th><th>Originalbefehl</th></tr>{cache_rows}</table>
<p><code>CACHED</code> stammt aus dem originalen BuildKit-Log. Der kalte Fall beginnt mit einem eigenen leeren Docker-in-Docker-Daemon und verwendet <code>--no-cache</code>. Externe Registry- und Dependency-Proxy-Caches werden nicht geleert. Die beiden Wiederholungsfälle nutzen denselben jobeigenen Daemon. Es gibt durch diese Änderung keinen dauerhaften BuildKit-Cache zwischen unabhängigen CI-Jobs.</p>
<h2>GitLab-Gesamtlaufzeit der Vergleichspipelines</h2>
<p><strong>Messgrenze:</strong> Diese beiden Pipelines enthalten jeweils alle drei Docker-Fälle. Sie sind keine Messung der üblichen Pipeline mit nur einem Docker-Neubau.</p>
<div class="scroll"><table><tr><th>Stand</th><th>Pipeline</th><th>Status</th><th>Erstellung bis Ende</th><th>GitLab duration</th><th>Initiale Queue</th><th>SHA</th></tr>{ci_rows}</table></div>
<p>Die Vergleichsläufe werden nacheinander gestartet. Auch dann bleiben Last durch andere Projekte, Netzwerk und Runner-Warten mögliche Einflussfaktoren. Es gibt einen vollständigen Lauf pro Variante. Die beobachtete Gesamtzeit ist deshalb keine statistisch belastbare Vorhersage für jeden künftigen Commit. Die Vorher-Pipeline enthält alle drei Bauarten; die Nachher-Pipeline schaltet dieselben Zusatzmessungen ausdrücklich ein. Normale Nachher-Pipelines bauen nur einmal.</p>
<h2>Runtime und Gleichwertigkeit</h2>
<table><tr><th>Stand</th><th>Unkomprimiertes Image</th><th>Plattform</th><th>Entities</th><th>Hash des Anwendungsartefakts</th></tr>{image_rows}</table>
<p>{entities} Der bestehende Containerjob bleibt blockierend: produktive native Module, ESM-Interoperabilität, Ablehnung einer ungültigen Konfiguration, API-HTTP-200, Export-Worker, echte PostgreSQL-/Redis-Verbindungen und SIGTERM-Stopp. Hinzu kommen die regulären Backend-, Frontend-, Integrations-, Browser-, Workflow-, Lint- und Audit-Gates.</p>
<h2>Kritisches Review</h2>
<p><strong>Verdikt: {verdict}.</strong> Die Remote-Qualifikation wird erst bei vollständig erfolgreichen Pipelines als bestanden gewertet.</p>
<table><tr><th>Einordnung</th><th>Befund und Behandlung</th></tr>
<tr><td>Regression vermieden</td><td>Die zusätzlichen Wiederholungsbauten und die besondere Metadatenprobe sind ausschließlich über <code>DOCKER_BUILD_BENCHMARK=true</code> aktiv. Der Normalfall führt sie nicht aus. Der bestehende normale Job-Timeout bleibt erhalten.</td></tr>
<tr><td>Kompatibilität</td><td>Produktive Abhängigkeiten werden weiter mit dem vollständigen Workspace-Lockfile installiert; es gibt weder ein neues pruned Lockfile noch eine Wiederverwendung ungeprüfter Entwicklungs-<code>node_modules</code>. Das Backend bleibt bei Webpack und <code>main.mjs</code>.</td></tr>
<tr><td>Neue Voraussetzung</td><td>Der schnelle Produktionspfad braucht Docker Buildx/Bake. Die CI prüft dessen Version ausdrücklich. Die alten Entwickler-/Test-Builds funktionieren weiter über die vorhandenen Docker-Befehle.</td></tr>
<tr><td>Geltungsbereich</td><td>Optimiert wird der produktive Backend-Bau im Container-Gate und über den neuen Bake-Einstieg. Bestehende Release-Testpfade, die absichtlich ein vollständiges Builder-Image veröffentlichen und darin Tests ausführen, bleiben erhalten. Für diese Pfade wird kein beseitigter Layerexport behauptet.</td></tr>
<tr><td>Messgrenze</td><td>Warm- und Quellcode-Cachetreffer gelten für denselben Daemon. Sie sind kein Beweis für wiederverwendbare Installationen in jedem frischen GitLab-Job. Gesamtlaufzeiten bleiben durch andere Jobs und Auslastung beeinflusst.</td></tr>
<tr><td>Lokale Grenze</td><td>Der lokale Nx-Start und die breite lokale Qualitätssuite blieben beim Dateizugriff hängen. 31 gezielte CI-Konfigurationsprüfungen, der konkrete Installationsvertrag sowie Bake-Auflösung für Plattform und Proxy wurden separat geprüft. Ein kleiner echter Build bestätigt zusätzlich die Übergabe zwischen den Targets und die unveränderten Dateiinhalte. Der statische Check-Modus unterstützt diese Target-Verknüpfung hier nicht und wird nicht als bestandene Prüfung gewertet. Die vollständige Linux-Pipeline ist der zusätzliche erforderliche Nachweis.</td></tr></table>
<h2>Wiederholung und Nachweise</h2>
<pre>docker buildx bake --file docker-bake.json --print backend
docker buildx bake --file docker-bake.json backend
# Vergleich auf dem Nachher-Commit: vollständige manuelle GitLab-Pipeline starten mit
# DOCKER_BUILD_BENCHMARK=true, NX_SKIP_NX_CACHE=true,
# NX_DAEMON=false, NX_NO_CLOUD=true
python3 tools/docker-build-benchmark/summarize.py</pre>
<p>Die Runtime-Imagegröße ist das unkomprimierte Docker-<code>Size</code>-Feld. Der Artefakthash umfasst Anwendung, Schemas und Paketdateien ohne installierte <code>node_modules</code> und <code>vendor</code>. Rohlogs, Zeitmessungen und Entity-Snapshots werden mit SHA und Pipeline-URL verknüpft. Es wird kein Release oder Deployment ausgeführt und keine fachliche Abnahme behauptet.</p>
<p>Primärquellen: <a href="https://docs.docker.com/build/cache/optimize/">Docker: Cache optimieren</a>, <a href="https://docs.docker.com/build/bake/contexts/">Docker: verbundene Bake-Targets</a>, <a href="https://docs.npmjs.com/cli/v11/commands/npm-ci/">npm ci</a>.</p>
<h2>Einzelne CI-Jobs</h2>{jobs_sections}</html>'''
(OUT / 'bericht.html').write_text(page)
print(OUT / 'bericht.html')
