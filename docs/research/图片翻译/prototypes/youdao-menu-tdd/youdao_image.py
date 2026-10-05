"""Live image API adapter; arbitrary input bytes, content-hash caching, no saved secrets."""
import base64
import hashlib
import io
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request
import uuid

from PIL import Image


class YoudaoImage:
    def __init__(self, app_key, secret, recordings):
        self.app_key, self.secret = app_key, secret
        self.recordings = Path(recordings)
        self.recordings.mkdir(parents=True, exist_ok=True)

    def translate(self, image_bytes, language):
        key = hashlib.sha256(image_bytes + language.encode() + b'pro-render1').hexdigest()
        cached = self.recordings / (key + '.json')
        if cached.exists():
            data = json.loads(cached.read_text())
            if str(data.get('errorCode')) != '0':
                raise RuntimeError('Youdao image error: ' + str(data.get('errorCode')))
            rendered = (self.recordings / (key + '.jpg')).read_bytes()
        else:
            q = base64.b64encode(image_bytes).decode()
            if len(q) >= 5_000_000:
                raise ValueError('Image API Base64 limit exceeded')
            salt, now = uuid.uuid4().hex, str(int(time.time()))
            signed = q if len(q) <= 20 else q[:10] + str(len(q)) + q[-10:]
            sign = hashlib.sha256((self.app_key + signed + salt + now + self.secret).encode()).hexdigest()
            body = {'type': '1', 'q': q, 'from': 'zh-CHS', 'to': language,
                    'appKey': self.app_key, 'salt': salt, 'curtime': now,
                    'signType': 'v3', 'sign': sign, 'render': '1', 'translateOption': '1'}
            req = urllib.request.Request('https://openapi.youdao.com/ocrtransapi',
                                         data=urllib.parse.urlencode(body).encode(),
                                         headers={'Content-Type': 'application/x-www-form-urlencoded'})
            start = time.perf_counter()
            with urllib.request.urlopen(req, timeout=90) as response:
                data = json.loads(response.read())
            if str(data.get('errorCode')) != '0':
                cached.write_text(json.dumps(data, ensure_ascii=False))
                raise RuntimeError('Youdao image error: ' + str(data.get('errorCode')))
            rendered = base64.b64decode(data.pop('render_image'), validate=True)
            Image.open(io.BytesIO(rendered)).verify()
            (self.recordings / (key + '.jpg')).write_bytes(rendered)
            data['recorded_api_ms'] = round((time.perf_counter()-start)*1000, 1)
            cached.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n')
        return {'image': rendered, 'size': list(Image.open(io.BytesIO(image_bytes)).size),
                'regions': data['resRegions']}
