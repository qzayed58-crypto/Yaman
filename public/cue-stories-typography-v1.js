(function () {
  'use strict';
  var KEY = 'cue_stories_settings_v1';
  var PREVIEW = 'cue-stories-settings-preview-v1';
  var AR = ["Cairo", "Tajawal", "IBM Plex Sans Arabic", "Noto Sans Arabic", "Almarai", "Readex Pro", "Alexandria", "Mada", "Rubik", "Vazirmatn", "Noto Naskh Arabic", "Noto Kufi Arabic", "Amiri", "Changa", "El Messiri", "Baloo Bhaijaan 2", "Markazi Text", "Harmattan"];
  var EN = ["Inter", "Roboto", "Open Sans", "Lato", "Nunito Sans", "Source Sans 3", "IBM Plex Sans", "Noto Sans", "Manrope", "Work Sans", "Instagram Sans", "Instagram Sans Bold", "Poppins", "Montserrat", "DM Sans", "Plus Jakarta Sans", "Outfit", "Atkinson Hyperlegible", "Lexend", "Literata"];
  var saved = new WeakMap(), fontLinks = Object.create(null), observer = null;
  var current = { version: 1, ar: 'default', en: 'default', arSize: 100, enSize: 100, arWeight: 'default', enWeight: 'default', alignment: 'default' };
  var TEXT_ROOT = '#text', SHEET_ROOT = '#sheet';
  var TEXT_TARGETS = '.en, .tr';
  var SHEET_TARGETS = '.sh-word, .sh-en, .sh-ar, .sh-exar';

  function normalize(input) {
    input = input && typeof input === 'object' ? input : {};
    function font(value, choices) { return choices.indexOf(value) >= 0 ? value : 'default'; }
    function size(value) {
      if (typeof value !== 'number' && typeof value !== 'string') return 100;
      if (String(value).trim() === '') return 100;
      var n = Number(value);
      if (!Number.isFinite(n) || n < 25 || n > 200) return 100;
      return Math.round(n / 5) * 5;
    }
    function weight(value) {
      if (value === 'default' || value === undefined || value === null || value === '') return 'default';
      var n = Number(value);
      if (!Number.isFinite(n) || n < 300 || n > 900) return 'default';
      return Math.round(n / 100) * 100;
    }
    return { version: 1, ar: font(input.ar, AR), en: font(input.en, EN), arSize: size(input.arSize), enSize: size(input.enSize), arWeight: weight(input.arWeight), enWeight: weight(input.enWeight), alignment: ['center','left','right'].indexOf(input.alignment) >= 0 ? input.alignment : 'default' };
  }
  function readSaved() {
    try { return normalize(JSON.parse(window.localStorage.getItem(KEY) || '{}')); }
    catch (_) { return normalize(null); }
  }
  function langFor(el) { return el.matches('.tr, .sh-ar, .sh-exar') ? 'ar' : 'en'; }
  function ensureFont(name) {
    if (!name || fontLinks[name]) return;
    // Instagram is a Latin-only family, loaded separately from Google Fonts.
    if (name === 'Instagram Sans' || name === 'Instagram Sans Bold') {
      var filename = name === 'Instagram Sans Bold' ? 'Instagram%20Sans%20Bold.woff' : 'Instagram%20Sans.woff';
      var face = new FontFace(name, 'url(https://fonts.cdnfonts.com/s/93599/' + filename + ')', { style: 'normal', weight: '400', display: 'swap' });
      document.fonts.add(face);
      fontLinks[name] = face;
      face.load().catch(function () {});
      return;
    }
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(name).replace(/%20/g, '+') + ':wght@400;700&display=swap';
    link.dataset.cueStoriesFont = name;
    (document.head || document.documentElement).appendChild(link);
    fontLinks[name] = link;
  }
  function inRoot(el, rootSelector) {
    var root = document.querySelector(rootSelector);
    return !!root && root.contains(el);
  }
  function eligible(el) {
    return el && el.nodeType === 1 && ((el.matches(TEXT_TARGETS) && inRoot(el, TEXT_ROOT)) || (el.matches(SHEET_TARGETS) && inRoot(el, SHEET_ROOT)));
  }
  function restore(el, base) {
    el.style.fontSize = base.inlineSize;
    el.style.fontFamily = base.inlineFamily;
    el.style.fontWeight = base.inlineWeight;
    el.style.textAlign = base.inlineTextAlign;
  }
  function applyElement(el) {
    if (!eligible(el)) return;
    var base = saved.get(el);
    if (base) restore(el, base);
    else {
      var cs = window.getComputedStyle(el);
      base = { size: parseFloat(cs.fontSize) || 16, inlineSize: el.style.fontSize, inlineFamily: el.style.fontFamily, inlineWeight: el.style.fontWeight, inlineTextAlign: el.style.textAlign };
      saved.set(el, base);
    }
    var lang = langFor(el), scale = current[lang + 'Size'] / 100;
    var name = current[lang] === 'default' ? '' : current[lang];
    var weight = current[lang + 'Weight'];
    if (name) el.style.fontFamily = '"' + name.replace(/"/g, '') + '", sans-serif';
    if (scale !== 1) el.style.fontSize = (base.size * scale) + 'px';
    if (weight !== 'default') el.style.fontWeight = String(weight);
    if (el.matches(TEXT_TARGETS) && inRoot(el, TEXT_ROOT) && current.alignment !== 'default') el.style.textAlign = current.alignment;
  }
  function collect(root, selector) {
    if (!root) return [];
    var result = [];
    if (root.matches && root.matches(selector)) result.push(root);
    root.querySelectorAll(selector).forEach(function (el) { result.push(el); });
    return result;
  }
  function applyRoots() {
    var list = [];
    list = list.concat(collect(document.querySelector(TEXT_ROOT), TEXT_TARGETS));
    list = list.concat(collect(document.querySelector(SHEET_ROOT), SHEET_TARGETS));
    // Restore all owned values before measuring any baseline, preventing inherited scaling from a prior pass.
    list.forEach(function (el) { var base = saved.get(el); if (base) restore(el, base); });
    list.forEach(applyElement);
  }
  function setSettings(settings) {
    current = normalize(settings);
    if (current.ar !== 'default') ensureFont(current.ar);
    if (current.en !== 'default') ensureFont(current.en);
    applyRoots();
  }
  function init() {
    current = readSaved();
    setSettings(current);
    if (window.MutationObserver && !observer) {
      observer = new MutationObserver(function (records) {
        records.forEach(function (record) {
          record.addedNodes.forEach(function (node) {
            if (node.nodeType !== 1) return;
            // Restrict work to additions within the two verified reading roots.
            var textRoot = document.querySelector(TEXT_ROOT), sheetRoot = document.querySelector(SHEET_ROOT);
            if (textRoot && (textRoot === node || textRoot.contains(node))) collect(node, TEXT_TARGETS).forEach(applyElement);
            if (sheetRoot && (sheetRoot === node || sheetRoot.contains(node))) collect(node, SHEET_TARGETS).forEach(applyElement);
          });
        });
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }
  window.addEventListener('storage', function (event) {
    if (event.key === KEY || event.key === null) setSettings(readSaved());
  });
  window.addEventListener('message', function (event) {
    if (window.parent === window || event.source !== window.parent || event.origin !== window.location.origin || !event.data || event.data.type !== PREVIEW) return;
    setSettings(event.data.settings);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
  // Preview runtime never persists settings or modifies story content, audio, theme, or progress.
})();
