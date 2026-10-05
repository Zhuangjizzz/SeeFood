"""Independent real-menu semantic checks; missing successful API evidence is a failure."""
import json
from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parent
RESULTS=ROOT/'results/contextual-raw'
# Independently read from the source images. These values are acceptance evidence only,
# never imported by runtime translation code.
CASES={
    'en': {'粉丝': r'(?i)(glass|starch|vermicelli|cellophane).*noodle|vermicelli',
           '地三鲜': r'(?i)(potato|aubergine|eggplant|pepper)',
           '香烤带鱼48元': r'(?i)(ribbonfish|hairtail|cutlassfish|beltfish|sable)',
           '肥牛卷（金针菇+沙葱）': r'(?i)(enoki).*(chive|allium|desert onion)'},
    'ja': {'粉丝': r'春雨|でんぷん麺',
           '地三鲜': r'(じゃがいも|ジャガイモ|なす|茄子|ピーマン)',
           '香烤带鱼48元': r'太刀魚|タチウオ',
           '肥牛卷（金针菇+沙葱）': r'(えのき|エノキ).*(ねぎ|ネギ|葱|ニラ)'},
    'ko': {'粉丝': r'당면', '地三鲜': r'감자|가지|피망',
           '香烤带鱼48元': r'갈치',
           '肥牛卷（金针菇+沙葱）': r'팽이.*(부추|파|양파)'},
    'es': {'粉丝': r'(?i)(fideos).*(cristal|vidrio|almidón)|vermicelli',
           '地三鲜': r'(?i)(patata|papa|berenjena|pimiento)',
           '香烤带鱼48元': r'(?i)(pez sable|pez cinta|pez espada de cinta|ribbonfish)',
           '肥牛卷（金针菇+沙葱）': r'(?i)(enoki).*(cebollino|allium|cebolla.*desierto)'}
}


def source_key(text):
    return re.sub(r'\s+','',text).replace('(','（').replace(')','）')


class RealMenuAcceptance(unittest.TestCase):
    def test_four_languages_have_successful_real_api_evidence_and_correct_key_meanings(self):
        for language, cases in CASES.items():
            with self.subTest(language=language):
                rows=[]
                for sample in ['test1','test2','test3-long']:
                    path=RESULTS/(sample+'-'+language+'.json')
                    self.assertTrue(path.exists(), 'Missing successful contextual API evidence: '+path.name)
                    rows.extend(json.loads(path.read_text())['regions'])
                by_source={source_key(r['source']):r for r in rows}
                for name,pattern in cases.items():
                    self.assertIn(name,by_source)
                    text=by_source[name]['translation'] or ''
                    self.assertRegex(text,pattern,name+' needs human semantic review')
                # Clear species or ingredient substitutions remain unacceptable.
                fish=by_source['香烤带鱼48元']['translation'] or ''
                self.assertNotRegex(fish, r'(?i)cuttlefish|squid|eel|鰆|ウナギ|うなぎ|오징어|장어|calamar|sepia|anguila')


if __name__=='__main__':
    unittest.main()
