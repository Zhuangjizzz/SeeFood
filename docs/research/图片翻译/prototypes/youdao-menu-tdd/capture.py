"""Capture authorized real Youdao responses, keeping credentials in memory only."""
import importlib.util
import json
from pathlib import Path
import sys
import termios
import time
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('youdao_smoke', ROOT.parent / 'youdao-render/run.py')
caller = importlib.util.module_from_spec(spec)
spec.loader.exec_module(caller)
previous = termios.tcgetattr(sys.stdin)
hidden = list(previous)
hidden[3] &= ~termios.ECHO
termios.tcsetattr(sys.stdin, termios.TCSANOW, hidden)
print('等待临时凭证（不回显，不落盘）。', flush=True)
try:
    credentials = json.loads(sys.stdin.readline())
finally:
    termios.tcsetattr(sys.stdin, termios.TCSANOW, previous)
while True:
    print('输入 baseline / tiles / quit：', flush=True)
    command = sys.stdin.readline().strip()
    if command in {'', 'quit'}: break
    if command == 'baseline':
        paths = sorted((ROOT.parents[1] / 'imgs').glob('test*'))
        output = ROOT / 'fixtures/baseline'
    elif command == 'tiles':
        paths = sorted((ROOT / 'fixtures/inputs').glob('*.png'))
        output = ROOT / 'fixtures/tiles'
    else:
        print('未知指令', flush=True)
        continue
    output.mkdir(parents=True, exist_ok=True)
    for path in paths:
        for language in ['en', 'ja', 'ko', 'es']:
            done = []
            if (output / 'requests.jsonl').exists():
                done = [json.loads(line) for line in (output / 'requests.jsonl').read_text().splitlines()]
            if any(r['sample_id'] == path.stem and r['language'] == language and r.get('error_code') == '0' for r in done):
                continue
            result = caller.call_api(path, language, credentials['appKey'], credentials['secret'],
                                     SimpleNamespace(render=1, model=1), output)
            if result.get('error_code') != '0':
                print('调用未通过；停止此组', flush=True)
                break
            time.sleep(1.2)
    print('此组记录完成', flush=True)
