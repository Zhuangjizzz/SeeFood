export const content: Record<string, { name: string; marketName: string; summary: string; dishSummary: string; details: string[]; dishDetails: string[]; uncertainty: string[] }> = {
  en: {
    name: 'Example fried rice', marketName: 'Example market-price dish', summary: 'A fixed mock example of fried rice; ingredients at this restaurant are unconfirmed.',
    dishSummary: 'A fixed mock example: this photo’s dish cannot be identified with confidence. Add a clearer photo or ask staff.',
    details: ['Possible ingredients: rice, egg and vegetables; confirm with staff.', 'Taste: commonly savory; seasoning is unconfirmed.', 'Common preparation: stir-fried; this restaurant’s method is unconfirmed.', 'Dietary note: egg and soy may be present; ask about allergens and shared equipment.', 'How to eat: commonly eaten with a spoon or chopsticks.', 'Food culture: fried rice is a common way to use cooked rice.'],
    dishDetails: ['Ingredients: cannot be confirmed from this example photo.', 'Taste: unknown; ask staff.', 'Preparation: unknown; ask how it is cooked.', 'Dietary note: allergens and dietary suitability require confirmation.', 'How to eat: ask whether parts should be removed or heated.', 'Food culture: no cultural identification is inferred without a reliable dish name.'],
    uncertainty: ['This is generated example content, not confirmed information about this restaurant.', 'Confirm ingredients, preparation and price with staff.']
  },
  ja: {
    name: '炒飯の例', marketName: '時価料理の例', summary: '炒飯についての固定の模擬例です。この店の食材は未確認です。',
    dishSummary: '固定の模擬例：写真だけでは料理を特定できません。鮮明な写真を追加するか、店員に確認してください。',
    details: ['主な食材の推測：米、卵、野菜の可能性があります。店員に確認してください。', '味：一般に塩味ですが、この店の味付けは未確認です。', '一般的な作り方：炒めます。この店の調理法は未確認です。', '食事上の注意：卵や大豆を含む可能性があります。アレルゲンや器具の共用を確認してください。', '食べ方：一般にスプーンや箸で食べます。', '食文化：炒飯は炊いたご飯を活用する身近な料理です。'],
    dishDetails: ['主な食材：この例の写真では確認できません。', '味：不明です。店員に確認してください。', '作り方：不明です。調理法を確認してください。', '食事上の注意：アレルゲンや食事制限への適合は要確認です。', '食べ方：取り除く部分や加熱の必要があるか確認してください。', '食文化：料理名が不明なため文化的な説明は推測しません。'],
    uncertainty: ['生成された模擬内容であり、この店の確認済み情報ではありません。', '食材、調理法、価格を店員に確認してください。']
  },
  ko: {
    name: '볶음밥 예시', marketName: '시가 요리 예시', summary: '볶음밥에 대한 고정 모의 예시입니다. 이 식당의 재료는 확인되지 않았습니다.',
    dishSummary: '고정 모의 예시: 사진만으로 요리를 확실히 알 수 없습니다. 더 선명한 사진을 추가하거나 직원에게 확인하세요.',
    details: ['주요 재료 추정: 밥, 달걀, 채소가 들어갈 수 있습니다. 직원에게 확인하세요.', '맛: 보통 짭짤하지만 이 식당의 양념은 확인되지 않았습니다.', '일반적인 조리법: 볶습니다. 이 식당의 조리법은 확인되지 않았습니다.', '식이 주의: 달걀이나 대두가 들어갈 수 있습니다. 알레르기 유발 성분과 공용 조리 도구를 확인하세요.', '먹는 법: 보통 숟가락이나 젓가락으로 먹습니다.', '식문화: 볶음밥은 지은 밥을 활용하는 흔한 요리입니다.'],
    dishDetails: ['주요 재료: 이 예시 사진으로 확인할 수 없습니다.', '맛: 알 수 없습니다. 직원에게 확인하세요.', '조리법: 알 수 없습니다. 어떻게 조리하는지 확인하세요.', '식이 주의: 알레르기 유발 성분과 식이 제한 적합성을 확인해야 합니다.', '먹는 법: 제거할 부분이나 가열할 필요가 있는지 물어보세요.', '식문화: 요리 이름이 확실하지 않아 문화적 정체성을 추정하지 않습니다.'],
    uncertainty: ['생성된 예시이며 이 식당에서 확인한 정보가 아닙니다.', '재료, 조리법, 가격은 직원에게 확인하세요.']
  },
  es: {
    name: 'Arroz frito de ejemplo', marketName: 'Plato de ejemplo a precio de mercado', summary: 'Un ejemplo simulado de arroz frito; los ingredientes de este restaurante no están confirmados.',
    dishSummary: 'Un ejemplo simulado: no se puede identificar el plato con confianza. Añade una foto más clara o pregunta al personal.',
    details: ['Posibles ingredientes: arroz, huevo y verduras; consulta al personal.', 'Sabor: suele ser salado; el condimento de este restaurante no está confirmado.', 'Preparación habitual: salteado; el método de este restaurante no está confirmado.', 'Nota dietética: puede contener huevo y soja; pregunta por alérgenos y utensilios compartidos.', 'Cómo comerlo: normalmente con cuchara o palillos.', 'Cultura: el arroz frito es una forma habitual de aprovechar arroz cocido.'],
    dishDetails: ['Ingredientes: no se pueden confirmar con esta foto de ejemplo.', 'Sabor: desconocido; pregunta al personal.', 'Preparación: desconocida; pregunta cómo se cocina.', 'Nota dietética: hay que confirmar alérgenos y compatibilidad con tus restricciones.', 'Cómo comerlo: pregunta si debes quitar alguna parte o calentarlo.', 'Cultura: no se atribuye una tradición sin identificar el plato de forma fiable.'],
    uncertainty: ['Es contenido de ejemplo generado, no información confirmada de este restaurante.', 'Confirma ingredientes, preparación y precio con el personal.']
  },
  'zh-CN': {
    name: '示例炒饭', marketName: '示例时价菜', summary: '这是炒饭的固定模拟示例，本店实际食材尚未确认。',
    dishSummary: '固定模拟示例：无法可靠确定照片中的菜品身份，请补充清晰照片或向店员确认。',
    details: ['主要食材推测：可能包含米饭、鸡蛋和蔬菜，请向店员确认。', '口味：常见做法偏咸鲜，本店调味尚未确认。', '常见做法：翻炒制作，本店实际做法尚未确认。', '饮食提示：可能包含鸡蛋或大豆，请确认过敏原及厨具共用情况。', '吃法：通常可用勺子或筷子食用。', '饮食文化：炒饭是利用熟米饭的一种常见烹饪方式。'],
    dishDetails: ['主要食材：无法从示例照片中确认。', '口味：未知，请向店员确认。', '做法：未知，请询问烹饪方式。', '饮食提示：过敏原及是否符合饮食限制均待确认。', '吃法：请确认是否有需去除的部分或需加热。', '饮食文化：没有可靠菜名时不推断文化归属。'],
    uncertainty: ['以上为生成的模拟内容，不是本店已确认信息。', '食材、做法与价格请向店员确认。']
  }
};
