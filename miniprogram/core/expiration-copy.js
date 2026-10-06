const COPY = {
  en: { expired: 'Temporary processing material has expired. Your saved history is still available. Send a new question or explicitly retry an unfinished task to continue.', missing: 'The original needed for this operation is no longer on this device. Add a photo or clarify your question using saved dish details.', addPhotos: 'Add a photo to this record' },
  ja: { expired: '一時的な処理データの期限が切れました。保存済みの履歴は読めます。新しく質問するか、未完了の処理を再試行してください。', missing: 'この操作に必要な原画像が端末にありません。写真を追加するか、保存済みの料理情報を使って質問を補足してください。', addPhotos: 'この記録に写真を追加' },
  ko: { expired: '임시 처리 자료가 만료됐어요. 저장된 기록은 계속 볼 수 있어요. 새 질문을 보내거나 완료되지 않은 작업을 다시 시도하세요.', missing: '이 작업에 필요한 원본이 기기에 없어요. 사진을 추가하거나 저장된 음식 정보를 바탕으로 질문을 보충하세요.', addPhotos: '이 기록에 사진 추가' },
  es: { expired: 'El material temporal de procesamiento ha caducado. El historial guardado sigue disponible. Envía una nueva pregunta o reintenta una tarea pendiente.', missing: 'El original necesario para esta acción ya no está en el dispositivo. Añade una foto o aclara la pregunta con los detalles guardados del plato.', addPhotos: 'Añadir foto a este registro' },
  'zh-CN': { expired: '临时处理材料已过期，已保存的历史仍可查看。可发送新问题，或主动重试未完成的任务。', missing: '本机已没有这次操作所需的原图。请补充照片，或基于已保存的菜品信息补充问题。', addPhotos: '为这条记录补图' }
};
function getExpirationCopy(language) { return COPY[language] || COPY.en; }
module.exports = { getExpirationCopy };
