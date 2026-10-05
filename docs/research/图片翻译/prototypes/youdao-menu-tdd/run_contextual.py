"""Capture/render contextual API translation from user-provided images."""
import json
from pathlib import Path
import sys
import termios

from menu_translation import translate_menu, image_regions, contextual_request
from replay_image import RecordedYoudao
from youdao_text import YoudaoText

ROOT=Path(__file__).resolve().parent
previous=termios.tcgetattr(sys.stdin)
hidden=list(previous)
hidden[3] &= ~termios.ECHO
termios.tcsetattr(sys.stdin, termios.TCSANOW, hidden)
print('等待临时凭证（不回显，不落盘）。',flush=True)
try:
    creds=json.loads(sys.stdin.readline())
finally:
    termios.tcsetattr(sys.stdin, termios.TCSANOW, previous)
translator=YoudaoText(creds['appKey'],creds['secret'],ROOT/'fixtures/contextual')
while True:
    print('输入文件名与语言，例如 test1.png en，或 all / quit：',flush=True)
    command=sys.stdin.readline().strip()
    if command in {'quit',''}: break
    tasks=[(p,lang) for p in sorted((ROOT.parents[1]/'imgs').glob('test*')) for lang in ['en','ja','ko','es']] if command=='all' else [(ROOT.parents[1]/'imgs'/command.split()[0],command.split()[1])]
    try:
        for path,lang in tasks:
            result=translate_menu(path,lang,RecordedYoudao(path.stem),translator)
            dest=ROOT/'results/contextual-raw'
            dest.mkdir(exist_ok=True)
            (dest/(path.stem+'-'+lang+'.png')).write_bytes(result.pop('image'))
            (dest/(path.stem+'-'+lang+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
            print(path.name,lang,'translated',len(result['regions']),'review',len(result['review']),flush=True)
    except Exception as error:
        print(type(error).__name__,str(error),flush=True)
