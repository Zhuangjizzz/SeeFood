const COPY = {
  en: { retryCards: 'Retry dish cards', retryTranslation: 'Retry image translation', continueCards: 'Continue dish-card submission', continueTranslation: 'Continue image submission', retryPending: 'Retry acceptance is not confirmed. Check progress or continue when online.', retryError: 'Could not complete this action. Your saved content is still available.' },
  ja: { retryCards: '料理カードを再試行', retryTranslation: '画像翻訳を再試行', continueCards: '料理カードの送信を続ける', continueTranslation: '翻訳画像の送信を続ける', retryPending: '再試行の受付は未確認です。オンラインで進行状況を確認するか続行してください。', retryError: '操作を完了できませんでした。保存済みの内容は引き続き使えます。' },
  ko: { retryCards: '음식 카드 다시 시도', retryTranslation: '이미지 번역 다시 시도', continueCards: '음식 카드 제출 계속', continueTranslation: '이미지 번역 제출 계속', retryPending: '재시도 접수가 확인되지 않았어요. 온라인에서 진행 상황을 확인하거나 계속하세요.', retryError: '작업을 완료하지 못했어요. 저장된 내용은 계속 사용할 수 있어요.' },
  es: { retryCards: 'Reintentar fichas de platos', retryTranslation: 'Reintentar traducción de imagen', continueCards: 'Continuar envío de fichas', continueTranslation: 'Continuar envío de traducción', retryPending: 'No se ha confirmado el reintento. Revisa el progreso o continúa con conexión.', retryError: 'No se pudo completar la acción. El contenido guardado sigue disponible.' },
  'zh-CN': { retryCards: '重试生成菜品卡片', retryTranslation: '重试生成译图', continueCards: '继续提交菜品卡片任务', continueTranslation: '继续提交译图任务', retryPending: '重试是否已接收尚未确认，请联网后查看进度或继续。', retryError: '操作未完成，已保存的内容仍然可用。' }
};
function getStageRetryCopy(language) { return COPY[language] || COPY.en; }
module.exports = { getStageRetryCopy };
