const page = require('../../ui/page');
const { GESTURE, CATEGORIES } = require('../../core/card-library');
const { getCardsCopy } = require('../../core/cards-copy');
const { getTextExchangeCopy } = require('../../core/text-exchange-copy');

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
  onHide() { this.stopGestures(); this.flushPosition(); if (this.library) this.library.closeMenu(); },
  onUnload() { this.stopGestures(); this.flushPosition(); if (this.library) this.library.closeMenu(); },
  openLanguage: page.openLanguage,
  openTextExchange() {
    this.stopGestures(); this.flushPosition();
    wx.navigateTo({ url: '/pages/text-exchange/text-exchange' });
  },
  renderLibrary(animate, restorePosition) {
    const state = this.library.getState();
    const language = page.services().application.getState().language;
    const copy = getCardsCopy(language);
    const stride = CARD_STRIDE * this.unit;
    const collapseOffset = this.collapseOffset || 0;
    const drag = state.drag;
    const cards = state.cards.map((card, index) => {
      const layer = Math.min(index, 3);
      const lifted = !!drag && drag.cardId === card.id;
      const y = lifted ? drag.fromIndex * stride + drag.translationY : state.expanded ? index * stride : collapseOffset + layer * 8 * this.unit;
      return Object.assign({}, card, {
        lifted,
        sourceText: card.pairedLanguage === 'zh-CN' ? card.textZh : card.pairedText,
        showChinese: card.pairedLanguage !== 'zh-CN' && card.pairedText !== card.textZh,
        categoryLabel: copy[card.category] || copy.service,
        placement: 'transform:translateY(' + y + 'px) rotate(' + (lifted ? 1 : state.expanded || index === 0 ? 0 : index % 2 ? -1.3 : 1.3) + 'deg) scale(' + (lifted ? 1.025 : state.expanded ? 1 : 1 - layer * .012) + ');z-index:' + (lifted ? state.cards.length + 1 : state.cards.length - index) + ';opacity:' + (state.expanded || index < 4 ? 1 : 0) + ';pointer-events:' + (state.expanded || index === 0 ? 'auto' : 'none') + ';'
      });
    });
    const patch = {
      cardCopy: copy, exchangeTitle: getTextExchangeCopy(language).title, cards, category: state.category, expanded: state.expanded, animate,
      scrollEnabled: state.expanded || collapseOffset > 0,
      categories: CATEGORIES.map((id) => ({ id, label: copy[id], count: state.counts[id] })),
      cardCount: state.cards.length, totalCount: state.counts.all,
      menuCard: state.menuCard,
      deletionError: state.deleteError ? copy[state.deleteError === 'storage-read' ? 'deleteReadFailed' : 'deleteFailed'] : '',
      showExpandHint: state.showExpandHint && state.cards.length > 0,
      showSortHint: state.showSortHint, dragging: !!drag, dropPosition: drag ? drag.toIndex + 1 : 0,
      dropPlacement: drag ? 'transform:translateY(' + drag.toIndex * stride + 'px);' : '',
      reorderStatus: drag ? copy.dragHint : state.reorderFeedback === 'cancelled' ? copy.dragCancelled : state.reorderFeedback === 'saved' ? copy.orderSaved : '',
      cardError: state.deleteError ? copy[state.deleteError === 'storage-read' ? 'deleteReadFailed' : 'deleteFailed'] : state.error ? copy[state.error === 'storage-read' ? 'storageRead' : state.pendingReorder ? 'orderFailed' : 'storageWrite'] : '',
      stageHeight: state.expanded ? Math.max(0, cards.length * stride) + 24 * this.unit : collapseOffset + Math.max((CARD_HEIGHT + 70) * this.unit, collapseOffset ? this.data.viewportHeight : 0)
    };
    if (restorePosition) {
      const index = Math.max(0, state.cards.findIndex((card) => card.id === state.position.cardId));
      this.currentScroll = state.expanded ? index * stride + Math.min(state.position.offset, stride - 1) : 0;
      patch.scrollTop = this.currentScroll;
    }
    this.setData(patch, () => { if (restorePosition || !this.libraryBounds) this.measureLibrary(); });
  },
  measureLibrary() {
    this.createSelectorQuery().select('.library-scroll').boundingClientRect((bounds) => {
      if (bounds) this.libraryBounds = bounds;
    }).exec();
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
    this.dragPointer = touch;
    const bounds = this.libraryBounds || { top: 0, bottom: this.data.viewportHeight, height: this.data.viewportHeight };
    this.library.beginTouch({ cardId: event.currentTarget.dataset.id, x: touch.clientX, y: touch.clientY,
      layout: { stride: CARD_STRIDE * this.unit, scrollTop: this.currentScroll || 0, top: bounds.top, bottom: bounds.bottom,
        maxScroll: Math.max(0, this.data.stageHeight + 32 * this.unit - bounds.height) } });
    this.holdTimer = setTimeout(() => {
      const result = this.library.longPress();
      if (result.action === 'expand') this.renderLibrary(true, true);
      else if (result.action === 'drag') {
        clearTimeout(this.positionTimer);
        this.renderLibrary(false, false);
        this.scheduleDragScroll();
      }
      else if (!result.ok) this.renderLibrary(false, false);
    }, GESTURE.holdMs);
  },
  onCardTouchMove(event) {
    if (event.touches.length !== 1) { this.cancelCardTouch(); return; }
    const touch = event.touches[0];
    this.dragPointer = touch;
    this.library.moveTouch({ x: touch.clientX, y: touch.clientY, scrollTop: this.currentScroll || 0 });
    if (this.library.getState().drag) this.renderLibrary(false, false);
  },
  onCardTouchEnd() {
    this.stopHold();
    clearTimeout(this.dragScrollTimer);
    const wasDragging = !!this.library.getState().drag;
    this.library.endTouch();
    this.dragPointer = null;
    if (wasDragging) { this.renderLibrary(true, false); this.flushPosition(); }
  },
  cancelCardTouch() {
    this.stopHold();
    clearTimeout(this.dragScrollTimer);
    this.dragPointer = null;
    if (this.library) {
      const wasDragging = !!this.library.getState().drag;
      this.library.cancelTouch();
      if (wasDragging) this.renderLibrary(true, false);
    }
  },
  scheduleDragScroll() {
    clearTimeout(this.dragScrollTimer);
    this.dragScrollTimer = setTimeout(() => {
      if (!this.library.getState().drag) return;
      const result = this.library.advanceDragScroll();
      if (result.action === 'scroll') {
        this.currentScroll = result.scrollTop;
        this.setData({ scrollTop: result.scrollTop });
        this.renderLibrary(false, false);
      }
      this.scheduleDragScroll();
    }, GESTURE.edgeTickMs);
  },
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
  onMenuTouchStart() { this.stopGestures(); },
  ignoreMenuEvent() {},
  openCardMenu(event) {
    this.stopGestures();
    this.flushPosition();
    this.library.openMenu(event.currentTarget.dataset.id);
    this.renderLibrary(false, false);
  },
  closeCardMenu() {
    this.library.closeMenu();
    this.renderLibrary(false, false);
  },
  deleteMenuCard() {
    if (!this.data.menuCard) return;
    this.stopGestures();
    clearTimeout(this.positionTimer);
    const result = this.library.deleteCard(this.data.menuCard.id);
    this.renderLibrary(false, result.ok);
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
    if (this.library.getState().drag && this.dragPointer) {
      this.library.moveTouch({ x: this.dragPointer.clientX, y: this.dragPointer.clientY, scrollTop: this.currentScroll });
      this.renderLibrary(false, false);
      return;
    }
    clearTimeout(this.positionTimer);
    this.positionTimer = setTimeout(() => this.flushPosition(), 160);
  },
  flushPosition() {
    clearTimeout(this.positionTimer);
    if (!this.library || this.library.getState().drag || !this.data.expanded || !this.data.cards.length) return;
    const stride = CARD_STRIDE * this.unit;
    const index = Math.min(this.data.cards.length - 1, Math.floor((this.currentScroll || 0) / stride));
    const result = this.library.rememberPosition({ cardId: this.data.cards[index].id, offset: Math.max(0, (this.currentScroll || 0) - index * stride) });
    if (!result.ok) this.renderLibrary(false, false);
  },
  retryCards() {
    if (this.library.getState().pendingDeletionId) this.library.retryDeletion();
    else if (this.library.getState().pendingReorder) this.library.retryReorder();
    else this.library.reload();
    this.renderLibrary(false, true);
  }
});
