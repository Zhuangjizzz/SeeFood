const ROUTES = {
  capture: '/pages/index/index', cards: '/pages/cards/cards',
  mine: '/pages/mine/mine', language: '/pages/language/language',
  preferences: '/pages/preferences/preferences'
};

function routeValue(value) {
  try { return typeof value === 'string' ? decodeURIComponent(value) : null; } catch (_) { return null; }
}

function services() { return getApp().services; }

function errorMessage(state) {
  return {
    'storage-write': state.copy.storageWrite,
    'storage-read': state.copy.storageRead,
    'unsupported-language': state.copy.unsupportedLanguage
  }[state.error] || '';
}

function syncChrome(state, page) {
  ['capture', 'cards', 'mine'].forEach((key, index) => {
    wx.setTabBarItem({ index, text: state.copy[key] });
  });
  wx.setNavigationBarTitle({ title: page === 'capture' ? 'SeeFood' : state.copy[page] || 'SeeFood' });
}

function showPage(target, page) {
  const application = services().application;
  if (page !== 'language') application.visit(page);
  const state = application.getState();
  if (state.needsLanguage && page !== 'language') {
    wx.reLaunch({ url: ROUTES.language });
    return false;
  }
  const selected = state.languages.find((item) => item.code === state.language);
  target.setData(Object.assign({}, state, {
    languageName: selected.name,
    errorMessage: errorMessage(state)
  }));
  syncChrome(state, page);
  return true;
}

function openLanguage() {
  services().application.openLanguage();
  wx.navigateTo({ url: ROUTES.language });
}

function finishLanguage() {
  const destination = services().application.getState().page;
  // Keep the existing native page instance and its scroll position when possible.
  if (getCurrentPages().length > 1) wx.navigateBack();
  else wx.switchTab({ url: ROUTES[destination] || ROUTES.capture });
}

function openPreferences() {
  services().application.openPreferences();
  wx.navigateTo({ url: ROUTES.preferences });
}

function finishPreferences() {
  services().application.closePreferences();
  const destination = services().application.getState().page;
  if (getCurrentPages().length > 1) wx.navigateBack();
  else wx.switchTab({ url: ROUTES[destination] || ROUTES.capture });
}

function unavailable() {
  wx.showToast({ title: services().application.getState().copy.notAvailable, icon: 'none' });
}

module.exports = { routeValue, ROUTES, services, showPage, openLanguage, finishLanguage, openPreferences, finishPreferences, unavailable };
