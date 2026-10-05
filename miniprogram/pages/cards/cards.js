const page = require('../../ui/page');
const { GESTURE, CATEGORIES } = require('../../core/card-library');
const { getCardsCopy } = require('../../core/cards-copy');

// Dimensions also define the anchor spacing used by scroll restoration.
const CARD_HEIGHT = 370;
const CARD_STRIDE = 400;

Page({
  data: { copy: {}, cardCopy: {}, cards: [], categories: [], scrollTop: 0 },
  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.unit = info.windowWidth / 750;
    this.setData({ viewportHeight: info.windowHeight });
    this.currentScroll = 0;
  },
  onShow() {
    if (!page.showPage(this, 'cards')) return;
    this.library = page.services().cardLibrary;
    this.library.reload();
    this.renderLibrary(false, true);
  },
  onHide() { this.stopGestures(); this.flushPosition(); },
  onUnload() { this.stopGestures(); this.flushPosition(); },
  openLanguage: page.openLanguage,
  renderLibrary(animate, restorePosition) {
    const state = this.library.getState();
    const language = page.services().application.getState().language;
    const copy = getCardsCopy(language);
    const stride = CARD_STRIDE * this.unit;
    const collapseOffset = this.collapseOffset || 0;
    const cards = state.cards.map((card, index) => {
      const layer = Math.min(index, 3);
      return Object.assign({}, card, {
        sourceText: card.pairedLanguage === 'zh-CN' ? card.textZh : card.pairedText,
        showChinese: card.pairedLanguage !== 'zh-CN' && card.pairedText !== card.textZh,
        categoryLabel: copy[card.category] || copy.service,
        placement: 'transform:translateY(' + (state.expanded ? index * stride : collapseOffset + layer * 8 * this.unit) + 'px) rotate(' + (state.expanded || index === 0 ? 0 : index % 2 ? -1.3 : 1.3) + 'deg) scale(' + (state.expanded ? 1 : 1 - layer * .012) + ');z-index:' + (state.cards.length - index) + ';opacity:' + (state.expanded || index < 4 ? 1 : 0) + ';pointer-events:' + (state.expanded || index === 0 ? 'auto' : 'none') + ';'
      });
    });
    const patch = {
      cardCopy: copy, cards, category: state.category, expanded: state.expanded, animate,
      scrollEnabled: state.expanded || collapseOffset > 0,
      categories: CATEGORIES.map((id) => ({ id, label: copy[id], count: state.counts[id] })),
      cardCount: state.cards.length, totalCount: state.counts.all,
      showExpandHint: state.showExpandHint && state.cards.length > 0,
      cardError: state.error ? copy[state.error === 'storage-read' ? 'storageRead' : 'storageWrite'] : '',
      stageHeight: state.expanded ? Math.max(0, cards.length * stride) + 24 * this.unit : collapseOffset + Math.max((CARD_HEIGHT + 70) * this.unit, collapseOffset ? this.data.viewportHeight : 0)
    };
    if (restorePosition) {
      const index = Math.max(0, state.cards.findIndex((card) => card.id === state.position.cardId));
      this.currentScroll = state.expanded ? index * stride + Math.min(state.position.offset, stride - 1) : 0;
      patch.scrollTop = this.currentScroll;
    }
    this.setData(patch);
  },
  selectCategory(event) {
    this.stopGestures();
    this.flushPosition();
    const result = this.library.selectCategory(event.currentTarget.dataset.category);
    this.renderLibrary(false, result.ok);
  },
  onCardTouchStart(event) {
    if (event.touches.length !== 1) { this.cancelCardTouch(); return; }
    this.stopHold();
    const touch = event.touches[0];
    this.library.beginTouch({ cardId: event.currentTarget.dataset.id, x: touch.clientX, y: touch.clientY });
    this.holdTimer = setTimeout(() => {
      const result = this.library.longPress();
      if (result.action === 'expand') this.renderLibrary(true, true);
      else if (!result.ok) this.renderLibrary(false, false);
    }, GESTURE.holdMs);
  },
  onCardTouchMove(event) {
    if (event.touches.length !== 1) { this.cancelCardTouch(); return; }
    const touch = event.touches[0];
    this.library.moveTouch({ x: touch.clientX, y: touch.clientY });
  },
  onCardTouchEnd() { this.stopHold(); this.library.endTouch(); },
  cancelCardTouch() { this.stopHold(); if (this.library) this.library.cancelTouch(); },
  stopHold() { clearTimeout(this.holdTimer); this.holdTimer = null; },
  stopGestures() {
    this.cancelCardTouch();
    clearTimeout(this.collapseTimer);
    this.collapseOffset = 0;
  },
  showCard(event) {
    this.flushPosition();
    this.library.tapCard(event.currentTarget.dataset.id);
    const card = this.library.getState().displayCard;
    if (card) wx.navigateTo({ url: '/pages/card-display/card-display?id=' + encodeURIComponent(card.id) });
  },
  collapseCards() {
    this.stopGestures();
    this.flushPosition();
    const result = this.library.collapse();
    if (!result.ok) { this.renderLibrary(false, false); return; }
    this.collapseOffset = this.currentScroll || 0;
    this.renderLibrary(true, false);
    this.collapseTimer = setTimeout(() => {
      this.collapseOffset = 0;
      this.renderLibrary(false, true);
    }, 400);
  },
  onLibraryScroll(event) {
    if (!this.data.expanded) return;
    this.currentScroll = Math.max(0, event.detail.scrollTop);
    clearTimeout(this.positionTimer);
    this.positionTimer = setTimeout(() => this.flushPosition(), 160);
  },
  flushPosition() {
    clearTimeout(this.positionTimer);
    if (!this.library || !this.data.expanded || !this.data.cards.length) return;
    const stride = CARD_STRIDE * this.unit;
    const index = Math.min(this.data.cards.length - 1, Math.floor((this.currentScroll || 0) / stride));
    const result = this.library.rememberPosition({ cardId: this.data.cards[index].id, offset: Math.max(0, (this.currentScroll || 0) - index * stride) });
    if (!result.ok) this.renderLibrary(false, false);
  },
  retryCards() { this.library.reload(); this.renderLibrary(false, true); }
});
