/* FRAME! — GitHub Pages-ready, no-build movie quiz. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const qs = selector => document.querySelector(selector);
  const qsa = selector => [...document.querySelectorAll(selector)];
  const LEVELS = ['쉬움', '중간', '어려움'];
  const MODES = { 쉬움:'EASY MODE', 중간:'NORMAL MODE', 어려움:'HARD MODE' };
  const OPTIONS = {
    '영화 대사 듣고 맞추기': '',
    '드라마 장면 보고 맞추기': '',
    '애니 장면 보고 맞추기': '',
    '노래 듣고 맞추기': '',
    '게임 장면 보고 맞추기': ''
  };
  let catalog = [], selectedLevel = '쉬움', selectedCategory = '종합', roundLimit = 10;
  let queue = [], index = 0, stage = 'idle', stageRemaining = 0, lastTick = 0, loopId = 0, paused = false, currentMovie = null;
  let sound = (()=>{try{return localStorage.getItem('frame_sound')!=='off'}catch{return false}})(), modal = '', sourceType = 'demo', sessionPlayed = 0;
  let previousFocus = null;
  let modalAutoPaused=false;
  let sceneLoadToken=0;
  const scenePreloadCache=new Map();
  const posterPreloadCache=new Map();
  let activePosterUrl='';
  // Settings previews are not committed to the shuffle history until Start is pressed.
  let preparedLaunch=null;
  let launchPreviewId=0;
  let launchBusy=false;
  let settingsNavRow=0;
  let settingsNavActive=false;
  let lastPosterTitles='';
  const scrub = s => String(s || '').replace(/[<>]/g, '');
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function urlForPath(path) { return './' + path.split('/').map(encodeURIComponent).join('/'); }
  function format2(n) { return String(n).padStart(2, '0'); }
  // FRAME! v36: early WAV decoding + WebAudio scheduling. Original MP3 files are preserved.
  // Timing fix: the original answer_reveal.mp3 contained ~0.48 seconds of leading silence.
  const SOUND_PATH='./assets/audio/';
  const TRACKS={
    ui_click:['button_click_fast.wav',.42],ui_select:['button_click_fast.wav',.40],ui_open:['button_click_fast.wav',.38],
    ui_back:['button_click_fast.wav',.36],game_start:['game_start.wav',.36],scene_show:['scene_show.wav',.32],
    guess_timer:['guess_timer_fast.wav',.76],answer_reveal:['answer_reveal_fast.wav',.78],
    next_scene:['next_scene_fast.wav',.48],pause:['pause.wav',.29],resume:['resume.wav',.30],
    game_finish:['game_finish.wav',.36],notice:['notice.wav',.32]
  };
  const sfx=window.FRAME_FAST_AUDIO_V36(SOUND_PATH,TRACKS);
  sfx.setEnabled(sound);
  // BGM remains an HTMLAudio loop; never decode the 157s music into RAM.
  const bgm=new Audio(SOUND_PATH+'bgm_menu.mp3');bgm.loop=true;bgm.preload='auto';bgm.volume=.16;
  let lastAudioName='',lastAudioAt=0;
  function stopStageAudio(){sfx.stopStage();}
  function pauseStageAudio(){sfx.pauseStage();}
  function resumeStageAudio(){if(sound)sfx.resumeStage();}
  // Browsers block audible BGM until the first real user interaction.
  let bgmPendingUnlock=false;
  function syncBgm(){
    const mainVisible=!$('mainScreen').classList.contains('hidden');
    const setupVisible=!$('settingsScreen').classList.contains('hidden');
    const shouldPlay=sound&&(mainVisible||setupVisible)&&!document.hidden;
    if(!shouldPlay){bgm.pause();return;}
    if(!bgm.paused){bgmPendingUnlock=false;return;}
    let playAttempt;
    try{playAttempt=bgm.play();}catch{bgmPendingUnlock=true;return;}
    if(playAttempt?.then){
      playAttempt.then(()=>{bgmPendingUnlock=false;}).catch(()=>{bgmPendingUnlock=true;});
    }
  }
  function unlockBgmFromGesture(){
    if(!sound||document.hidden)return;
    sfx.unlock();
    syncBgm();
  }
  function playSfx(name){
    if(!sound||!TRACKS[name])return;
    const now=performance.now();
    if(name===lastAudioName&&now-lastAudioAt<85)return;
    lastAudioName=name;lastAudioAt=now;
    sfx.play(name);
  }
  function updateSound(){const el=$('soundBtn');if(el)el.querySelector('use').setAttribute('href',sound?'#i-volume':'#i-mute');}
  function toggleSound(){
    sound=!sound;
    try{localStorage.setItem('frame_sound',sound?'on':'off')}catch{}
    if(!sound){sfx.stopAll();bgm.pause();}sfx.setEnabled(sound);if(sound)sfx.unlock();
    updateSound();syncBgm();if(sound)playSfx('ui_select');
  }
  function toast(msg) { const box=$('toastContainer');box.innerHTML='';const node=document.createElement('div');node.className='toast';node.textContent=msg;box.append(node);setTimeout(()=>{if(node.isConnected)node.remove()},2700); }
  function showNotice(message) {
    const el = $('noticeBackdrop');
    $('noticeMessage').textContent=message;
    el.classList.remove('hidden');
    $('noticeOkBtn').focus({preventScroll:true});
    playSfx('notice');
  }
  function closeNotice(){
    $('noticeBackdrop').classList.add('hidden');
    if(!$('modalBackdrop').classList.contains('hidden')) $('modalClose').focus({preventScroll:true});
    else $('otherBtn').focus({preventScroll:true});
  }
  function showSettings(){modalClose(true);showScreen('settingsScreen');playSfx('ui_open');}
  function showScreen(which) { ['mainScreen','settingsScreen','gameScreen','finishScreen'].forEach(id => $(id).classList.toggle('hidden',id!==which)); window.scrollTo({top:0,behavior:'instant'});syncBgm(); if(which==='mainScreen')schedulePosterAnimationResume(); }
  function modalOpen(name,html) {
    if(name!=='pause' && !paused && ['scene','guess','reveal'].includes(stage)){
      paused=true;modalAutoPaused=true;cancelAnimationFrame(loopId);
      pauseStageAudio();
    }
    previousFocus=document.activeElement;modal=name;$('modalContent').innerHTML=html;$('modalBackdrop').classList.remove('hidden');$('modalClose').focus(); }
  function modalClose(force=false) {
    if(modal && modal!=='pause'&&!force)playSfx('ui_back');
    if(modal==='pause'&&!force){resume();return;}
    $('modalBackdrop').classList.add('hidden');$('modalContent').innerHTML='';modal='';
    if(modalAutoPaused){
      modalAutoPaused=false;
      if(['scene','guess','reveal'].includes(stage)){
        paused=false;lastTick=performance.now();
        resumeStageAudio();
        loopId=requestAnimationFrame(tick);
      }else{paused=false;}
    }
    // The header button may retain focus after a help/other-games dialog.
    // While playing, put focus back onto the game surface, not a toolbar action.
    if(!$('gameScreen').classList.contains('hidden') && ['scene','guess','reveal','loading'].includes(stage)) {
      $('gameScreen').focus({preventScroll:true});
    } else if(previousFocus?.isConnected) {
      previousFocus.focus({preventScroll:true});
    }
  }
  function showHelp() { playSfx('ui_open'); modalOpen('help',`<div class="modal-kicker">THE RULES</div><h2 class="modal-title" id="modalTitle">게임 방법</h2><div class="instructions"><div class="instruction-row"><span class="instruction-num">01</span><div><strong>3초간 장면 감상</strong><small>영화 장면이 딱 3초 동안 표시됩니다.</small></div></div><div class="instruction-row"><span class="instruction-num">02</span><div><strong>5초 동안 머릿속으로 추리</strong><small>장면이 사라지고 카운트다운이 시작됩니다.</small></div></div><div class="instruction-row"><span class="instruction-num">03</span><div><strong>포스터와 제목으로 정답 공개</strong><small>정답이 3초 동안 보인 후 자동으로 다음 장면이 나옵니다.</small></div></div></div>`); }
  function showOther() { playSfx('ui_open'); modalOpen('other',`<div class="modal-kicker">MORE GAMES</div><h2 class="modal-title" id="modalTitle">이외 게임</h2><div class="games-list">${Object.entries(OPTIONS).map(([name],i)=>`<button class="other-game" data-other="${escapeHtml(name)}"><span class="other-game-icon">${['♫','▣','✦','♪','⌘'][i]}</span>${escapeHtml(name)}<span class="go">↗</span></button>`).join('')}</div>`); qsa('[data-other]').forEach(btn=>btn.addEventListener('click',()=>{const link=OPTIONS[btn.dataset.other];if(link){window.open(link,'_blank','noopener,noreferrer')}else{showNotice('게임 추가 전입니다. 추후 이용 부탁드립니다.')}})); }
  function showLibrary() { const rows=LEVELS.map(level=>{const items=catalog.filter(q=>q.level===level);return `<div class="library-row">${level}<span>${items.length}개 장면 · ${new Set(items.map(m=>m.title)).size}편</span></div>`}).join('');modalOpen('library',`<div class="modal-kicker">SCENE LIBRARY</div><h2 class="modal-title" id="modalTitle">영화 라이브러리</h2><p class="modal-desc">현재 웹사이트가 인식한 장면입니다.</p><div class="library-summary"><span class="status-indicator ${sourceType==='github'||sourceType==='manifest'||sourceType==='bundle'?'live':''}"></span>${sourceType==='github'?'GitHub 저장소에서 자동 인식':sourceType==='manifest'?'manifest.json에서 인식':'데모 샘플 모드'}</div><div class="library-list">${rows}</div><p class="fineprint">영화 장면 추가: <code>movies/한국 영화/영화제목/쉬움/01.jpg</code> · 포스터: <code>movies/외국 영화/영화제목/포스터.jpg</code><br/>GitHub Pages는 공개 저장소에서 폴더 목록을 자동으로 읽습니다. 로컬 파일 실행 또는 GitHub API 제한 상황에서는 manifest.json을 사용합니다.</p>`); }
  function pause() { if(stage==='idle'||stage==='loading'||paused)return;pauseStageAudio();playSfx('pause');paused=true;cancelAnimationFrame(loopId);modalOpen('pause',`<div class="modal-kicker">INTERMISSION</div><h2 class="modal-title" id="modalTitle">잠시 정지했습니다.</h2><p class="modal-desc">남은 시간은 그대로 유지됩니다. 준비되면 다시 계속하세요.</p><div class="modal-actions"><button class="modal-action primary" id="resumeBtn"><svg><use href="#i-play"/></svg> 계속하기 <span>RESUME</span></button><button class="modal-action" id="restartBtn"><svg><use href="#i-refresh"/></svg> 처음부터 다시 시작 <span>RESTART</span></button><button class="modal-action" id="returnBtn"><svg><use href="#i-home"/></svg> 메인 메뉴로 이동 <span>HOME</span></button></div>`);$('resumeBtn').onclick=resume;$('restartBtn').onclick=()=>{modalClose(true);startGame();};$('returnBtn').onclick=()=>{modalClose(true);goHome();};selectPauseItem(0); }
  function selectPauseItem(i){
    const items=['resumeBtn','restartBtn','returnBtn'].map($).filter(Boolean);
    if(!items.length)return;
    const n=(i+items.length)%items.length;
    items.forEach((button,index)=>{
      const selected=index===n;
      button.classList.toggle('keyboard-selected',selected);
      button.classList.toggle('primary',selected);
      button.setAttribute('aria-current',selected?'true':'false');
      button.tabIndex=0;
    });
    items[n].focus({preventScroll:true});
  }
  function resume(){if(!paused)return;playSfx('resume');paused=false;resumeStageAudio();modalClose(true);lastTick=performance.now();if(stage==='scene'||stage==='guess'||stage==='reveal')loopId=requestAnimationFrame(tick);}
  function goHome(){preparedLaunch=null;launchPreviewId++;clearLaunchNavigation();stopStageAudio();cancelAnimationFrame(loopId);sceneLoadToken++;stage='idle';paused=false;modalAutoPaused=false;modalClose(true);showScreen('mainScreen');}
  function categoryMatches(item){return selectedCategory==='종합'||item.category===selectedCategory;}
  function shuffle(items){const a=items.slice();for(let i=a.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
  // v34 - persistent shuffle-bag, independent for each category and difficulty.
  // Every scene is drawn once per cycle. A new cycle starts only after the
  // previous one is exhausted. Within a round no scene can be repeated.
  const DRAW_HISTORY_KEY='frame_shuffle_bag_v34';
  let drawHistoryFallback={};
  function readDrawHistory(){
    try{
      const parsed=JSON.parse(localStorage.getItem(DRAW_HISTORY_KEY)||'{}');
      return parsed && typeof parsed==='object' && !Array.isArray(parsed) ? parsed : drawHistoryFallback;
    }catch{return drawHistoryFallback;}
  }
  function saveDrawHistory(history){
    drawHistoryFallback=history;
    try{localStorage.setItem(DRAW_HISTORY_KEY,JSON.stringify(history));}catch{}
  }
  function sceneKey(movie){
    return `${movie.category||''}\u001f${movie.title}\u001f${movie.scene}`;
  }
  function freshDrawBag(allKeys,previousRound,selectedThisRound){
    const recent=new Set(previousRound);
    const selected=new Set(selectedThisRound);
    const mixed=shuffle(allKeys);
    // During a cycle transition, recently shown scenes go to the back.
    return [...mixed.filter(k=>!selected.has(k)&&!recent.has(k)),
            ...mixed.filter(k=>!selected.has(k)&&recent.has(k)),
            ...mixed.filter(k=>selected.has(k))];
  }
  function drawFreshRound(pool,requested,category,level,commit=true){
    const drawCount=Math.min(pool.length,Math.max(0,requested));
    if(!drawCount)return [];
    const byKey=new Map(pool.map(movie=>[sceneKey(movie),movie]));
    const keys=[...byKey.keys()];
    const valid=new Set(keys);
    const scope=`${category}::${level}`;
    const history={...readDrawHistory()};
    const saved=history[scope];
    const state=saved && typeof saved==='object' ? saved : {};
    let remaining=Array.isArray(state.remaining)
      ? state.remaining.filter(key=>typeof key==='string'&&valid.has(key)) : [];
    const seen=new Set(Array.isArray(state.known) ? state.known:[]);
    const newKeys=keys.filter(key=>!seen.has(key));
    // New movies added to movies/ are immediately eligible, including after a deploy.
    if(newKeys.length)remaining=[...shuffle(newKeys),...remaining];
    const lastRound=Array.isArray(state.lastRound)
      ? state.lastRound.filter(key=>valid.has(key)) : [];
    // Deduplicate persisted records, e.g. after an older version or bad cache.
    remaining=[...new Set(remaining)];
    const chosen=[];
    const chosenSet=new Set();
    while(chosen.length<drawCount){
      if(!remaining.length)remaining=freshDrawBag(keys,lastRound,chosen);
      const nextIndex=remaining.findIndex(key=>!chosenSet.has(key));
      if(nextIndex<0)break;
      const [key]=remaining.splice(nextIndex,1);
      chosen.push(key);chosenSet.add(key);
    }
    const record={known:keys,remaining,lastRound:chosen};
    history[scope]=record;
    if(commit)saveDrawHistory(history);
    const items=chosen.map(key=>byKey.get(key)).filter(Boolean);
    return commit?items:{items,scope,record};
  }
  const decodedSceneImages=new Map();
  function preloadScene(url){
    if(!url)return Promise.resolve(false);
    if(scenePreloadCache.has(url))return scenePreloadCache.get(url);
    const promise=new Promise(resolve=>{
      const im=new Image();let settled=false;
      const finish=ok=>{if(settled)return;settled=true;resolve(ok);};
      im.onload=()=>{
        const loaded=()=>{
          decodedSceneImages.delete(url);
          decodedSceneImages.set(url,im);
          while(decodedSceneImages.size>3) decodedSceneImages.delete(decodedSceneImages.keys().next().value);
          finish(true);
        };
        if(im.decode) im.decode().then(loaded,loaded);
        else loaded();
      };
      im.onerror=()=>finish(false);
      im.src=url;
      if(im.complete && im.naturalWidth>0)finish(true);
      setTimeout(()=>finish(false),10000);
    });
    scenePreloadCache.set(url,promise);
    return promise;
  }
  // 포스터는 정답 화면 전환 시 다운로드하지 않습니다. 장면 시작 전에 다운로드·디코딩합니다.
  function preloadPoster(url){
    if(!url)return Promise.resolve(false);
    if(posterPreloadCache.has(url))return posterPreloadCache.get(url);
    const promise=new Promise(resolve=>{
      const image=new Image();let settled=false;
      const complete=ok=>{if(settled)return;settled=true;resolve(ok);};
      image.onload=()=>{
        if(typeof image.decode==='function') image.decode().then(()=>complete(true),()=>complete(true));
        else complete(true);
      };
      image.onerror=()=>complete(false);
      image.src=url;
      if(image.complete && image.naturalWidth)complete(true);
      setTimeout(()=>complete(false),12000);
    });
    posterPreloadCache.set(url,promise);
    return promise;
  }
  function preparePoster(movie){
    const img=$('posterImage');
    const fallback=$('posterFallback');
    const url=movie?.poster||'';
    activePosterUrl=url;
    if(!url){img.removeAttribute('src');img.classList.add('hidden');fallback.classList.remove('hidden');return;}
    img.loading='eager';
    img.decoding='sync';
    img.onerror=()=>{
      if(activePosterUrl!==url)return;
      img.classList.add('hidden');fallback.classList.remove('hidden');
    };
    img.onload=()=>{if(activePosterUrl===url){fallback.classList.add('hidden');img.classList.remove('hidden');}};
    fallback.classList.add('hidden');
    img.classList.remove('hidden');
    if(img.getAttribute('src')!==url)img.src=url;
    // 숨겨진 정답 패널의 실제 DOM 이미지까지 미리 디코딩하도록 요청합니다.
    if(typeof img.decode==='function')img.decode().catch(()=>{});
  }
  function launchSignature(){
    return [selectedCategory,selectedLevel,String(roundLimit),catalog.length].join('::');
  }
  function prepareLaunchRound(){
    // Preview once per settings change; no game is counted as played yet.
    const id=++launchPreviewId;
    preparedLaunch=null;
    const pool=catalog.filter(m=>m.level===selectedLevel&&categoryMatches(m));
    if(!pool.length)return;
    const desired=roundLimit==='all'?pool.length:Number(roundLimit);
    const candidate=drawFreshRound(pool,desired,selectedCategory,selectedLevel,false);
    if(!candidate.items.length)return;
    const entry={signature:launchSignature(),...candidate,ready:null};
    preparedLaunch=entry;
    // Start loading and decoding at difficulty/category/count selection time.
    // Warm the *actual* visible game image element while its screen is hidden.
    // This avoids a second image decode when we switch from settings to game.
    const sceneElement=$('sceneImage');
    if(sceneElement && sceneElement.getAttribute('src')!==entry.items[0].scene){
      sceneElement.src=entry.items[0].scene;
    }
    if(typeof sceneElement?.decode==='function')sceneElement.decode().catch(()=>{});
    entry.ready=preloadScene(entry.items[0].scene);
    preloadPoster(entry.items[0].poster);
    if(entry.items.length>1){
      // Defer the next scene to avoid competing with the first download.
      entry.ready.then(()=>{if(id===launchPreviewId){preloadScene(entry.items[1].scene);preloadPoster(entry.items[1].poster);}});
    }
  }
  function setLaunchNavigation(row,focus=true){
    settingsNavRow=Math.max(0,Math.min(2,row));
    const selected=settingsNavRow===0?qs(`.difficulty[data-level="${selectedLevel}"]`):
      settingsNavRow===1?qs(`.count-btn[data-count="${roundLimit}"]`):$('startBtn');
    qsa('#settingsScreen .difficulty, #settingsScreen .count-btn, #settingsScreen #startBtn')
      .forEach(button=>button.classList.toggle('keyboard-nav-target',button===selected));
    if(focus && selected && !selected.disabled)selected.focus({preventScroll:true});
  }
  function clearLaunchNavigation(){
    settingsNavActive=false;
    qsa('#settingsScreen .keyboard-nav-target').forEach(button=>button.classList.remove('keyboard-nav-target'));
  }
  // v48: Main-menu shortcuts only. 1 = All / 2 = Korean / 3 = Foreign.
  // Listen in capture phase so a toolbar button retaining keyboard focus
  // cannot react to the same keypress as a native button activation.
  function handleHomeCategoryShortcut(event){
    if($('mainScreen').classList.contains('hidden') || modal ||
      !$('modalBackdrop').classList.contains('hidden') ||
      !$('noticeBackdrop').classList.contains('hidden') ||
      !$('posterLightbox').classList.contains('hidden'))return;
    if(event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.isComposing)return;
    const target=event.target;
    if(target?.isContentEditable || target?.closest?.('[contenteditable="true"]') ||
      ['INPUT','TEXTAREA','SELECT'].includes(target?.tagName))return;
    const shortcuts={Digit1:'종합',Digit2:'한국 영화',Digit3:'외국 영화',
      Numpad1:'종합',Numpad2:'한국 영화',Numpad3:'외국 영화'};
    const category=shortcuts[event.code] || {'1':'종합','2':'한국 영화','3':'외국 영화'}[event.key];
    if(!category)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    chooseCategory(category);
  }
  function handleSettingsKeyboard(event){
    if($('settingsScreen').classList.contains('hidden')||modal||
      !$('noticeBackdrop').classList.contains('hidden')||
      !$('posterLightbox').classList.contains('hidden'))return;
    const key=event.key;
    if(!['ArrowRight','ArrowLeft','ArrowUp','ArrowDown','Enter'].includes(key))return;
    const tag=event.target?.tagName;
    if(['INPUT','TEXTAREA','SELECT'].includes(tag))return;
    const active=document.activeElement;
    if(active?.classList?.contains('difficulty'))settingsNavRow=0;
    else if(active?.classList?.contains('count-btn'))settingsNavRow=1;
    else if(active===$('startBtn'))settingsNavRow=2;
    if(key==='Enter'){
      if(!settingsNavActive)return; // Preserve ordinary Tab + Enter behavior.
      event.preventDefault();event.stopImmediatePropagation();
      if(event.repeat)return;
      if(settingsNavRow===2 && !$('startBtn').disabled)startGame();
      else setLaunchNavigation(settingsNavRow);
      return;
    }
    // Keep arrow keys from scrolling or triggering unrelated focused controls.
    event.preventDefault();event.stopImmediatePropagation();
    settingsNavActive=true;
    if(key==='ArrowDown'){setLaunchNavigation(settingsNavRow+1);return;}
    if(key==='ArrowUp'){setLaunchNavigation(settingsNavRow-1);return;}
    const dir=key==='ArrowRight'?1:-1;
    if(settingsNavRow===0){
      const current=LEVELS.indexOf(selectedLevel);
      const next=Math.max(0,Math.min(LEVELS.length-1,current+dir));
      if(next!==current)chooseLevel(LEVELS[next]);
    }else if(settingsNavRow===1){
      const enabled=qsa('.count-btn').filter(btn=>!btn.disabled);
      const current=enabled.findIndex(btn=>btn.dataset.count===String(roundLimit));
      const next=Math.max(0,Math.min(enabled.length-1,(current<0?0:current)+dir));
      const button=enabled[next];
      if(button && roundLimit!==button.dataset.count){
        roundLimit=button.dataset.count;
        updateAllCount();
        prepareLaunchRound();
        playSfx('ui_select');
      }
    }
    setLaunchNavigation(settingsNavRow);
  }
  async function startGame(){
    if(launchBusy)return;
    const pool=catalog.filter(m=>m.level===selectedLevel&&categoryMatches(m));
    if(!pool.length){toast('이 난이도에는 아직 영화 장면이 없습니다.');return;}
    launchBusy=true;
    stopStageAudio();const token=++sceneLoadToken;
    // Use the already-decoded settings preview when available. Commit its
    // shuffle-bag record *only now*, so browsing options never burns history.
    const preview=preparedLaunch?.signature===launchSignature()?preparedLaunch:null;
    if(preview){
      queue=preview.items;
      const history={...readDrawHistory()};
      history[preview.scope]=preview.record;
      saveDrawHistory(history);
    }else{
      queue=drawFreshRound(pool,roundLimit==='all'?pool.length:Number(roundLimit),selectedCategory,selectedLevel);
    }
    preparedLaunch=null;launchPreviewId++;
    index=0;paused=false;modalAutoPaused=false;modalClose(true);
    $('gameLevel').textContent=selectedLevel;$('gameLevel').dataset.level=selectedLevel;$('gameCategory').textContent=selectedCategory;$('gameTotal').textContent=queue.length;
    const btn=$('startBtn');btn.disabled=true;
    // Do not wait for the answer poster: it has eight seconds to finish loading.
    // Only the first scene must be decoded before its 3-second countdown starts.
    try{await(preview?.ready||preloadScene(queue[0].scene));}
    finally{btn.disabled=false;launchBusy=false;}
    if(token!==sceneLoadToken)return;
    clearLaunchNavigation();
    playSfx('game_start');showScreen('gameScreen');$('gameScreen').focus({preventScroll:true});beginScene();
  }
  function setStage(name,seconds){stopStageAudio();cancelAnimationFrame(loopId);stage=name;$('gameScreen').dataset.stage=name;stageRemaining=seconds;lastTick=performance.now();$('scenePanel').classList.toggle('hidden',name!=='scene');$('guessPanel').classList.toggle('hidden',name!=='guess');$('revealPanel').classList.toggle('hidden',name!=='reveal');$('nextBtn').classList.toggle('hidden',name!=='reveal');$('skipBtn').classList.toggle('hidden',name!=='scene'&&name!=='guess');$('stageHint').classList.toggle('hidden',name!=='reveal');if(name==='scene'||name==='guess'||name==='reveal')loopId=requestAnimationFrame(tick);}
  function beginScene(){currentMovie=queue[index]; preparePoster(currentMovie); if(index+1<queue.length){preloadScene(queue[index+1].scene);preloadPoster(queue[index+1].poster);}$('gameIndex').textContent=format2(index+1);$('overallProgress').style.width=`${index/queue.length*100}%`;$('scenePanel').style.setProperty('--scene-backdrop', `url("${currentMovie.scene.replaceAll('\"','%22')}")`);$('sceneImage').src=currentMovie.scene;$('sceneImage').alt=`${selectedLevel} 난이도 ${index+1}번째 영화 장면`;$('stageTitle').textContent='이 장면을 기억하세요.';$('stageSubtitle').textContent='3초 동안 영화 장면이 공개됩니다.';$('stageHint').textContent='장면에 집중하세요.';setStage('scene',3);if(index===0)playSfx('scene_show');}
  // Skip works only while a stage is running (not paused or covered by a dialog).
  function skipStage(){
    if(paused||modal||!$('noticeBackdrop').classList.contains('hidden')||!$('posterLightbox').classList.contains('hidden'))return;
    if($('gameScreen').classList.contains('hidden'))return;
    if(stage==='scene')startGuess();
    else if(stage==='guess')reveal();
  }
  function startGuess(){preloadPoster(currentMovie.poster);$('stageTitle').textContent='어떤 영화였을까요?';$('stageSubtitle').textContent='5초 안에 머릿속으로 제목을 떠올려 보세요.';$('stageHint').textContent='정답이 곧 공개됩니다.';setStage('guess',5);playSfx('guess_timer');}
  function reveal(){if(index+1<queue.length){preloadScene(queue[index+1].scene);preloadPoster(queue[index+1].poster);}setStage('reveal',3);$('stageTitle').textContent='정답을 공개합니다.';$('stageSubtitle').textContent='영화 포스터와 제목을 확인해 보세요.';$('stageHint').textContent=index+1===queue.length?'마지막 장면입니다.':'3초 후 다음 장면으로 자동 이동합니다.';$('answerName').textContent=currentMovie.title;$('answerNumber').textContent='SCENE '+String(index+1).padStart(3,'0');$('nextBtn').innerHTML=index+1===queue.length?'결과 확인 <svg><use href="#i-arrow"/></svg>':'다음 장면 <svg><use href="#i-arrow"/></svg>';// 포스터는 장면 공개 전부터 실제 이미지 엘리먼트에 준비되어 있습니다.
    playSfx('answer_reveal');}
  let lastWhole=10;
  function tick(now){if(paused||!['scene','guess','reveal'].includes(stage))return;const delta=Math.max(0,Math.min(1,(now-lastTick)/1000));lastTick=now;const before=stageRemaining;stageRemaining=Math.max(0,stageRemaining-delta);if(stage==='scene'){$('sceneTimer').textContent=stageRemaining.toFixed(1)+'s';}else if(stage==='reveal'){const label=qs('.reveal-next-label');if(label)label.textContent=`${Math.max(1,Math.ceil(stageRemaining))}초 후 ${index+1===queue.length?'결과 화면':'다음 장면'}으로 자동 이동`; }else{let whole=Math.ceil(stageRemaining);$('guessNumber').textContent=whole||0;qsa('#countSegments span').forEach((el,i)=>el.classList.toggle('off',i>=whole));lastWhole=whole;}if(stageRemaining<=.00001){if(stage==='scene'){lastWhole=6;startGuess();}else if(stage==='guess'){reveal();}else{nextScene();}return;}loopId=requestAnimationFrame(tick);}
  async function nextScene(){
    if(stage!=='reveal'||paused)return;
    cancelAnimationFrame(loopId);stage='loading';
    const newIndex=index+1;const token=++sceneLoadToken;
    if(newIndex>=queue.length){stopStageAudio();playSfx('next_scene');index++;sessionPlayed++;finishGame();return;}
    // 이전 정답 화면을 유지하면서 다음 장면 디코딩 완료를 기다린다.
    const [ready]=await Promise.all([preloadScene(queue[newIndex].scene),preloadPoster(queue[newIndex].poster)]);
    if(token!==sceneLoadToken)return;
    if(!ready){
      const more=queue.slice(newIndex+1).findIndex(m=>scenePreloadCache.get(m.scene)===undefined);
      console.warn('FRAME!: 다음 장면 로드 실패',queue[newIndex].scene);
    }
    stopStageAudio();playSfx('next_scene');index=newIndex;sessionPlayed++;beginScene();
  }
  function finishGame(){
    stopStageAudio();stage='idle';$('overallProgress').style.width='100%';
    $('finishCount').textContent=queue.length;
    $('finishLevel').textContent=selectedLevel;
    $('finishLevel').dataset.level=selectedLevel;
    $('finishCategory').textContent=selectedCategory;
    let total=queue.length;
    try{total=Number(localStorage.getItem('frame_completed')||0)+queue.length;localStorage.setItem('frame_completed',String(total))}catch{}
    // 실제 출제된 순서만 사용하며 별도의 영화 데이터를 중복해서 관리하지 않습니다.
    const grid=$('finishPosterGrid');
    grid.replaceChildren();
    queue.forEach((movie,i)=>{
      const card=document.createElement('article');card.className='finish-poster-card';
      const imageWrap=document.createElement('div');imageWrap.className='finish-poster-image';
      if(movie.poster){
        const image=document.createElement('img');image.src=movie.poster;image.alt=`${movie.title} 포스터`;image.loading=i<6?'eager':'lazy';image.decoding='async';
        image.onerror=()=>{image.replaceWith(Object.assign(document.createElement('span'),{className:'finish-poster-empty',textContent:'포스터 없음'}));};
        imageWrap.append(image);
      }else{
        const fallback=document.createElement('span');fallback.className='finish-poster-empty';fallback.textContent='포스터 없음';imageWrap.append(fallback);
      }
      const text=document.createElement('div');text.className='finish-poster-info';
      const sequence=document.createElement('span');sequence.className='finish-poster-number';sequence.textContent=`SCENE ${format2(i+1)}`;
      const name=document.createElement('strong');name.textContent=movie.title;name.title=movie.title;
      text.append(sequence,name);card.append(imageWrap,text);grid.append(card);
    });
    showScreen('finishScreen');
    requestAnimationFrame(fitFinishGallery);
    playSfx('game_finish');
  }

  // v32: 10 and 20 scenes fit on one PC screen. Larger sessions use
  // the same 20-scene grid sizing and scroll inside the poster area only.
  function fitFinishGallery(){
    const screen=$('finishScreen');
    const grid=$('finishPosterGrid');
    if(!screen||screen.classList.contains('hidden')||!grid)return;
    const count=grid.children.length;
    const bar=document.querySelector('.topbar');
    screen.style.setProperty('--finish-header-height',`${Math.ceil(bar?.getBoundingClientRect().height||76)}px`);
    const desktop=window.innerWidth>760;
    const scrollMode=desktop&&count>20;
    screen.classList.toggle('finish-desktop-scroll',scrollMode);
    if(!desktop){
      grid.style.removeProperty('--finish-cols');
      grid.style.removeProperty('--finish-rows');
      grid.style.removeProperty('--finish-gap');
      grid.style.removeProperty('--finish-pad');
      grid.style.removeProperty('--finish-name-size');
      grid.style.removeProperty('--finish-index-size');
      grid.style.removeProperty('--finish-cell-height');
      return;
    }
    if(!count)return;
    const card=screen.querySelector('.finish-gallery-card');
    const head=screen.querySelector('.finish-gallery-heading');
    const foot=screen.querySelector('.finish-gallery-bottom');
    const usableHeight=Math.max(120,(screen.clientHeight||window.innerHeight-76)-
      (head?.offsetHeight||85)-(foot?.offsetHeight||60)-44);
    const cols=5;
    const rows=count<=10?2:4;
    const gap=8;
    const rowHeight=Math.max(36,Math.floor((usableHeight-gap*(rows-1))/rows));
    grid.style.setProperty('--finish-cols',String(cols));
    grid.style.setProperty('--finish-rows',String(rows));
    grid.style.setProperty('--finish-gap',`${gap}px`);
    grid.style.setProperty('--finish-pad','5px');
    grid.style.setProperty('--finish-name-size','12px');
    grid.style.setProperty('--finish-index-size','9px');
    grid.style.setProperty('--finish-cell-height',`${rowHeight}px`);
  }
  let finishLayoutRaf=0;
  window.addEventListener('resize',()=>{
    cancelAnimationFrame(finishLayoutRaf);
    finishLayoutRaf=requestAnimationFrame(fitFinishGallery);
  },{passive:true});

  function normalizeManifest(data){const result=[];if(Array.isArray(data)){for(const entry of data){if(entry?.title&&LEVELS.includes(entry.level)&&entry.scene){result.push({title:String(entry.title),level:entry.level,category:['한국 영화','외국 영화'].includes(entry.category)?entry.category:categoryFromScene(entry.scene),scene:String(entry.scene),poster:entry.poster?String(entry.poster):''});}}}return result;}
  function categoryFromScene(scene){
    try { const path=decodeURIComponent(String(scene));
      const match=path.match(/(?:^|\/)movies\/(한국 영화|외국 영화)\//);
      return match?.[1]||'외국 영화';
    }catch{return '외국 영화';}
  }
  function parseFileTree(paths){
    const images=paths.filter(p=>/^movies\//i.test(p)&&/\.(png|jpe?g)$/i.test(p));
    const posters=new Map();
    for(const path of images){
      const parts=path.split('/');
      if(parts.length!==4)continue;
      const [root,category,title,file]=parts;
      if(!['한국 영화','외국 영화'].includes(category))continue;
      if(!/^(poster|포스터|cover|thumbnail)\.(png|jpe?g)$/i.test(file))continue;
      const priority=/^poster\./i.test(file)?0:/^포스터\./i.test(file)?1:2;
      const key=category+'/'+title,old=posters.get(key);
      if(!old||old.priority>priority)posters.set(key,{url:urlForPath(path),priority});
    }
    const rows=[];
    for(const path of images){
      const parts=path.split('/');
      if(parts.length!==5)continue;
      const [root,category,title,level,file]=parts;
      if(!['한국 영화','외국 영화'].includes(category)||!LEVELS.includes(level))continue;
      rows.push({title,category,level,scene:urlForPath(path),poster:posters.get(category+'/'+title)?.url||''});
    }
    return rows;
  }
  async function tryManifest(){try{const response=await fetch('./movies/manifest.json',{cache:'no-store'});if(!response.ok)return [];const rows=normalizeManifest(await response.json());return rows;}catch{return [];}}
  async function tryGithub(){const host=location.hostname.toLowerCase();if(!host.endsWith('.github.io'))return [];const owner=host.slice(0,-'.github.io'.length), parts=decodeURIComponent(location.pathname).split('/').filter(Boolean), repo=parts[0]||`${owner}.github.io`;if(!/^[\w.-]+$/.test(owner)||!/^[\w.-]+$/.test(repo))return [];const ctrl=new AbortController();const timeout=setTimeout(()=>ctrl.abort(),8500);try{const headers={Accept:'application/vnd.github+json'};const base=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;const info=await fetch(base,{headers,signal:ctrl.signal});if(!info.ok)throw Error('repository status '+info.status);const repoInfo=await info.json();const branch=repoInfo.default_branch||'main';const res=await fetch(`${base}/git/trees/${encodeURIComponent(branch)}?recursive=1`,{headers,signal:ctrl.signal});if(!res.ok)throw Error('tree status '+res.status);const tree=await res.json();if(tree.truncated)throw Error('tree truncated');return parseFileTree((tree.tree||[]).filter(x=>x.type==='blob').map(x=>x.path));}catch(e){console.warn('GitHub 자동 탐색 사용 불가:',e.message);return [];}finally{clearTimeout(timeout);}}
  async function loadCatalog(){const status=$('dataStatus');const bundled=normalizeManifest(window.FRAME_CATALOG_V27);if(bundled.length){catalog=bundled;sourceType='bundle';}else{const local=await tryManifest();if(local.length){catalog=local;sourceType='manifest';}else{const github=await tryGithub();if(github.length){catalog=github;sourceType='github';}else{catalog=window.FRAME_DEMO||[];sourceType='demo';}}}const films=new Set(catalog.map(x=>`${x.category}|${x.title}`)).size;status.textContent=sourceType==='demo'?`샘플 모드 · ${catalog.length}개 데모 장면`: `${films}편의 영화 · ${catalog.length}개 장면 준비 완료`;$('dataDot').classList.toggle('live',sourceType!=='demo');if(sourceType==='demo')console.info('FRAME!: 영화 데이터 미탐색 — 예시 장면 사용 중');updateAllCount();renderPosterMarquee();}
  function updateAllCount(){
    const count=catalog.filter(item=>item.level===selectedLevel&&categoryMatches(item)).length;
    const button=$('allCountBtn');
    if(button){button.textContent=`전체(${count}개)`;button.setAttribute('aria-label',`${selectedCategory} ${selectedLevel} 난이도 전체 ${count}개 문제`);}
    qsa('.count-btn').forEach(btn=>{
      const required=Number(btn.dataset.count);
      btn.disabled=Number.isFinite(required)&&required>count;
      btn.setAttribute('aria-disabled',String(btn.disabled));
    });
    if(roundLimit!=='all' && Number(roundLimit)>count){roundLimit='all';}
    qsa('.count-btn').forEach(btn=>{
      const active=btn.dataset.count===String(roundLimit);
      btn.classList.toggle('active',active);
      btn.setAttribute('aria-pressed',String(active));
    });
    if($('selectedCategoryLabel'))$('selectedCategoryLabel').textContent=selectedCategory;
  }
  function chooseCategory(category){
    if(!['종합','한국 영화','외국 영화'].includes(category))return;
    selectedCategory=category;
    selectedLevel='쉬움';
    roundLimit=10;
    qsa('.difficulty').forEach(btn=>{
      const active=btn.dataset.level===selectedLevel;
      btn.classList.toggle('selected',active);
      btn.setAttribute('aria-pressed',String(active));
    });
    if($('modePill'))$('modePill').textContent=MODES[selectedLevel];
    updateAllCount();
    showSettings();
    clearLaunchNavigation();settingsNavRow=0;
    prepareLaunchRound();
  }

// Safari sometimes parks a CSS transform animation after reload/backgrounding.
// Resume the existing timeline; do not reset its position on every interaction.
let marqueeResumeFrame=0;
function resumePosterAnimation(){
  if($('mainScreen').classList.contains('hidden'))return;
  const track=$('posterMarqueeTrack');
  const frame=qs('.poster-marquee-frame');
  if(!track||!track.children.length||frame?.classList.contains('lightbox-open'))return;
  // Commit the box's height before starting the transform compositor.
  void track.getBoundingClientRect();
  for(const animation of track.getAnimations()){
    if(animation.playState==='paused' || animation.playState==='idle'){
      try{animation.play();}catch{}
    }
  }
}
function schedulePosterAnimationResume(){
  cancelAnimationFrame(marqueeResumeFrame);
  marqueeResumeFrame=requestAnimationFrame(()=>{
    marqueeResumeFrame=requestAnimationFrame(resumePosterAnimation);
  });
}

function renderPosterMarquee(itemsOverride){
  const track=$('posterMarqueeTrack');const fallback=$('posterMarqueeFallback');
  if(!track||!fallback)return;
  const source=itemsOverride || catalog;
  const unique=[];const seen=new Set();
  for(const item of source){
    const key=item.category ? item.category+'|'+item.title:item.title;
    if(!item.poster||seen.has(key))continue;
    seen.add(key);unique.push({title:item.title,poster:item.poster});
  }
  if(!unique.length){fallback.classList.remove('hidden');return;}
  // 전체 한국/외국 포스터에서 먼저 섞고 매번 새로운 조합을 사용한다.
  const items=shuffle(unique).slice(0,Math.min(unique.length,32));
  lastPosterTitles=items.map(x=>x.title).join('|');
  const all=items.concat(items);
  track.innerHTML=all.map((movie,i)=>`<button type="button" class="poster-chip" data-poster-title="${escapeHtml(movie.title)}" data-poster-src="${escapeHtml(movie.poster)}" aria-label="${escapeHtml(movie.title)} 포스터 확대" ${i>=items.length?'tabindex="-1" aria-hidden="true"':''}><img src="${escapeHtml(movie.poster)}" alt="" loading="${i<8?'eager':'lazy'}" decoding="async" draggable="false"/></button>`).join('');
  fallback.classList.add('hidden');
  // One initial layout pass is sufficient. Do not require any touch to animate.
  schedulePosterAnimationResume();
}

  let posterLightboxReturnFocus=null;
  function openPosterLightbox(button){
    if(!button)return;
    const src=button.dataset.posterSrc;
    if(!src)return;
    const lightbox=$('posterLightbox');
    posterLightboxReturnFocus=button;
    $('posterLightboxImage').src=src;
    $('posterLightboxImage').alt=`${button.dataset.posterTitle||'영화'} 포스터 확대 이미지`;
    $('posterLightboxTitle').textContent=button.dataset.posterTitle||'';
    lightbox.classList.remove('hidden');
    lightbox.setAttribute('aria-hidden','false');
    qs('.poster-marquee-frame')?.classList.add('lightbox-open');
    document.body.classList.add('poster-lightbox-visible');
    $('posterLightboxClose').focus({preventScroll:true});
    playSfx('ui_click');
  }
  function closePosterLightbox(){
    const lightbox=$('posterLightbox');
    if(lightbox.classList.contains('hidden'))return;
    lightbox.classList.add('hidden');
    lightbox.setAttribute('aria-hidden','true');
    $('posterLightboxImage').removeAttribute('src');
    qs('.poster-marquee-frame')?.classList.remove('lightbox-open');
    schedulePosterAnimationResume();
    document.body.classList.remove('poster-lightbox-visible');
    if(posterLightboxReturnFocus?.isConnected && window.matchMedia('(hover:hover) and (pointer:fine)').matches)posterLightboxReturnFocus.focus({preventScroll:true}); else if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
    posterLightboxReturnFocus=null;
  }

  function chooseLevel(level){selectedLevel=level;updateAllCount();$('modePill').textContent=MODES[level];qsa('.difficulty').forEach(btn=>{const chosen=btn.dataset.level===level;btn.classList.toggle('selected',chosen);btn.setAttribute('aria-pressed',String(chosen));});prepareLaunchRound();playSfx('ui_select');}
  function setup(){
    if ($('year')) $('year').textContent = new Date().getFullYear();
    updateSound();
    qsa('.difficulty').forEach(btn=>{
      btn.addEventListener('click',()=>chooseLevel(btn.dataset.level));
      // 더블클릭하면 먼저 난이도를 선택하고 같은 게임 시작 절차를 실행합니다.
      btn.addEventListener('dblclick',event=>{
        event.preventDefault();
        if(!$('settingsScreen').classList.contains('hidden')){
          if(selectedLevel!==btn.dataset.level)chooseLevel(btn.dataset.level);
          if(!$('startBtn').disabled)startGame();
        }
      });
    });
    qsa('.count-btn').forEach(btn=>btn.addEventListener('click',()=>{
      playSfx('ui_select');roundLimit=btn.dataset.count;updateAllCount();prepareLaunchRound();
    }));
    $('posterMarqueeTrack').addEventListener('click',event=>{
      const button=event.target.closest('button.poster-chip');
      if(button)openPosterLightbox(button);
    });
    const marquee=$('posterMarquee');
    const boostOff=()=>{marquee.classList.remove('edge-boost');for(const animation of $('posterMarqueeTrack').getAnimations())animation.playbackRate=1;};
    marquee.addEventListener('pointerdown',e=>{
      const rect=marquee.getBoundingClientRect();const ratio=(e.clientX-rect.left)/rect.width;
      if(ratio<.18||ratio>.82){
        marquee.classList.add('edge-boost');
        for(const animation of $('posterMarqueeTrack').getAnimations())animation.playbackRate=2;
      }
    },{passive:true});
    ['pointerup','pointercancel','pointerleave'].forEach(event=>marquee.addEventListener(event,boostOff,{passive:true}));
    marquee.addEventListener('contextmenu',e=>e.preventDefault());
    marquee.addEventListener('selectstart',e=>e.preventDefault());
    $('posterLightboxClose').addEventListener('click',closePosterLightbox);
    $('posterLightbox').addEventListener('click',event=>{
      if(event.target===$('posterLightbox'))closePosterLightbox();
    });
    document.addEventListener('keydown',event=>{
      if($('posterLightbox').classList.contains('hidden'))return;
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closePosterLightbox();}
      if(event.key==='Tab'){
        event.preventDefault();$('posterLightboxClose').focus({preventScroll:true});
      }
    },true);
    qsa('[data-category]').forEach(btn=>btn.addEventListener('click',()=>chooseCategory(btn.dataset.category)));$('settingsBackBtn').onclick=goHome; $('noticeOkBtn').onclick=closeNotice; $('noticeBackdrop').onclick=e=>{if(e.target===$('noticeBackdrop'))closeNotice();}; // The brand remains stationary on touch. No unnecessary home reflow.
    let lastBrandTouchAt=-10000;
    const brand=$('logoBtn');
    const brandGoHome=()=>{
      if(!$('mainScreen').classList.contains('hidden')){brand.blur();return;}
      goHome();brand.blur();schedulePosterAnimationResume();
    };
    brand.addEventListener('pointerup',event=>{
      if(event.pointerType!=='touch')return;
      lastBrandTouchAt=performance.now();brandGoHome();
    });
    brand.addEventListener('dragstart',event=>event.preventDefault());
    brand.addEventListener('selectstart',event=>event.preventDefault());
    brand.onclick=()=>{
      if(performance.now()-lastBrandTouchAt<700)return;
      brandGoHome();
    };$('howBtn').onclick=showHelp;$('otherBtn').onclick=showOther;$('libraryBtn').onclick=showLibrary;

    // Developer link: native anchor for mouse/keyboard, immediate touchend for iOS.
    // No setTimeout, async work, or audio decoding in this navigation path.
    const devLink=$('devBtn');
    let lastDevTouchAt=-10000;
    devLink.addEventListener('touchend',event=>{
      if(event.changedTouches.length!==1)return;
      // Open synchronously inside the touch gesture. If Safari blocks the
      // programmatic tab, let the original <a target=_blank> click proceed.
      const popup=window.open(devLink.href,'_blank');
      if(!popup)return;
      lastDevTouchAt=performance.now();
      if(event.cancelable)event.preventDefault();
      try{popup.opener=null;}catch{}
    },{passive:false});
    devLink.addEventListener('click',event=>{
      if(performance.now()-lastDevTouchAt<700)event.preventDefault();
    });
    $('soundBtn').onclick=toggleSound;$('startBtn').onclick=startGame;$('pauseBtn').onclick=pause;
    $('skipBtn').onclick=skipStage;
    $('nextBtn').onclick=nextScene;$('replayBtn').onclick=startGame;$('finishHomeBtn').onclick=goHome;
    $('modalClose').onclick=()=>modalClose();$('modalBackdrop').onclick=e=>{if(e.target===$('modalBackdrop'))modalClose();};
    // v48: Numeric category selection on the home screen, including numpad.
    document.addEventListener('keydown',handleHomeCategoryShortcut,true);
    // v47: Settings keyboard grid: Right×2, Down, Right, Down, Enter
    // selects 어려움 / 20문제 and starts. Capture before native button handlers.
    document.addEventListener('keydown',handleSettingsKeyboard,true);
    $('settingsScreen').addEventListener('pointerdown',clearLaunchNavigation,{passive:true});
    // v45: During active gameplay, Enter belongs exclusively to stage controls.
    // Capture before native button activation: a focused header button (e.g.
    // '이외 게임') must never open as a side effect of skipping/revealing.
    document.addEventListener('keydown',e=>{
      if(e.key!=='Enter'||$('gameScreen').classList.contains('hidden'))return;
      if(!['scene','guess','reveal','loading'].includes(stage))return;
      if(paused||modal||!$('noticeBackdrop').classList.contains('hidden')||!$('posterLightbox').classList.contains('hidden'))return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // v46: Clear programmatic focus on the non-interactive game container.
      // Otherwise keyboard modality can draw the browser's large black outline.
      if(document.activeElement===$('gameScreen')) $('gameScreen').blur();
      if(e.repeat)return;
      if(stage==='scene'||stage==='guess')skipStage();
      else if(stage==='reveal')nextScene();
      // While loading, consume Enter but do not advance twice.
    },true);
    document.addEventListener('keydown',e=>{if(!$('noticeBackdrop').classList.contains('hidden')){if(e.key==='Escape'||e.key==='Enter'){e.preventDefault();closeNotice();}return;}if(modal==='pause' && ['ArrowDown','ArrowUp','ArrowRight','ArrowLeft','Home','End'].includes(e.key)){e.preventDefault();const items=['resumeBtn','restartBtn','returnBtn'].map($);const current=items.indexOf(document.activeElement);const next=e.key==='Home'?0:e.key==='End'?2:(current+(e.key==='ArrowDown'||e.key==='ArrowRight'?1:-1)+3)%3;selectPauseItem(next);return;}if(e.code==='Space'&&!['INPUT','TEXTAREA','BUTTON'].includes(document.activeElement?.tagName)){if(!$('gameScreen').classList.contains('hidden')){e.preventDefault();paused?resume():pause();}}else if(e.key==='Escape'){if(modal){if(modal==='pause')resume();else modalClose();}else if(!$('gameScreen').classList.contains('hidden'))pause();else if(!$('settingsScreen').classList.contains('hidden'))goHome();}});
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&!paused&&['scene','guess','reveal'].includes(stage))pause();});
    // v16: 중복 재생 방지 - 공통 document 클릭 효과음을 사용하지 않습니다.
    // 각 동작에서 효과음은 정확히 한 번만 발생하도록 별도 연결합니다.
    ['settingsBackBtn','logoBtn','finishHomeBtn'].forEach(id=>{
      const button=$(id);
      if(button)button.addEventListener('click',()=>playSfx('ui_click'));
    });
    // 닫기 버튼은 modalClose()가 이미 ui_back 효과음을 재생합니다.
    // 모달 내부의 선택/재시작 등은 각각 본래 효과음만 재생합니다.
    // v29: Prevent Safari's game-stage double-tap zoom while preserving pinch zoom/accessibility.
    // Browser UI buttons keep their native activation semantics.
    const gameSurface=$('gameScreen');
    gameSurface.addEventListener('dblclick',event=>{
      if(event.target.closest('button,a,input,textarea,select'))return;
      event.preventDefault();
    },{passive:false});
    // A rapid second tap on a non-interactive surface should not scale the document.
    let lastGameTapAt=0;
    gameSurface.addEventListener('touchend',event=>{
      if(event.target.closest('button,a,input,textarea,select'))return;
      if(event.touches.length||event.changedTouches.length!==1)return;
      const now=Date.now();
      if(now-lastGameTapAt<310)event.preventDefault();
      lastGameTapAt=now;
    },{passive:false});
    // Keep a listener active until the browser allows audible playback.
    // A first tap on ANY screen control unlocks the BGM, not just the carousel.
    document.addEventListener('pointerdown',unlockBgmFromGesture,{capture:true,passive:true});
    document.addEventListener('touchstart',unlockBgmFromGesture,{capture:true,passive:true});
    document.addEventListener('keydown',unlockBgmFromGesture,{capture:true});
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden){
        bgm.pause();
        pauseStageAudio();
      }else{
        syncBgm();
        schedulePosterAnimationResume();
        if(!paused&&['guess','reveal'].includes(stage))resumeStageAudio();
      }
    });
    window.addEventListener('pageshow',()=>{schedulePosterAnimationResume();syncBgm();});
    window.addEventListener('resize',schedulePosterAnimationResume,{passive:true});
    sfx.warm();
    updateAllCount();
    // The bundled manifest is ready synchronously. Never paint two different
    // poster strips on startup: rebuilding twice triggered Safari flicker.
    if(!window.FRAME_CATALOG_V27?.length && window.FRAME_POSTERS?.length){
      renderPosterMarquee(window.FRAME_POSTERS);
    }
    loadCatalog();
  }
  setup();
})();
