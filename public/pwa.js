(function () {
  'use strict';
  var hasSW = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  var regPromise = null;
  var lastCheck = 0;
  var refreshing = false;

  function registerAndUpdate() {
    if (!hasSW) return Promise.resolve(null);
    if (!regPromise) {
      regPromise = navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .then(function (reg) {
          if (typeof reg.update === 'function') {
            lastCheck = Date.now();
            return reg.update().catch(function () {}).then(function () { return reg; });
          }
          return reg;
        })
        .catch(function () { return null; });
    }
    return regPromise;
  }

  function checkUpdate(force) {
    if (!hasSW || (!force && Date.now() - lastCheck < 30000)) return;
    registerAndUpdate().then(function (reg) {
      if (!reg || typeof reg.update !== 'function') return;
      lastCheck = Date.now();
      reg.update().catch(function () {});
    });
  }

  function installEntryCheck() {
    // The app-shell response is network-first; registering again plus update() asks
    // the browser to check the Worker script on every entry, with HTTP cache bypassed.
    registerAndUpdate();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installEntryCheck, { once: true });
  else installEntryCheck();
  var cueHiddenAt = 0;
  var cueDeferredRefresh = false;
  window.addEventListener('pageshow', function (event) { if (event.persisted) cueHandleResume(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { cueHiddenAt = Date.now(); return; }
    if (document.visibilityState === 'visible') {
      if (cueHiddenAt && Date.now() - cueHiddenAt >= 800) { cueHiddenAt = 0; cueHandleResume(); }
      else checkUpdate(false);
    }
  });
  function cueSafeToRefresh() {
    var gate = document.getElementById('cue-auth-gate');
    if (gate && !gate.hidden) return false;
    if (document.querySelector('[aria-modal="true"], .scrim')) return false;
    var pane = document.querySelector('.pane:not([hidden])');
    if (pane && pane.querySelector('#stage, #opts, #rvBack, .study-nav, .story-reader, [data-story-reader="true"]')) return false;
    var media = Array.prototype.slice.call(document.querySelectorAll('audio,video'));
    if (media.some(function (item) { return !item.paused && !item.ended; })) return false;
    return true;
  }
  function cueHandleResume() {
    /* CUE_RESUME_WITHOUT_RELOAD_V1: check for updates without discarding the current view. */
    cueDeferredRefresh = false; checkUpdate(true);
  }
  document.addEventListener('click', function () {
    if (!cueDeferredRefresh) return;
    setTimeout(function () { if (cueDeferredRefresh && cueSafeToRefresh()) setRefreshing(true); }, 180);
  }, true);

  var indicator = document.createElement('div');
  indicator.id = 'cue-pull-refresh';
  indicator.setAttribute('role', 'status');
  indicator.setAttribute('aria-live', 'polite');
  indicator.textContent = 'اسحب للأسفل للتحديث';
  indicator.style.cssText = 'position:fixed;z-index:2147483000;top:env(safe-area-inset-top,0px);left:50%;transform:translate(-50%,-130%);opacity:0;pointer-events:none;padding:9px 15px;border-radius:999px;background:#1d2b2a;color:#fff;font:600 14px/1.3 system-ui,sans-serif;box-shadow:0 5px 18px #0003;transition:transform .15s ease,opacity .15s ease;white-space:nowrap';
  function showIndicator(text, visible) {
    indicator.textContent = text;
    indicator.style.transform = visible ? 'translate(-50%,10px)' : 'translate(-50%,-130%)';
    indicator.style.opacity = visible ? '1' : '0';
  }
  function setRefreshing(silent) {
    if (refreshing) return;
    refreshing = true;
    if (!silent) showIndicator('جارٍ التحقق والتحديث…', true);
    cueDeferredRefresh = false;
    var update = Promise.resolve(null);
    if (hasSW) {
      update = Promise.race([
        navigator.serviceWorker.ready.then(function (reg) {
          if (reg && typeof reg.update === 'function') { lastCheck = Date.now(); return reg.update().catch(function () {}); }
        }).catch(function () {}),
        new Promise(function (resolve) { setTimeout(resolve, 1200); })
      ]);
    }
    Promise.resolve(update).finally(function () { setTimeout(function () { location.reload(); }, 120); });
  }

  /* CUE_STORY_NATIVE_TOUCH_V1: opened readers use native scrolling; CSS keeps pull-refresh disabled. */
  function cueIsOpenedStory() {
    if (document.body && document.body.classList.contains('is-story')) return true;
    var pane = document.getElementById('pane-stories');
    var stories = window.__cueIntegratedStoriesV1;
    return !!(pane && !pane.hidden && stories && typeof stories.view === 'function' && stories.view() === 'story');
  }

  function cueIsStoriesView() {
    var body = document.body;
    var pane = document.getElementById('pane-stories');
    if (pane && !pane.hidden && window.getComputedStyle(pane).display !== 'none') return true;
    var tab = document.querySelector('#tabbar .tab[data-tab="stories"].on, #tabbar .tab[data-tab="stories"][aria-current="page"]');
    if (tab) return true;
    return !!(body && (body.classList.contains('story') || body.classList.contains('path')));
  }

  /* CUE_BRANCH_AWARE_PULL_REFRESH_V1: preserve main selectors; stop only nested branches. */
  function cueIsMainPullRefreshScreen() {
    var body = document.body;
    if (!body) return false;
    var gate = document.getElementById('cue-auth-gate');
    if (gate) {
      var gateStyle = window.getComputedStyle(gate);
      var gateRect = gate.getBoundingClientRect();
      if (!gate.hidden && gateStyle.display !== 'none' && gateStyle.visibility !== 'hidden' && gateRect.width > 0 && gateRect.height > 0) return false;
    }
    if (body.classList.contains('cue-home-visible')) return true;
    // Standalone Stories level selector remains on its previous top-level behavior.
    if (body.classList.contains('is-levels') && !body.classList.contains('is-path') && !body.classList.contains('is-story')) return true;
    function visible(el) {
      if (!el || !el.isConnected) return false;
      var style = window.getComputedStyle(el);
      var rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }
    var tab = document.querySelector('#tabbar .tab.on[data-tab], #tabbar .tab[aria-current="page"][data-tab]');
    if (!tab) return false;
    if (tab.dataset.tab === 'stories') {
      var stories = window.__cueIntegratedStoriesV1;
      var storiesPane = document.getElementById('pane-stories');
      return !!(visible(storiesPane) && stories && typeof stories.view === 'function' && stories.view() === 'levels');
    }
    if (tab.dataset.tab === 'conversations') {
      return Array.prototype.filter.call(document.querySelectorAll('#pane-conversations .cc-level-card'), visible).length === 6;
    }
    if (tab.dataset.tab === 'vocab') {
      return Array.prototype.filter.call(document.querySelectorAll('#pane-vocab .lvl'), visible).length === 6;
    }
    if (tab.dataset.tab === 'settings') {
      var settingsPane = document.getElementById('pane-settings');
      if (!visible(settingsPane)) return false;
      var nestedSettingsPage = Array.prototype.some.call(settingsPane.querySelectorAll('[id]'), function (el) {
        return /settings-(?:page|panel|modal)$/i.test(el.id) && visible(el);
      });
      return !nestedSettingsPage;
    }
    return false;
  }
  function cueSyncStoriesPullGuard() {
    if (!document.documentElement) return;
    var storiesView = cueIsStoriesView();
    var openedStory = cueIsOpenedStory();
    document.documentElement.classList.toggle('cue-stories-no-pull-refresh', storiesView);
    document.documentElement.classList.toggle('cue-nested-no-pull-refresh', !storiesView && !openedStory && !cueIsMainPullRefreshScreen());
  }

  function cueStoriesScrollAtTop(target) {
    var node = target && target.nodeType === 1 ? target : target && target.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      var style = window.getComputedStyle(node);
      if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1 && node.scrollTop > 1) return false;
      node = node.parentElement;
    }
    var scrolling = document.scrollingElement || document.documentElement;
    return !(scrolling && scrolling.scrollTop > 1) && !(window.scrollY > 1);
  }

  var cueStoriesOverscrollStyle = document.createElement('style');
  cueStoriesOverscrollStyle.textContent = 'html.cue-stories-no-pull-refresh,html.cue-stories-no-pull-refresh body,html.cue-stories-no-pull-refresh #pane-stories,html.cue-stories-no-pull-refresh #pane-stories #road,html.cue-stories-no-pull-refresh #pane-stories .story-reader{overscroll-behavior-y:none!important}html.cue-nested-no-pull-refresh,html.cue-nested-no-pull-refresh body{overscroll-behavior-y:none!important}';
  (document.head || document.documentElement).appendChild(cueStoriesOverscrollStyle);

  function cueWatchStoriesPullMode() {
    cueSyncStoriesPullGuard();
    if (typeof MutationObserver === 'undefined') return;
    if (document.body) new MutationObserver(cueSyncStoriesPullGuard).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    var tabbar = document.getElementById('tabbar');
    if (tabbar) new MutationObserver(cueSyncStoriesPullGuard).observe(tabbar, { attributes: true, childList: true, subtree: true, attributeFilter: ['class', 'aria-current', 'hidden'] });
    var storiesPane = document.getElementById('pane-stories');
    if (storiesPane) new MutationObserver(cueSyncStoriesPullGuard).observe(storiesPane, { attributes: true, attributeFilter: ['class', 'hidden'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', cueWatchStoriesPullMode, { once: true });
  else cueWatchStoriesPullMode();
  document.addEventListener('click', function () { setTimeout(cueSyncStoriesPullGuard, 0); }, true);
  window.addEventListener('popstate', function () { setTimeout(cueSyncStoriesPullGuard, 0); });
  window.addEventListener('pageshow', function () { setTimeout(cueSyncStoriesPullGuard, 0); });

  // Touch-event path is supported by iOS Safari and mobile Chromium; desktop
  // browsers continue to use their native reload controls.
  if ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0) {
    document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(indicator); }, { once: true });
    var startY = null, startX = null, pull = 0;
    document.addEventListener('touchstart', function (event) {
      cueSyncStoriesPullGuard();
      if (cueIsOpenedStory()) { startY = null; startX = null; pull = 0; return; }
      if (!cueIsStoriesView() && !cueIsMainPullRefreshScreen()) { startY = null; startX = null; pull = 0; showIndicator('اسحب للأسفل للتحديث', false); return; }
      if (event.touches.length !== 1 || (cueIsMainPullRefreshScreen() && !cueStoriesScrollAtTop(event.composedPath ? event.composedPath()[0] : event.target))) { startY = null; startX = null; pull = 0; return; }
      if (event.target && event.target.closest && event.target.closest('input,textarea,select,button,[contenteditable="true"]')) { startY = null; startX = null; pull = 0; return; }
      startY = event.touches[0].clientY;
      startX = event.touches[0].clientX;
      pull = 0;
    }, { passive: true });
    document.addEventListener('touchmove', function (event) {
      if (cueIsOpenedStory()) return;
      cueSyncStoriesPullGuard();
      if (cueIsStoriesView() && !cueIsMainPullRefreshScreen()) {
        if (startY === null || event.touches.length !== 1) return;
        var storyDy = event.touches[0].clientY - startY;
        var storyDx = event.touches[0].clientX - startX;
        if (storyDy > 0 && Math.abs(storyDx) <= 48 && cueStoriesScrollAtTop(event.composedPath ? event.composedPath()[0] : event.target)) event.preventDefault();
        return;
      }
      if (!cueIsMainPullRefreshScreen()) {
        if (startY !== null && event.touches.length === 1) {
          var branchDy = event.touches[0].clientY - startY;
          var branchDx = event.touches[0].clientX - startX;
          if (branchDy > 0 && Math.abs(branchDx) <= 48 && cueStoriesScrollAtTop(event.composedPath ? event.composedPath()[0] : event.target)) event.preventDefault();
        }
        pull = 0;
        showIndicator('اسحب للأسفل للتحديث', false);
        return;
      }
      if (startY === null || event.touches.length !== 1 || !cueStoriesScrollAtTop(event.composedPath ? event.composedPath()[0] : event.target)) return;
      var dy = event.touches[0].clientY - startY;
      var dx = event.touches[0].clientX - startX;
      if (dy <= 0 || Math.abs(dx) > 48) return;
      pull = dy;
      if (dy > 12) event.preventDefault();
      showIndicator(dy >= 88 ? 'أفلت للتحديث' : 'اسحب للأسفل للتحديث', true);
    }, { passive: false });
    document.addEventListener('touchend', function () {
      if (cueIsOpenedStory() || (cueIsStoriesView() && !cueIsMainPullRefreshScreen())) { startY = null; startX = null; pull = 0; showIndicator('اسحب للأسفل للتحديث', false); return; }
      cueSyncStoriesPullGuard();
      if (!cueIsMainPullRefreshScreen()) { startY = null; startX = null; pull = 0; showIndicator('اسحب للأسفل للتحديث', false); return; }
      if (startY === null) return;
      var shouldRefresh = pull >= 88;
      startY = null; startX = null; pull = 0;
      if (shouldRefresh) setRefreshing();
      else showIndicator('اسحب للأسفل للتحديث', false);
    }, { passive: true });
    document.addEventListener('touchcancel', function () { startY = null; startX = null; pull = 0; showIndicator('اسحب للأسفل للتحديث', false); }, { passive: true });
  }
  /* CUE_SILENT_RESUME_AND_BACK_V1 */
  (function cueInstallBackNavigation(){
    if (location.pathname !== '/' && location.pathname !== '/index.html') return;
    if (window.__cueBackHandlingV1) return;
    window.__cueBackHandlingV1 = true;
    var tabTrail = [];
    var handlingBack = false;
    function activeTab(){
      var button = document.querySelector('#tabbar .tab.on, #tabbar .tab[aria-current="page"]');
      if (button && button.dataset.tab) return button.dataset.tab;
      var pane = document.querySelector('.pane:not([hidden])');
      return pane && pane.id ? pane.id.replace(/^pane-/, '') : 'home';
    }
    var lastTab = activeTab();
    function visible(el){
      if (!el || el.disabled) return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
    }
    function findBackButton(){/*cue-root-explicit-step-back-v1*/for(var cueBackId of ["rvBack2","rvBack","backStudy","backPath","backLevels","back"]){var cueBackElement=document.getElementById(cueBackId);if(cueBackElement&&visible(cueBackElement))return cueBackElement;}
      var dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (dialog) {
        var cancel = dialog.querySelector('.big-btn.ghost, button[aria-label*="إغلاق"], button[aria-label*="رجوع"]');
        if (cancel && visible(cancel)) return cancel;
        var first = dialog.querySelector('button'); if (first && visible(first)) return first;
      }
      var pane = document.querySelector('.pane:not([hidden])') || document;
      var resultGo = pane.querySelector('.result #go'); if (resultGo && visible(resultGo)) return resultGo;
      var candidates = Array.prototype.slice.call(pane.querySelectorAll('button,a,[role="button"]')).filter(visible);
      var ranked = candidates.map(function(el){
        var label = ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.textContent || '')).replace(/\s+/g,' ').trim();
        var cls = String(el.className || '');
        var rank = -1;
        if (el.matches('.back-chip, [data-phonics-mode="hub"]')) rank = 0;
        else if (/^(رجوع|الرجوع|عودة|العودة|رجوع إلى|العودة إلى|المستويات|الأقسام)(\b|\s|$)/u.test(label)) rank = 1;
        else if (/x-btn|back|close/i.test(cls) || /العودة إلى|إغلاق/i.test(el.getAttribute('aria-label') || '')) rank = 2;
        if (el.matches('.tab')) rank = -1;
        return {el:el,rank:rank};
      }).filter(function(x){return x.rank >= 0;}).sort(function(a,b){return a.rank-b.rank;});
      return ranked.length ? ranked[0].el : null;
    }
    function pushBackMarker(){try{history.pushState({__cueRootBack:true},'',location.href)}catch(_){}}
    document.addEventListener('click',function(event){
      var button = event.target && event.target.closest ? event.target.closest('#tabbar .tab[data-tab]') : null;
      if (!button || handlingBack) return;
      var before = lastTab;
      setTimeout(function(){
        var after = activeTab();
        if (after && after !== before) { tabTrail.push(before); lastTab = after; try{history.pushState({__cueRootBack:true},'',location.href)}catch(_){} }
      },0);
    },false);
    window.addEventListener('popstate',function(){
      if (activeTab()==='stories' && window.__cueIntegratedStoriesV1 && window.__cueIntegratedStoriesV1.back()) { setTimeout(pushBackMarker,0); return; }
      var back = findBackButton();
      if (back) { back.click(); setTimeout(pushBackMarker,0); return; }
      var current = activeTab();
      var destination = tabTrail.length ? tabTrail.pop() : (current !== 'home' ? 'home' : null);
      if (destination) {
        var tab = document.querySelector('#tabbar .tab[data-tab="'+destination+'"]');
        if (tab) { handlingBack = true; tab.click(); handlingBack = false; lastTab = destination; pushBackMarker(); return; }
      }
      if (window.confirm('هل تريد الخروج من الموقع فعلًا؟ اضغط موافق للخروج أو إلغاء للبقاء.')) { history.back(); return; }
      pushBackMarker();
    });
    try { var state = history.state || {}; if (!state.__cueRootBack) history.pushState({__cueRootBack:true},'',location.href); } catch (_) {}
  })();
})();

;(()=>{/*cue-story-step-back-v1*/
    if(!['/stories','/stories/','/stories/index.html','/stories.html'].includes(location.pathname)||window.__cueStoryStepBackV1)return;
    window.__cueStoryStepBackV1=true;
    var key='__cueStoryScrollV1',handlingPop=false;
    var view=function(){var c=document.body&&document.body.classList;return c&&c.contains('is-story')?'story':c&&c.contains('is-path')?'path':'levels'};
    var restore=function(){var y=0;try{y=Number(sessionStorage.getItem(key)||0)||0}catch(_){}var done=function(){if(view()==='path')window.scrollTo(0,y)};if(typeof requestAnimationFrame==='function')requestAnimationFrame(function(){requestAnimationFrame(done)});else setTimeout(done,80)};
    try{if(!history.state||!history.state.__cueStoryStepBackV1)history.pushState({__cueStoryStepBackV1:true},'',location.href)}catch(_){}
    document.addEventListener('click',function(e){
      var target=e.target&&e.target.closest?e.target.closest('#road [data-i]'):null;
      if(target&&view()==='path'){var y=window.scrollY||window.pageYOffset||0;try{sessionStorage.setItem(key,String(y))}catch(_){}}
      var before=view(),isBackPath=!!(e.target&&e.target.closest&&e.target.closest('#backPath'));
      if(isBackPath&&before==='story'&&!handlingPop)setTimeout(restore,0);
      setTimeout(function(){if(handlingPop)return;var after=view();if((before==='levels'&&after==='path')||(before==='path'&&after==='story')){try{history.pushState({__cueStoryStepBackV1:true},'',location.href)}catch(_){}}},0);
    },true);
    window.addEventListener('popstate',function(){
      if(handlingPop)return;
      var current=view();
      if(current==='story'){var b=document.getElementById('backPath');if(b){handlingPop=true;b.click();setTimeout(function(){handlingPop=false;restore()},0);try{history.pushState({__cueStoryStepBackV1:true},'',location.href)}catch(_){};return}}
      if(current==='path'){var b=document.getElementById('backLevels');if(b){handlingPop=true;b.click();setTimeout(function(){handlingPop=false},0);try{history.pushState({__cueStoryStepBackV1:true},'',location.href)}catch(_){};return}}
      location.assign('/');
    });
  })();


/* CUE_READ_TAB_V1: mount the standalone reading game as an isolated app pane. */
(function cueInstallReadTabV1() {
  'use strict';
  function install() {
    var app = document.getElementById('app');
    var bar = document.getElementById('tabbar');
    if (!app || !bar || bar.querySelector('[data-tab="read"]')) return;

    var pane = document.createElement('section');
    pane.id = 'pane-read';
    pane.className = 'pane';
    pane.hidden = true;
    pane.setAttribute('aria-label', 'Read');
    pane.style.cssText = 'background:#050814;min-height:calc(100vh - var(--tabh, 4.6rem));';

    var frame = document.createElement('iframe');
    frame.title = 'Read — CyberFlow English Reading Game';
    frame.setAttribute('allow', 'autoplay');
    frame.setAttribute('loading', 'lazy');
    frame.style.cssText = 'display:block;width:100%;height:calc(100dvh - var(--tabh, 4.6rem));min-height:520px;border:0;background:#050814;';
    var gameLoaded = false;
    function loadGame() {
      if (gameLoaded) return;
      gameLoaded = true;
      frame.src = '/read/';
      pane.appendChild(frame);
    }

    var vocabPane = document.getElementById('pane-vocab');
    if (vocabPane && vocabPane.parentNode === app) vocabPane.before(pane);
    else app.appendChild(pane);

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab';
    button.dataset.tab = 'read';
    button.setAttribute('aria-label', 'Read');
    button.title = 'Read';
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.5C10.3 5.2 8 4.6 4.5 4.6v13.8c3.5 0 5.8 0.6 7.5 1.9 1.7-1.3 4-1.9 7.5-1.9V4.6c-3.5 0-5.8 0.6-7.5 1.9Z"/><path d="M12 6.5v13.8"/></svg><span>Read</span>';
    var conversationsButton = bar.querySelector('[data-tab="conversations"]');
    var storiesButton = bar.querySelector('[data-tab="stories"]');
    if (storiesButton) storiesButton.before(button);
    else if (conversationsButton) conversationsButton.after(button);
    else bar.appendChild(button);

    bar.addEventListener('click', function (event) {
      var target = event.target && event.target.closest ? event.target.closest('.tab') : null;
      if (!target) return;
      if (target === button) {
        loadGame();
        pane.hidden = false;
      } else {
        pane.hidden = true;
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
