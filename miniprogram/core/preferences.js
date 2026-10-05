const { OPTIONS, getPreferencesCopy } = require('./preferences-copy');
const CATEGORIES = ['allergies', 'restrictions', 'tastes'];

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function emptyForm() {
  return { allergies: [], restrictions: [], tastes: [], notes: { allergies: '', restrictions: '', tastes: '' } };
}

function readPreferences(store) {
  const value = store ? store.get('preferences', null) : null;
  if (value === null) return null;
  if (!value || !Number.isSafeInteger(value.version) || value.version < 1 ||
    !value.notes || typeof value.notes !== 'object' || CATEGORIES.some((category) =>
      !Array.isArray(value[category]) || value[category].some((item) => typeof item !== 'string' || !item) ||
      new Set(value[category]).size !== value[category].length || typeof value.notes[category] !== 'string')) {
    throw new Error('Invalid saved preferences');
  }
  return clone(value);
}

function createPreferences({ store }) {
  let saved = null;
  let draft = null;
  let error = null;
  let readable = false;
  function refresh() {
    try { saved = readPreferences(store); readable = true; error = null; }
    catch (_) { readable = false; error = 'storage-read'; return { ok: false, error }; }
    return { ok: true };
  }
  refresh();
  return {
    beginEdit() {
      const result = refresh();
      if (!result.ok) return result;
      draft = saved ? clone(saved) : emptyForm();
      delete draft.version;
      error = null;
      return { ok: true };
    },
    retryRead() {
      const result = refresh();
      if (result.ok && !draft) {
        draft = saved ? clone(saved) : emptyForm();
        delete draft.version;
      }
      return result;
    },
    toggleOption(category, value) {
      if (!draft || !CATEGORIES.includes(category)) return;
      const selected = draft[category];
      draft[category] = selected.includes(value) ? selected.filter((item) => item !== value) : selected.concat(value);
    },
    updateNotes(category, value) {
      if (draft && CATEGORIES.includes(category)) draft.notes[category] = value;
    },
    cancelEdit() { draft = null; error = readable ? null : 'storage-read'; },
    save() {
      const result = refresh();
      if (!result.ok) return result;
      if (!draft) return { ok: false, error: 'edit-required' };
      const next = Object.assign({}, clone(draft), { version: (saved ? saved.version : 1) + 1 });
      try { store.set('preferences', next); }
      catch (_) { error = 'storage-write'; return { ok: false, error }; }
      saved = next;
      draft = null;
      error = null;
      return { ok: true };
    },
    getState(language) {
      const copy = getPreferencesCopy(language);
      const form = draft || saved || emptyForm();
      return {
        saved: clone(saved), draft: clone(draft), error, readable, isSet: saved !== null, copy,
        groups: CATEGORIES.map((category, index) => ({
          category, number: `0${index + 1}`, label: copy[category], hint: copy[`${category}Hint`],
          notes: form.notes[category],
          options: OPTIONS[category].map((value) => ({ value, label: copy[value], selected: form[category].includes(value) }))
        })),
        summary: saved ? CATEGORIES.filter((category) => saved[category].length || saved.notes[category]).map((category) => ({
          category, label: copy[category],
          text: saved[category].map((value) => copy[value] || value).concat(saved.notes[category] || []).join(' · ')
        })) : []
      };
    },
    getSnapshot() {
      if (!readable) throw new Error('storage-read');
      const source = saved || emptyForm();
      return {
        version: saved ? saved.version : 1,
        allergies: source.allergies.slice(), restrictions: source.restrictions.slice(), tastes: source.tastes.slice(),
        notes: CATEGORIES.filter((category) => source.notes[category]).map((category) => `[${category}]\n${source.notes[category]}`).join('\n\n')
      };
    }
  };
}

module.exports = { createPreferences };
