const COPY = {
  en: { manage: 'Free up space', help: 'Choose saved records to delete in History, then return here and retry saving. Unsaved content remains on this page.', return: 'Return to unsaved content', history: 'Choose records to remove. Return to the previous page to retry saving.' },
  ja: { manage: '空き容量を増やす', help: '履歴で削除する記録を選び、この画面に戻って保存を再試行してください。未保存の内容はこの画面に残ります。', return: '未保存の内容に戻る', history: '削除する記録を選んでください。前の画面に戻って保存を再試行できます。' },
  ko: { manage: '저장 공간 확보', help: '기록에서 삭제할 항목을 선택한 뒤 이 화면으로 돌아와 저장을 다시 시도하세요. 저장하지 못한 내용은 이 화면에 남습니다.', return: '저장하지 못한 내용으로 돌아가기', history: '삭제할 기록을 선택하세요. 이전 화면으로 돌아가 저장을 다시 시도할 수 있습니다.' },
  es: { manage: 'Liberar espacio', help: 'Elige registros para eliminar en Historial, vuelve aquí e intenta guardar de nuevo. El contenido sin guardar permanece en esta página.', return: 'Volver al contenido sin guardar', history: 'Elige los registros que quieres eliminar. Vuelve a la página anterior para intentar guardar de nuevo.' },
  'zh-CN': { manage: '清理存储空间', help: '到历史中选择要删除的记录，返回这里后重试保存。未保存内容会保留在当前页面。', return: '返回未保存内容', history: '请选择要移除的记录，完成后返回上一页重试保存。' }
};
function getSaveCopy(language) { return COPY[language] || COPY.en; }
module.exports = { getSaveCopy };
