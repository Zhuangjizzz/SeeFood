const test = require('node:test');
const assert = require('node:assert/strict');
const { createPreferences } = require('../miniprogram/core/preferences');
const { createApplication } = require('../miniprogram/core/application');
const { createLocalStore } = require('../miniprogram/core/local-store');
const { fileStorage } = require('./support/storage');

test('three preference groups become effective together only after saving and restore their original notes', (t) => {
  const driver = fileStorage(t);
  const preferences = createPreferences({ store: createLocalStore(driver) });
  preferences.beginEdit();
  preferences.toggleOption('allergies', 'peanuts');
  preferences.updateNotes('allergies', '  Also ask about peanut oil.\nPlease check the utensils.  ');
  preferences.toggleOption('restrictions', 'no-pork');
  preferences.updateNotes('restrictions', '不吃猪油，也请核对高汤。');
  preferences.toggleOption('tastes', 'mild');
  preferences.updateNotes('tastes', '少放辣椒，但可以有花椒。');
  assert.deepEqual(preferences.getSnapshot(), {
    version: 1, allergies: [], restrictions: [], tastes: [], notes: ''
  });
  assert.equal(preferences.save().ok, true);

  const restored = createPreferences({ store: createLocalStore(driver) });
  assert.deepEqual(restored.getSnapshot(), {
    version: 2, allergies: ['peanuts'], restrictions: ['no-pork'], tastes: ['mild'],
    notes: '[allergies]\n  Also ask about peanut oil.\nPlease check the utensils.  \n\n[restrictions]\n不吃猪油，也请核对高汤。\n\n[tastes]\n少放辣椒，但可以有花椒。'
  });
  restored.beginEdit();
  assert.deepEqual(restored.getState().draft, {
    allergies: ['peanuts'], restrictions: ['no-pork'], tastes: ['mild'],
    notes: {
      allergies: '  Also ask about peanut oil.\nPlease check the utensils.  ',
      restrictions: '不吃猪油，也请核对高汤。', tastes: '少放辣椒，但可以有花椒。'
    }
  });
});

test('retrying a read failure during save keeps the in-progress notes and can save them after storage recovers', (t) => {
  const driver = fileStorage(t);
  const preferences = createPreferences({ store: createLocalStore(driver) });
  preferences.beginEdit();
  preferences.updateNotes('allergies', 'These unsaved details must stay.');
  const read = driver.get;
  driver.get = () => { throw new Error('storage temporarily unavailable'); };
  assert.deepEqual(preferences.save(), { ok: false, error: 'storage-read' });
  driver.get = read;
  assert.equal(preferences.retryRead().ok, true);
  assert.equal(preferences.getState().draft.notes.allergies, 'These unsaved details must stay.');
  assert.equal(preferences.save().ok, true);
  assert.equal(createPreferences({ store: createLocalStore(driver) }).getSnapshot().notes, '[allergies]\nThese unsaved details must stay.');
});

test('the personal summary shows only saved choices in the interface language and keeps note originals', (t) => {
  const preferences = createPreferences({ store: createLocalStore(fileStorage(t)) });
  preferences.beginEdit();
  preferences.toggleOption('allergies', 'peanuts');
  preferences.updateNotes('restrictions', 'だしの材料を確認したいです。');
  preferences.toggleOption('tastes', 'mild');
  assert.deepEqual(preferences.getState('en').summary, []);
  preferences.save();
  const examples = [
    ['en', 'Allergies', 'Peanuts', 'Mild'],
    ['ja', 'アレルギー', '落花生', '辛さ控えめ'],
    ['ko', '알레르기', '땅콩', '덜 맵게'],
    ['es', 'Alergias', 'Cacahuetes', 'Poco picante'],
    ['zh-CN', '过敏信息', '花生', '少辣']
  ];
  for (const [language, categoryLabel, allergyLabel, tasteLabel] of examples) {
    const state = preferences.getState(language);
    assert.equal(state.summary[0].label, categoryLabel);
    assert.equal(state.summary[0].text, allergyLabel);
    assert.equal(state.summary[1].text, 'だしの材料を確認したいです。');
    assert.equal(state.summary[2].text, tasteLabel);
    assert.deepEqual(state.groups.map((group) => group.category), ['allergies', 'restrictions', 'tastes']);
    assert.equal(state.groups[0].options.find((option) => option.value === 'peanuts').label, allergyLabel);
  }
  preferences.beginEdit();
  preferences.toggleOption('allergies', 'peanuts');
  preferences.toggleOption('allergies', 'sesame');
  assert.equal(preferences.getState('en').summary[0].text, 'Peanuts');
});

test('preferences return to the actual entrance and cancelling never saves the edit', (t) => {
  for (const origin of ['capture', 'mine']) {
    const driver = fileStorage(t);
    const application = createApplication({ store: createLocalStore(driver), systemLanguage: 'en' });
    application.visit(origin);
    application.openPreferences();
    assert.equal(application.getState().page, 'preferences');
    application.preferences.toggleOption('allergies', 'peanuts');
    application.closePreferences();
    assert.equal(application.getState().page, origin);
    assert.equal(application.getState().preferences.isSet, false);
    application.openPreferences();
    assert.deepEqual(application.preferences.getState().draft.allergies, []);
    application.preferences.toggleOption('tastes', 'mild');
    assert.equal(application.preferences.save().ok, true);
    application.closePreferences();
    assert.equal(application.getState().page, origin);
    assert.equal(application.getState().showPreferenceInvite, false);
    const restored = createApplication({ store: createLocalStore(driver), systemLanguage: 'en' });
    assert.equal(restored.getState().showPreferenceInvite, false);
  }
});

test('unreadable preferences report an error and cannot be replaced by an empty form', () => {
  for (const value of ['broken', { version: 4, allergies: [] }, { version: 0, allergies: [], restrictions: [], tastes: [], notes: {} }]) {
    const preferences = createPreferences({ store: { get: () => value, set: () => assert.fail('must preserve unread preferences') } });
    assert.equal(preferences.getState().error, 'storage-read');
    assert.deepEqual(preferences.beginEdit(), { ok: false, error: 'storage-read' });
    assert.deepEqual(preferences.save(), { ok: false, error: 'storage-read' });
    assert.throws(() => preferences.getSnapshot(), /storage-read/);
  }
});

test('a failed save preserves the edit, the last saved preferences and its version until a successful retry', (t) => {
  const driver = fileStorage(t);
  const preferences = createPreferences({ store: createLocalStore(driver) });
  preferences.beginEdit();
  preferences.toggleOption('allergies', 'peanuts');
  preferences.save();
  preferences.beginEdit();
  preferences.toggleOption('allergies', 'peanuts');
  preferences.toggleOption('allergies', 'sesame');
  preferences.updateNotes('allergies', 'Check sesame oil too.');
  const write = driver.set;
  driver.set = () => { throw new Error('storage full'); };
  assert.deepEqual(preferences.save(), { ok: false, error: 'storage-write' });
  assert.equal(preferences.getState().error, 'storage-write');
  assert.deepEqual(preferences.getState().draft.allergies, ['sesame']);
  const restored = createPreferences({ store: createLocalStore(driver) });
  assert.deepEqual(restored.getSnapshot(), {
    version: 2, allergies: ['peanuts'], restrictions: [], tastes: [], notes: ''
  });
  assert.deepEqual(preferences.getSnapshot(), restored.getSnapshot());
  driver.set = write;
  assert.deepEqual(preferences.save(), { ok: true });
  const retried = createPreferences({ store: createLocalStore(driver) });
  assert.equal(retried.getSnapshot().version, 3);
  assert.deepEqual(retried.getSnapshot().allergies, ['sesame']);
  assert.equal(retried.getSnapshot().notes, '[allergies]\nCheck sesame oil too.');
});
