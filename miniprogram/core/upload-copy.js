const COPY = {
  en: { uploadingBody: 'Keep this page open while your photo uploads.', uploadedBody: 'Photo uploaded and linked to this record. Processing has not started.', failedBody: 'The upload could not be completed. Your original photo is still on this device.', localFailure: 'The upload status could not be saved on this device. Your original photo is still here.' },
  ja: { uploadingBody: '写真のアップロードが終わるまで、このページを開いておいてください。', uploadedBody: '写真をアップロードし、この記録に関連付けました。処理はまだ始まっていません。', failedBody: 'アップロードを完了できませんでした。元の写真はこの端末に残っています。', localFailure: 'アップロード状態を端末に保存できませんでした。元の写真は残っています。' },
  ko: { uploadingBody: '사진 업로드가 끝날 때까지 이 페이지를 열어 두세요.', uploadedBody: '사진을 업로드해 이 기록에 연결했어요. 처리는 아직 시작되지 않았어요.', failedBody: '업로드를 완료하지 못했어요. 원본 사진은 이 기기에 남아 있어요.', localFailure: '업로드 상태를 기기에 저장하지 못했어요. 원본 사진은 남아 있어요.' },
  es: { uploadingBody: 'Mantén esta página abierta mientras se sube la foto.', uploadedBody: 'Foto subida y vinculada a este registro. El procesamiento aún no ha comenzado.', failedBody: 'No se pudo completar la subida. La foto original sigue en este dispositivo.', localFailure: 'No se pudo guardar el estado de la subida en el dispositivo. La foto original sigue aquí.' },
  'zh-CN': { uploadingBody: '图片上传期间，请保持当前页面打开。', uploadedBody: '图片已上传并关联到本条记录，尚未开始处理。', failedBody: '上传未能完成，原图仍保留在本机。', localFailure: '上传状态未能保存到本机，原图仍保留在这里。' }
};
function getUploadCopy(language) { return Object.assign({}, COPY[language] || COPY.en); }
module.exports = { getUploadCopy };
