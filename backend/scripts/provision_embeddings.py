"""Download a version-recorded public embedding model; no LLM key or private data."""
import argparse
import hashlib
import json
import os
from pathlib import Path

os.environ['HF_HUB_DISABLE_XET'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
from huggingface_hub import HfApi, snapshot_download

parser = argparse.ArgumentParser()
parser.add_argument('--destination', default=os.getenv('EMBEDDING_MODEL_PATH', './data/models/all-MiniLM-L6-v2'))
parser.add_argument('--revision', help='Optional exact public model commit for reproducible provisioning')
args = parser.parse_args()
path = Path(args.destination).resolve()
repo = 'sentence-transformers/all-MiniLM-L6-v2'
revision = args.revision or HfApi().model_info(repo).sha
snapshot_download(repo, revision=revision, local_dir=str(path), cache_dir=str(path.parent / '.download-cache'),
                  allow_patterns=['*.json', '*.txt', '*.safetensors'], max_workers=2)
weights = path / 'model.safetensors'
if not weights.is_file():
    raise SystemExit('Model did not contain safe-tensor weights; not provisioned.')
marker = {'repository': repo, 'revision': revision, 'weights_sha256': hashlib.sha256(weights.read_bytes()).hexdigest()}
(path / 'insightiq-model.json').write_text(json.dumps(marker, indent=2))
print(json.dumps({'provisioned': str(path), **marker}))
