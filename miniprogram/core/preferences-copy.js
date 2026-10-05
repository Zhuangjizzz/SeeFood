// Option meanings and content sources are recorded in docs/product/preferences-content.md.
const OPTIONS = {
  allergies: ['peanuts', 'tree-nuts', 'milk', 'egg', 'fish', 'crustacean-shellfish', 'wheat', 'soy', 'sesame'],
  restrictions: ['vegetarian', 'vegan', 'no-pork', 'no-alcohol', 'halal', 'kosher'],
  tastes: ['mild', 'light', 'sweet']
};

const COPY = {
  en: {
    intro: 'Keep allergies, restrictions and tastes separate. Changes apply after you save.',
    allergies: 'Allergies', restrictions: 'Dietary restrictions', tastes: 'Taste preferences',
    allergiesHint: 'These options do not cover every allergy. Add exact foods and check ingredients and cross-contact with staff. No warning does not mean a dish is safe.',
    restrictionsHint: 'Vegetarian excludes meat and fish but allows eggs and dairy; vegan excludes animal ingredients. Add any stricter or religious requirements below. Confirm ingredients, preparation and certification with staff.',
    tastesHint: 'These are taste preferences. Add ingredients you dislike below.',
    additional: 'Additional details', optional: 'Optional', placeholder: 'Add any other needs in your own words',
    save: 'Save preferences', saved: 'Preferences saved', edit: 'Edit preferences',
    savedEmpty: 'Saved with no preferences specified', emptyGroup: 'None specified',
    storageRead: 'Couldn’t read your saved preferences. Try again before editing.',
    storageWrite: 'Couldn’t save on this device. Your changes are still here. Free some space and try again.',
    peanuts: 'Peanuts', 'tree-nuts': 'Tree nuts', milk: 'Milk', egg: 'Eggs', fish: 'Fish',
    'crustacean-shellfish': 'Crustaceans (shrimp, crab)', wheat: 'Wheat', soy: 'Soy', sesame: 'Sesame',
    vegetarian: 'Vegetarian', vegan: 'Vegan', 'no-pork': 'No pork', 'no-alcohol': 'No alcohol',
    halal: 'Halal requirements', kosher: 'Kosher requirements', mild: 'Mild', light: 'Light seasoning', sweet: 'Sweet flavors'
  },
  ja: {
    intro: 'アレルギー、食事制限、味の好みを分けて記録します。保存後に反映されます。',
    allergies: 'アレルギー', restrictions: '食事制限', tastes: '味の好み',
    allergiesHint: 'すべてのアレルギーを網羅していません。具体的な食品を追記し、原材料や調理中の混入をお店に確認してください。注意表示がなくても安全とは限りません。',
    restrictionsHint: 'ここではベジタリアンは肉・魚を避け、卵・乳を含める意味です。ヴィーガンは動物由来の食材を避けます。追加条件や宗教上の条件を追記し、原材料・調理方法・認証をお店に確認してください。',
    tastesHint: '味の好みとして記録します。苦手な食材は下に追記できます。',
    additional: '補足', optional: '任意', placeholder: 'ほかの希望を自由に記入してください',
    save: '設定を保存', saved: '設定を保存しました', edit: '設定を編集',
    savedEmpty: '希望を指定せずに保存済み', emptyGroup: '指定なし',
    storageRead: '保存済みの食事設定を読み込めませんでした。編集する前に再試行してください。',
    storageWrite: '端末に保存できませんでした。編集中の内容は残っています。空き容量を確認して再試行してください。',
    peanuts: '落花生', 'tree-nuts': '木の実類', milk: '乳', egg: '卵', fish: '魚',
    'crustacean-shellfish': '甲殻類（えび・かに）', wheat: '小麦', soy: '大豆', sesame: 'ごま',
    vegetarian: 'ベジタリアン', vegan: 'ヴィーガン', 'no-pork': '豚肉を避ける', 'no-alcohol': 'アルコールを避ける',
    halal: 'ハラールの条件あり', kosher: 'コーシャの条件あり', mild: '辛さ控えめ', light: '薄味', sweet: '甘い味'
  },
  ko: {
    intro: '알레르기, 식사 제한, 맛 선호를 따로 기록해요. 저장한 뒤 적용돼요.',
    allergies: '알레르기', restrictions: '식사 제한', tastes: '맛 선호',
    allergiesHint: '모든 알레르기가 포함된 목록은 아니에요. 정확한 식품을 추가하고 재료와 조리 중 혼입 여부를 직원에게 확인하세요. 경고가 없어도 안전하다는 뜻은 아니에요.',
    restrictionsHint: '여기서 채식은 고기와 생선을 제외하고 달걀과 유제품은 허용해요. 비건은 동물성 재료를 제외해요. 더 엄격한 조건이나 종교적 요건을 적고 재료, 조리 방법, 인증을 직원에게 확인하세요.',
    tastesHint: '맛의 선호로 기록해요. 싫어하는 재료는 아래에 적어 주세요.',
    additional: '추가 설명', optional: '선택', placeholder: '그 밖의 요구 사항을 직접 적어 주세요',
    save: '선호 저장', saved: '선호를 저장했어요', edit: '선호 수정',
    savedEmpty: '지정한 선호 없이 저장했어요', emptyGroup: '지정하지 않음',
    storageRead: '저장한 식사 선호를 읽지 못했어요. 수정하기 전에 다시 시도해 주세요.',
    storageWrite: '기기에 저장하지 못했어요. 수정 내용은 남아 있어요. 공간을 확보한 뒤 다시 시도해 주세요.',
    peanuts: '땅콩', 'tree-nuts': '견과류', milk: '우유', egg: '달걀', fish: '생선',
    'crustacean-shellfish': '갑각류 (새우, 게)', wheat: '밀', soy: '대두', sesame: '참깨',
    vegetarian: '채식', vegan: '비건', 'no-pork': '돼지고기 제외', 'no-alcohol': '알코올 제외',
    halal: '할랄 요건', kosher: '코셔 요건', mild: '덜 맵게', light: '담백하게', sweet: '달콤한 맛'
  },
  es: {
    intro: 'Registra alergias, restricciones y gustos por separado. Los cambios se aplican al guardar.',
    allergies: 'Alergias', restrictions: 'Restricciones alimentarias', tastes: 'Preferencias de sabor',
    allergiesHint: 'La lista no incluye todas las alergias. Añade los alimentos concretos y confirma los ingredientes y el contacto cruzado con el personal. La ausencia de avisos no garantiza seguridad.',
    restrictionsHint: 'Vegetariano excluye carne y pescado, pero permite huevos y lácteos; vegano excluye ingredientes animales. Añade otros requisitos, incluidos los religiosos. Confirma ingredientes, preparación y certificación con el personal.',
    tastesHint: 'Estas opciones indican tus gustos. Añade abajo los ingredientes que no te gustan.',
    additional: 'Detalles adicionales', optional: 'Opcional', placeholder: 'Describe cualquier otra necesidad con tus palabras',
    save: 'Guardar preferencias', saved: 'Preferencias guardadas', edit: 'Editar preferencias',
    savedEmpty: 'Guardado sin preferencias especificadas', emptyGroup: 'Sin especificar',
    storageRead: 'No se pudieron leer tus preferencias. Reinténtalo antes de editarlas.',
    storageWrite: 'No se pudo guardar. Tus cambios siguen aquí. Libera espacio y vuelve a intentarlo.',
    peanuts: 'Cacahuetes', 'tree-nuts': 'Frutos de cáscara', milk: 'Leche', egg: 'Huevos', fish: 'Pescado',
    'crustacean-shellfish': 'Crustáceos (gambas, cangrejo)', wheat: 'Trigo', soy: 'Soja', sesame: 'Sésamo',
    vegetarian: 'Vegetariano', vegan: 'Vegano', 'no-pork': 'Sin cerdo', 'no-alcohol': 'Sin alcohol',
    halal: 'Requisitos halal', kosher: 'Requisitos kosher', mild: 'Poco picante', light: 'Sabor suave', sweet: 'Sabores dulces'
  },
  'zh-CN': {
    intro: '过敏、饮食限制和口味偏好分别记录，统一保存后生效。',
    allergies: '过敏信息', restrictions: '饮食限制', tastes: '口味偏好',
    allergiesHint: '选项不能涵盖所有过敏原。请补充具体食物，并向店员核对配料和制作中交叉接触的情况。没有提示不代表可以放心食用。',
    restrictionsHint: '这里的素食指不吃肉和鱼、可接受蛋奶；纯素不摄入动物来源食材。宗教饮食及其他条件请补充，配料、制作条件与认证仍需向店员确认。',
    tastesHint: '这里记录口味喜好，不喜欢的食材也可以在下方补充。',
    additional: '文字补充', optional: '选填', placeholder: '用自己的话补充其他需求',
    save: '保存饮食偏好', saved: '饮食偏好已保存', edit: '修改饮食偏好',
    savedEmpty: '已保存，尚未填写具体偏好', emptyGroup: '未填写',
    storageRead: '未能读取已保存的偏好，请重试后再编辑。',
    storageWrite: '未能保存到本机，编辑内容仍保留。请清理一些空间后重试。',
    peanuts: '花生', 'tree-nuts': '树坚果', milk: '乳', egg: '蛋', fish: '鱼',
    'crustacean-shellfish': '甲壳类（虾、蟹）', wheat: '小麦', soy: '大豆', sesame: '芝麻',
    vegetarian: '素食', vegan: '纯素', 'no-pork': '不吃猪肉', 'no-alcohol': '不摄入酒精',
    halal: '清真饮食要求', kosher: '犹太洁食要求', mild: '少辣', light: '清淡', sweet: '甜口'
  }
};

function getPreferencesCopy(language) { return Object.assign({}, COPY[language] || COPY.en); }

module.exports = { OPTIONS, getPreferencesCopy };
