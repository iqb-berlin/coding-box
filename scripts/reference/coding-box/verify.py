"""Check the sealed corpus, or re-seal only after both independent oracles pass."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent
repo = root.parents[2]
args = argparse.ArgumentParser()
args.add_argument('--refresh', action='store_true', help='requires R and the documented R packages')
options = args.parse_args()
subprocess.run(['python3', str(root/'generate.py'), '--check'], cwd=repo, check=True)
if options.refresh:
    subprocess.run(['Rscript', str(root/'normalize-workshop.R'), '--check'], cwd=repo, check=True)
    subprocess.run(['Rscript', str(root/'verify-upstream.R'), '--check'], cwd=repo, check=True)
    subprocess.run(['Rscript', str(root/'verify-independent.R')], cwd=repo, check=True)
files = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
         for p in sorted(root.rglob('*')) if p.is_file() and p.name != 'verification.json'
         and '__pycache__' not in p.parts}
proof = root/'verification.json'
if options.refresh:
    version = subprocess.check_output(['Rscript', '--version'], text=True).strip()
    proof.write_text(json.dumps(dict(method='Python specification arithmetic + pinned eatPrepTBA R completion + separate R arithmetic',
                                    rVersion=version, files=files), ensure_ascii=False, indent=2)+'\n')
else:
    assert json.loads(proof.read_text())['files'] == files, 'Corpus changed: independently verify with verify.py --refresh'
print('All corpus inputs and verification sources match the independent verification record.')
