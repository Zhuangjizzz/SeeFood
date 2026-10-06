function createWechatTranslationFiles(platform) {
  return {
    removeRecordTranslations(recordId) {
      try { platform.getFileSystemManager().rmdirSync(`${platform.env.USER_DATA_PATH}/seefood-translations/${encodeURIComponent(recordId)}`, true); }
      catch (error) {
        if (error.code !== 'ENOENT' && !/no such file|file not exist/i.test(error.errMsg || error.message || '')) throw error;
      }
    },
    async copyTranslation(artifact, temporaryPath, recordId) {
      const info = await new Promise((resolve, reject) => platform.getImageInfo({ src: temporaryPath, success: resolve, fail: reject }));
      if (info.width !== artifact.width || info.height !== artifact.height || !['png', 'jpeg', 'jpg', 'webp'].includes(info.type)) throw new Error('Invalid translated image');
      const files = platform.getFileSystemManager();
      const directory = `${platform.env.USER_DATA_PATH}/seefood-translations/${encodeURIComponent(recordId)}`;
      try { files.accessSync(directory); } catch (_) { files.mkdirSync(directory, true); }
      const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[artifact.mimeType];
      const localPath = `${directory}/${encodeURIComponent(artifact.id)}.${extension}`;
      await new Promise((resolve, reject) => files.copyFile({ srcPath: temporaryPath, destPath: localPath, success: resolve, fail: reject }));
      const sizeBytes = files.statSync(localPath).size;
      if (sizeBytes <= 0 || sizeBytes !== files.statSync(temporaryPath).size) throw new Error('Translated image copy incomplete');
      return { localPath, sizeBytes };
    },
    hasTranslation(localPath, sizeBytes) {
      try { return sizeBytes > 0 && platform.getFileSystemManager().statSync(localPath).size === sizeBytes; }
      catch (_) { return false; }
    }
  };
}
module.exports = { createWechatTranslationFiles };
