const COPY = {
  en: {
    title: 'Create a card', create: 'Create a card', back: 'Back to cards', source: 'What would you like to say?', sourcePlaceholder: 'Write your message',
    generate: 'Generate Chinese', chinese: 'Check the Chinese', chineseHelp: 'Read and edit this text before saving.', chinesePlaceholder: 'Generate Chinese or write it here',
    titleLabel: 'Card title', category: 'Category', color: 'Card color', dietary: 'Dietary needs', service: 'At the table', green: 'Pale green', blue: 'Pale blue', orange: 'Pale orange',
    save: 'Save card', discard: 'Discard draft', continueDraft: 'Continue draft', draftFound: 'You have an unfinished card', draftSaved: 'Draft saved on this device',
    draftFailed: 'Could not save. Your draft is still here. Try again.', storageRead: 'Could not read your draft. Try again before editing.', retrySave: 'Retry saving', retryRead: 'Read again',
    generating: 'Generating Chinese…', translated: 'Chinese is ready to check', needsReview: 'Your message changed. Generate Chinese again or edit the Chinese to match.',
    offline: 'Translation needs a connection. Your draft is still here.', translationFailed: 'Chinese could not be generated. Your draft is still here.', continueTranslation: 'Continue translation',
    interrupted: 'Translation was interrupted. Continue when ready.', saved: 'Card saved', discardTitle: 'Discard this draft?', discardBody: 'The unfinished card will be removed from this device.', cancel: 'Keep editing', mock: 'Sample translation — check the text before saving.'
  },
  ja: {
    title: 'カードを作成', create: 'カードを作成', back: 'カードに戻る', source: '何を伝えたいですか？', sourcePlaceholder: '伝えたい内容を入力',
    generate: '中国語を生成', chinese: '中国語を確認', chineseHelp: '保存する前に確認・編集してください。', chinesePlaceholder: '中国語を生成するか、ここに入力',
    titleLabel: 'カードのタイトル', category: '分類', color: 'カードの色', dietary: '食事の希望', service: 'テーブルでの会話', green: '薄緑', blue: '薄青', orange: '薄橙',
    save: 'カードを保存', discard: '下書きを破棄', continueDraft: '下書きを続ける', draftFound: '未完成のカードがあります', draftSaved: '下書きをこの端末に保存しました',
    draftFailed: '保存できませんでした。下書きは残っています。再試行してください。', storageRead: '下書きを読み込めませんでした。編集前に再試行してください。', retrySave: '保存を再試行', retryRead: '再読み込み',
    generating: '中国語を生成中…', translated: '中国語を確認してください', needsReview: '原文が変わりました。中国語を再生成するか、原文に合わせて編集してください。',
    offline: '翻訳には接続が必要です。下書きは残っています。', translationFailed: '中国語を生成できませんでした。下書きは残っています。', continueTranslation: '翻訳を続ける',
    interrupted: '翻訳が中断されました。準備ができたら続けてください。', saved: 'カードを保存しました', discardTitle: '下書きを破棄しますか？', discardBody: '未完成のカードをこの端末から削除します。', cancel: '編集を続ける', mock: 'サンプル翻訳です。保存前に内容を確認してください。'
  },
  ko: {
    title: '카드 만들기', create: '카드 만들기', back: '카드로 돌아가기', source: '무엇을 말하고 싶으세요?', sourcePlaceholder: '전할 말을 입력하세요',
    generate: '중국어 생성', chinese: '중국어 확인', chineseHelp: '저장하기 전에 내용을 확인하고 수정하세요.', chinesePlaceholder: '중국어를 생성하거나 직접 입력하세요',
    titleLabel: '카드 제목', category: '분류', color: '카드 색상', dietary: '식사 요구사항', service: '식탁 대화', green: '연두색', blue: '연파랑', orange: '연주황',
    save: '카드 저장', discard: '초안 버리기', continueDraft: '초안 계속 작성', draftFound: '작성 중인 카드가 있어요', draftSaved: '초안이 이 기기에 저장되었어요',
    draftFailed: '저장하지 못했어요. 초안은 남아 있어요. 다시 시도하세요.', storageRead: '초안을 읽지 못했어요. 편집 전에 다시 시도하세요.', retrySave: '저장 재시도', retryRead: '다시 읽기',
    generating: '중국어 생성 중…', translated: '중국어를 확인해 주세요', needsReview: '원문이 바뀌었어요. 중국어를 다시 생성하거나 원문에 맞게 수정하세요.',
    offline: '번역하려면 연결이 필요해요. 초안은 남아 있어요.', translationFailed: '중국어를 생성하지 못했어요. 초안은 남아 있어요.', continueTranslation: '번역 계속하기',
    interrupted: '번역이 중단되었어요. 준비되면 계속하세요.', saved: '카드를 저장했어요', discardTitle: '초안을 버릴까요?', discardBody: '작성 중인 카드를 이 기기에서 삭제해요.', cancel: '계속 작성', mock: '예시 번역이에요. 저장 전에 내용을 확인하세요.'
  },
  es: {
    title: 'Crear tarjeta', create: 'Crear tarjeta', back: 'Volver a tarjetas', source: '¿Qué quieres decir?', sourcePlaceholder: 'Escribe tu mensaje',
    generate: 'Generar chino', chinese: 'Revisa el chino', chineseHelp: 'Lee y edita el texto antes de guardar.', chinesePlaceholder: 'Genera el chino o escríbelo aquí',
    titleLabel: 'Título de la tarjeta', category: 'Categoría', color: 'Color de la tarjeta', dietary: 'Necesidades alimentarias', service: 'En la mesa', green: 'Verde claro', blue: 'Azul claro', orange: 'Naranja claro',
    save: 'Guardar tarjeta', discard: 'Descartar borrador', continueDraft: 'Continuar borrador', draftFound: 'Tienes una tarjeta sin terminar', draftSaved: 'Borrador guardado en este dispositivo',
    draftFailed: 'No se pudo guardar. Tu borrador sigue aquí. Inténtalo de nuevo.', storageRead: 'No se pudo leer el borrador. Vuelve a intentarlo antes de editar.', retrySave: 'Reintentar guardado', retryRead: 'Volver a leer',
    generating: 'Generando chino…', translated: 'El chino está listo para revisar', needsReview: 'Tu mensaje cambió. Genera el chino de nuevo o edítalo para que coincida.',
    offline: 'La traducción necesita conexión. Tu borrador sigue aquí.', translationFailed: 'No se pudo generar el chino. Tu borrador sigue aquí.', continueTranslation: 'Continuar traducción',
    interrupted: 'La traducción se interrumpió. Continúa cuando quieras.', saved: 'Tarjeta guardada', discardTitle: '¿Descartar este borrador?', discardBody: 'La tarjeta sin terminar se eliminará de este dispositivo.', cancel: 'Seguir editando', mock: 'Traducción de ejemplo: revisa el texto antes de guardar.'
  },
  'zh-CN': {
    title: '创建沟通卡', create: '创建沟通卡', back: '返回卡库', source: '你想说的话', sourcePlaceholder: '输入想告诉店员的内容',
    generate: '生成中文', chinese: '核对中文', chineseHelp: '保存前请核对，也可以直接修改。', chinesePlaceholder: '生成中文或在此输入',
    titleLabel: '卡片标题', category: '分类', color: '卡片颜色', dietary: '饮食需求', service: '餐桌沟通', green: '浅绿', blue: '浅蓝', orange: '浅橙',
    save: '保存卡片', discard: '放弃草稿', continueDraft: '继续草稿', draftFound: '你有一张未完成的卡片', draftSaved: '草稿已保存到本机',
    draftFailed: '未能保存，草稿仍保留在当前页面，请重试。', storageRead: '未能读取草稿，请重试后再编辑。', retrySave: '重试保存', retryRead: '重新读取',
    generating: '正在生成中文…', translated: '中文已生成，请核对', needsReview: '正文已修改，请重新生成中文，或修改中文使其与正文一致。',
    offline: '翻译需要联网，草稿仍保留。', translationFailed: '未能生成中文，草稿仍保留。', continueTranslation: '继续翻译',
    interrupted: '翻译已中断，可以继续原来的请求。', saved: '卡片已保存', discardTitle: '放弃这份草稿？', discardBody: '将从本机删除这张尚未保存的卡片。', cancel: '继续编辑', mock: '模拟翻译，请核对后保存。'
  }
};
function getCardEditorCopy(language) { return COPY[language] || COPY.en; }
module.exports = { getCardEditorCopy };
