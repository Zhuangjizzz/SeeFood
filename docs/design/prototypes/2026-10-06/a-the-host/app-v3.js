/* THROWAWAY A03 prototype. Browser-only sample storage; no backend, camera or AI calls. */
(() => {
  const params = new URLSearchParams(location.search);
  const C = window.SeeFoodContent;
  const storageKey = 'seefood-THROWAWAY-prototype-v3';
  const exportMode = params.has('export');
  const device = document.getElementById('device');
  const screen = document.getElementById('screen');
  const clone = value => JSON.parse(JSON.stringify(value));
  const e = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let state;
  const copy = (...values) => values[C.languages.indexOf(state.lang)] || values[0];
  const t = key => C.strings[key] ? copy(...C.strings[key]) : key;
  const iconPaths={
    camera:'<path d="M8 6l2-3h4l2 3h4a2 2 0 012 2v11a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z"/><circle cx="12" cy="13" r="4"/>',
    image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="M3 17l5-5 4 4 4-7 5 7"/>',
    arrow:'<path d="M4 12h16M14 6l6 6-6 6"/>',chevron:'<path d="M9 5l7 7-7 7"/>',back:'<path d="M20 12H4m6-6-6 6 6 6"/>',plus:'<path d="M12 5v14M5 12h14"/>',check:'<path d="M5 12l4 4L19 6"/>',globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18z"/>',chat:'<path d="M21 11a8 8 0 01-8 8H7l-5 3 1.5-6A8 8 0 111 9"/><path d="M8 10h8M8 14h5"/>',cards:'<rect x="6" y="3" width="15" height="16" rx="3"/><path d="M3 7v12a3 3 0 003 3h11M10 8h7M10 12h5"/>',user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0116 0v2"/>',history:'<path d="M3 11a9 9 0 119 10M3 4v7h7M12 7v6l4 2"/>',leaf:'<path d="M20 3C9 2 2 7 5 15c4 7 15 1 15-12zM3 21l12-12"/>',settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="var(--surface)"/><circle cx="16" cy="12" r="2" fill="var(--surface)"/><circle cx="10" cy="18" r="2" fill="var(--surface)"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',close:'<path d="M6 6l12 12M18 6 6 18"/>',refresh:'<path d="M20 8a8 8 0 00-14-3L3 8m0-5v5h5M4 16a8 8 0 0014 3l3-3m0 5v-5h-5"/>',warning:'<path d="M11 3L2 19a1 1 0 001 2h18a1 1 0 001-2L13 3a1 1 0 00-2 0zM12 8v5M12 17v.1"/>',trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',edit:'<path d="M16 3l5 5L8 21H3v-5zM13 6l5 5"/>',expand:'<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',book:'<path d="M12 5C8 2 4 3 2 4v16c3-2 6-2 10 0 4-2 7-2 10 0V4c-2-1-6-2-10 1v15"/>',spark:'<path d="M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',list:'<path d="M8 5h13M8 12h13M8 19h13M3 5h.1M3 12h.1M3 19h.1"/>',send:'<path d="M22 2L9 15M22 2l-7 20-6-7-7-6z"/>'
  };
  function icon(name,size=20){return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name]||iconPaths.spark}</svg>`;}

  const initialMessages = [
    {id:'m1',role:'user',text:'What should I check if I want something mild?',lang:'en'},
    {id:'m2',role:'assistant',text:'Start by asking about the Seasonal Greens. Confirm the vegetables, sauces and cooking fats with the staff. The name alone does not confirm the ingredients. You can also ask whether the Sichuan-style Eggplant can be prepared with less chilli.',rich:true,lang:'en'}
  ];
  const initialRecord = (id,day,photos) => ({id,createdAt:`2026-10-${day}T12:30:00+08:00`,kind:'menu',photoIds:photos,chat:clone(initialMessages),chatDraft:'',processing:'ready',saveState:'saved',imageStates:photos.map(()=>({upload:'ready',cards:'ready',translation:'ready'})),selectedImage:0,imageChoices:{},chatScroll:0,newReply:false});
  const blankSide = () => ({draft:'',original:'',translated:'',lang:'en',at:0,revision:0,pending:false});
  const defaults = () => ({
    version:3,variant:'A',page:'capture',lang:'en',scenario:'ready',inputMode:'menu',
    records:[initialRecord('record-1','06',[0,1]),initialRecord('record-2','05',[0]),initialRecord('record-3','04',[1])],
    activeRecordId:'record-1',activeImage:0,imageView:'translated',imageChoices:{},recordPhotos:[0,1],
    previewImages:[0,1,2],adding:false,previewKind:'menu',selectedDish:'d1',selectedCard:'c1',
    cardCategory:'all',aDecks:{cards:false,dishes:false},cardOrder:C.cards.map(c=>c.id),hints:{expanded:false,reordered:false},
    customCards:[],removedCards:[],cardDrafts:{},cardDraft:null,editingId:null,cardMenu:null,
    conversation:{speaker:'visitor',visitor:blankSide(),staff:blankSide(),epoch:0},
    preferences:['mild'],preferenceNotes:{allergies:'',restrictions:'',tastes:''},preferenceSet:false,preferenceVersion:1,welcomeDismissed:false,
    nav:[],positions:{},zoom:1,fullImageSource:'result',fullImageIndex:0,historyMenu:null,dialog:null,persistenceError:false
  });
  state=defaults();
  if(!exportMode){try{const stored=JSON.parse(localStorage.getItem(storageKey));if(stored?.version===3)state={...state,...stored};}catch{state.persistenceError=true;}}
  state.scenario=params.get('scenario')||'ready';
  if(params.get('lang')&&C.languages.includes(params.get('lang')))state.lang=params.get('lang');
  if(params.get('page'))state.page=params.get('page');
  if(params.has('deck'))state.aDecks[state.page==='cards'?'cards':'dishes']=params.get('deck')==='expanded';
  state.dialog=null;state.cardMenu=null;state.historyMenu=null;
  const record=()=>state.records.find(r=>r.id===state.activeRecordId);
  const viewKey=()=>['result','chat','detail','fullscreen'].includes(state.page)?state.page+':'+state.activeRecordId:state.page;
  const image=(n=0,view='original')=>`assets/${n===1?'menu-extra':'menu'}${view==='translated'?'-translated.svg':n===1?'.svg':'-original.svg'}`;
  const recordTitle=r=>`${t(r?.kind==='dish'?'dish':'menu')} · ${new Intl.DateTimeFormat(state.lang,{month:'short',day:'numeric'}).format(new Date(r?.createdAt||'2026-10-06T12:30:00+08:00'))}`;
  let toastTimer,scrollTimer;
  function toast(message){const box=document.getElementById('toast');box.textContent=message;box.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>box.classList.remove('visible'),2400);}
  function capturePosition(){const sc=screen.querySelector('.page-scroll');if(sc)state.positions[viewKey()]=sc.scrollTop;}
  function updateUrl(){const u=new URL(location.href);u.searchParams.set('variant','A');u.searchParams.set('page',state.page);u.searchParams.set('lang',state.lang);u.searchParams.set('scenario',state.scenario);if(['cards','result'].includes(state.page))u.searchParams.set('deck',state.aDecks[state.page==='cards'?'cards':'dishes']?'expanded':'stacked');else u.searchParams.delete('deck');history.replaceState(null,'',u);}
  function commit(){
    if(state.scenario==='storage-failed'){state.persistenceError=true;}else if(!exportMode){try{const saved={...state,scenario:'ready',dialog:null,cardMenu:null,historyMenu:null,persistenceError:false};localStorage.setItem(storageKey,JSON.stringify(saved));state.persistenceError=false;}catch{state.persistenceError=true;}}
    window.prototypeState=state;document.getElementById('state-display').textContent=JSON.stringify(state,null,2);updateUrl();
    const foot=document.querySelector('.stage-footnote');if(foot)foot.textContent=state.persistenceError?'浏览器示例保存失败 · 当前更改仅在此页面内':'固定示例 · 浏览器保存可重置';
  }
  function cards(){
    if(state.scenario==='empty'&&state.page==='cards')return [];
    let items=C.cards.filter(c=>!state.removedCards.includes(c.id)&&!state.customCards.some(x=>x.id===c.id)).map(c=>({...c,title:c.titleKey?t(c.titleKey):Array.isArray(c.title)?(c.preset?copy(...c.title):c.title[0]):c.title,en:c.preset?copy(...c.texts):c.en,lang:c.preset?state.lang:'en'})).concat(state.customCards);
    items.sort((a,b)=>state.cardOrder.indexOf(a.id)-state.cardOrder.indexOf(b.id));
    if(state.scenario==='single')items=items.slice(0,1);
    if(state.scenario==='many'){if(!state.reviewCards?.length)state.reviewCards=Array.from({length:15},(_,i)=>({...items[i%Math.max(1,items.length)]||C.cards[0],id:'sample-'+i,title:((items[i%Math.max(1,items.length)]||{}).title||t('cards'))+' '+(i+1)}));items=state.reviewCards;}else if(state.page==='card-show'&&state.selectedCard?.startsWith('sample-'))items=state.reviewCards||items;
    if(state.scenario==='long-card'&&items[0])items[0]={...items[0],en:Array(4).fill(items[0].en).join(' '),zh:Array(5).fill(items[0].zh).join('')};
    return items;
  }
  function reorderCards(ids){
    if(ids.some(id=>id.startsWith('sample-'))){state.reviewCards=ids.map(id=>state.reviewCards.find(c=>c.id===id)).filter(Boolean);state.hints.reordered=true;commit();return;}
    const set=new Set(ids);let i=0;state.cardOrder=state.cardOrder.map(id=>set.has(id)?ids[i++]:id);state.hints.reordered=true;commit();
  }
  function syncRecord(){const r=record();state.recordPhotos=r?.photoIds||[];state.imageChoices=r?.imageChoices||{};state.activeImage=Math.min(Math.max(0,state.activeImage),Math.max(0,state.recordPhotos.length-1));}
  function imgState(i=state.activeImage){const base=record()?.imageStates?.[i]||{upload:'ready',cards:'ready',translation:'ready'};
    if(i!==state.activeImage)return base;
    if(['processing','partial','uploading','upload-failed'].includes(state.scenario))return {...base,upload:state.scenario==='uploading'?'uploading':state.scenario==='upload-failed'?'failed':'ready',translation:state.scenario==='partial'?'failed':'processing'};
    if(state.scenario==='no-translation'||record()?.kind==='dish'||state.lang==='zh'&&record()?.targetLanguage==='zh')return {...base,translation:'not_required'};
    return base;
  }
  function selectImage(i){state.activeImage=i;const r=record();if(r){r.selectedImage=i;state.imageView=r.imageChoices?.[i]||(imgState(i).translation==='ready'?'translated':'original');}state.fullImageIndex=i;state.zoom=1;}
  syncRecord();if(!params.has('page')||state.page==='result')selectImage(record()?.selectedImage||0);
  const status=(r=record())=>{
    if(state.page==='preferences'&&['checking','failed'].includes(state.scenario))return `<div class="status-banner ${state.scenario==='failed'?'warning':''}">${icon(state.scenario==='failed'?'warning':'refresh',16)}<div><strong>${t(state.scenario==='failed'?'checkFailed':'checking')}</strong>${t('checkFailedNote')}${state.scenario==='failed'?`<button data-action="retry-check">${t('retry')}</button>`:''}</div></div>`;
    if(state.scenario==='offline')return `<div class="status-banner">${icon('book',16)}<div>${t('offline')}<small>${t('offlineNote')}</small></div></div>`;
    if(state.scenario==='storage-failed')return `<div class="status-banner error">${icon('warning',16)}<div><strong>${t('saveFailed')}</strong>${t('saveFailedNote')}<button data-action="retry-save">${t('retrySave')}</button></div></div>`;
    const s=imgState();if(s.upload!=='ready')return `<div class="status-banner warning"><div><strong>${s.upload==='failed'?t('uploadFailed'):copy('Uploading photos','正在上传图片','写真をアップロード中','사진 업로드 중','Subiendo fotos')}</strong>${s.upload==='failed'?t('uploadFailedNote'):copy('Keep this page open until upload completes.','上传完成前请保持页面打开。','アップロードが終わるまで画面を開いてください。','업로드가 끝날 때까지 화면을 유지하세요.','Mantén esta página abierta hasta terminar la carga.')}<button data-action="retry-upload" ${s.upload==='failed'?'':'hidden'}>${t('retry')}</button></div></div>`;
    if(s.translation==='processing'||s.translation==='failed')return `<div class="status-banner ${s.translation==='failed'?'warning':''}">${icon(s.translation==='failed'?'warning':'refresh',16)}<div><strong>${t(s.translation==='failed'?'partial':'processing')}</strong>${t(s.translation==='failed'?'partialNote':'processingNote')}<span>${copy('You can leave and return from Recent records.','可以离开，稍后从最近记录继续。','離れても最近の記録から戻れます。','나중에 최근 기록에서 이어 볼 수 있어요.','Puedes volver desde los registros recientes.')}</span>${s.translation==='failed'?`<button data-action="retry-image">${t('retryImage')}</button>`:''}</div></div>`;
    return `<div class="status-banner">${icon('check',15)}<span>${t('savedLocal')} · ${t('offlineAvailable')}</span></div>`;
  };
  function header(key){return `<header class="sub-header"><button class="icon-button" data-action="back" aria-label="${t('back')}">${icon('back')}</button><h1>${e(t(key))}</h1></header>`;}
  function tabbar(active){return `<nav class="app-tabbar">${[['capture','camera'],['cards','cards'],['mine','user']].map(([p,i])=>`<button data-page="${p}" class="${p===active?'active':''}" aria-current="${p===active?'page':'false'}">${icon(i)}<span>${t(p)}</span></button>`).join('')}</nav>`;}
  const ui={t,copy,e,escape:e,icon,header,tabbar,image,recordTitle,status,getCards:cards,commit,render:()=>render(),navigate,toast,reorderCards,
    get commCards(){return cards();},get dishes(){return state.scenario==='no-cards'?[]:C.dishes.filter(x=>x.images.includes(state.recordPhotos[state.activeImage]===1?1:0)).map(x=>({...x,price:x.price===null?null:'¥'+x.price}));},
    empty:kind=>`<div class="empty-block">${icon(kind==='cards'?'cards':'image',28)}<strong>${t(kind==='cards'?'noSavedCards':'noCards')}</strong>${t(kind==='cards'?'noSavedCardsNote':'noCardsNote')}</div>`,
    menu:(cls='')=>`<button class="menu-preview ${cls}" data-action="fullscreen" aria-label="${t('zoomIn')}">${state.scenario==='offline-missing'?`<span>${t('notSavedImage')}</span>`:`<img src="${image(state.recordPhotos[state.activeImage],state.imageView)}" alt="${t(state.imageView)}">`}</button>`,
    imageTabs:()=>`<div class="v3-image-strip">${state.recordPhotos.map((id,i)=>`<button data-action="select-image" data-value="${i}" class="image-thumb ${i===state.activeImage?'active':''}" aria-label="${t('photo')} ${i+1}"><img src="${image(id,'original')}" alt=""><span>${i+1}</span><small>${imgState(i).upload!=='ready'?t('waitingUpload'):imgState(i).translation==='processing'?t('working'):imgState(i).translation==='failed'?copy('Retry','待重试','再試行','재시도','Reintentar'):t('saved')}</small></button>`).join('')}</div><div class="image-toggle">${['original','translated'].map(v=>`<button data-action="image-view" data-value="${v}" class="${v===state.imageView?'active':''}" ${v==='translated'&&imgState().translation!=='ready'?'disabled':''}>${t(v)}</button>`).join('')}</div>`
  };
  function renderResult(){if(!record())return header('history')+ui.empty('dishes');let html=window.SeeFoodVariants.A.render('result',state,ui);html=html.replace('data-page="capture"','data-action="back"').replace(e(t('recordTitle')),e(recordTitle(record())));return html;}
  function renderDetail(){const d=C.dishes.find(x=>x.id===state.selectedDish)||C.dishes[0];return `${header('details')}<div class="page-scroll sub-content"><p class="sub-kicker">${t('fromPhoto')} ${d.images[0]+1}</p><div class="detail-zh">${e(d.zh)}</div><h2>${e(d.en)}</h2><div class="detail-price">${d.price===null?t('priceUnknown'):'¥'+d.price}</div><p>${e(d.desc)}</p><button class="source-link" data-action="view-original">${icon('image')} ${t('viewOriginal')}</button>${[['ingredients',d.ingredients.join(', ')],['commonRecipe',d.method],['dietaryNote',d.caution],['howToEat',d.eating],['culture',d.story]].map(([k,v])=>`<h3>${t(k)}</h3><p lang="en">${e(v)}</p>`).join('')}<p class="muted-note">${t('recipeCaution')}</p></div><div class="sub-footer"><button class="primary-button" data-page="chat">${t('askAI')}</button></div>`;}
  function renderChat(){const r=record();if(!r)return header('chat')+ui.empty('dishes');const messages=r.chat||[];const working=r.replyPending||state.scenario==='replying';return `${header('chat')}<div class="page-scroll chat-page v3-chat"><div class="chat-context">${icon('book')}<span>${e(recordTitle(r))} · ${r.photoIds.length} ${t('photos')}</span></div>${state.scenario==='stale'?`<div class="status-banner warning">${t('stale')}</div>`:''}${state.scenario==='offline'?status():''}${messages.map((m,i)=>`<div class="chat-message ${m.role}" data-message-id="${m.id}">${m.role==='assistant'?'<div class="v3-answer-label">SeeFood</div>':''}<div lang="${m.lang||'en'}">${e(state.scenario==='interrupted'&&i===messages.length-1?m.text.slice(0,105)+'…':m.text)}</div>${m.rich?`<button class="chat-dish" data-page="detail" data-id="d3"><strong>清炒时蔬 · Seasonal Greens</strong><small>${t('priceUnknown')}</small></button><div class="chat-comm"><strong>请少放辣椒，谢谢。</strong><p>Please make it less spicy. Thank you.</p><button data-action="save-chat-card" data-id="${m.id}">${t(state.customCards.some(c=>c.sourceMessageId===r.id+':'+m.id)?'cardSaved':'saveCard')}</button></div>`:''}${state.scenario==='interrupted'&&i===messages.length-1?`<div class="status-banner warning">${t('unfinished')}<button data-action="retry-reply">${t('retryReply')}</button></div>`:''}</div>`).join('')}${working?`<p class="v3-reply-progress">${t('waiting')} ···</p>`:''}</div><button class="v3-new-reply" data-action="latest-reply" ${r.newReply?'':'hidden'}>${copy('New reply ↓','有新回复 ↓','新しい返信 ↓','새 답변 ↓','Nueva respuesta ↓')}</button><div class="chat-dock"><div class="quick-prompts">${['quickRecommend','quickPrice','quickStaff'].map(k=>`<button data-action="quick-prompt" data-value="${k}" ${working||state.scenario==='offline'?'disabled':''}>${t(k)}</button>`).join('')}</div><div class="chat-input-row"><textarea id="chat-draft" rows="1" placeholder="${t('chatHint')}">${e(r.chatDraft||'')}</textarea><button data-action="send-chat" aria-label="${t('send')}" ${working||state.scenario==='offline'||!r.chatDraft?.trim()?'disabled':''}>${icon('send')}</button></div>${working?`<p class="muted-note">${t('draftNote')}</p>`:''}${r.chatDraft?`<button class="small-button" data-action="clear-chat-draft">${copy('Clear draft','清空草稿','下書きを消す','초안 지우기','Borrar borrador')}</button>`:''}</div>`;}
  const pages=[['onboarding','首次进入'],['capture','拍照首页'],['preview','提交前预览'],['result','识别结果'],['detail','菜品详情（保留探索稿）'],['chat','独立对话'],['cards','个人沟通卡'],['card-show','放大展示'],['card-edit','编辑沟通卡'],['translate','双向文字翻译'],['mine','我的'],['history','历史记录'],['preferences','饮食偏好'],['language','语言设置']];
  const scenarios={capture:[['ready','有最近记录'],['empty','首次使用 / 无记录'],['camera-denied','相机不可用']],onboarding:[['ready','匹配系统语言'],['unmatched-language','系统语言未匹配']],preview:[['ready','待确认'],['upload-failed','上传失败']],result:[['ready','已保存'],['uploading','正在上传'],['upload-failed','上传失败'],['processing','译图处理中'],['partial','译图失败'],['no-cards','没有菜品'],['no-translation','无须译图'],['offline','离线已保存'],['offline-missing','离线缺失图片'],['storage-failed','保存失败']],cards:[['ready','默认卡库'],['single','仅一张卡'],['many','15张卡 / 拖动'],['long-card','长内容'],['empty','空卡库'],['offline','离线'],['storage-failed','保存失败']],chat:[['ready','完整回复'],['replying','正在回复'],['interrupted','中断回复'],['stale','偏好已改变'],['offline','离线']],history:[['ready','历史'],['empty','空历史'],['processing','处理中'],['upload-failed','待上传'],['offline','离线']],preferences:[['ready','编辑偏好'],['checking','检查中'],['failed','检查失败']],language:[['ready','设置语言'],['unmatched-language','首次选择语言']],'card-edit':[['ready','编辑'],['translating','翻译中'],['translation-failed','翻译失败'],['offline','离线'],['storage-failed','保存失败']],translate:[['ready','双向交流'],['translating','翻译中'],['translation-failed','翻译失败'],['offline','离线'],['storage-failed','保存失败']]};
  function render(options={}){
    if(options.capture!==false)capturePosition();syncRecord();
    const position=options.top!==undefined?options.top:state.positions[viewKey()]||0;
    device.className='device variant-a';device.lang=state.lang;
    let content;
    if(['cards','card-show','card-edit','translate'].includes(state.page))content=window.SeeFoodCardsV3?.render(state.page,state,ui);
    else if(state.page==='result')content=renderResult();else if(state.page==='detail')content=renderDetail();else if(state.page==='chat')content=renderChat();else {let viewState=state;if(state.page==='preferences'&&state.preferenceDraft)viewState={...state,preferences:state.preferenceDraft.selected,preferenceNotes:state.preferenceDraft.notes};if(state.page==='history'&&['processing','upload-failed'].includes(state.scenario))viewState={...state,records:state.records.map((r,i)=>i===0?{...r,processing:state.scenario}:r)};content=window.SeeFoodPagesV3?.render(state.page,viewState,ui);}
    screen.innerHTML=content||header('capture');
    if(state.dialog)renderDialog();
    if(state.page==='result')window.SeeFoodVariants.A.mount(state,ui);
    if(state.page==='fullscreen'&&state.fullImageSource==='result'&&imgState().translation!=='ready')screen.querySelector('[data-action="image-view"][data-value="translated"]')?.setAttribute('disabled','');
    window.SeeFoodCardsV3?.mount(state,ui);
    const sc=screen.querySelector('.page-scroll');if(sc){sc.scrollTop=position;sc.addEventListener('scroll',()=>{state.positions[viewKey()]=sc.scrollTop;if(state.page==='chat'&&record()&&sc.scrollHeight-sc.clientHeight-sc.scrollTop<48){record().newReply=false;screen.querySelector('.v3-new-reply')?.setAttribute('hidden','');}clearTimeout(scrollTimer);scrollTimer=setTimeout(commit,120);},{passive:true});}
    mountPhotoDrag();mountViewer();renderWorkbench();commit();
  }
  function renderWorkbench(){
    document.getElementById('page-nav').innerHTML=pages.map(([key,label],i)=>`<button class="nav-page ${state.page===key?'active':''}" data-review-page="${key}"><span>${String(i+1).padStart(2,'0')}</span>${label}</button>`).join('');
    document.getElementById('stage-title').textContent=pages.find(p=>p[0]===state.page)?.[1]||'全屏图片';
    document.getElementById('variant-notes').innerHTML='<h2>The Host</h2><p class="direction-subtitle">温暖餐桌</p><p class="direction-description">轻点沟通卡直接展示；长按展开，展开后再长按拖动。</p><div class="swatches"><span style="background:#f2f0eb"></span><span style="background:#245941"></span><span style="background:#1e3932"></span><span style="background:#dce6d8"></span></div>';
    document.getElementById('language-picker').value=state.lang;
    document.getElementById('scenario-picker').innerHTML=(scenarios[state.page]||[['ready','默认']]).map(([v,l])=>`<option value="${v}" ${state.scenario===v?'selected':''}>${l}</option>`).join('');
    document.getElementById('screen-notes').innerHTML='<b>示例保存</b>卡片、草稿、排序和浏览状态保存在本浏览器。图片处理、翻译和回复使用固定示例。<button class="secondary-button" data-action="reset-demo">重置此原型示例</button>';
  }
  function navigate(page,id,options={}){
    capturePosition();const from={page:state.page,recordId:state.activeRecordId,scenario:state.scenario};
    if(page!==state.page&&!options.replace){if(['capture','cards','mine'].includes(page))state.nav=[];else state.nav.push(from);}
    if(id&&page==='detail')state.selectedDish=id;if(id&&page==='card-show')state.selectedCard=id;
    state.page=page;state.scenario=options.scenario||'ready';state.dialog=null;state.cardMenu=null;state.historyMenu=null;
    if(page==='card-edit'&&!state.cardDraft)prepareCard();
    if(page==='preferences'&&!state.preferenceDraft)state.preferenceDraft={selected:[...state.preferences],notes:{...state.preferenceNotes}};
    if(page==='result')selectImage(record()?.selectedImage||0);
    render({capture:false,top:options.top});
  }
  function back(){capturePosition();if(state.page==='preferences')state.preferenceDraft=null;const fallback={page:['card-show','card-edit','translate'].includes(state.page)?'cards':['chat','detail','fullscreen'].includes(state.page)?'result':'capture',recordId:state.activeRecordId};const prev=state.nav.pop()||fallback;state.page=prev.page;state.activeRecordId=prev.recordId;state.scenario=prev.scenario||'ready';state.cardMenu=null;state.dialog=null;render({capture:false});}
  function prepareCard(id){const existing=cards().find(c=>c.id===id);state.editingId=existing?.id||null;const key=state.editingId||'new';state.cardDraft=state.cardDrafts[key]||{title:existing?.title||'',en:existing?.en||'',zh:existing?.zh||'',category:existing?.category||(state.cardCategory==='all'?'service':state.cardCategory),color:existing?.color||'green',lang:existing?.lang||state.lang,titleEdited:!!existing,revision:0};state.cardDrafts[key]=state.cardDraft;}
  function saveDraft(){if(state.cardDraft)state.cardDrafts[state.editingId||'new']=state.cardDraft;commit();}
  function dialog(type,id){state.dialog={type,id};render();}
  function renderDialog(){const d=state.dialog;const label=d.type==='reset'?copy('Reset prototype examples?','重置原型示例？','例をリセットしますか？','예시를 초기화할까요?','¿Reiniciar los ejemplos?'):d.type==='clear-conversation'?copy('Clear this exchange?','清空本次交流？','この会話を消去しますか？','이번 대화를 지울까요?','¿Borrar este intercambio?'):d.type==='draft'?copy('Discard this draft?','放弃此草稿？','下書きを破棄しますか？','초안을 버릴까요?','¿Descartar este borrador?'):d.type==='card'?t('delete'):t('deleteRecord');screen.insertAdjacentHTML('beforeend',`<div class="confirm-overlay"><div class="confirm-dialog" role="dialog" aria-modal="true"><h2>${label}</h2><p>${d.type==='record'||d.type==='history'?t('deleteNote'):d.type==='card'?t('deleteCardNote'):copy('This only changes the prototype examples on this browser.','仅影响此浏览器中的原型示例。','このブラウザのサンプルだけが変わります。','이 브라우저의 예시에만 적용돼요.','Solo afecta los ejemplos de este navegador.')}</p><button class="danger-button full-width" data-action="confirm-dialog">${t('continue')}</button><button class="secondary-button" data-action="cancel-dialog">${t('cancel')}</button></div></div>`);}
  function confirmDialog(){const d=state.dialog;state.dialog=null;
    if(d.type==='reset'){if(!exportMode)localStorage.removeItem(storageKey);state=defaults();state.page='cards';render({capture:false,top:0});return;}
    if(d.type==='card'){state.removedCards.push(d.id);state.customCards=state.customCards.filter(c=>c.id!==d.id);state.cardOrder=state.cardOrder.filter(id=>id!==d.id);delete state.cardDrafts[d.id];state.cardMenu=null;}
    if(d.type==='record'||d.type==='history'){state.records=d.type==='history'?[]:state.records.filter(r=>r.id!==d.id);if(!record())state.activeRecordId=state.records[0]?.id||null;state.historyMenu=null;}
    if(d.type==='draft'){delete state.cardDrafts[state.editingId||'new'];state.cardDraft=null;back();return;}
    if(d.type==='clear-conversation')state.conversation={speaker:'visitor',visitor:blankSide(),staff:blankSide(),epoch:state.conversation.epoch+1};
    render();
  }
  function completePhotos(id){const r=state.records.find(x=>x.id===id);if(!r)return;r.processing='ready';r.imageStates=r.photoIds.map(()=>({upload:'ready',cards:'ready',translation:r.targetLanguage==='zh'||r.kind==='dish'?'not_required':'ready'}));r.saveState='saved';if(state.activeRecordId===id&&state.page==='result'){state.scenario='ready';render();toast(copy('Translated image is ready. Switch when you like.','译图已准备好，可按需切换。','翻訳画像を表示できます。','번역 이미지가 준비됐어요.','La imagen traducida está lista.'));}else commit();}
  function submitPhotos(){if(!state.previewImages.length)return;let r=record();const start=state.adding&&r?r.photoIds.length:0;if(!state.adding||!r){r={...initialRecord('record-'+Date.now(),'06',[]),createdAt:new Date().toISOString(),kind:state.inputMode,chat:[],targetLanguage:state.lang};state.records.unshift(r);state.activeRecordId=r.id;}
    r.photoIds.push(...state.previewImages);r.imageStates.push(...state.previewImages.map(()=>({upload:'uploading',cards:'pending',translation:'pending'})));r.processing='uploading';r.saveState='saving';state.activeImage=start;r.selectedImage=start;
    state.nav=state.nav.filter(n=>n.page!=='preview');navigate('result',null,{replace:true,scenario:'uploading',top:0});const id=r.id;
    setTimeout(()=>{const rr=state.records.find(x=>x.id===id);if(!rr)return;rr.processing='processing';rr.imageStates=rr.imageStates.map(s=>s.upload==='uploading'?{upload:'ready',cards:'ready',translation:'processing'}:s);if(state.page==='result'&&state.activeRecordId===id){state.scenario='processing';render();}else commit();setTimeout(()=>completePhotos(id),2000);},1200);
  }
  function sendChat(key){const r=record();if(!r||r.replyPending||state.scenario==='replying'||state.scenario==='offline')return;
    const prompts={quickRecommend:copy('Help me choose from this menu.','请从这份菜单帮我推荐菜品。','このメニューからおすすめを教えてください。','이 메뉴에서 추천해 주세요.','Ayúdame a elegir platos de este menú.'),quickPrice:copy('How much are 宫保鸡丁 and 鱼香茄子 together?','宫保鸡丁和鱼香茄子一共多少钱？','宮保鶏丁と魚香茄子の合計はいくら？','궁보계정과 어향가지의 합계는?','¿Cuánto cuestan 宫保鸡丁 y 鱼香茄子?'),quickStaff:copy('Help me ask for less chilli.','帮我问店员能否少放辣椒。','辛さを控えめにしてほしいです。','고추를 적게 넣어 주세요.','Ayúdame a pedir menos picante.')};
    const text=key?prompts[key]:r.chatDraft?.trim();if(!text)return;r.chat.push({id:'m-'+Date.now(),role:'user',text,lang:state.lang});r.chatDraft='';r.replyPending=true;state.positions['chat:'+r.id]=999999;render({capture:false,top:999999});const id=r.id;
    r.pendingReplyKey=key; r.replyDue=Date.now()+1800;commit();setTimeout(()=>finishReply(id,key),1800);
  }
  function finishReply(id,key){const rr=state.records.find(x=>x.id===id);if(!rr?.replyPending)return;rr.replyPending=false;rr.chat.push({id:'a-'+Date.now(),role:'assistant',text:key==='quickPrice'?'宫保鸡丁 ¥38 + 鱼香茄子 ¥28 = ¥66. This is a reference amount for one of each. The price of 清炒时蔬 remains unknown.':'This fixed example stays with the current menu. Ask the staff to confirm unclear ingredients. You can use the communication card below.',rich:key!=='quickPrice',lang:'en'});
      const sc=state.page==='chat'&&record()?.id===id?screen.querySelector('.page-scroll'):null;const atBottom=sc&&sc.scrollHeight-sc.clientHeight-sc.scrollTop<100;rr.newReply=!atBottom;
      if(sc)render(atBottom?{top:999999}:{});else commit();
  }
  async function act(action,el){const v=el.dataset.value,id=el.dataset.id,index=Number(el.dataset.index);
    if(action==='back'){back();return;}
    if(action==='reset-demo'){dialog('reset');return;}
    if(action==='confirm-dialog'){confirmDialog();return;}if(action==='cancel-dialog'){state.dialog=null;render();return;}
    if(['take-photo','import-photos','capture','import','add-photos'].includes(action)){if(state.scenario.startsWith('offline')){toast(t('offlineNote'));return;}if(['capture','take-photo'].includes(action)&&state.scenario==='camera-denied'){toast(t('cameraUnavailable'));return;}state.adding=action==='add-photos';state.previewImages=['capture','take-photo'].includes(action)?[0]:[0,1,2];navigate('preview',null,{top:0});toast(copy('Example photos loaded','已载入示例图片','サンプル写真を読み込みました','예시 사진을 불러왔어요','Fotos de ejemplo cargadas'));return;}
    if(action==='mode'){state.inputMode=v;render();return;}
    if(action==='dismiss-welcome'){state.welcomeDismissed=true;if(state.page==='onboarding')navigate('capture',null,{replace:true});else render();return;}
    if(action==='open-record'||action==='open-history'){const r=state.records.find(x=>x.id===id);if(!r)return;capturePosition();state.activeRecordId=id;state.activeImage=r.selectedImage||0;navigate('result',null,{scenario:r.processing==='ready'?'ready':r.processing,capture:false});return;}
    if(action==='submit-photos'){submitPhotos();return;}
    if(action==='remove-photo'){state.previewImages.splice(index,1);render();return;}
    if(action==='move-photo'){const j=index+Number(v);if(j>=0&&j<state.previewImages.length)[state.previewImages[index],state.previewImages[j]]=[state.previewImages[j],state.previewImages[index]];render();return;}
    if(action==='preview-image'){state.fullImageSource='preview';state.fullImageIndex=index;state.zoom=1;navigate('fullscreen');return;}
    if(action==='fullscreen'||action==='view-original'){state.fullImageSource='result';state.fullImageIndex=state.activeImage;state.zoom=1;if(action==='view-original'){state.imageView='original';record().imageChoices[state.activeImage]='original';}navigate('fullscreen',null,{scenario:state.scenario});return;}
    if(action==='select-image'){selectImage(Number(v));render();return;}
    if(action==='full-select'){state.fullImageIndex=index;state.zoom=1;if(state.fullImageSource==='result')selectImage(index);render({top:0});return;}
    if(action==='image-view'){if(v==='translated'&&imgState().translation!=='ready'){toast(t('translatedUnavailable'));return;}state.imageView=v;if(record())record().imageChoices[state.activeImage]=v;render();return;}
    if(action==='zoom'||action==='zoom-reset'){state.zoom=action==='zoom-reset'?1:Math.max(1,Math.min(4,state.zoom+Number(v)));const img=screen.querySelector('.image-viewer img');if(img)img.style.width=100*state.zoom+'%';const label=screen.querySelector('[data-action="zoom-reset"]');if(label)label.textContent=Math.round(state.zoom*100)+'%';screen.querySelector('[data-action="zoom"][data-value="-0.5"]')?.toggleAttribute('disabled',state.zoom<=1);screen.querySelector('[data-action="zoom"][data-value="0.5"]')?.toggleAttribute('disabled',state.zoom>=4);commit();return;}
    if(action==='toggle-a-deck'){document.getElementById('a-deck-dishes')?.toggleDeck?.();commit();return;}
    if(action==='new-card'||action==='edit-card'){prepareCard(action==='edit-card'?id:null);navigate('card-edit');return;}
    if(action==='show-card'){navigate('card-show',id);return;}
    if(action==='filter-cards'){state.cardCategory=v;state.cardMenu=null;render({top:0});return;}
    if(action==='card-menu'){state.cardMenu=state.cardMenu===id?null:id;render();return;}
    if(action==='card-color'){state.cardDraft.color=v;saveDraft();render();return;}
    if(action==='discard-card-draft'){dialog('draft');return;}
    if(action==='generate-card'){
      const d=state.cardDraft;if(!d?.en.trim())return;if(state.scenario==='translation-failed'){toast(t('translationFailed'));return;}if(state.scenario==='offline'){toast(t('offlineNote'));return;}
      d.zh=d.lang==='zh'?d.en:'请少放辣椒，谢谢。';d.pending=false;saveDraft();render();toast(copy('Fixed sample translation. Please check and edit.','固定示例翻译，请核对并编辑。','固定の翻訳例です。編集してください。','고정 번역 예시를 확인하고 수정하세요.','Traducción de ejemplo. Revísala y edítala.'));return;
    }
    if(action==='save-card'){
      const d=state.cardDraft;if(!d?.title.trim()||!d.en.trim()||!d.zh.trim())return;if(state.scenario==='storage-failed'){toast(t('saveFailed'));return;}
      const key=state.editingId||'new',item={...clone(d),id:state.editingId||'custom-'+Date.now(),preset:false};const fresh=!state.editingId;state.customCards=state.customCards.filter(c=>c.id!==item.id).concat(item);if(fresh)state.cardOrder.unshift(item.id);delete state.cardDrafts[key];state.cardDraft=null;state.selectedCard=item.id;
      if(state.cardCategory!=='all'&&state.cardCategory!==item.category)state.cardCategory=item.category;
      if(fresh)state.cardCategory='all';state.nav=[];navigate('cards',null,{replace:true,top:fresh?0:state.positions.cards||0});if(!fresh)screen.querySelector(`[data-v3-card="${item.id}"]`)?.scrollIntoView({block:'center'});toast(t('saved'));return;
    }
    if(action==='save-chat-card'){const r=record(),source=r.id+':'+id;if(state.customCards.some(c=>c.sourceMessageId===source)){toast(t('cardSaved'));return;}const cid='saved-'+Date.now();state.customCards.push({id:cid,title:'Less chilli, please',en:'Please make it less spicy. Thank you.',zh:'请少放辣椒，谢谢。',lang:'en',category:'dietary',color:'green',sourceMessageId:source});state.cardOrder.unshift(cid);render();toast(t('cardSaved'));return;}
    if(action==='delete-card'){dialog('card',id);return;}if(action==='delete-record'){dialog('record',id);return;}if(action==='clear-history'){dialog('history');return;}
    if(action==='history-menu'){state.historyMenu=state.historyMenu===(id||'all')?null:(id||'all');render();return;}
    if(action==='preference'){state.preferenceDraft||={selected:[...state.preferences],notes:{...state.preferenceNotes}};const p=state.preferenceDraft.selected;state.preferenceDraft.selected=p.includes(v)?p.filter(x=>x!==v):p.concat(v);render();return;}
    if(action==='save-preferences'){if(state.preferenceDraft){state.preferences=[...state.preferenceDraft.selected];state.preferenceNotes={...state.preferenceDraft.notes};}state.preferenceSet=true;state.preferenceVersion++;state.welcomeDismissed=true;back();toast(t('saved'));return;}
    if(action==='set-language'||action==='language'){state.lang=v;if(state.scenario==='unmatched-language'){navigate('capture',null,{replace:true});}else render();return;}
    if(action==='speaker'){state.conversation.speaker=v;render();return;}
    if(action==='clear-conversation'){dialog('clear-conversation');return;}
    if(action==='translate-text'){
      const side=state.conversation[state.conversation.speaker];if(!side.draft.trim())return;if(state.scenario==='offline'){toast(t('offlineNote'));return;}if(state.scenario==='translation-failed'){toast(t('translationFailed'));return;}
      side.original=side.draft;side.lang=state.lang;side.translated=state.conversation.speaker==='visitor'?(state.lang==='zh'?side.draft:'请少放辣椒，谢谢。'):copy('Yes, we can make it less spicy.','可以，我们可以少放辣椒。','はい、辛さを控えめにできます。','네, 덜 맵게 할 수 있어요.','Sí, podemos hacerlo menos picante.');side.at=Date.now();side.draft='';render();toast(copy('Fixed translation example','固定翻译示例','固定の翻訳例','고정 번역 예시','Traducción de ejemplo'));return;
    }
    if(action==='quick-prompt'||action==='send-chat'){sendChat(action==='quick-prompt'?v:null);return;}
    if(action==='clear-chat-draft'){if(record())record().chatDraft='';render();return;}
    if(action==='latest-reply'){if(record())record().newReply=false;render({top:999999});return;}
    if(action==='retry-reply'){state.scenario='ready';render();return;}
    if(action==='retry-upload'){state.scenario='uploading';render();setTimeout(()=>completePhotos(state.activeRecordId),1200);return;}
    if(action==='retry-image'){state.scenario='processing';render();const rid=state.activeRecordId;setTimeout(()=>completePhotos(rid),1300);return;}
    if(['retry-save','retry-check'].includes(action)){state.scenario='ready';render();return;}
  }
  document.addEventListener('click',ev=>{
    if(ev.defaultPrevented)return;const el=ev.target.closest('[data-action],[data-page],[data-review-page]');if(!el||el.disabled)return;
    if(el.dataset.reviewPage){state.nav=[];if(el.dataset.reviewPage==='card-edit')prepareCard('c1');navigate(el.dataset.reviewPage,null,{replace:true,top:0});return;}
    if(el.dataset.action){act(el.dataset.action,el);return;}
    if(el.dataset.page){navigate(el.dataset.page,el.dataset.id);}
  });
  document.addEventListener('input',ev=>{const el=ev.target;if(el.id==='chat-draft'&&record()){record().chatDraft=el.value;const send=screen.querySelector('[data-action="send-chat"]');if(send)send.disabled=!el.value.trim()||record().replyPending||state.scenario==='replying'||state.scenario==='offline';}
    if(el.dataset.prefNote){state.preferenceDraft||={selected:[...state.preferences],notes:{...state.preferenceNotes}};state.preferenceDraft.notes[el.dataset.prefNote]=el.value;}
    if(el.id==='translation-input'){const s=state.conversation[state.conversation.speaker];s.draft=el.value;s.revision++;const b=screen.querySelector('[data-action="translate-text"]');if(b)b.disabled=!el.value.trim();}
    if(el.dataset.draft&&state.cardDraft){const d=state.cardDraft;d[el.dataset.draft]=el.value;if(d.lang==='zh'&&el.dataset.draft==='en')d.zh=d.en;d.revision++;if(el.dataset.draft==='title')d.titleEdited=true;if(el.dataset.draft==='en'&&!d.titleEdited){d.title=Array.from(el.value.trim()).slice(0,28).join('');const title=screen.querySelector('[data-draft="title"]');if(title)title.value=d.title;}const b=screen.querySelector('[data-action="save-card"]');if(b)b.disabled=!d.title.trim()||!d.en.trim()||!d.zh.trim();const g=screen.querySelector('[data-action="generate-card"]');if(g)g.disabled=!d.en.trim();saveDraft();}commit();
  });
  document.addEventListener('change',ev=>{if(ev.target.dataset.draft&&state.cardDraft){state.cardDraft[ev.target.dataset.draft]=ev.target.value;saveDraft();}});
  document.getElementById('language-picker').onchange=ev=>{state.lang=ev.target.value;render();};
  document.getElementById('scenario-picker').onchange=ev=>{state.scenario=ev.target.value;if(['processing','partial','no-translation','uploading','upload-failed'].includes(state.scenario))state.imageView='original';if(state.page==='cards')state.cardCategory='all';render({top:0});};
  window.addEventListener('pagehide',()=>{capturePosition();commit();});
  function mountPhotoDrag(){
    screen.querySelectorAll('[data-photo-drag]').forEach(handle=>{handle.style.touchAction='none';handle.addEventListener('pointerdown',ev=>{if(ev.button!==0)return;ev.preventDefault();const from=Number(handle.dataset.photoDrag);let to=from;const row=handle.closest('.v3-photo-item');row.classList.add('v3-dragging');handle.setPointerCapture(ev.pointerId);
      const move=e=>{const rows=[...screen.querySelectorAll('.v3-photo-item')];const found=rows.findIndex(r=>e.clientY<r.getBoundingClientRect().bottom);to=found<0?rows.length-1:found;rows.forEach((r,i)=>r.classList.toggle('v3-drop-target',i===to));};
      const end=e=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);if(e.type!=='pointercancel'&&from!==to){const [item]=state.previewImages.splice(from,1);state.previewImages.splice(to,0,item);}render();};handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
    });});
  }
  function mountViewer(){const viewer=screen.querySelector('.image-viewer');if(!viewer)return;const img=viewer.querySelector('img');if(!img)return;let initialDistance=0,initialZoom=1;viewer.addEventListener('touchstart',ev=>{if(ev.touches.length===2){initialDistance=Math.hypot(ev.touches[0].clientX-ev.touches[1].clientX,ev.touches[0].clientY-ev.touches[1].clientY);initialZoom=state.zoom;}},{passive:true});viewer.addEventListener('touchmove',ev=>{if(ev.touches.length!==2||!initialDistance)return;ev.preventDefault();const dist=Math.hypot(ev.touches[0].clientX-ev.touches[1].clientX,ev.touches[0].clientY-ev.touches[1].clientY);state.zoom=Math.min(4,Math.max(1,initialZoom*dist/initialDistance));img.style.width=state.zoom*100+'%';},{passive:false});viewer.addEventListener('touchend',()=>{initialDistance=0;commit();},{passive:true});}
  if(exportMode)document.body.classList.add('export-mode');
  if(!pages.some(p=>p[0]===state.page)&&state.page!=='fullscreen')state.page='capture';
  if(state.page==='card-edit')prepareCard(state.editingId||'c1');
  if(state.page==='preferences')state.preferenceDraft={selected:[...state.preferences],notes:{...state.preferenceNotes}};
  render({capture:false});
  state.records.forEach(r=>{if(r.replyPending)setTimeout(()=>finishReply(r.id,r.pendingReplyKey),Math.max(0,(r.replyDue||0)-Date.now()));if(['uploading','processing'].includes(r.processing))setTimeout(()=>completePhotos(r.id),1800);});
})();
