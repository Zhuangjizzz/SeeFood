const COPY = {
  en: { uploadingBody: 'Keep this page open while your photo uploads.', uploadedBody: 'Photo uploaded and linked to this record. Processing has not started.', failedBody: 'The upload could not be completed. Your original photo is still on this device.', localFailure: 'The upload status could not be saved on this device.' },
  ja: { uploadingBody: '写真のアップロードが終わるまで、このページを開いておいてください。', uploadedBody: '写真をアップロードし、この記録に関連付けました。処理はまだ始まっていません。', failedBody: 'アップロードを完了できませんでした。元の写真はこの端末に残っています。', localFailure: 'アップロード状態を端末に保存できませんでした。' },
  ko: { uploadingBody: '사진 업로드가 끝날 때까지 이 페이지를 열어 두세요.', uploadedBody: '사진을 업로드해 이 기록에 연결했어요. 처리는 아직 시작되지 않았어요.', failedBody: '업로드를 완료하지 못했어요. 원본 사진은 이 기기에 남아 있어요.', localFailure: '업로드 상태를 기기에 저장하지 못했어요.' },
  es: { uploadingBody: 'Mantén esta página abierta mientras se sube la foto.', uploadedBody: 'Foto subida y vinculada a este registro. El procesamiento aún no ha comenzado.', failedBody: 'No se pudo completar la subida. La foto original sigue en este dispositivo.', localFailure: 'No se pudo guardar el estado de la subida en el dispositivo.' },
  'zh-CN': { uploadingBody: '图片上传期间，请保持当前页面打开。', uploadedBody: '图片已上传并关联到本条记录，尚未开始处理。', failedBody: '上传未能完成，原图仍保留在本机。', localFailure: '上传状态未能保存到本机。' }
};
const RECOVERY = {
  en: { interrupted: 'Upload interrupted', resuming: 'Resuming upload', retryUpload: 'Continue upload',
    interruptedBody: 'Your original photo is saved on this device. When connected, tap Continue upload to resume.',
    resumingBody: 'Continuing the upload for this photo. Keep this page open until it finishes.' },
  ja: { interrupted: 'アップロード中断', resuming: 'アップロード再開中', retryUpload: 'アップロードを再開',
    interruptedBody: '元の写真はこの端末に保存されています。接続後に「アップロードを再開」を押してください。',
    resumingBody: 'この写真のアップロードを再開しています。完了までこのページを開いておいてください。' },
  ko: { interrupted: '업로드 중단', resuming: '업로드 재개 중', retryUpload: '업로드 계속',
    interruptedBody: '원본 사진이 이 기기에 저장돼 있어요. 연결 후 업로드 계속을 눌러 주세요.',
    resumingBody: '이 사진의 업로드를 계속하고 있어요. 끝날 때까지 이 페이지를 열어 두세요.' },
  es: { interrupted: 'Subida interrumpida', resuming: 'Reanudando subida', retryUpload: 'Continuar subida',
    interruptedBody: 'La foto original está guardada en este dispositivo. Cuando tengas conexión, pulsa Continuar subida.',
    resumingBody: 'Se está reanudando la subida de esta foto. Mantén esta página abierta hasta que termine.' },
  'zh-CN': { interrupted: '上传中断', resuming: '恢复上传中', retryUpload: '继续上传',
    interruptedBody: '原图已保存在本机。联网后请点击“继续上传”。',
    resumingBody: '正在继续上传这张图片，完成前请保持当前页面打开。' }
};
function getUploadCopy(language) { return Object.assign({}, COPY[language] || COPY.en, RECOVERY[language] || RECOVERY.en); }
module.exports = { getUploadCopy };
