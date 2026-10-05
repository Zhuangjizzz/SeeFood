function createWechatNetwork(platform) {
  let online = true; let known = false; let revision = 0;
  const listeners = new Set();
  function update(connected) {
    if (typeof connected !== 'boolean') return;
    const changed = !known || online !== connected; online = connected; known = true;
    if (changed) listeners.forEach((listener) => { try { listener({ online, known }); } catch (_) { /* Views may have gone away. */ } });
  }
  if (platform.onNetworkStatusChange) platform.onNetworkStatusChange((event) => { revision += 1; update(event.isConnected); });
  function refresh() {
    const expected = revision;
    if (!platform.getNetworkType) return Promise.resolve();
    return new Promise((resolve) => platform.getNetworkType({
      success(result) { if (expected === revision) update(result.networkType !== 'none'); resolve(); },
      fail() { resolve(); }
    }));
  }
  const ready = refresh();
  return { refresh,
    getState() { return { online, known }; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async requireOnline() { await ready; if (!online) throw { code: 'network-unavailable' }; }
  };
}
module.exports = { createWechatNetwork };
