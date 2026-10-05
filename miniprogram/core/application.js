const { LANGUAGES, getCopy } = require('./i18n');
const LANGUAGE_CODES = LANGUAGES.map((item) => item.code);

function matchLanguage(value) {
  const code = String(value || '').toLowerCase().replace(/_/g, '-');
  if (/^zh(?:$|-)/.test(code)) {
    return /-(?:hant|tw|hk|mo)(?:$|-)/.test(code) ? null : 'zh-CN';
  }
  const base = code.split('-')[0];
  return LANGUAGE_CODES.includes(base) ? base : null;
}

function createApplication({ store, systemLanguage }) {
  let settings = {};
  let error = null;
  function readSettings() {
    const value = store ? store.get('settings', {}) : {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings');
    return value;
  }
  try { settings = readSettings(); }
  catch (_) { error = 'storage-read'; }
  let language = LANGUAGE_CODES.includes(settings.language) ? settings.language : matchLanguage(systemLanguage);
  let page = language ? 'capture' : 'language';
  let returnTo = 'capture';
  function saveSettings(patch) {
    let previous;
    try { previous = readSettings(); }
    catch (_) { error = 'storage-read'; return { ok: false, error }; }
    const nextSettings = Object.assign({}, previous, patch);
    try { store.set('settings', nextSettings); }
    catch (_) { error = 'storage-write'; return { ok: false, error }; }
    settings = nextSettings;
    error = null;
    return { ok: true };
  }
  return {
    getState() {
      return {
        language: language || 'en', page, needsLanguage: !language, error,
        showPreferenceInvite: !settings.preferenceInviteDismissed,
        copy: getCopy(language),
        languages: LANGUAGES.map((item) => Object.assign({}, item))
      };
    },
    chooseLanguage(nextLanguage) {
      if (!LANGUAGE_CODES.includes(nextLanguage)) {
        error = 'unsupported-language';
        return { ok: false, error };
      }
      const saved = saveSettings({ language: nextLanguage });
      if (!saved.ok) return saved;
      language = nextLanguage;
      page = returnTo;
      return { ok: true };
    },
    visit(destination) {
      if (['capture', 'cards', 'mine'].includes(destination) && language) page = destination;
    },
    openLanguage() {
      if (page !== 'language') returnTo = page;
      page = 'language';
    },
    closeLanguage() {
      if (language) page = returnTo;
    },
    skipPreferenceInvite() {
      return saveSettings({ preferenceInviteDismissed: true });
    }
  };
}

module.exports = { createApplication };
