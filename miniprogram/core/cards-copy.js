const COPY = {
  en: {
    all: 'All', dietary: 'Dietary needs', service: 'At the table', savedCards: 'cards',
    expandHint: 'Tap to show · Hold to spread', tapHint: 'Tap a card to show it to the staff',
    sortHint: 'Hold a card to change its order', dragHint: 'Drag up or down', dropPosition: 'Position', cancelDrag: 'Cancel move',
    dragCancelled: 'Move cancelled', orderSaved: 'Order saved', orderFailed: 'Order was not saved. The previous order is restored. Free some space and retry.',
    collapse: 'Collapse cards', emptyCategory: 'No cards in this category yet.', emptyLibrary: 'Your card library is empty.',
    staffTitle: 'Show to the staff', returnCards: 'Back to cards', cardMissing: 'This card is no longer available.',
    manageCard: 'Manage card', deleteCard: 'Delete card', cancel: 'Cancel', retryDelete: 'Retry deletion',
    deleteExplanation: 'Remove this card from this device.',
    deleteFailed: 'The card was not deleted. Free some space and retry.',
    deleteReadFailed: 'The card was not deleted because saved cards could not be read. Retry when storage is available.',
    storageRead: 'Your saved cards could not be read. Please retry.',
    storageWrite: 'This change could not be saved. Free some space and retry.', retry: 'Retry'
  },
  ja: {
    all: 'すべて', dietary: '食事の要望', service: 'テーブルで', savedCards: '枚',
    expandHint: 'タップで表示・長押しで広げる', tapHint: 'カードをタップして店員に見せられます',
    sortHint: '長押しでカードの順番を変更', dragHint: '上下に動かしてください', dropPosition: '位置', cancelDrag: '移動を取消',
    dragCancelled: '移動を取り消しました', orderSaved: '順番を保存しました', orderFailed: '順番を保存できず、元の順番に戻りました。空き容量を確認して再試行してください。',
    collapse: 'カードを重ねる', emptyCategory: 'この分類のカードはまだありません。', emptyLibrary: 'カードはまだありません。',
    staffTitle: '店員に見せる', returnCards: 'カードに戻る', cardMissing: 'このカードは利用できなくなりました。',
    manageCard: 'カードを管理', deleteCard: 'カードを削除', cancel: 'キャンセル', retryDelete: '削除を再試行',
    deleteExplanation: 'この端末からこのカードを削除します。',
    deleteFailed: 'カードを削除できませんでした。空き容量を確認して再試行してください。',
    deleteReadFailed: '保存したカードを読み込めないため、削除できませんでした。再試行してください。',
    storageRead: '保存したカードを読み込めませんでした。再試行してください。',
    storageWrite: '変更を保存できませんでした。空き容量を確認して、再試行してください。', retry: '再試行'
  },
  ko: {
    all: '전체', dietary: '식사 요구', service: '식탁에서', savedCards: '장',
    expandHint: '탭하여 보여 주기 · 길게 눌러 펼치기', tapHint: '카드를 탭하여 직원에게 보여 주세요',
    sortHint: '카드를 길게 눌러 순서를 바꾸세요', dragHint: '위아래로 옮기세요', dropPosition: '위치', cancelDrag: '이동 취소',
    dragCancelled: '이동을 취소했어요', orderSaved: '순서를 저장했어요', orderFailed: '순서를 저장하지 못해 이전 순서로 돌아갔어요. 공간을 확보한 뒤 다시 시도해 주세요.',
    collapse: '카드 접기', emptyCategory: '이 분류에는 아직 카드가 없어요.', emptyLibrary: '저장한 카드가 없어요.',
    staffTitle: '직원에게 보여 주기', returnCards: '카드로 돌아가기', cardMissing: '이 카드를 더 이상 사용할 수 없어요.',
    manageCard: '카드 관리', deleteCard: '카드 삭제', cancel: '취소', retryDelete: '삭제 다시 시도',
    deleteExplanation: '이 기기에서 이 카드를 삭제해요.',
    deleteFailed: '카드를 삭제하지 못했어요. 저장 공간을 확보한 뒤 다시 시도해 주세요.',
    deleteReadFailed: '저장한 카드를 읽지 못해 삭제하지 않았어요. 다시 시도해 주세요.',
    storageRead: '저장한 카드를 읽지 못했어요. 다시 시도해 주세요.',
    storageWrite: '변경 사항을 저장하지 못했어요. 저장 공간을 확보한 뒤 다시 시도해 주세요.', retry: '다시 시도'
  },
  es: {
    all: 'Todas', dietary: 'Necesidades alimentarias', service: 'En la mesa', savedCards: 'tarjetas',
    expandHint: 'Toca para mostrar · Mantén para desplegar', tapHint: 'Toca una tarjeta para mostrársela al personal',
    sortHint: 'Mantén pulsada una tarjeta para cambiar el orden', dragHint: 'Arrastra arriba o abajo', dropPosition: 'Posición', cancelDrag: 'Cancelar',
    dragCancelled: 'Movimiento cancelado', orderSaved: 'Orden guardado', orderFailed: 'No se guardó el orden. Se restauró el anterior. Libera espacio y reintenta.',
    collapse: 'Recoger tarjetas', emptyCategory: 'Todavía no hay tarjetas en esta categoría.', emptyLibrary: 'Tu biblioteca de tarjetas está vacía.',
    staffTitle: 'Mostrar al personal', returnCards: 'Volver a las tarjetas', cardMissing: 'Esta tarjeta ya no está disponible.',
    manageCard: 'Gestionar tarjeta', deleteCard: 'Eliminar tarjeta', cancel: 'Cancelar', retryDelete: 'Reintentar eliminación',
    deleteExplanation: 'Elimina esta tarjeta de este dispositivo.',
    deleteFailed: 'La tarjeta no se eliminó. Libera espacio e inténtalo de nuevo.',
    deleteReadFailed: 'No se eliminó la tarjeta porque no se pudieron leer las tarjetas guardadas. Inténtalo de nuevo.',
    storageRead: 'No se pudieron leer tus tarjetas. Inténtalo de nuevo.',
    storageWrite: 'No se pudo guardar el cambio. Libera espacio e inténtalo de nuevo.', retry: 'Reintentar'
  },
  'zh-CN': {
    all: '全部', dietary: '饮食需求', service: '餐桌沟通', savedCards: '张卡片',
    expandHint: '轻点展示，长按展开', tapHint: '轻点卡片，展示给店员',
    sortHint: '长按卡片可调整顺序', dragHint: '上下拖动卡片', dropPosition: '位置', cancelDrag: '取消拖动',
    dragCancelled: '已取消拖动', orderSaved: '顺序已保存', orderFailed: '顺序未能保存，已恢复原顺序。请清理一些空间后重试。',
    collapse: '收拢卡片', emptyCategory: '这个分类还没有卡片。', emptyLibrary: '卡库里还没有卡片。',
    staffTitle: '给店员看', returnCards: '返回卡库', cardMissing: '这张卡片已不可用。',
    manageCard: '管理卡片', deleteCard: '删除卡片', cancel: '取消', retryDelete: '重试删除',
    deleteExplanation: '从本机移除这张卡片。',
    deleteFailed: '卡片尚未删除，请清理一些空间后重试。',
    deleteReadFailed: '未能读取已保存的卡片，本次尚未删除，请重试。',
    storageRead: '未能读取已保存的卡片，请重试。',
    storageWrite: '未能保存本次修改，请清理一些空间后重试。', retry: '重试'
  }
};

function getCardsCopy(language) { return Object.assign({}, COPY[language] || COPY.en); }
module.exports = { getCardsCopy };
