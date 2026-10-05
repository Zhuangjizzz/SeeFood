const page = require('./page');

function query(target, callback) {
  if (!wx.createSelectorQuery) return callback([]);
  wx.createSelectorQuery().in(target).selectAll('.reading-anchor').fields({ id: true, dataset: true, rect: true }).exec((result) => callback(result && result[0] || []));
}
function capture(target, event) {
  const sequence = (target.readingSequence || 0) + 1; target.readingSequence = sequence;
  const scrollTop = Math.max(0, event.scrollTop || 0);
  target.readingChanged = true;
  target.readingPosition = { anchorId: null, offset: 0, scrollTop };
  query(target, (nodes) => {
    if (target.readingSequence !== sequence) return;
    const visible = nodes.find((node) => node.bottom > 0);
    if (visible && visible.dataset && visible.dataset.anchorId) target.readingPosition = { anchorId: visible.dataset.anchorId, offset: visible.top, scrollTop };
  });
}
function save(target, view, id) {
  if (!target.readingChanged || !target.readingPosition) return { ok: true };
  const history = page.services().history;
  const result = view === 'result' ? history.saveResultPosition(id, target.readingPosition) : history.saveListPosition(view, target.readingPosition);
  if (result && result.ok) { target.readingChanged = false; target.setData({ positionSaveFailed: false }); }
  else target.setData({ positionSaveFailed: true });
  return result;
}
function restore(target, view, id) {
  const history = page.services().history;
  const saved = view === 'result' ? history.getResultPosition(id) : history.getListPosition(view);
  target.readingPosition = saved; target.readingChanged = false;
  const apply = () => query(target, (nodes) => {
    if (!wx.pageScrollTo) return;
    const node = saved.anchorId && nodes.find((item) => item.dataset && item.dataset.anchorId === saved.anchorId);
    if (node && node.id) wx.pageScrollTo({ selector: `#${node.id}`, offsetTop: -saved.offset, duration: 0 });
    else wx.pageScrollTo({ scrollTop: saved.anchorId ? 0 : saved.scrollTop, duration: 0 });
  });
  if (wx.nextTick) wx.nextTick(apply); else apply();
}
module.exports = { capture, save, restore };
