"""Youdao contextual translation API adapter, plus exact-request offline replay."""
import hashlib
import json
from pathlib import Path
import time
import urllib.request
import urllib.parse
import urllib.error
import uuid

PROMPT = Path(__file__).with_name('prompt.txt').read_text().strip()
ENDPOINT = 'https://openapi.youdao.com/proxy/http/llm-trans'


def request_key(text, language, prompt=PROMPT):
    return hashlib.sha256(json.dumps([text, language, prompt], ensure_ascii=False).encode()).hexdigest()


class YoudaoText:
    def __init__(self, app_key, secret, recordings):
        self.app_key, self.secret = app_key, secret
        self.recordings = Path(recordings)
        self.recordings.mkdir(parents=True, exist_ok=True)

    def translate(self, text, language):
        key = request_key(text, language)
        dest = self.recordings / (key + '.json')
        if dest.exists():
            record = json.loads(dest.read_text())
            if record.get('status') == 'success':
                return record['translation']
        salt, now = uuid.uuid4().hex, str(int(time.time()))
        truncated = text if len(text) <= 20 else text[:10] + str(len(text)) + text[-10:]
        sign = hashlib.sha256((self.app_key + truncated + salt + now + self.secret).encode()).hexdigest()
        body = {'appKey': self.app_key, 'salt': salt, 'curtime': now, 'sign': sign, 'signType': 'v3',
                'i': text, 'prompt': PROMPT, 'from': 'zh-CHS', 'to': language,
                'streamType': 'full', 'handleOption': '0'}
        req = urllib.request.Request(ENDPOINT, data=urllib.parse.urlencode(body).encode(),
                                     headers={'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'text/event-stream'})
        start = time.perf_counter()
        events, full, code = [], '', 'missing'
        with urllib.request.urlopen(req, timeout=90) as response:
            http = response.status
            for line in response:
                decoded = line.decode().strip()
                if not decoded or decoded in {'data: [DONE]', '[DONE]'}:
                    continue
                if decoded.startswith('data:'):
                    decoded = decoded[5:].strip()
                if not decoded.startswith('{'):
                    continue
                event = json.loads(decoded)
                events.append(event)
                code = str(event.get('code', event.get('errorCode', 'missing')))
                if code != '0':
                    break
                full = event.get('data', {}).get('transFull', full)
        record = {'key': key, 'language': language, 'text': text, 'prompt': PROMPT,
                  'translation': full, 'code': code, 'http': http, 'events': events,
                  'api_ms': round((time.perf_counter() - start) * 1000, 1),
                  'status': 'success' if code == '0' and full else 'error'}
        dest.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({k: record[k] for k in ['key', 'language', 'status', 'code', 'api_ms']}, ensure_ascii=False), flush=True)
        if record['status'] != 'success':
            raise RuntimeError('Youdao text API did not succeed: ' + code)
        return full


class ReplayText:
    def __init__(self, recordings):
        self.recordings = Path(recordings)

    def translate(self, text, language):
        path = self.recordings / (request_key(text, language) + '.json')
        record = json.loads(path.read_text())
        if record['status'] != 'success':
            raise RuntimeError('Recorded text API error: ' + record['code'])
        return record['translation']
