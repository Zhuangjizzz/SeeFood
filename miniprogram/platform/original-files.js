// Original files live under USER_DATA_PATH, independently of temporary picker files.
function createWechatOriginalFiles(platform) {
  return {
    async copyOriginal(image, recordId) {
      const files = platform.getFileSystemManager();
      const root = `${platform.env.USER_DATA_PATH}/seefood-originals/${encodeURIComponent(recordId)}`;
      try { files.accessSync(root); }
      catch (_) { files.mkdirSync(root, true); }
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[image.mimeType];
      const destination = `${root}/${encodeURIComponent(image.id)}.${extension}`;
      await new Promise((resolve, reject) => files.copyFile({ srcPath: image.localPath, destPath: destination,
        success: resolve, fail: reject }));
      const stat = files.statSync(destination);
      if (stat.size !== image.sizeBytes || stat.size <= 0) throw new Error('Original copy is incomplete');
      return destination;
    },
    removeUncommittedOriginals(recordId, images) {
      const files = platform.getFileSystemManager();
      const directory = `${platform.env.USER_DATA_PATH}/seefood-originals/${encodeURIComponent(recordId)}`;
      if (images) {
        for (const image of images) {
          const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[image.mimeType];
          try { files.unlinkSync(`${directory}/${encodeURIComponent(image.id)}.${extension}`); }
          catch (error) {
            const message = error.errMsg || error.message || '';
            if (error.code !== 'ENOENT' && !/no such file|file not exist/i.test(message)) throw error;
          }
        }
        return;
      }
      try { files.rmdirSync(directory, true); }
      catch (error) {
        const message = error.errMsg || error.message || '';
        if (error.code !== 'ENOENT' && !/no such file|file not exist/i.test(message)) throw error;
      }
    },
    hasOriginal(localPath, sizeBytes) {
      try { return platform.getFileSystemManager().statSync(localPath).size === sizeBytes; }
      catch (_) { return false; }
    }
  };
}

module.exports = { createWechatOriginalFiles };
