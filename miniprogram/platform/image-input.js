function createWechatMedia(platform) {
  return {
    async chooseImages({ source, count }) {
      const result = await new Promise((resolve, reject) => {
        if (!platform.chooseMedia) return reject({ code: `${source}-unavailable` });
        platform.chooseMedia({ count, mediaType: ['image'], sourceType: [source], sizeType: ['original'],
          camera: 'back', success: resolve, fail(failure) {
            const message = failure.errMsg || '';
            reject({ code: /cancel/i.test(message) ? 'cancelled' :
              /auth|deny|permission/i.test(message) ? `${source}-denied` : `${source}-unavailable` });
          } });
      });
      return Promise.all(result.tempFiles.map(async (file) => {
        const info = await new Promise((resolve, reject) => {
          platform.getImageInfo({ src: file.tempFilePath, success: resolve, fail: () => reject({ code: 'image-unreadable' }) });
        });
        return { localPath: file.tempFilePath, sizeBytes: file.size,
          width: info.width, height: info.height, orientation: info.orientation || 'up',
          mimeType: `image/${info.type === 'jpg' ? 'jpeg' : info.type}` };
      }));
    }
  };
}

module.exports = { createWechatMedia };
