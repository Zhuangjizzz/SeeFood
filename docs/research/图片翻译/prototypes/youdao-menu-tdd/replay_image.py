"""Replay recorded external image API responses by exact image hash."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent

class RecordedYoudao:
    def __init__(self, sample, group='baseline'):
        self.sample, self.group = sample, group

    def translate(self, image_bytes, language):
        digest = hashlib.sha256(image_bytes).hexdigest()
        directory = ROOT / 'fixtures' / self.group
        rows = [json.loads(line) for line in (directory / 'requests.jsonl').read_text().splitlines()]
        row = next((r for r in rows if r['source_sha256'] == digest and r['language'] == language), None)
        if row is None:
            directory = ROOT / 'fixtures/tiles'
            rows = [json.loads(line) for line in (directory / 'requests.jsonl').read_text().splitlines()]
            row = next(r for r in rows if r['source_sha256'] == digest and r['language'] == language)
        return {'image': (directory / row['images'][0]['file']).read_bytes(),
                'size': row['source_size'], 'regions': row['regions']}
