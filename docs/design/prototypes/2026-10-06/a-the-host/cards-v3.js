/* THROWAWAY / A revision 03. Communication cards and a single local conversation.
 * This view explores Q1–Q18. Its text-generation actions use the host's fixed examples.
 * Deck transitions retain the same card nodes; a fresh press is required after expansion.
 */
(function () {
  'use strict';
  const languageNames = { en: 'English', zh: '简体中文', ja: '日本語', ko: '한국어', es: 'Español' };
  const palette = { green: '#e2eadc', blue: '#e0e8e6', orange: '#efe0cd' };
  const copy = (ui, ...words) => ui.copy(...words);
  const escape = (ui, value) => (ui.e || ui.escape)(String(value ?? ''));
  const countLabel = (ui, count) => `${count} ${copy(ui, 'cards', '张卡片', '枚のカード', '개 카드', 'tarjetas')}`;
  const collapseLabel = ui => copy(ui, 'Stack cards', '收拢卡片', 'カードを重ねる', '카드 모으기', 'Apilar tarjetas');
  const hints = (ui, expanded) => expanded
    ? copy(ui, 'Hold a card to change its position.', '长按卡片可调整顺序', 'カードを長押しして順番を変更', '카드를 길게 눌러 순서를 바꾸세요', 'Mantén pulsada una tarjeta para reordenarla.')
    : copy(ui, 'Tap to show. Hold to spread.', '轻点展示，长按展开', 'タップで見せる・長押しで広げる', '탭하여 보여주기 · 길게 눌러 펼치기', 'Toca para mostrar. Mantén pulsado para desplegar.');
  function tint(card) { return palette[card.color] || palette.green; }
  function visibleCards(state, ui) {
    return ui.getCards().filter(card => state.cardCategory === 'all' || card.category === state.cardCategory);
  }
  function cardMarkup(card, index, state, ui) {
    const e = value => escape(ui, value);
    const lang = card.lang || state.lang;
    const duplicate = lang === 'zh' || card.zh === card.en;
    return `<article class="v3-paper-card" data-v3-card="${e(card.id)}" style="--v3-card-color:${tint(card)}">
      <div class="v3-card-top"><span>${ui.icon(card.category === 'dietary' ? 'leaf' : 'chat', 15)}${ui.t(card.category)}</span>
        <button class="v3-card-more" data-v3-menu-toggle="${e(card.id)}" aria-label="${e(copy(ui, 'Manage card', '管理卡片', 'カードを管理', '카드 관리', 'Gestionar tarjeta'))}" aria-expanded="false">${ui.icon('more', 20)}</button></div>
      <div class="v3-card-body" role="button" tabindex="0" aria-label="${e(card.title)} · ${e(ui.t('showStaff'))}" aria-describedby="v3-deck-keyboard">
        <h2 lang="${e(lang)}">${e(card.title)}</h2><p class="v3-card-message" lang="${e(lang)}">${e(duplicate ? card.zh : card.en)}</p>
        ${duplicate ? '' : `<div class="v3-card-translation"><span>中文</span><p lang="zh">${e(card.zh)}</p></div>`}
        <div class="v3-card-imprint"><span>${e(languageNames[lang] || lang)}${duplicate ? '' : ' / 中文'}</span><span class="v3-card-number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span></div>
      </div>
      <div class="v3-card-menu" hidden><button data-action="edit-card" data-id="${e(card.id)}">${ui.icon('edit', 16)}${ui.t('edit')}</button><button class="v3-danger-text" data-action="delete-card" data-id="${e(card.id)}">${ui.icon('trash', 16)}${ui.t('delete')}</button></div>
    </article>`;
  }
  function cards(state, ui) {
    const items = visibleCards(state, ui);
    const expanded = !!state.aDecks?.cards;
    const hasDraft = !!state.cardDrafts?.new;
    const shouldHint = items.length && !(expanded ? state.hints?.reordered : state.hints?.expanded);
    return `<div class="page-scroll v3-cards-page" data-v3-card-library>
      <header class="v3-cards-heading"><div><p class="v3-eyebrow">${copy(ui, 'AT YOUR TABLE', '餐桌上的几句话', '食卓で伝える言葉', '식탁에서 전하는 말', 'EN TU MESA')}</p><h1>${ui.t('cards')}</h1></div><button class="v3-circle" data-action="new-card" aria-label="${escape(ui, ui.t('newCard'))}">${ui.icon('plus', 23)}</button></header>
      <p class="v3-intro">${copy(ui, 'A few words, ready when you need them.', '把想说的话，放在手边。', '伝えたい言葉を、すぐ手元に。', '필요한 말을 가까이 두세요.', 'Las palabras que necesitas, a mano.')}</p>
      <button class="v3-translate-entry" data-page="translate"><span class="v3-translation-mark" aria-hidden="true"><b>文</b><i>A</i></span><span><strong>${ui.t('translate')}</strong><small>${copy(ui, 'Pass the phone. Keep talking.', '递过手机，继续交流。', 'スマホを渡して、会話を続ける。', '휴대폰을 건네며 대화를 이어가세요.', 'Pasa el teléfono y sigue hablando.')}</small></span>${ui.icon('arrow', 20)}</button>
      ${hasDraft ? `<button class="v3-resume-draft" data-action="new-card">${ui.icon('edit', 16)}<span>${copy(ui, 'Continue your unsaved card', '继续编辑未保存的卡片', '下書きの編集を続ける', '카드 초안 이어 쓰기', 'Continuar el borrador de tarjeta')}</span>${ui.icon('chevron', 15)}</button>` : ''}
      <div class="v3-library-toolbar"><nav class="v3-card-filters" aria-label="${escape(ui, ui.t('category'))}">${['all', 'dietary', 'service'].map(category => `<button data-action="filter-cards" data-value="${category}" class="${state.cardCategory === category ? 'is-active' : ''}" aria-pressed="${state.cardCategory === category}">${ui.t(category)}</button>`).join('')}</nav>
        <div class="v3-library-count"><span>${countLabel(ui, items.length)}</span><button class="v3-collapse" data-v3-collapse aria-label="${collapseLabel(ui)}" ${!expanded || !items.length ? 'hidden' : ''}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 14 6-6 6 6"/><path d="M6 19h12"/></svg></button></div>
      </div>
      ${items.length ? `<section class="v3-card-deck ${expanded ? 'is-expanded' : 'is-stacked'}" aria-label="${escape(ui, ui.t('cards'))}" data-v3-deck>${items.map((card, index) => cardMarkup(card, index, state, ui)).join('')}<div class="v3-drag-placeholder" aria-hidden="true" hidden></div></section>
        <p class="v3-gesture-hint" data-v3-hint ${shouldHint ? '' : 'hidden'}>${hints(ui, expanded)}</p>
        <span class="v3-sr-only" id="v3-deck-keyboard">${copy(ui, 'Enter: show card. Space: spread. Alt and up or down: move an expanded card.', '回车展示卡片，空格展开，展开后按 Alt 与上下方向键调整顺序。', 'Enterで表示、Spaceで展開。展開後はAltと上下キーで並べ替え。', 'Enter로 표시, Space로 펼치기. 펼친 뒤 Alt와 위아래 키로 이동.', 'Intro: mostrar. Espacio: desplegar. Alt y flechas: mover una tarjeta desplegada.')}</span><span class="v3-sr-only" aria-live="polite" data-v3-deck-announcement></span>`
        : `<section class="v3-empty-cards">${ui.icon('cards', 31)}<h2>${copy(ui, 'Room for your words.', '留一个位置，放你的话。', 'あなたの言葉をここに。', '하고 싶은 말을 담아보세요.', 'Un lugar para tus palabras.')}</h2><p>${state.cardCategory === 'all' ? ui.t('noSavedCardsNote') : copy(ui, 'No cards in this category yet.', '这个分类还没有卡片。', 'このカテゴリにはまだカードがありません。', '이 분류에는 아직 카드가 없어요.', 'Aún no hay tarjetas en esta categoría.')}</p></section>`}
      <button class="v3-create-card" data-action="new-card">${ui.icon('plus', 18)}${ui.t('newCard')}</button>
      ${state.scenario === 'storage-failed' ? `<p class="v3-inline-error">${ui.t('saveFailed')} · ${copy(ui, 'Your last saved order is kept.', '仍保留上次成功保存的顺序。', '前回保存した順番を保持しています。', '마지막으로 저장한 순서를 유지해요.', 'Se conserva el último orden guardado.')}</p>` : `<p class="v3-local-note">${ui.icon('check', 13)}${ui.t('offlineAvailable')}</p>`}
    </div>${ui.tabbar('cards')}`;
  }
  function cardShow(state, ui) {
    const card = ui.getCards().find(item => item.id === state.selectedCard) || ui.getCards()[0];
    if (!card) return `${ui.header('showStaff')}<div class="page-scroll v3-form-page"><p>${ui.t('noSavedCards')}</p><button class="v3-primary" data-page="cards">${ui.t('back')}</button></div>`;
    const duplicate = card.lang === 'zh' || card.en === card.zh;
    return `${ui.header('showStaff')}<div class="page-scroll v3-staff-page"><article class="v3-staff-card" style="--v3-card-color:${tint(card)}"><header><span class="v3-staff-seal" aria-hidden="true">sf</span><span>${escape(ui, card.title)}</span></header><div class="v3-staff-words"><p class="v3-staff-chinese" lang="zh">${(card.zh.match(/[^，。！？；：\n]+[，。！？；：]?|\n/gu)||[]).map(part=>part==='\n'?'<br>':`<span class="v3-staff-phrase">${escape(ui,part)}</span>`).join('')}</p>${duplicate ? '' : `<div class="v3-staff-original"><span>${escape(ui, languageNames[card.lang || state.lang])}</span><p lang="${escape(ui, card.lang || state.lang)}">${escape(ui, card.en)}</p></div>`}</div><footer>SeeFood <span aria-hidden="true">·</span> ${copy(ui, 'Thank you', '谢谢', 'ありがとうございます', '감사합니다', 'Gracias')}</footer></article></div>`;
  }
  function formError(state, ui) {
    if (state.scenario === 'translation-failed') return `<div class="v3-inline-error" role="status">${ui.icon('warning', 17)}<span>${ui.t('translationFailed')}</span></div>`;
    if (state.scenario === 'offline') return `<div class="v3-inline-error" role="status">${ui.icon('warning', 17)}<span>${copy(ui, 'You are offline. Your input is kept; translate when connected.', '当前离线，输入已保留；联网后再翻译。', 'オフラインです。入力を保持し、接続後に翻訳できます。', '오프라인이에요. 입력을 유지하고 연결 후 번역하세요.', 'Sin conexión. Conservamos el texto; traduce cuando te conectes.')}</span></div>`;
    return '';
  }
  function cardEdit(state, ui) {
    const draft = state.cardDraft || { title: '', en: '', zh: '', category: state.cardCategory === 'dietary' ? 'dietary' : 'service', color: 'green', lang: state.lang };
    const e = value => escape(ui, value);
    const lang = draft.lang || state.lang;
    const isChinese = lang === 'zh';
    const busy = !!state.cardTranslationPending || state.scenario === 'translating';
    const disabled = !draft.title?.trim() || !draft.en?.trim() || (!isChinese && !draft.zh?.trim()) || busy;
    return `${ui.header(state.editingId ? 'edit' : 'newCard')}<div class="page-scroll v3-form-page">
      <p class="v3-form-lead">${copy(ui, 'Start with what you want to say.', '先写下你想说的话。', 'まず、伝えたいことを。', '먼저 하고 싶은 말을 적어보세요.', 'Empieza por lo que quieres decir.')}</p>
      <div class="v3-field"><label for="card-words">${ui.t('yourWords')}<span>${e(languageNames[lang])}</span></label><textarea id="card-words" data-draft="en" lang="${e(lang)}" placeholder="${e(copy(ui, 'For example: No coriander, please.', '例如：请不要放香菜。', '例：パクチーを入れないでください。', '예: 고수는 넣지 말아 주세요.', 'Por ejemplo: Sin cilantro, por favor.'))}">${e(draft.en)}</textarea></div>
      ${isChinese ? '' : `<button class="v3-secondary" data-action="generate-card" ${busy || !draft.en?.trim() ? 'disabled' : ''}>${ui.icon(busy ? 'refresh' : 'globe', 17)}${busy ? copy(ui, 'Translating…', '正在翻译…', '翻訳中…', '번역 중…', 'Traduciendo…') : ui.t('generateChinese')}</button>`}
      ${formError(state, ui)}
      ${isChinese ? `<p class="v3-field-help">${copy(ui, 'This Chinese text is what staff will see.', '这段中文将直接展示给店员。', 'この中国語を店員さんに見せます。', '이 중국어 문장이 직원에게 표시돼요.', 'El personal verá este texto en chino.')}</p>` : `<section class="v3-chinese-check"><div class="v3-field"><label for="card-chinese">${copy(ui, 'Check the Chinese', '核对中文', '中国語を確認', '중국어 확인', 'Revisa el chino')}<span>中文</span></label><textarea id="card-chinese" data-draft="zh" lang="zh" placeholder="${e(copy(ui, 'The Chinese text will appear here.', '中文会显示在这里，可以修改。', '中国語がここに表示されます。', '중국어가 여기에 표시돼요.', 'El texto en chino aparecerá aquí.'))}">${e(draft.zh)}</textarea></div><p class="v3-field-help">${ui.t('checkTranslation')}</p></section>`}
      <section class="v3-card-settings"><h2>${copy(ui, 'Make it easy to find', '方便下次找到', '次も見つけやすく', '다음에 쉽게 찾기', 'Encuéntrala fácilmente')}</h2><div class="v3-field"><label for="card-title">${ui.t('cardTitle')}</label><input id="card-title" data-draft="title" value="${e(draft.title)}" placeholder="${e(copy(ui, 'Starts with your message', '默认取正文开头，可修改', '本文の先頭から作成', '본문의 첫 부분으로 만들어요', 'Usa el comienzo del mensaje'))}"></div><div class="v3-field"><label for="card-category">${ui.t('category')}</label><select id="card-category" data-draft="category">${['dietary', 'service'].map(category => `<option value="${category}" ${draft.category === category ? 'selected' : ''}>${ui.t(category)}</option>`).join('')}</select></div><div class="v3-field"><span class="v3-field-label">${ui.t('color')}</span><div class="v3-color-choices">${[['green', ['Green', '浅绿', '緑', '초록', 'Verde']], ['blue', ['Blue', '浅蓝', '青', '파랑', 'Azul']], ['orange', ['Ochre', '暖橙', '橙', '주황', 'Ocre']]].map(([color, names]) => `<button class="v3-color ${draft.color === color ? 'is-selected' : ''}" data-action="card-color" data-value="${color}" style="--v3-card-color:${palette[color]}" aria-label="${copy(ui, ...names)}" aria-pressed="${draft.color === color}">${draft.color === color ? ui.icon('check', 20) : ''}</button>`).join('')}</div></div></section>
      <p class="v3-draft-note ${state.scenario === 'storage-failed' ? 'is-error' : ''}" data-v3-draft-status role="status">${state.scenario === 'storage-failed' ? copy(ui, 'The draft could not be saved. Keep this page open and retry.', '草稿保存失败，请保留当前页面并重试。', '下書きを保存できません。ページを開いたまま再試行してください。', '초안을 저장하지 못했어요. 페이지를 유지하고 다시 시도하세요.', 'No se guardó el borrador. Mantén esta página abierta e inténtalo de nuevo.') : copy(ui, 'A draft stays on this device until you save or discard it.', '草稿保留在本机，点击保存后才成为正式卡片。', '保存するまでは、この端末の下書きです。', '저장 전에는 이 기기에 초안으로 남아요.', 'El borrador queda en este dispositivo hasta guardarlo o descartarlo.')}</p>
      <button class="v3-discard" data-action="discard-card-draft">${copy(ui, 'Discard draft', '放弃草稿', '下書きを破棄', '초안 버리기', 'Descartar borrador')}</button>
    </div><div class="v3-form-footer"><button class="v3-primary" data-action="save-card" ${disabled ? 'disabled' : ''}>${ui.t('save')}${ui.icon('check', 17)}</button></div>`;
  }
  function translate(state, ui) {
    const current = state.conversation || { speaker: 'visitor', visitor: { draft: '' }, staff: { draft: '' } };
    const speaker = current.speaker || 'visitor';
    const entry = current[speaker] || {};
    const isStaff = speaker === 'staff';
    const activeLanguage = languageNames[state.lang] || languageNames.en;
    const busy = !!state.conversationPending || state.scenario === 'translating';
    const results = ['visitor', 'staff'].filter(key => current[key]?.original && current[key]?.translated).sort((a, b) => (current[b].at || 0) - (current[a].at || 0));
    return `${ui.header('translate')}<div class="page-scroll v3-form-page v3-translate-page">
      <div class="v3-speaker-tabs" aria-label="${escape(ui, copy(ui, 'Who is speaking?', '谁在说话', '話す人', '말하는 사람', '¿Quién habla?'))}">${[['visitor', ['I say', '我说', '自分', '내가 말하기', 'Yo digo']], ['staff', ['Staff say', '店员说', '店員さん', '직원이 말하기', 'El personal dice']]].map(([key, names]) => `<button data-action="speaker" data-value="${key}" class="${speaker === key ? 'is-active' : ''}" aria-pressed="${speaker === key}">${copy(ui, ...names)}</button>`).join('')}</div>
      <div class="v3-language-direction"><span>${isStaff ? '中文' : escape(ui, activeLanguage)}</span>${ui.icon('arrow', 16)}<span>${isStaff ? escape(ui, activeLanguage) : '中文'}</span></div>
      <div class="v3-field"><label class="v3-sr-only" for="translation-input">${ui.t('yourWords')}</label><textarea id="translation-input" lang="${isStaff ? 'zh' : state.lang}" placeholder="${escape(ui, isStaff ? '请在这里输入您想说的话。' : copy(ui, 'What would you like to say?', '你想说些什么？', '伝えたいことを入力', '하고 싶은 말을 입력하세요', '¿Qué quieres decir?'))}">${escape(ui, entry.draft)}</textarea></div>
      <button class="v3-primary" data-action="translate-text" ${busy || !entry.draft?.trim() ? 'disabled' : ''}>${ui.icon(busy ? 'refresh' : 'globe', 17)}${busy ? copy(ui, 'Translating…', '正在翻译…', '翻訳中…', '번역 중…', 'Traduciendo…') : ui.t('translateNow')}</button>
      ${formError(state, ui)}
      <section class="v3-conversation-results" aria-live="polite"><div class="v3-results-heading"><h2>${copy(ui, 'Your current exchange', '刚才的交流', '今回のやりとり', '지금 나눈 말', 'Esta conversación')}</h2><span>${copy(ui, 'Latest from each person', '每人保留最近一句', 'それぞれ最新の一言', '각자 최근 한 문장', 'Lo último de cada persona')}</span></div>
      ${results.length ? results.map((key, index) => {
        const result = current[key];
        const originalLang = key === 'staff' ? 'zh' : result.lang || state.lang;
        const targetLang = key === 'staff' ? result.lang || state.lang : 'zh';
        return `<article class="v3-conversation-result ${index === 0 ? 'is-latest' : ''}"><header><span>${copy(ui, ...(key === 'visitor' ? ['I said', '我说', '自分', '내 말', 'Yo dije'] : ['Staff said', '店员说', '店員さん', '직원의 말', 'El personal dijo']))}</span>${index === 0 ? `<small>${busy || state.scenario === 'translation-failed' ? copy(ui, 'Last successful result', '上次成功结果', '前回の翻訳結果', '마지막 번역 결과', 'Último resultado correcto') : copy(ui, 'Most recent', '最新', '最新', '최근', 'Lo más reciente')}</small>` : ''}</header><p class="v3-exchange-original" lang="${originalLang}">${escape(ui, result.original)}</p><div class="v3-exchange-translation"><span>${escape(ui, languageNames[targetLang])}</span><p lang="${targetLang}">${escape(ui, result.translated)}</p></div></article>`;
      }).join('') : `<div class="v3-no-conversation">${ui.icon('chat', 24)}<p>${copy(ui, 'Each person’s most recent words will stay here.', '双方最近说的话会留在这里，方便核对。', 'それぞれの最新の言葉がここに残ります。', '서로 최근에 한 말을 여기서 확인할 수 있어요.', 'Aquí quedarán las últimas palabras de cada persona.')}</p></div>`}</section>
      <button class="v3-clear-conversation" data-action="clear-conversation">${ui.icon('trash', 15)}${copy(ui, 'Clear this exchange', '清空本次交流', '今回のやりとりを消去', '이번 대화 지우기', 'Borrar esta conversación')}</button>
      <p class="v3-local-note">${copy(ui, 'This exchange stays on this device until you clear it.', '本次交流保留在本机，清空后重置。', '消去するまで、この端末に保持します。', '지우기 전까지 이 기기에 보관돼요.', 'Se conserva en este dispositivo hasta que la borres.')}</p>
    </div>`;
  }

  let unmount = () => {};
  function mount(state, ui) {
    unmount();
    unmount = () => {};
    const library = document.querySelector('.variant-a [data-v3-card-library]');
    if (!library) return;
    const deck = library.querySelector('[data-v3-deck]');
    if (!deck) return;
    const toolbar = library.querySelector('.v3-library-toolbar');
    const arrow = library.querySelector('[data-v3-collapse]');
    const hint = library.querySelector('[data-v3-hint]');
    const announcement = library.querySelector('[data-v3-deck-announcement]');
    const placeholder = deck.querySelector('.v3-drag-placeholder');
    const abort = new AbortController();
    const signal = abort.signal;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let nodes = [...deck.querySelectorAll('[data-v3-card]')];
    let positions = new Map();
    let press = null;
    let drag = null;
    let swallowUntil = 0;
    let frame = 0;
    let scrollFrame = 0;
    let resizeFrame = 0;
    let alive = true;
    const expanded = () => !!state.aDecks?.cards;
    function announce(text) { if (announcement) announcement.textContent = text; }
    function closeMenus() {
      state.cardMenu = null;
      deck.querySelectorAll('.v3-card-menu').forEach(menu => { menu.hidden = true; });
      deck.querySelectorAll('[data-v3-menu-toggle]').forEach(button => button.setAttribute('aria-expanded', 'false'));
    }
    function refreshChrome() {
      deck.classList.toggle('is-expanded', expanded());
      deck.classList.toggle('is-stacked', !expanded());
      arrow.hidden = !expanded();
      if (hint) {
        hint.textContent = hints(ui, expanded());
        hint.hidden = !!(expanded() ? state.hints?.reordered : state.hints?.expanded);
      }
      nodes.forEach((node, index) => {
        const inactive = !expanded() && index > 0;
        node.inert = inactive;
        node.setAttribute('aria-hidden', String(inactive));
        node.querySelector('.v3-card-more').disabled = !expanded();
        node.querySelector('.v3-card-number').textContent = String(index + 1).padStart(2, '0');
      });
    }
    function layout(animate = true) {
      if (!alive) return;
      const frontHeight = nodes[0].scrollHeight;
      let nextY = 0;
      positions = new Map();
      nodes.forEach((node, index) => {
        const height = node.querySelector('.v3-card-body').offsetHeight + node.querySelector('.v3-card-top').offsetHeight + 2;
        const y = expanded() ? nextY : Math.min(index, 3) * 12;
        positions.set(node.dataset.v3Card, { y, height });
        if (expanded()) nextY += height + 18;
        node.style.transition = animate && !reduced ? 'transform 380ms cubic-bezier(.25,.46,.45,.94), height 380ms cubic-bezier(.25,.46,.45,.94), opacity 200ms' : 'none';
        node.style.transitionDelay = animate && !drag && !reduced ? `${Math.min(index, 6) * 22}ms` : '0ms';
        node.style.height = `${expanded() ? height : frontHeight}px`;
        if (node === drag?.node) return;
        const scale = expanded() ? 1 : 1 - Math.min(index, 3) * .024;
        const angle = expanded() || index === 0 ? 0 : index % 2 ? -1.35 : 1.2;
        node.style.transform = `translate3d(0,${y}px,0) scale(${scale}) rotate(${angle}deg)`;
        node.style.zIndex = nodes.length - index;
        node.style.opacity = !expanded() && index > 3 ? '0' : '1';
      });
      const height = expanded() ? Math.max(0, nextY - 18) : frontHeight + Math.min(nodes.length - 1, 3) * 12 + 10;
      deck.style.transition = animate && !reduced ? 'height 430ms cubic-bezier(.25,.46,.45,.94)' : 'none';
      deck.style.height = `${height}px`;
      refreshChrome();
      if (drag) {
        const target = positions.get(drag.node.dataset.v3Card);
        placeholder.hidden = false;
        placeholder.style.height = `${target.height}px`;
        placeholder.style.transform = `translateY(${target.y}px)`;
      }
    }
    function scrollToDeck() {
      cancelAnimationFrame(scrollFrame);
      const start = library.scrollTop;
      const target = Math.max(0, deck.getBoundingClientRect().top - library.getBoundingClientRect().top + start - toolbar.offsetHeight - 8);
      if (reduced) { library.scrollTop = target; return; }
      const at = performance.now();
      function step(now) {
        if (!alive) return;
        const amount = Math.min(1, (now - at) / 430);
        library.scrollTop = start + (target - start) * (1 - Math.pow(1 - amount, 3));
        if (amount < 1) scrollFrame = requestAnimationFrame(step);
      }
      scrollFrame = requestAnimationFrame(step);
    }
    function setExpanded(value) {
      closeMenus();
      state.aDecks ||= {};
      state.aDecks.cards = value;
      state.hints ||= {};
      if (value) state.hints.expanded = true;
      layout(true);
      ui.commit();
      announce(value ? hints(ui, true) : collapseLabel(ui));
      scrollToDeck();
    }
    function beginDrag(node, x, y) {
      cancelAnimationFrame(scrollFrame);
      closeMenus();
      const rect = node.getBoundingClientRect();
      drag = { node, original: [...nodes], x, y, grabY: y - rect.top, moved: false };
      node.classList.add('is-dragging');
      node.style.transition = 'none';
      node.style.transitionDelay = '0ms';
      node.style.zIndex = '500';
      deck.classList.add('is-dragging');
      layout(true);
      updateDrag(x, y);
      announce(copy(ui, 'Card lifted. Drag up or down.', '卡片已提起，可以上下拖动。', 'カードを上下に動かせます。', '카드를 위아래로 옮기세요.', 'Tarjeta levantada. Muévela arriba o abajo.'));
      autoScroll();
    }
    function updateDrag(x, y) {
      if (!drag) return;
      drag.x = x; drag.y = y;
      const own = positions.get(drag.node.dataset.v3Card);
      const targetY = Math.max(-6, Math.min(deck.offsetHeight - own.height + 6, y - deck.getBoundingClientRect().top - drag.grabY));
      drag.node.style.transition = 'none';
      drag.node.style.transform = `translate3d(0,${targetY}px,0) scale(1.018) rotate(-.6deg)`;
      const center = targetY + own.height / 2;
      const rest = nodes.filter(node => node !== drag.node);
      const index = rest.filter(node => { const position = positions.get(node.dataset.v3Card); return center > position.y + position.height / 2; }).length;
      const oldIndex = nodes.indexOf(drag.node);
      if (index !== oldIndex) {
        nodes = [...rest.slice(0, index), drag.node, ...rest.slice(index)];
        drag.moved = true;
        layout(true);
      }
    }
    function autoScroll() {
      cancelAnimationFrame(frame);
      if (!drag || !alive) return;
      const bounds = library.getBoundingClientRect();
      const top = Math.max(bounds.top, toolbar.getBoundingClientRect().bottom) + 45;
      const bottom = bounds.bottom - 48;
      const step = drag.y < top ? -Math.min(12, (top - drag.y) / 4) : drag.y > bottom ? Math.min(12, (drag.y - bottom) / 4) : 0;
      if (step) { library.scrollTop += step; updateDrag(drag.x, drag.y); }
      frame = requestAnimationFrame(autoScroll);
    }
    function finishDrag(cancelled) {
      if (!drag) return;
      cancelAnimationFrame(frame);
      const current = drag;
      drag = null;
      current.node.classList.remove('is-dragging');
      deck.classList.remove('is-dragging');
      placeholder.hidden = true;
      if (cancelled) nodes = current.original;
      nodes.forEach(node => deck.insertBefore(node, placeholder));
      layout(true);
      if (!cancelled && current.moved) {
        state.hints ||= {};
        state.hints.reordered = true;
        ui.reorderCards(nodes.map(node => node.dataset.v3Card));
        refreshChrome();
        announce(copy(ui, 'Card order updated.', '卡片顺序已调整。', 'カードの順番を変更しました。', '카드 순서를 바꿨어요.', 'Orden de tarjetas actualizado.'));
      } else if (cancelled) announce(copy(ui, 'Move cancelled.', '已取消拖动。', '移動を取り消しました。', '이동을 취소했어요.', 'Movimiento cancelado.'));
    }
    function endPress(cancelled = false) {
      if (!press) return;
      clearTimeout(press.timer);
      const held = press.held;
      press = null;
      deck.classList.remove('is-holding');
      if (drag) finishDrag(cancelled);
      if (held) swallowUntil = performance.now() + 650;
    }
    function startPress(node, x, y, type) {
      if (press) endPress(true);
      if (!expanded() && node !== nodes[0]) return;
      press = { node, x, y, type, held: false, timer: 0 };
      press.timer = setTimeout(() => {
        if (!press || !alive) return;
        press.held = true;
        swallowUntil = performance.now() + 20000;
        deck.classList.add('is-holding');
        if (expanded()) beginDrag(node, x, y);
        else setExpanded(true);
      }, 470);
    }
    function movePress(x, y) {
      if (!press) return;
      if (drag) updateDrag(x, y);
      else if (!press.held && Math.hypot(x - press.x, y - press.y) > 9) {
        swallowUntil = performance.now() + 650;
        endPress(true);
      }
    }
    function targetCard(event) {
      if (event.target.closest('button,.v3-card-menu')) return null;
      return event.target.closest('[data-v3-card]');
    }
    deck.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch' || event.button !== 0) return;
      const node = targetCard(event);
      if (!node) return;
      event.preventDefault();
      node.querySelector('.v3-card-body').focus({ preventScroll: true });
      startPress(node, event.clientX, event.clientY, 'pointer');
    }, { signal });
    document.addEventListener('pointermove', event => { if (press?.type === 'pointer') movePress(event.clientX, event.clientY); }, { signal });
    document.addEventListener('pointerup', event => { if (press?.type === 'pointer') endPress(false); }, { signal });
    document.addEventListener('pointercancel', () => { if (press?.type === 'pointer') endPress(true); }, { signal });
    deck.addEventListener('touchstart', event => {
      if (event.touches.length !== 1) { endPress(true); return; }
      const node = targetCard(event);
      if (node) startPress(node, event.touches[0].clientX, event.touches[0].clientY, 'touch');
    }, { passive: true, signal });
    deck.addEventListener('touchmove', event => {
      if (press?.type !== 'touch') return;
      if (press.held && event.cancelable) event.preventDefault();
      if (event.touches.length === 1) movePress(event.touches[0].clientX, event.touches[0].clientY);
      else endPress(true);
    }, { passive: false, signal });
    deck.addEventListener('touchend', event => { if (press?.type === 'touch') { if (press.held && event.cancelable) event.preventDefault(); endPress(false); } }, { passive: false, signal });
    deck.addEventListener('touchcancel', () => endPress(true), { signal });
    deck.addEventListener('contextmenu', event => event.preventDefault(), { signal });
    library.addEventListener('click', event => {
      const toggle = event.target.closest('[data-v3-menu-toggle]');
      if (toggle && expanded()) {
        event.preventDefault(); event.stopPropagation();
        const menu = toggle.closest('[data-v3-card]').querySelector('.v3-card-menu');
        const wasOpen = !menu.hidden;
        closeMenus();
        if (!wasOpen) { menu.hidden = false; toggle.setAttribute('aria-expanded', 'true'); state.cardMenu = toggle.dataset.v3MenuToggle; }
        ui.commit(); return;
      }
      if (event.target.closest('[data-v3-collapse]')) {
        event.preventDefault(); event.stopPropagation(); endPress(true); setExpanded(false); return;
      }
      if (event.target.closest('button,.v3-card-menu')) return;
      const node = event.target.closest('[data-v3-card]');
      if (node) {
        event.preventDefault(); event.stopPropagation();
        if (performance.now() < swallowUntil || drag) return;
        closeMenus(); ui.navigate('card-show', node.dataset.v3Card);
      } else closeMenus();
    }, { signal });
    library.addEventListener('keydown', event => {
      if (event.key === 'Escape') { endPress(true); closeMenus(); return; }
      const body = event.target.closest('.v3-card-body');
      if (!body) return;
      const node = body.closest('[data-v3-card]');
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); ui.navigate('card-show', node.dataset.v3Card); }
      else if (event.code === 'Space') { event.preventDefault(); event.stopPropagation(); if (!expanded()) setExpanded(true); }
      else if (expanded() && event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const from = nodes.indexOf(node), to = from + (event.key === 'ArrowUp' ? -1 : 1);
        if (to < 0 || to >= nodes.length) return;
        nodes.splice(from, 1); nodes.splice(to, 0, node);
        nodes.forEach(item => deck.insertBefore(item, placeholder));
        state.hints ||= {}; state.hints.reordered = true;
        ui.reorderCards(nodes.map(item => item.dataset.v3Card)); layout(true);
        body.focus({ preventScroll: true });
        announce(`${countLabel(ui, to + 1)} / ${nodes.length}`);
      }
    }, { signal });
    window.addEventListener('blur', () => endPress(true), { signal });
    library.addEventListener('scroll', () => { if (press && !press.held) endPress(true); }, { passive: true, signal });
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => { if (!drag) layout(false); });
    });
    observer.observe(library);
    layout(false);
    unmount = () => {
      alive = false;
      if (press) clearTimeout(press.timer);
      cancelAnimationFrame(frame); cancelAnimationFrame(scrollFrame); cancelAnimationFrame(resizeFrame);
      observer.disconnect(); abort.abort();
    };
  }
  window.SeeFoodCardsV3 = {
    render(page, state, ui) { return ({ cards, 'card-show': cardShow, 'card-edit': cardEdit, translate }[page] || (() => null))(state, ui); },
    mount
  };
})();
