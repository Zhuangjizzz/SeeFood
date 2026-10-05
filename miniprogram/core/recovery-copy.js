const COPY = {
  en: { checking: 'Checking processing status', checkAgain: 'Check progress again' },
  ja: { checking: '処理の受付状況を確認中', checkAgain: '進捗を再確認' },
  ko: { checking: '처리 접수 상태 확인 중', checkAgain: '진행 상태 다시 확인' },
  es: { checking: 'Comprobando el estado del procesamiento', checkAgain: 'Volver a consultar el progreso' },
  'zh-CN': { checking: '正在确认处理状态', checkAgain: '重新查询进度' }
};
function getRecoveryCopy(language) { return Object.assign({}, COPY[language] || COPY.en); }
module.exports = { getRecoveryCopy };
