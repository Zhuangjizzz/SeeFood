"""Translate any local image through the general research pipeline."""
import argparse
import getpass
import json
import os
from pathlib import Path

from menu_translation import translate_menu
from replay_image import RecordedYoudao
from youdao_image import YoudaoImage
from youdao_text import YoudaoText, ReplayText

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('image', type=Path)
parser.add_argument('--language', choices=['en','ja','ko','es','zh-CHS'], default='en')
parser.add_argument('--output', type=Path, default=ROOT/'results/local-contextual')
parser.add_argument('--replay', action='store_true', help='Use only exact recorded external responses; no calls')
args = parser.parse_args()
if args.replay:
    image_api, text_api = RecordedYoudao(args.image.stem), ReplayText(ROOT/'fixtures/contextual')
elif args.language == 'zh-CHS':
    image_api, text_api = None, None
else:
    app = os.environ.get('YOUDAO_APP_KEY') or getpass.getpass('有道应用 ID：')
    secret = os.environ.get('YOUDAO_APP_SECRET') or getpass.getpass('有道应用密钥：')
    image_api = YoudaoImage(app,secret,ROOT/'fixtures/live-image')
    text_api = YoudaoText(app,secret,ROOT/'fixtures/contextual')
result=translate_menu(args.image,args.language,image_api,text_api)
args.output.mkdir(parents=True,exist_ok=True)
(args.output/'translated.png').write_bytes(result.pop('image'))
(args.output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print('已保存结果；待核对事项：', len(result['review']))
