const COPY = {
  en: {
    empty: 'No saved records yet', emptyBody: 'Take a photo or choose a menu to start a record.',
    description: 'Saved menus, dishes and conversations on this device.',
    offline: 'You’re offline. Read saved content; connect to create new results.',
    missingImages: 'Some images are unavailable offline.',
    localBody: 'Saved text, original photos, translated images and conversations stay on this device without an expiry date. Unsaved images are unavailable offline. Clearing this device’s data removes these records.',
    processingLabel: 'Processing', processing: 'Processing', partial: 'Some content is ready', partialFailed: 'Some processing failed', complete: 'Processing complete', failed: 'Processing failed',
    positionFailed: 'Couldn’t save your reading position. Existing content is still available.'
  },
  ja: {
    empty: '保存した記録はまだありません', emptyBody: '写真を撮るかメニューを選んで、記録を始めましょう。',
    description: 'この端末に保存したメニュー、料理、会話です。',
    offline: 'オフラインです。保存済みの内容を読めます。新しい結果を作るには接続してください。',
    missingImages: '一部の画像はオフラインで利用できません。',
    localBody: '保存済みの文章、元画像、翻訳画像、会話は、この端末に期限なく残ります。未保存の画像はオフラインでは使えません。端末のデータを消去すると記録は削除されます。',
    processingLabel: '処理', processing: '処理中', partial: '一部の内容を利用できます', partialFailed: '一部の処理が失敗しました', complete: '処理完了', failed: '処理失敗',
    positionFailed: '閲覧位置を保存できませんでした。保存済みの内容は引き続き読めます。'
  },
  ko: {
    empty: '저장한 기록이 아직 없어요', emptyBody: '사진을 찍거나 메뉴를 선택해 기록을 시작하세요.',
    description: '이 기기에 저장한 메뉴, 요리와 대화예요.',
    offline: '오프라인이에요. 저장한 내용은 읽을 수 있어요. 새 결과를 만들려면 연결해 주세요.',
    missingImages: '일부 이미지는 오프라인에서 사용할 수 없어요.',
    localBody: '저장한 글, 원본 사진, 번역 이미지와 대화는 만료 없이 이 기기에 남아요. 저장하지 않은 이미지는 오프라인에서 사용할 수 없어요. 기기 데이터를 지우면 기록도 삭제돼요.',
    processingLabel: '처리', processing: '처리 중', partial: '일부 내용을 볼 수 있어요', partialFailed: '일부 처리에 실패했어요', complete: '처리 완료', failed: '처리 실패',
    positionFailed: '읽던 위치를 저장하지 못했어요. 기존 내용은 계속 읽을 수 있어요.'
  },
  es: {
    empty: 'Aún no hay registros guardados', emptyBody: 'Haz una foto o elige un menú para crear un registro.',
    description: 'Menús, platos y conversaciones guardados en este dispositivo.',
    offline: 'Sin conexión. Puedes leer lo guardado; conéctate para crear nuevos resultados.',
    missingImages: 'Algunas imágenes no están disponibles sin conexión.',
    localBody: 'El texto, las fotos originales, las imágenes traducidas y las conversaciones guardadas permanecen en este dispositivo sin caducidad. Las imágenes sin guardar no están disponibles sin conexión. Borrar los datos del dispositivo elimina estos registros.',
    processingLabel: 'Procesamiento', processing: 'Procesando', partial: 'Parte del contenido está listo', partialFailed: 'Parte del procesamiento ha fallado', complete: 'Procesamiento completado', failed: 'Error de procesamiento',
    positionFailed: 'No se pudo guardar la posición de lectura. El contenido sigue disponible.'
  },
  'zh-CN': {
    empty: '还没有保存的记录', emptyBody: '拍摄照片或从相册选择菜单，开始一条记录。',
    description: '本机保存的菜单、菜品和对话。',
    offline: '当前离线。已保存内容仍可阅读，新生成内容需要联网。',
    missingImages: '部分图片尚不可离线使用。',
    localBody: '已保存的文字、原图、译图和对话保留在本机，默认不过期。未保存的图片无法离线使用；清除本机数据会移除这些记录。',
    processingLabel: '处理', processing: '处理中', partial: '部分内容已可阅读', partialFailed: '部分处理失败', complete: '处理完成', failed: '处理失败',
    positionFailed: '未能保存阅读位置，已有内容仍可阅读。'
  }
};
function getHistoryCopy(language) { return { ...(COPY[language] || COPY.en) }; }
module.exports = { getHistoryCopy };
