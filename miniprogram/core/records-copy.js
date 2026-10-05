const COPY = {
  en: {
    result: 'Record', photo: 'Photo', photos: 'photos', original: 'Original',
    uploadLabel: 'Upload', saveLabel: 'On this device', pendingUpload: 'Waiting to upload', uploading: 'Uploading', uploaded: 'Uploaded', uploadFailed: 'Upload failed',
    saving: 'Saving on this device…', saved: 'Saved on this device', saveFailed: 'Not saved', partialSave: 'Some images are unavailable',
    pendingBody: 'Your original photos are saved on this device. Upload has not started.', noDishes: 'Dish details will appear after processing.',
    recordWriteFailed: 'Couldn’t save this record. Your selected photos are still here. Free some space and retry saving.',
    originalWriteFailed: 'Couldn’t save an original photo. Your selection is still here, but this record is not saved. Free some space and retry.',
    recordReadFailed: 'Couldn’t read saved records. Try again; existing records have not been removed.',
    missingRecord: 'This record is not available on this device.', missingOriginal: 'The saved original file is unavailable. Choose the photo again before uploading.',
    invalidCapture: 'This selection could not be saved. Return and choose your photos again.',
    captureConflict: 'This confirmation does not match the saved selection. Your saved record has not changed.',
    retrySave: 'Retry saving', retryRead: 'Try reading again', openRecord: 'Open record', back: 'Back'
  },
  ja: {
    result: '記録', photo: '写真', photos: '枚', original: '元画像',
    uploadLabel: 'アップロード', saveLabel: '端末への保存', pendingUpload: 'アップロード待ち', uploading: 'アップロード中', uploaded: 'アップロード済み', uploadFailed: 'アップロード失敗',
    saving: '端末に保存中…', saved: '端末に保存済み', saveFailed: '未保存', partialSave: '一部の画像を利用できません',
    pendingBody: '元の写真は端末に保存されています。アップロードはまだ始まっていません。', noDishes: '処理が完了すると料理の情報が表示されます。',
    recordWriteFailed: '記録を保存できませんでした。選択した写真はここに残っています。空き容量を確認して保存を再試行してください。',
    originalWriteFailed: '元の写真を保存できませんでした。選択した写真は残っていますが、記録は未保存です。空き容量を確認して再試行してください。',
    recordReadFailed: '保存済みの記録を読み込めませんでした。記録は削除されていません。もう一度お試しください。',
    missingRecord: 'この端末で記録を開けません。', missingOriginal: '保存した元画像が見つかりません。アップロードする前に写真を選び直してください。',
    invalidCapture: '選択内容を保存できませんでした。戻って写真を選び直してください。',
    captureConflict: '確認内容が保存済みの選択と一致しません。保存済みの記録は変更されていません。',
    retrySave: '保存を再試行', retryRead: '読み込みを再試行', openRecord: '記録を開く', back: '戻る'
  },
  ko: {
    result: '기록', photo: '사진', photos: '장', original: '원본',
    uploadLabel: '업로드', saveLabel: '기기 저장', pendingUpload: '업로드 대기 중', uploading: '업로드 중', uploaded: '업로드됨', uploadFailed: '업로드 실패',
    saving: '기기에 저장 중…', saved: '기기에 저장됨', saveFailed: '저장되지 않음', partialSave: '일부 이미지를 사용할 수 없어요',
    pendingBody: '원본 사진이 이 기기에 저장됐어요. 업로드는 아직 시작되지 않았어요.', noDishes: '처리가 끝나면 요리 정보가 표시돼요.',
    recordWriteFailed: '기록을 저장하지 못했어요. 선택한 사진은 여기에 남아 있어요. 공간을 확보한 뒤 저장을 다시 시도해 주세요.',
    originalWriteFailed: '원본 사진을 저장하지 못했어요. 선택한 사진은 남아 있지만 기록은 저장되지 않았어요. 공간을 확보한 뒤 다시 시도해 주세요.',
    recordReadFailed: '저장한 기록을 읽지 못했어요. 기존 기록은 삭제되지 않았어요. 다시 시도해 주세요.',
    missingRecord: '이 기기에서 기록을 찾을 수 없어요.', missingOriginal: '저장한 원본 파일을 사용할 수 없어요. 업로드 전에 사진을 다시 선택해 주세요.',
    invalidCapture: '선택한 내용을 저장할 수 없어요. 돌아가서 사진을 다시 선택해 주세요.',
    captureConflict: '확인한 내용이 저장된 선택과 달라요. 저장된 기록은 바뀌지 않았어요.',
    retrySave: '저장 다시 시도', retryRead: '다시 읽기', openRecord: '기록 열기', back: '뒤로'
  },
  es: {
    result: 'Registro', photo: 'Foto', photos: 'fotos', original: 'Original',
    uploadLabel: 'Subida', saveLabel: 'En este dispositivo', pendingUpload: 'Pendiente de subir', uploading: 'Subiendo', uploaded: 'Subida completada', uploadFailed: 'Error al subir',
    saving: 'Guardando en este dispositivo…', saved: 'Guardado en este dispositivo', saveFailed: 'Sin guardar', partialSave: 'Algunas imágenes no están disponibles',
    pendingBody: 'Las fotos originales están guardadas en este dispositivo. La subida aún no ha comenzado.', noDishes: 'Los detalles de los platos aparecerán después del procesamiento.',
    recordWriteFailed: 'No se pudo guardar el registro. Las fotos seleccionadas siguen aquí. Libera espacio y vuelve a guardarlo.',
    originalWriteFailed: 'No se pudo guardar una foto original. La selección sigue aquí, pero el registro no está guardado. Libera espacio y reinténtalo.',
    recordReadFailed: 'No se pudieron leer los registros. No se ha eliminado ningún registro. Vuelve a intentarlo.',
    missingRecord: 'Este registro no está disponible en el dispositivo.', missingOriginal: 'El archivo original guardado no está disponible. Elige la foto de nuevo antes de subirla.',
    invalidCapture: 'No se pudo guardar esta selección. Vuelve atrás y elige las fotos de nuevo.',
    captureConflict: 'La confirmación no coincide con la selección guardada. El registro guardado no ha cambiado.',
    retrySave: 'Reintentar guardado', retryRead: 'Volver a leer', openRecord: 'Abrir registro', back: 'Volver'
  },
  'zh-CN': {
    result: '当前记录', photo: '图片', photos: '张', original: '原图',
    uploadLabel: '上传', saveLabel: '本机保存', pendingUpload: '待上传', uploading: '上传中', uploaded: '已上传', uploadFailed: '上传失败',
    saving: '正在保存到本机…', saved: '已保存到本机', saveFailed: '未保存', partialSave: '部分图片无法读取',
    pendingBody: '原图已保存到本机，尚未开始上传。', noDishes: '处理完成后，菜品说明会显示在这里。',
    recordWriteFailed: '记录未能保存。所选图片仍保留在这里，请清理一些空间后重试保存。',
    originalWriteFailed: '原图未能保存。所选图片仍保留在这里，但记录尚未保存，请清理一些空间后重试。',
    recordReadFailed: '未能读取已保存的记录，请重试。已有记录没有被删除。',
    missingRecord: '本机找不到这条记录。', missingOriginal: '已保存的原图文件无法读取，请在上传前重新选择图片。',
    invalidCapture: '本批图片无法保存，请返回后重新选择。',
    captureConflict: '本次确认与已保存的图片选择不一致，已有记录没有改变。',
    retrySave: '重试保存', retryRead: '重新读取', openRecord: '打开记录', back: '返回'
  }
};

function getRecordsCopy(language) { return Object.assign({}, COPY[language] || COPY.en); }
function recordError(copy, error) {
  return ({ 'storage-read': copy.recordReadFailed, 'storage-write': copy.recordWriteFailed,
    'original-write': copy.originalWriteFailed, 'record-missing': copy.missingRecord,
    'capture-invalid': copy.invalidCapture, 'capture-conflict': copy.captureConflict,
    'submission-missing': copy.invalidCapture, 'save-unavailable': copy.recordWriteFailed })[error] || '';
}

module.exports = { getRecordsCopy, recordError };
