const COPY = {
  en: {
    manage: 'Manage', menu: 'Record options', deleteRecord: 'Delete', clear: 'Clear history', cancel: 'Cancel',
    deleteTitle: 'Delete this record?', clearTitle: 'Clear these records?',
    deleteBody: 'Delete “{title}” and its photos, translated images, dish cards, conversation, draft and reading position from this device. Saved personal cards stay in your library.',
    clearBody: 'Delete the {count} records currently listed, including their photos, translated images, dish cards, conversations, drafts and reading positions. Saved personal cards stay in your library.',
    cleanup: 'Deletion status', deletedRecord: 'Deleted record', localSucceeded: 'Removed from this device', localPending: 'Device cleanup pending', localFailed: 'Device cleanup failed',
    serverSucceeded: 'Temporary server material removed', serverQueued: 'Server cleanup pending', serverRunning: 'Removing temporary server material', serverFailed: 'Server cleanup needs a retry', serverNotRequired: 'No temporary server material was submitted',
    boundary: 'Server cleanup covers this service’s temporary material. It does not confirm deletion by a third-party provider.', retry: 'Retry cleanup',
    failed: 'Couldn’t save the deletion. The record is still available. Try again.', unavailable: 'This record is no longer available.', readFailed: 'Couldn’t read deletion status. Try again.'
  },
  ja: {
    manage: '管理', menu: '記録の操作', deleteRecord: '削除', clear: '履歴を消去', cancel: 'キャンセル', deleteTitle: 'この記録を削除しますか？', clearTitle: 'これらの記録を消去しますか？',
    deleteBody: '「{title}」とその写真、翻訳画像、料理カード、会話、下書き、閲覧位置をこの端末から削除します。保存した個人カードはカード一覧に残ります。',
    clearBody: '現在の一覧にある{count}件の記録と、その写真、翻訳画像、料理カード、会話、下書き、閲覧位置を削除します。保存した個人カードは残ります。',
    cleanup: '削除の状況', deletedRecord: '削除した記録', localSucceeded: 'この端末から削除済み', localPending: '端末の削除待ち', localFailed: '端末の削除に失敗',
    serverSucceeded: 'サーバーの一時データを削除済み', serverQueued: 'サーバーの削除待ち', serverRunning: 'サーバーの一時データを削除中', serverFailed: 'サーバーの削除を再試行してください', serverNotRequired: 'サーバーへの送信はありません',
    boundary: 'サーバーの削除状況は本サービスの一時データが対象です。外部提供者による削除の完了は確認しません。', retry: '削除を再試行',
    failed: '削除を保存できませんでした。記録は残っています。再試行してください。', unavailable: 'この記録は利用できません。', readFailed: '削除状況を読み込めませんでした。再試行してください。'
  },
  ko: {
    manage: '관리', menu: '기록 옵션', deleteRecord: '삭제', clear: '기록 비우기', cancel: '취소', deleteTitle: '이 기록을 삭제할까요?', clearTitle: '이 기록들을 비울까요?',
    deleteBody: '이 기기에서 “{title}” 및 해당 사진, 번역 이미지, 요리 카드, 대화, 초안과 읽던 위치를 삭제해요. 저장한 개인 카드는 카드함에 남아요.',
    clearBody: '현재 목록의 기록 {count}개와 해당 사진, 번역 이미지, 요리 카드, 대화, 초안과 읽던 위치를 삭제해요. 저장한 개인 카드는 남아요.',
    cleanup: '삭제 상태', deletedRecord: '삭제한 기록', localSucceeded: '이 기기에서 삭제됨', localPending: '기기 정리 대기 중', localFailed: '기기 정리 실패',
    serverSucceeded: '서버의 임시 자료 삭제됨', serverQueued: '서버 정리 대기 중', serverRunning: '서버의 임시 자료 삭제 중', serverFailed: '서버 정리를 다시 시도해 주세요', serverNotRequired: '서버에 보낸 임시 자료 없음',
    boundary: '서버 정리 상태는 이 서비스의 임시 자료에 해당해요. 외부 제공 업체의 삭제 완료를 의미하지 않아요.', retry: '정리 다시 시도',
    failed: '삭제를 저장하지 못했어요. 기록은 그대로예요. 다시 시도해 주세요.', unavailable: '이 기록을 더 이상 사용할 수 없어요.', readFailed: '삭제 상태를 읽지 못했어요. 다시 시도해 주세요.'
  },
  es: {
    manage: 'Gestionar', menu: 'Opciones del registro', deleteRecord: 'Eliminar', clear: 'Vaciar historial', cancel: 'Cancelar', deleteTitle: '¿Eliminar este registro?', clearTitle: '¿Vaciar estos registros?',
    deleteBody: 'Elimina «{title}» y sus fotos, imágenes traducidas, fichas de platos, conversación, borrador y posición de lectura de este dispositivo. Las tarjetas personales guardadas permanecen en tu biblioteca.',
    clearBody: 'Elimina los {count} registros de la lista actual, incluidas sus fotos, imágenes traducidas, fichas de platos, conversaciones, borradores y posiciones de lectura. Las tarjetas personales guardadas permanecen.',
    cleanup: 'Estado de eliminación', deletedRecord: 'Registro eliminado', localSucceeded: 'Eliminado de este dispositivo', localPending: 'Limpieza del dispositivo pendiente', localFailed: 'Error al limpiar el dispositivo',
    serverSucceeded: 'Material temporal del servidor eliminado', serverQueued: 'Limpieza del servidor pendiente', serverRunning: 'Eliminando material temporal del servidor', serverFailed: 'Hay que reintentar la limpieza del servidor', serverNotRequired: 'No se envió material temporal al servidor',
    boundary: 'La limpieza del servidor abarca el material temporal de este servicio. No confirma la eliminación por un proveedor externo.', retry: 'Reintentar limpieza',
    failed: 'No se pudo guardar la eliminación. El registro sigue disponible. Inténtalo de nuevo.', unavailable: 'Este registro ya no está disponible.', readFailed: 'No se pudo leer el estado de eliminación. Inténtalo de nuevo.'
  },
  'zh-CN': {
    manage: '管理', menu: '记录选项', deleteRecord: '删除', clear: '清空历史', cancel: '取消', deleteTitle: '删除这条记录？', clearTitle: '清空这些记录？',
    deleteBody: '从本机删除“{title}”及其原图、译图、菜品卡片、对话、草稿和阅读位置。个人卡库中已保存的卡片继续保留。',
    clearBody: '删除当前列表中的 {count} 条记录，以及它们的原图、译图、菜品卡片、对话、草稿和阅读位置。个人卡库中已保存的卡片继续保留。',
    cleanup: '删除状态', deletedRecord: '已删除记录', localSucceeded: '本机内容已移除', localPending: '本机清理待完成', localFailed: '本机清理失败',
    serverSucceeded: '服务端临时材料已清理', serverQueued: '服务端清理待完成', serverRunning: '正在清理服务端临时材料', serverFailed: '服务端清理需要重试', serverNotRequired: '未向服务端提交临时材料',
    boundary: '服务端清理状态仅指本服务的临时材料，不表示第三方供应商已完成删除。', retry: '重试清理',
    failed: '删除未能保存，记录仍然保留，请重试。', unavailable: '这条记录已不可用。', readFailed: '无法读取删除状态，请重试。'
  }
};
function getDeletionCopy(language) { return COPY[language] || COPY.en; }
module.exports = { getDeletionCopy };
