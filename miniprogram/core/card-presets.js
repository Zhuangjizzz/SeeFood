const PRESETS = [
  {
    id: 'less-spicy', category: 'dietary', color: 'green', textZh: '请少放辣椒，谢谢。',
    en: ['Less spicy, please', 'Please make it less spicy. Thank you.'],
    ja: ['辛さ控えめで', '辛さを控えめにしてください。ありがとうございます。'],
    ko: ['덜 맵게 해 주세요', '덜 맵게 해 주세요. 감사합니다.'],
    es: ['Poco picante, por favor', 'Poco picante, por favor. Gracias.'],
    'zh-CN': ['请少放辣', null]
  },
  {
    id: 'water', category: 'service', color: 'blue', textZh: '请给我一杯水，谢谢。',
    en: ['Water, please', 'Could I have a glass of water, please?'],
    ja: ['お水をください', 'お水を一杯いただけますか。'],
    ko: ['물 주세요', '물 한 잔 주시겠어요?'],
    es: ['Agua, por favor', '¿Me trae un vaso de agua, por favor?'],
    'zh-CN': ['请给我水', null]
  },
  {
    id: 'ingredients', category: 'dietary', color: 'orange', textZh: '请问这道菜用了哪些食材和调料？',
    en: ['About the ingredients', 'Which ingredients and seasonings are used in this dish?'],
    ja: ['材料を教えてください', 'この料理にはどんな食材と調味料を使っていますか。'],
    ko: ['재료를 알려 주세요', '이 요리에는 어떤 재료와 양념이 들어가나요?'],
    es: ['Sobre los ingredientes', '¿Qué ingredientes y condimentos lleva este plato?'],
    'zh-CN': ['询问配料', null]
  },
  {
    id: 'tableware', category: 'service', color: 'green', textZh: '请再给我一套餐具，谢谢。',
    en: ['Extra tableware', 'Could I have another set of tableware, please?'],
    ja: ['食器をもう一組', '食器をもう一組いただけますか。'],
    ko: ['식기 한 세트 더 주세요', '식기 한 세트 더 주시겠어요?'],
    es: ['Otros cubiertos', '¿Me trae otro juego de cubiertos, por favor?'],
    'zh-CN': ['请加一套餐具', null]
  },
  {
    id: 'no-meat', category: 'dietary', color: 'green', textZh: '我不吃肉。请问这道菜含有肉、肉汤或动物油吗？',
    en: ['I do not eat meat', 'I do not eat meat. Does this dish contain meat, meat broth or animal fat?'],
    ja: ['肉を食べません', '肉を食べません。この料理に肉、肉のだし、動物性の油は入っていますか。'],
    ko: ['고기를 먹지 않아요', '고기를 먹지 않아요. 이 요리에 고기, 육수 또는 동물성 기름이 들어가나요?'],
    es: ['No como carne', 'No como carne. ¿Este plato lleva carne, caldo de carne o grasa animal?'],
    'zh-CN': ['我不吃肉', null]
  },
  {
    id: 'bill', category: 'service', color: 'orange', textZh: '请给我看一下账单，谢谢。',
    en: ['The bill, please', 'Could I see the bill, please?'],
    ja: ['お会計をお願いします', 'お会計の明細を見せていただけますか。'],
    ko: ['계산서 주세요', '계산서를 보여 주시겠어요?'],
    es: ['La cuenta, por favor', '¿Me trae la cuenta, por favor?'],
    'zh-CN': ['请给我账单', null]
  }
];

function createPresetCards(language) {
  return PRESETS.map((preset, order) => {
    const translations = {};
    ['en', 'ja', 'ko', 'es', 'zh-CN'].forEach((code) => {
      translations[code] = {
        title: preset[code][0], pairedText: preset[code][1], pairedLanguage: code
      };
    });
    return Object.assign({
      id: 'personal-preset-' + preset.id, presetId: preset.id, order,
      category: preset.category, color: preset.color, textZh: preset.textZh,
      edited: false, saveState: 'saved', translations
    }, translations[language] || translations.en);
  });
}

module.exports = { createPresetCards };
