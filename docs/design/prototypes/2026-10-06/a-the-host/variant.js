/* Fixed dish examples and reversible paper-card expansion. */
(function () {
  const copy = (ui,...words) => ui.copy(...words);
  function deckLabel(ui,expanded){return expanded?copy(ui,'Stack cards','收起卡片','カードを重ねる','카드 모으기','Apilar tarjetas'):copy(ui,'Spread cards','展开卡片','カードを広げる','카드 펼치기','Desplegar tarjetas');}
  function deck(state,ui,kind,items,renderCard){
    const expanded=!!state.aDecks?.[kind];
    const title=kind==='dishes'?copy(ui,'Get to know the dishes','菜品卡片','料理を知るカード','음식 알아보기','Conoce los platos'):copy(ui,'Your card collection','我的卡片','マイカード','내 카드 모음','Tus tarjetas');
    const caption=kind==='dishes'?`${ui.t('fromPhoto')} ${state.activeImage+1} · ${items.length} ${copy(ui,'cards','张卡片','枚','개 카드','tarjetas')}`:copy(ui,'Keep the words you need close.','把想说的话，放在手边。','伝えたい言葉を手元に。','필요한 말을 가까이 두세요.','Las palabras que necesitas, a mano.');
    return `<section class="a-knowledge-section"><div class="a-deck-heading"><div><h2>${title}</h2><p>${caption}</p></div>${items.length?`<button class="a-deck-toggle" data-action="toggle-a-deck" data-deck="${kind}" aria-expanded="${expanded}" aria-controls="a-deck-${kind}">${ui.icon(expanded?'cards':'grid',16)}<span>${deckLabel(ui,expanded)}</span></button>`:''}</div>${items.length?`<div id="a-deck-${kind}" class="a-knowledge-deck ${expanded?'is-expanded':'is-stacked'}" data-deck-kind="${kind}"><div class="a-deck-shadow" aria-hidden="true"></div>${items.map((item,i)=>`<article class="a-deck-card a-deck-${kind}-card" data-deck-index="${i}" style="z-index:${items.length-i};--card-tint:${item.color==='orange'?'#eee0d0':item.color==='blue'?'#dce8e6':'#e0e9dc'}">${renderCard(item,i)}</article>`).join('')}<button class="a-deck-cover" data-action="toggle-a-deck" data-deck="${kind}" aria-label="${deckLabel(ui,false)} · ${items.length}"></button></div><div class="a-deck-tail"><span>${copy(ui,'A little more to discover.','翻开卡片，多了解一点。','カードを開いて、もう少し詳しく。','카드를 열어 더 알아보세요.','Abre las tarjetas y descubre más.')}</span><span aria-hidden="true">${items.length.toString().padStart(2,'0')} / SF</span></div>`:ui.empty(kind==='dishes'?'dishes':'cards')}</section>`;
  }
  function dishCard(d,i,ui){return `<div class="a-knowledge-card-head"><span class="a-card-series">${copy(ui,'ON THE MENU','菜单上的好菜','メニューの料理','메뉴 속 음식','EN EL MENÚ')}</span><span class="a-card-page">${String(i+1).padStart(2,'0')}</span></div><div class="a-knowledge-card-main"><div class="a-card-name-row"><div><span class="a-chinese-name" lang="zh">${ui.escape(d.zh)}</span><h3 lang="en">${ui.escape(d.en)}</h3></div><span class="a-card-price ${d.price===null?'is-unknown':''}">${d.price==null?ui.t('priceUnknown'):ui.escape(d.price)}</span></div><p class="a-card-description" lang="en">${ui.escape(d.desc)}</p><div class="a-card-caution">${ui.icon('warning',14)}<span lang="en">${ui.escape(d.tag)}</span></div></div><button class="a-card-read" data-page="detail" data-id="${d.id}"><span>${copy(ui,'Ingredients & the story','食材、吃法与小知识','食材と料理の話','재료와 음식 이야기','Ingredientes y su historia')}</span>${ui.icon('arrow',18)}</button>`;}
  function result(state,ui){return `<div class="page-scroll a-page a-result"><header class="a-record-heading"><button class="a-icon-button" data-page="capture" aria-label="${ui.t('back')}">${ui.icon('back',22)}</button><div><h1>${ui.t('recordTitle')}</h1><span>${copy(ui,'A closer look at your menu','慢慢看，慢慢了解','メニューを詳しく見る','메뉴를 자세히 살펴보세요','Tu menú, más de cerca')}</span></div><button class="a-icon-button a-add-icon" data-action="add-photos" aria-label="${ui.t('addPhotos')}">${ui.icon('plus',22)}</button></header>
      <section class="a-image-section"><div class="a-result-photo-controls">${ui.imageTabs()}</div><div class="a-menu-frame">${ui.menu('a-menu-picture')}<span class="a-enlarge-hint">${ui.icon('expand',14)}${copy(ui,'Tap to enlarge','轻点放大','タップして拡大','탭하여 확대','Toca para ampliar')}</span></div>${ui.status()}</section>
      ${deck(state,ui,'dishes',ui.dishes,(d,i)=>dishCard(d,i,ui))}
      <button class="a-add-photo" data-action="add-photos">${ui.icon('plus',17)}${ui.t('addPhotos')}</button></div><div class="result-dock a-chat-dock"><button class="a-primary" data-page="chat">${ui.icon('chat',22)}<span>${ui.t('askAI')}</span>${ui.icon('arrow',19)}</button></div>`;}
  function mount(state,ui){
    const reduceMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
    const easing='cubic-bezier(.25,.46,.45,.94)';
    document.querySelectorAll('.variant-a .a-knowledge-deck').forEach(container=>{
      const kind=container.dataset.deckKind;
      const cards=[...container.querySelectorAll('.a-deck-card')];
      cards.forEach(card=>{const link=card.querySelector('.a-card-read>span');if(link)link.dataset.expandedLabel=link.textContent;});
      let animations=[];
      let scrollFrame;
      function layout(expanded,animate){
        const previous=cards.map(card=>getComputedStyle(card).transform);
        const previousHeights=cards.map(card=>getComputedStyle(card).height);
        const oldHeight=container.getBoundingClientRect().height;
        animations.forEach(a=>a.cancel());animations=[];
        cards.forEach(card=>card.style.height='auto');
        const heights=cards.map(card=>card.offsetHeight);
        let offset=0;
        const transforms=cards.map((card,i)=>{
          let target;
          if(expanded){target=`translate3d(0, ${offset}px, 0) rotate(0deg) scale(1)`;offset+=heights[i]+18;}
          else{const index=Math.min(i,3);target=`translate3d(${i%2?-3:3}px, ${index*12}px, 0) rotate(${i===0?-.7:i%2?1.5:-1.6}deg) scale(${1-index*.024})`;}
          card.style.transform=target;card.style.height=(expanded?heights[i]:heights[0])+'px';card.inert=!expanded;card.setAttribute('aria-hidden',!expanded&&i>0?'true':'false');return target;
        });
        const total=expanded?Math.max(0,offset-18):heights[0]+Math.min(cards.length-1,3)*12+8;
        container.style.height=total+'px';container.classList.toggle('is-expanded',expanded);container.classList.toggle('is-stacked',!expanded);
        const cover=container.querySelector('.a-deck-cover');cover.hidden=expanded;cover.disabled=expanded;
        const frontLabel=cards[0].querySelector('.a-card-read>span');if(frontLabel)frontLabel.textContent=expanded?frontLabel.dataset.expandedLabel:deckLabel(ui,false);
        const toggle=document.querySelector(`.a-deck-toggle[data-deck="${kind}"]`);
        if(toggle){toggle.setAttribute('aria-expanded',String(expanded));toggle.innerHTML=ui.icon(expanded?'cards':'grid',16)+`<span>${deckLabel(ui,expanded)}</span>`;}
        if(animate&&!reduceMotion()){
          cards.forEach((card,i)=>{const order=expanded?i:cards.length-1-i;const a=card.animate([{transform:previous[i],height:previousHeights[i]},{transform:transforms[i],height:card.style.height}],{duration:360,delay:Math.min(order,6)*35,easing,fill:'backwards'});animations.push(a);});
          animations.push(container.animate([{height:oldHeight+'px'},{height:total+'px'}],{duration:360+Math.min(cards.length-1,6)*35,easing}));
        }
      }
      layout(!!state.aDecks?.[kind],false);
      container.refreshDeck=()=>layout(!!state.aDecks[kind],false);
      container.toggleDeck=()=>{
        cancelAnimationFrame(scrollFrame);
        state.aDecks[kind]=!state.aDecks[kind];layout(state.aDecks[kind],true);
        if(state.aDecks[kind]){const scroller=container.closest('.page-scroll');const heading=container.previousElementSibling;if(scroller&&heading){const from=scroller.scrollTop;const to=Math.max(0,from+heading.getBoundingClientRect().top-scroller.getBoundingClientRect().top-18);if(reduceMotion())scroller.scrollTop=to;else{const start=performance.now();const scroll=time=>{if(!container.isConnected)return;const progress=Math.min(1,(time-start)/450);scroller.scrollTop=from+(to-from)*(1-Math.pow(1-progress,3));if(progress<1)scrollFrame=requestAnimationFrame(scroll);};scrollFrame=requestAnimationFrame(scroll);}}}
        document.getElementById('state-display').textContent=JSON.stringify(state,null,2);
        try{const url=new URL(location.href);url.searchParams.set('deck',state.aDecks[kind]?'expanded':'stacked');history.replaceState(null,'',url);}catch(_){}
      };
    });
  }
  window.addEventListener('resize',()=>document.querySelectorAll('.variant-a .a-knowledge-deck').forEach(deck=>deck.refreshDeck?.()));
  window.SeeFoodVariants.A={name:'The Host',render(page,state,ui){return result(state,ui);},mount};
})();
