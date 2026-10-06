function developmentBackend(platform) {
  try {
    if (platform.getAccountInfoSync().miniProgram.envVersion !== 'develop') return { enabled: false };
    return require('../config/backend');
  } catch (_) { return { enabled: false }; }
}

function createWechatBackend(platform, store, config, network) {
  const enabled = config.enabled === true && typeof config.baseUrl === 'string' && typeof config.identity === 'string';
  let sessionPromise;
  function send(url, method, data, header) {
    return new Promise((resolve, reject) => {
      platform.request({ url, method, data, header, timeout: 30000,
        success(result) {
          if (result.statusCode >= 200 && result.statusCode < 300) resolve(result.data);
          else reject({ code: result.data && result.data.code || 'TEMPORARY_FAILURE', status: result.statusCode });
        },
        fail() { reject({ code: 'network-unavailable' }); }
      });
    });
  }
  async function session() {
    if (!enabled) throw { code: 'backend-unavailable' };
    let cached;
    try { cached = store.get('backend-session', null); } catch (_) { throw { code: 'storage-read' }; }
    if (cached && cached.baseUrl === config.baseUrl && cached.identity === config.identity && Date.parse(cached.expiresAt) > Date.now() + 30000) return cached.accessToken;
    if (!sessionPromise) {
      sessionPromise = send(config.baseUrl + '/v1/dev/session', 'POST', { identity: config.identity }, { 'Content-Type': 'application/json' })
        .then((result) => {
          if (!result || typeof result.accessToken !== 'string') throw { code: 'INPUT_UNSUPPORTED' };
          try { store.set('backend-session', Object.assign({}, result, { baseUrl: config.baseUrl, identity: config.identity })); }
          catch (_) { throw { code: 'storage-write' }; }
          return result.accessToken;
        }).finally(() => { sessionPromise = null; });
    }
    return sessionPromise;
  }
  async function business(method, path, data, key) {
    if (network) await network.requireOnline();
    const accessToken = await session();
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };
    if (key) headers['Idempotency-Key'] = key;
    return send(config.baseUrl + path, method, data, headers);
  }
  return {
    enabled, identityKey: config.identity,
    ackJob: (id, body) => business('POST', `/v1/jobs/${encodeURIComponent(id)}/ack`, body),
    deleteContext: (id) => business('DELETE', `/v1/contexts/${encodeURIComponent(id)}`),
    getCleanup: (id) => business('GET', `/v1/cleanups/${encodeURIComponent(id)}`),
    createJob: (body, key) => business('POST', '/v1/jobs', body, key),
    retryJob: (id, body, key) => business('POST', `/v1/jobs/${encodeURIComponent(id)}/retry`, body, key),
    getJob: (id) => business('GET', `/v1/jobs/${encodeURIComponent(id)}`),
    listContextJobs: (id, cursor) => business('GET', `/v1/contexts/${encodeURIComponent(id)}/jobs${cursor === undefined ? '' : '?cursor=' + encodeURIComponent(cursor)}`),
    putContext: (id, body) => business('PUT', `/v1/contexts/${encodeURIComponent(id)}`, body),
    createUpload: (body, key) => business('POST', '/v1/uploads', body, key),
    completeUpload: (id, body, key) => business('POST', `/v1/uploads/${encodeURIComponent(id)}/complete`, body, key),
    async downloadArtifact(artifact) {
      if (network) await network.requireOnline();
      // A business token is attached only to this service's own resource endpoint.
      const prefix = config.baseUrl + '/v1/image-artifacts/';
      if (!artifact.remoteUrl.startsWith(prefix) || artifact.remoteUrl.slice(prefix.length).split('?')[0] !== encodeURIComponent(artifact.id) || artifact.remoteUrl.includes('#')) throw { code: 'DEPENDENCY_MISSING' };
      const accessToken = await session();
      return new Promise((resolve, reject) => platform.downloadFile({ url: artifact.remoteUrl,
        header: { Authorization: `Bearer ${accessToken}` }, timeout: 30000,
        success(result) {
          if (result.statusCode === 200 && result.tempFilePath) resolve(result.tempFilePath);
          else reject({ code: 'translation-download' });
        }, fail() { reject({ code: 'network-unavailable' }); }
      }));
    },
    async sendUpload(ticket, filePath) {
      if (network) await network.requireOnline();
      const bytes = await new Promise((resolve, reject) => platform.getFileSystemManager().readFile({ filePath,
        success: (result) => resolve(result.data), fail: () => reject({ code: 'original-missing' }) }));
      // Dynamic file targets receive only their own capability headers, never business auth.
      return send(ticket.uploadUrl, ticket.uploadMethod, bytes, ticket.uploadHeaders);
    }
  };
}

module.exports = { createWechatBackend, developmentBackend };
