"""Behavior at the agreed image-to-result seam; test values are independent API contracts."""
import io
from pathlib import Path
import re
import tempfile
import unittest

from PIL import Image
from menu_translation import translate_menu


class ImageAPI:
    """A deterministic external API fixture with arbitrary invented menu text."""
    def translate(self, image_bytes, language):
        image = Image.open(io.BytesIO(image_bytes))
        return {'image': image_bytes, 'size': list(image.size), 'regions': [
            {'context': '紫苏烤蘑菇', 'boundingBox': '10,10,140,22',
             'lines': [{'text': '紫苏烤蘑菇', 'boundingBox': '10,10,140,22'}]},
            {'context': '¥17.6/份', 'boundingBox': '160,10,70,22',
             'lines': [{'text': '¥17.6/份', 'boundingBox': '160,10,70,22'}]}]}


class MissingIDTextAPI:
    def translate(self, text, language):
        return '<item id="0">Grilled mushrooms with perilla</item>'


class ChangedProtectedPriceAPI:
    def translate(self, text, language):
        return ('<item id="0">Grilled mushrooms with perilla</item>'
                '<item id="1"><keep>¥176/份</keep> (original ¥17.6/份)</item>')


class ArbitraryCorrectTextAPI:
    def translate(self, text, language):
        return ('<item id="0">Perilla mushroom skewers</item>'
                '<item id="1"><keep>¥17.6/份</keep></item>')


class OverlappingImageAPI:
    def translate(self, image_bytes, language):
        image = Image.open(io.BytesIO(image_bytes))
        # The first row encodes the crop origin. This models an external OCR response,
        # independently of production crop offsets.
        offset = image.getpixel((0, 0))[0] * 100
        y = 1500 - offset
        return {'image': image_bytes, 'size': list(image.size), 'regions': [] if y < 0 else [
            {'context': '番茄汤', 'boundingBox': f'10,{y},100,24',
             'lines': [{'text': '番茄汤', 'boundingBox': f'10,{y},100,24'}]}]}


class SingleItemTextAPI:
    def translate(self, text, language):
        return '<item id="0">Tomato soup</item>'


class MixedPriceImageAPI:
    def translate(self, image_bytes, language):
        image = Image.open(io.BytesIO(image_bytes))
        return {'image': image_bytes, 'size': list(image.size), 'regions': [
            {'context': '紫苏烤蘑菇 ¥17.6/份', 'boundingBox': '10,10,220,22', 'lines': [
                {'text': '紫苏烤蘑菇 ¥17.6/份', 'boundingBox': '10,10,220,22', 'words': [
                    {'text': '紫苏烤蘑菇', 'boundingBox': '10,10,140,22'},
                    {'text': '¥17.6/份', 'boundingBox': '160,10,70,22'}]}]}]}


class MixedPriceTextAPI:
    def translate(self, text, language):
        return '<item id="0">Mushrooms <keep>¥17.6/份</keep></item>'


class MenuTranslationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.image = Path(self.temporary.name) / 'arbitrary.png'
        Image.new('RGB', (400, 100), 'white').save(self.image)

    def tearDown(self):
        self.temporary.cleanup()

    def test_changed_item_identities_do_not_produce_a_completed_translation(self):
        result = translate_menu(self.image, 'en', ImageAPI(), MissingIDTextAPI())
        self.assertTrue(all(r['translation'] is None and r['review'] for r in result['regions']))
        self.assertEqual(result['image'], self.image.read_bytes())

    def test_changed_protected_price_is_rejected_even_if_original_is_also_quoted(self):
        result = translate_menu(self.image, 'en', ImageAPI(), ChangedProtectedPriceAPI())
        self.assertTrue(all(r['translation'] is None and r['review'] for r in result['regions']))

    def test_arbitrary_api_translation_is_used_and_price_pixels_are_preserved(self):
        result = translate_menu(self.image, 'en', ImageAPI(), ArbitraryCorrectTextAPI())
        self.assertEqual([r['translation'] for r in result['regions']],
                         ['Perilla mushroom skewers', '¥17.6/份'])
        self.assertEqual(result['regions'][0].get('drawn_text'), 'Perilla mushroom skewers')
        self.assertEqual(result['regions'][1].get('basis'), 'original-price')
        source = Image.open(self.image)
        rendered = Image.open(io.BytesIO(result['image']))
        self.assertEqual(rendered.crop((160, 10, 230, 32)).tobytes(), source.crop((160, 10, 230, 32)).tobytes())

    def test_chinese_target_returns_original_without_supplier_dependencies(self):
        result = translate_menu(self.image, 'zh-CHS', None, None)
        self.assertEqual(result['image'], self.image.read_bytes())

    def test_missing_text_api_preserves_image_as_an_incomplete_result(self):
        result = translate_menu(self.image, 'en', ImageAPI(), None)
        self.assertEqual(result['image'], self.image.read_bytes())
        self.assertTrue(result['review'])

    def test_overlapping_long_image_text_is_retained_once_at_original_coordinates(self):
        long = Image.new('RGB', (300, 3100), 'white')
        for y in range(3100):
            long.putpixel((0, y), (y // 100, 0, 0))
        long.save(self.image)
        result = translate_menu(self.image, 'en', OverlappingImageAPI(), SingleItemTextAPI())
        self.assertEqual([(r['source'], r['box']) for r in result['regions']],
                         [('番茄汤', [10, 1500, 100, 24])])

    def test_inline_price_is_not_repainted_with_the_dish_translation(self):
        image = Image.new('RGB', (400,100), 'white')
        for y in range(10,32):
            for x in range(160,230):
                image.putpixel((x,y), (120,40,20))
        image.save(self.image)
        result = translate_menu(self.image,'en',MixedPriceImageAPI(),MixedPriceTextAPI())
        rendered = Image.open(io.BytesIO(result['image']))
        self.assertEqual(rendered.crop((160,10,230,32)).tobytes(), image.crop((160,10,230,32)).tobytes())
        self.assertEqual(result['regions'][0].get('drawn_text'), 'Mushrooms')


if __name__ == '__main__':
    unittest.main()
