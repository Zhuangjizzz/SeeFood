const COPY = {
  en: {
    all: 'All', dietary: 'Dietary needs', service: 'At the table', savedCards: 'cards',
    expandHint: 'Tap to show · Hold to spread', tapHint: 'Tap a card to show it to the staff',
    collapse: 'Collapse cards', emptyCategory: 'No cards in this category yet.', emptyLibrary: 'Your card library is empty.',
    staffTitle: 'Show to the staff', returnCards: 'Back to cards', cardMissing: 'This card is no longer available.',
    storageRead: 'Your saved cards could not be read. Please retry.',
    storageWrite: 'This change could not be saved. Free some space and retry.', retry: 'Retry'
  },
  ja: {
    all: 'すべて', dietary: '食事の要望', service: 'テーブルで', savedCards: '枚',
    expandHint: 'タップで表示・長押しで広げる', tapHint: 'カードをタップして店員に見せられます',
    collapse: 'カードを重ねる', emptyCategory: 'この分類のカードはまだありません。', emptyLibrary: 'カードはまだありません。',
    staffTitle: '店員に見せる', returnCards: 'カードに戻る', cardMissing: 'このカードは利用できなくなりました。',
    storageRead: '保存したカードを読み込めませんでした。再試行してください。',
    storageWrite: '変更を保存できませんでした。空き容量を確認して、再試行してください。', retry: '再試行'
  },
  ko: {
    all: '전체', dietary: '식사 요구', service: '식탁에서', savedCards: '장',
    expandHint: '탭하여 보여 주기 · 길게 눌러 펼치기', tapHint: '카드를 탭하여 직원에게 보여 주세요',
    collapse: '카드 접기', emptyCategory: '이 분류에는 아직 카드가 없어요.', emptyLibrary: '저장한 카드가 없어요.',
    staffTitle: '직원에게 보여 주기', returnCards: '카드로 돌아가기', cardMissing: '이 카드를 더 이상 사용할 수 없어요.',
    storageRead: '저장한 카드를 읽지 못했어요. 다시 시도해 주세요.',
    storageWrite: '변경 사항을 저장하지 못했어요. 저장 공간을 확보한 뒤 다시 시도해 주세요.', retry: '다시 시도'
  },
  es: {
    all: 'Todas', dietary: 'Necesidades alimentarias', service: 'En la mesa', savedCards: 'tarjetas',
    expandHint: 'Toca para mostrar · Mantén para desplegar', tapHint: 'Toca una tarjeta para mostrársela al personal',
    collapse: 'Recoger tarjetas', emptyCategory: 'Todavía no hay tarjetas en esta categoría.', emptyLibrary: 'Tu biblioteca de tarjetas está vacía.',
    staffTitle: 'Mostrar al personal', returnCards: 'Volver a las tarjetas', cardMissing: 'Esta tarjeta ya no está disponible.',
    storageRead: 'No se pudieron leer tus tarjetas. Inténtalo de nuevo.',
    storageWrite: 'No se pudo guardar el cambio. Libera espacio e inténtalo de nuevo.', retry: 'Reintentar'
  },
  'zh-CN': {
    all: '全部', dietary: '饮食需求', service: '餐桌沟通', savedCards: '张卡片',
    expandHint: '轻点展示，长按展开', tapHint: '轻点卡片，展示给店员',
    collapse: '收拢卡片', emptyCategory: '这个分类还没有卡片。', emptyLibrary: '卡库里还没有卡片。',
    staffTitle: '给店员看', returnCards: '返回卡库', cardMissing: '这张卡片已不可用。',
    storageRead: '未能读取已保存的卡片，请重试。',
    storageWrite: '未能保存本次修改，请清理一些空间后重试。', retry: '重试'
  }
};

function getCardsCopy(language) { return Object.assign({}, COPY[language] || COPY.en); }
module.exports = { getCardsCopy };
