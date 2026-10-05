"""General image translation pipeline. No menu names, sample paths, or fixed image coordinates."""
import io
from pathlib import Path
import re
from xml.etree import ElementTree
from xml.sax.saxutils import escape

from PIL import Image, ImageDraw, ImageFont, ImageOps

PRICE = re.compile(r'(?:[¥￥]\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*元|[零一二三四五六七八九十百千万两]+元)(?:\s*[/／]\s*[^\s\d，。；、()（）<>]+)?')


def image_regions(original, image_translator):
    source = ImageOps.exif_transpose(Image.open(io.BytesIO(original))).convert('RGB')
    collected = []
    if source.height <= 2048 and source.width <= 2048:
        parts = [(0, 0, source)]
    else:
        parts = [(x, y, source.crop((x, y, min(x + 1600, source.width), min(y + 1600, source.height))))
                 for y in range(0, source.height, 1400) for x in range(0, source.width, 1400)]
    for xoff, yoff, tile in parts:
        data = original if len(parts) == 1 else io.BytesIO()
        if len(parts) != 1:
            tile.save(data, format='PNG')
            data = data.getvalue()
        response = image_translator.translate(data, 'en')
        for parent in response['regions']:
            rawlines = parent.get('lines') or [{'text': parent['context'], 'boundingBox': parent['boundingBox']}]
            lines, pending = [], None
            for rawline in rawlines:
                text = rawline['text'].strip()
                box = [int(n) for n in rawline['boundingBox'].split(',')]
                # Join soft wraps indicated by unclosed brackets, regardless of the words.
                if pending:
                    px, py, pw, ph = pending['box']
                    pending['text'] += text
                    pending['box'] = [min(px, box[0]), min(py, box[1]),
                                      max(px+pw, box[0]+box[2])-min(px,box[0]),
                                      max(py+ph, box[1]+box[3])-min(py,box[1])]
                else:
                    pending = {'text': text, 'box': box, 'words': rawline.get('words', [])}
                if pending['text'].count('（') + pending['text'].count('(') <= pending['text'].count('）') + pending['text'].count(')'):
                    lines.append(pending)
                    pending = None
            if pending:
                lines.append(pending)
            for line in lines:
                x, y, w, h = line['box']
                # The overlap's central area supplies complete text at tile edges.
                if (xoff + 1600 < source.width and x+w/2 >= 1400) or (yoff + 1600 < source.height and y+h/2 >= 1400):
                    continue
                if h <= 2 or w <= 2 or not line['text']:
                    continue
                box = [x+xoff, y+yoff, w, h]
                if any(existing['source'] == line['text'] and abs(existing['box'][0]-box[0]) < 8
                       and abs(existing['box'][1]-box[1]) < 8 for existing in collected):
                    continue
                words = []
                for word in line.get('words', []):
                    wx,wy,ww,wh = map(int, word['boundingBox'].split(','))
                    words.append({'text': word.get('text',word.get('word','')), 'box': [wx+xoff,wy+yoff,ww,wh]})
                collected.append({'source': line['text'], 'box': box, 'words': words})
    return source, collected


def contextual_request(regions):
    rows = []
    for index, region in enumerate(regions):
        source = escape(region['source'])
        protected = PRICE.sub(lambda m: '<keep>' + m[0] + '</keep>', source)
        rows.append(f'<item id="{index}">{protected}</item>')
    return '\n'.join(rows)


def translate_regions(regions, language, text_translator):
    # Chunk on item boundaries, using the documented 5000-character API limit.
    groups, current, length = [], [], 0
    for region in regions:
        size = len(contextual_request([region]))
        if current and length + size > 4000:
            groups.append(current)
            current, length = [], 0
        current.append(region)
        length += size
    if current:
        groups.append(current)
    output = []
    for group in groups:
        raw = text_translator.translate(contextual_request(group), language)
        try:
            root = ElementTree.fromstring('<root>' + raw + '</root>')
            items = list(root)
            if [item.attrib.get('id') for item in items] != [str(i) for i in range(len(group))]:
                raise ValueError('Text API changed item identities')
            if any(item.tag != 'item' for item in items):
                raise ValueError('Text API returned unexpected tags')
            accepted = []
            for region, item in zip(group, items):
                text = ''.join(item.itertext()).strip()
                prices = PRICE.findall(region['source'])
                protected = [keep.text for keep in item if keep.tag == 'keep']
                if protected != prices or PRICE.findall(text) != prices:
                    raise ValueError('Text API changed an original price')
                price_only = PRICE.fullmatch(region['source']) is not None
                accepted.append({**region, 'translation': text,
                                 'basis': 'original-price' if price_only else 'youdao-contextual-api', 'review': []})
            output.extend(accepted)
        except (ElementTree.ParseError, ValueError) as error:
            output.extend({**region, 'translation': None, 'basis': 'untranslated', 'review': [str(error)]}
                          for region in group)
    return output


def render(original, regions, language):
    image = original.copy()
    draw = ImageDraw.Draw(image)
    font_path = '/System/Library/Fonts/AppleSDGothicNeo.ttc' if language == 'ko' else '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
    for region in regions:
        x, y, width, height = region['box']
        text = region.get('translation')
        if not text or text == region['source']:
            region['drawn_text'] = text
            continue
        price_match = PRICE.search(region['source'])
        protected_box = None
        if price_match:
            # Find inline price glyphs from OCR character boxes, rather than guessed coordinates.
            words = region.get('words', [])
            compact = ''.join(word['text'] for word in words)
            price = re.sub(r'\s+','',price_match[0])
            start = compact.find(price)
            selected, position = [], 0
            if start >= 0:
                for word in words:
                    end = position + len(word['text'])
                    if end > start and position < start + len(price):
                        selected.append(word['box'])
                    position = end
            if not selected:
                region['review'].append('Inline price position unavailable; original region preserved')
                region.update(drawn_text=None,text_fits=False)
                continue
            px=min(b[0] for b in selected); py=min(b[1] for b in selected)
            pr=max(b[0]+b[2] for b in selected); pb=max(b[1]+b[3] for b in selected)
            protected_box=(px,py,pr,pb)
            if px > x:
                width = min(width, px-x-2)
            else:
                region['review'].append('Inline price intersects translation area; original region preserved')
                region.update(drawn_text=None,text_fits=False)
                continue
            text = text.replace(price_match[0], '', 1).strip()
        # Limit redraw to the original text area; no neighbouring picture or price is cleared.
        for size in range(max(9, height), 5, -1):
            font = ImageFont.truetype(font_path, size)
            bbox = draw.textbbox((0, 0), text, font=font)
            if bbox[2]-bbox[0] <= width and bbox[3]-bbox[1] <= height:
                break
        fits = bbox[2]-bbox[0] <= width and bbox[3]-bbox[1] <= height
        if size < 9 or not fits:
            region['review'].append('Translation needs more layout space')
            region.update(drawn_text=None, text_fits=False)
            continue
        background = original.getpixel((max(0,x-1), max(0,y-1)))
        brightness = sum(background) / 3
        draw.rectangle((x,y,x+width,y+height),fill=background)
        draw.text((x-bbox[0],y-bbox[1]),text,font=font,fill='black' if brightness>140 else 'white')
        if protected_box:
            image.paste(original.crop(protected_box), protected_box[:2])
        region.update(drawn_text=text,text_fits=True,font_pixels=size)
    data=io.BytesIO()
    image.save(data, format='PNG')
    return data.getvalue()


def translate_menu(image_path, target_language, image_translator, text_translator=None):
    original = Path(image_path).read_bytes()
    if target_language == 'zh-CHS':
        image = Image.open(io.BytesIO(original))
        return {'image': original, 'size': list(image.size), 'regions': [], 'review': []}
    source, regions = image_regions(original, image_translator)
    if text_translator is None:
        issue = 'Contextual text API is unavailable; translation is incomplete'
        return {'image': original, 'size': list(source.size),
                'regions': [{**region, 'translation': None, 'basis': 'untranslated', 'review': [issue]}
                            for region in regions], 'review': [issue]}
    translated = translate_regions(regions, target_language, text_translator)
    return {'image': render(source, translated, target_language), 'size': list(source.size), 'regions': translated,
            'review': [issue for region in translated for issue in region['review']]}
