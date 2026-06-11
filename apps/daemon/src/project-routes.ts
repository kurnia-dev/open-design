import { rm, writeFile, readFile, readdir, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Express, Response } from 'express';
import {
  defaultScenarioPluginIdForProjectMetadata,
  type ChatSessionMode,
  type PluginManifest,
} from '@open-design/contracts';
import { createProjectArtifactFile } from './artifact-create.js';
import { ArtifactPublicationBlockedError } from './artifact-publication-guard.js';
import { ArtifactRegressionError } from './artifact-stub-guard.js';
import { listDesignSystems, readDesignSystemPackageInfo } from './design-systems.js';
import { startDevScript, getDevServerUrl, stopDevScript } from './design-system-import.js';
import {
  FIRST_PARTY_ATOMS,
  buildConnectorProbe,
  getInstalledPlugin,
  listInstalledPlugins,
  resolvePluginSnapshot,
} from './plugins/index.js';
import { connectorService } from './connectors/service.js';
import type { RouteDeps } from './server-context.js';
import { listSkills } from './skills.js';
import { isSafeId } from './projects.js';
import {
  BUILT_IN_PROJECT_LOCATION_ID,
  allProjectLocations,
  createLocationProjectDir,
  ensureProjectLocation,
  scanProjectLocation,
  writeProjectManifest,
} from './project-locations.js';
import { auditDesignSystemPackage } from './tools-connectors-cli.js';
import { callLlmOnce } from './memory-llm.js';
import { getGitHubToken, setGitHubToken, clearGitHubToken } from './github-tokens.js';


export interface RegisterProjectRoutesDeps extends RouteDeps<'db' | 'design' | 'http' | 'paths' | 'projectStore' | 'projectFiles' | 'conversations' | 'templates' | 'status' | 'events' | 'ids' | 'telemetry' | 'appConfig' | 'validation'> { }

function projectDetailResolvedDir(
  projectsRoot: string,
  project: any,
  resolveProjectDir: (
    projectsRoot: string,
    projectId: string,
    metadata?: unknown,
    opts?: { allowUnavailableSandboxImportedProject?: boolean },
  ) => string,
): string {
  const baseDir = typeof project?.metadata?.baseDir === 'string'
    ? path.normalize(project.metadata.baseDir)
    : null;
  if (baseDir && path.isAbsolute(baseDir)) return baseDir;
  return resolveProjectDir(projectsRoot, project.id, project.metadata, {
    allowUnavailableSandboxImportedProject: true,
  });
}

const URL_PREVIEW_SCROLL_BRIDGE = `<script data-od-url-scroll-bridge>
(function(){
  if (window.__odUrlScrollBridge) return;
  window.__odUrlScrollBridge = true;
  var pending = false;
  function scrollElement(){
    return document.querySelector('.design-canvas') || document.scrollingElement || document.documentElement;
  }
  function num(value){
    var next = Number(value || 0);
    return Number.isFinite(next) ? next : 0;
  }
  function post(){
    var el = scrollElement();
    if (!el) return;
    var frame = document.scrollingElement || document.documentElement;
    window.parent.postMessage({
      type: 'od:preview-scroll',
      canvasLeft: Math.round(el.scrollLeft || 0),
      canvasTop: Math.round(el.scrollTop || 0),
      frameLeft: Math.round(frame.scrollLeft || 0),
      frameTop: Math.round(frame.scrollTop || 0)
    }, '*');
  }
  function schedule(){
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(function(){
      pending = false;
      post();
    });
  }
  function scrollTo(el, left, top){
    if (!el) return;
    if (typeof el.scrollTo === 'function') el.scrollTo(num(left), num(top));
    else {
      el.scrollLeft = num(left);
      el.scrollTop = num(top);
    }
  }
  function scrollBy(el, left, top){
    if (!el) return;
    var dx = num(left);
    var dy = num(top);
    if (!dx && !dy) return;
    if (typeof el.scrollBy === 'function') el.scrollBy({ left: dx, top: dy, behavior: 'auto' });
    else {
      el.scrollLeft = (el.scrollLeft || 0) + dx;
      el.scrollTop = (el.scrollTop || 0) + dy;
    }
  }
  function requestRestore(){
    window.parent.postMessage({ type: 'od:preview-scroll-request' }, '*');
  }
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || !data.type) return;
    if (data.type === 'od:preview-scroll-restore') {
      scrollTo(document.scrollingElement || document.documentElement, data.frameLeft, data.frameTop);
      scrollTo(scrollElement(), data.canvasLeft, data.canvasTop);
      setTimeout(post, 0);
      return;
    }
    if (data.type === 'od:preview-scroll-by') {
      scrollBy(scrollElement(), data.left, data.top);
      schedule();
    }
  });
  window.addEventListener('scroll', schedule, true);
  document.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){
      requestRestore();
      schedule();
    });
  } else {
    setTimeout(function(){
      requestRestore();
      schedule();
    }, 0);
  }
})();
</script>`;

const URL_PREVIEW_SELECTION_BRIDGE = `<script data-od-url-selection-bridge>
(function(){
  if (window.__odUrlSelectionBridge) return;
  window.__odUrlSelectionBridge = true;
  var commentEnabled = false;
  var mode = 'picker';
  var hoveredId = null;
  var drawing = false;
  var stroke = [];
  var strokeFrame = null;
  var postTargetsPending = false;
  var postTargetsTimer = null;
  var activeCommentElementId = null;
  var activeCommentSelector = null;
  var activeTargetPending = false;
  function esc(value){
    try { return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/"/g, '\\\\"'); }
    catch (_) { return String(value); }
  }
  function ensureStyle(){
    if (document.querySelector('style[data-od-url-selection-style]')) return;
    var style = document.createElement('style');
    style.setAttribute('data-od-url-selection-style', '');
    style.textContent =
      'html[data-od-comment-mode] body * { cursor: crosshair !important; }' +
      'html[data-od-comment-mode][data-od-comment-mode-kind="pod"] body * { cursor: cell !important; }' +
      'html[data-od-comment-mode] body iframe,html[data-od-comment-mode] body object,html[data-od-comment-mode] body embed { pointer-events: none !important; }';
    (document.head || document.documentElement).appendChild(style);
  }
  function active(){ return commentEnabled; }
  function annotatedSelectorFor(el){
    var id = el.getAttribute('data-od-id') || el.getAttribute('data-screen-label');
    if (!id) return null;
    return el.hasAttribute('data-od-id') ? '[data-od-id="' + esc(id) + '"]' : '[data-screen-label="' + esc(id) + '"]';
  }
  function domSelectorFor(el){
    if (!el || !el.tagName || el === document.documentElement || el === document.body) return null;
    var parts = [];
    var node = el;
    while (node && node !== document.documentElement && node !== document.body) {
      var tag = node.tagName ? node.tagName.toLowerCase() : '';
      if (!tag || /^(script|style|template|meta|link|title|noscript)$/.test(tag)) return null;
      var parent = node.parentElement;
      if (!parent) return null;
      var index = 1;
      var sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.tagName && sibling.tagName.toLowerCase() === tag) index++;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(tag + ':nth-of-type(' + index + ')');
      node = parent;
    }
    return parts.length ? 'body > ' + parts.join(' > ') : null;
  }
  function visibleTarget(el){
    if (!el || !el.getBoundingClientRect) return false;
    if (el === document.documentElement || el === document.body) return false;
    if (/^(script|style|template|meta|link|title|noscript)$/.test(el.tagName ? el.tagName.toLowerCase() : '')) return false;
    try {
      var rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return false;
      var cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') return false;
    } catch (_) { return false; }
    return true;
  }
  function meaningfulDomFallbackTarget(el){
    if (!visibleTarget(el)) return false;
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (/^(a|button|input|textarea|select|label|img|video|canvas|h1|h2|h3|h4|h5|h6|p|li|td|th)$/.test(tag)) return true;
    if (el.getAttribute && (el.getAttribute('role') || el.getAttribute('aria-label') || el.getAttribute('title'))) return true;
    if (tag === 'svg') return !!(el.getAttribute && (el.getAttribute('role') || el.getAttribute('aria-label') || el.getAttribute('title')));
    var text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!text) return false;
    if (/^(span|strong|em|b|i|small|code|mark)$/.test(tag)) return true;
    var meaningfulChildren = 0;
    for (var child = el.firstElementChild; child; child = child.nextElementSibling) {
      var childTag = child.tagName ? child.tagName.toLowerCase() : '';
      if (/^(script|style|template|meta|link|title|noscript)$/.test(childTag)) continue;
      if ((child.textContent || '').replace(/\\s+/g, ' ').trim() || /^(img|video|canvas|svg|input|textarea|select)$/.test(childTag)) {
        meaningfulChildren++;
        if (meaningfulChildren > 1) return false;
      }
    }
    return true;
  }
  function generatedRootAnnotation(el, id){
    return id === 'path-0' && el && el.parentElement === document.body && el.id === 'root';
  }
  function styleSnapshot(el){
    try {
      var cs = window.getComputedStyle(el);
      return {
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        paddingTop: cs.paddingTop,
        paddingRight: cs.paddingRight,
        paddingBottom: cs.paddingBottom,
        paddingLeft: cs.paddingLeft,
        borderRadius: cs.borderTopLeftRadius,
        textAlign: cs.textAlign,
        fontFamily: cs.fontFamily
      };
    } catch (_) { return null; }
  }
  function targetFrom(el, allowDomFallback, clickedEl, clickPoint){
    var id = el.getAttribute('data-od-id') || el.getAttribute('data-screen-label');
    if (allowDomFallback && id && generatedRootAnnotation(el, id)) return null;
    var selector = annotatedSelectorFor(el);
    if (!id && allowDomFallback && meaningfulDomFallbackTarget(el)) {
      selector = domSelectorFor(el);
      if (selector) id = 'dom:' + selector;
    }
    if (!id || !selector) return null;
    var rect = el.getBoundingClientRect();
    var tag = el.tagName ? el.tagName.toLowerCase() : 'element';
    var cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    var html = '';
    try {
      var match = (el.outerHTML || '').replace(/\\s+/g, ' ').match(/^<[^>]+>/);
      html = match ? match[0] : '';
    } catch (_) {}
    var payload = {
      type: 'od:comment-target',
      elementId: id,
      selector: selector,
      label: tag + cls,
      text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
      position: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      htmlHint: html.slice(0, 180),
      style: styleSnapshot(el)
    };
    if (clickPoint) payload.hoverPoint = { x: Math.round(clickPoint.x), y: Math.round(clickPoint.y) };
    if (clickedEl && clickedEl !== el) {
      var clickedTag = clickedEl.tagName ? clickedEl.tagName.toLowerCase() : 'element';
      var clickedCls = typeof clickedEl.className === 'string' && clickedEl.className.trim() ? '.' + clickedEl.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
      payload.clickedDescendant = {
        label: clickedTag + clickedCls,
        text: (clickedEl.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80)
      };
    }
    return payload;
  }
  function allTargets(){
    var includeDomFallback = commentEnabled && mode === 'picker';
    var nodes = includeDomFallback ? document.querySelectorAll('body *') : document.querySelectorAll('[data-od-id], [data-screen-label]');
    var items = [];
    var seen = Object.create(null);
    for (var i = 0; i < nodes.length; i++) {
      var item = targetFrom(nodes[i], includeDomFallback);
      if (item && !seen[item.elementId]) {
        seen[item.elementId] = true;
        items.push(item);
      }
    }
    return items;
  }
  function postTargets(){
    if (!active()) return;
    window.parent.postMessage({ type: 'od:comment-targets', targets: allTargets() }, '*');
  }
  function schedulePostTargets(){
    if (!active() || postTargetsPending) return;
    postTargetsPending = true;
    if (postTargetsTimer) window.clearTimeout(postTargetsTimer);
    postTargetsTimer = window.setTimeout(function(){
      window.requestAnimationFrame(function(){
        postTargetsPending = false;
        postTargetsTimer = null;
        postTargets();
      });
    }, 120);
  }
  function findCommentTargetByIdentity(elementId, selector){
    var el = null;
    if (selector) {
      try { el = document.querySelector(String(selector)); } catch (_) { el = null; }
    }
    if (!el && elementId) {
      try {
        var id = String(elementId).replace(/"/g, '\\\\"');
        el = document.querySelector('[data-od-id="' + id + '"], [data-screen-label="' + id + '"]');
      } catch (_) { el = null; }
    }
    return el;
  }
  function postActiveCommentTarget(){
    if (!active() || !activeCommentElementId) return;
    var el = findCommentTargetByIdentity(activeCommentElementId, activeCommentSelector);
    if (!el) return;
    var payload = targetFrom(el, commentEnabled && mode === 'picker');
    if (payload) window.parent.postMessage(Object.assign({}, payload, { type: 'od:comment-active-target-update' }), '*');
  }
  function schedulePostActiveCommentTarget(){
    if (!active() || !activeCommentElementId || activeTargetPending) return;
    activeTargetPending = true;
    window.requestAnimationFrame(function(){
      activeTargetPending = false;
      postActiveCommentTarget();
    });
  }
  function eventCandidateElements(event){
    var items = [];
    function push(node){
      if (!node || node.nodeType !== 1) return;
      if (items.indexOf(node) >= 0) return;
      items.push(node);
    }
    try {
      if (event && typeof event.composedPath === 'function') {
        var path = event.composedPath();
        for (var i = 0; i < path.length; i++) push(path[i]);
      }
    } catch (_) {}
    push(event && event.target);
    try {
      if (event && typeof event.clientX === 'number' && typeof event.clientY === 'number' && document.elementsFromPoint) {
        var stack = document.elementsFromPoint(event.clientX, event.clientY);
        for (var s = 0; s < stack.length; s++) push(stack[s]);
      } else if (event && typeof event.clientX === 'number' && typeof event.clientY === 'number' && document.elementFromPoint) {
        push(document.elementFromPoint(event.clientX, event.clientY));
      }
    } catch (_) {}
    return items;
  }
  function closestTarget(event){
    var candidates = eventCandidateElements(event);
    var allowDomFallback = commentEnabled && mode === 'picker';
    var annotatedFallback = null;
    for (var i = 0; i < candidates.length; i++) {
      var clicked = candidates[i];
      var el = clicked;
      while (el && el !== document.documentElement) {
        if (allowDomFallback && meaningfulDomFallbackTarget(el)) return { target: el, clicked: clicked };
        if (el.getAttribute && (el.hasAttribute('data-od-id') || el.hasAttribute('data-screen-label'))) {
          var id = el.getAttribute('data-od-id') || el.getAttribute('data-screen-label');
          if (allowDomFallback && generatedRootAnnotation(el, id)) {
            el = el.parentElement;
            continue;
          }
          if (allowDomFallback && !annotatedFallback) annotatedFallback = { target: el, clicked: clicked };
          if (allowDomFallback) break;
          return { target: el, clicked: clicked };
        }
        el = el.parentElement;
      }
    }
    return annotatedFallback;
  }
  function relativePoint(ev){ return { x: Math.round(ev.clientX), y: Math.round(ev.clientY) }; }
  function postStroke(type){ window.parent.postMessage({ type: type, points: stroke.slice() }, '*'); }
  function schedulePostStroke(){
    if (strokeFrame !== null) return;
    strokeFrame = requestAnimationFrame(function(){
      strokeFrame = null;
      postStroke('od:pod-stroke');
    });
  }
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || !data.type) return;
    if (data.type === 'od:url-selection-bridge-probe') {
      window.parent.postMessage({ type: 'od:url-selection-bridge-ready' }, '*');
      return;
    }
    if (data.type === 'od:comment-mode') {
      commentEnabled = !!data.enabled;
      mode = data.mode === 'pod' ? 'pod' : 'picker';
      document.documentElement.toggleAttribute('data-od-comment-mode', commentEnabled);
      document.documentElement.setAttribute('data-od-comment-mode-kind', mode);
      if (commentEnabled) setTimeout(postTargets, 0);
      else {
        hoveredId = null;
        activeCommentElementId = null;
        activeCommentSelector = null;
      }
      if (!commentEnabled || mode !== 'pod') {
        drawing = false;
        stroke = [];
        try { window.parent.postMessage({ type: 'od:pod-clear' }, '*'); } catch (_) {}
      }
      return;
    }
    if (data.type === 'od:comment-active-target') {
      activeCommentElementId = data.elementId ? String(data.elementId) : null;
      activeCommentSelector = data.selector ? String(data.selector) : null;
      schedulePostActiveCommentTarget();
    }
  });
  document.addEventListener('mouseover', function(ev){
    if (!commentEnabled || mode !== 'picker') return;
    var result = closestTarget(ev);
    if (!result) return;
    var payload = targetFrom(result.target, true);
    if (!payload || payload.elementId === hoveredId) return;
    hoveredId = payload.elementId;
    window.parent.postMessage(Object.assign({}, payload, { type: 'od:comment-hover' }), '*');
  }, true);
  document.addEventListener('mouseout', function(ev){
    if (!commentEnabled || mode !== 'picker') return;
    var result = closestTarget(ev);
    if (!result) return;
    var next = ev.relatedTarget;
    while (next && next !== document.documentElement) {
      if (next === result.target) return;
      next = next.parentElement;
    }
    hoveredId = null;
    window.parent.postMessage({ type: 'od:comment-leave' }, '*');
  }, true);
  document.addEventListener('click', function(ev){
    if (!commentEnabled || mode !== 'picker') return;
    var result = closestTarget(ev);
    if (result) {
      ev.preventDefault();
      ev.stopPropagation();
      var payload = targetFrom(result.target, true, result.clicked, { x: ev.clientX, y: ev.clientY });
      if (payload) {
        activeCommentElementId = payload.elementId || activeCommentElementId;
        activeCommentSelector = payload.selector || activeCommentSelector;
        window.parent.postMessage(payload, '*');
      }
      return;
    }
    var t = ev.target;
    var walk = t && t.nodeType === 1 ? t : null;
    while (walk && walk !== document.documentElement) {
      var tag = walk.tagName;
      if (tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'LABEL') return;
      if (walk.isContentEditable) return;
      walk = walk.parentElement;
    }
    ev.preventDefault();
    ev.stopPropagation();
    var pinX = Math.round(ev.clientX);
    var pinY = Math.round(ev.clientY);
    var pinId = 'pin-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
    window.parent.postMessage({
      type: 'od:comment-target',
      elementId: pinId,
      selector: '[data-od-pin="' + pinId + '"]',
      label: 'pin',
      text: '',
      position: { x: pinX - 12, y: pinY - 12, width: 24, height: 24 },
      hoverPoint: { x: pinX, y: pinY },
      htmlHint: '',
      style: null,
      freePin: true
    }, '*');
  }, true);
  document.addEventListener('pointerdown', function(ev){
    if (!commentEnabled || mode !== 'pod' || ev.button !== 0) return;
    drawing = true;
    stroke = [relativePoint(ev)];
    ev.preventDefault();
    ev.stopPropagation();
    postStroke('od:pod-stroke');
  }, true);
  document.addEventListener('pointermove', function(ev){
    if (!drawing || mode !== 'pod') return;
    var point = relativePoint(ev);
    var last = stroke[stroke.length - 1];
    if (last && Math.hypot(last.x - point.x, last.y - point.y) < 4) return;
    stroke.push(point);
    ev.preventDefault();
    ev.stopPropagation();
    schedulePostStroke();
  }, true);
  function finishStroke(ev){
    if (!drawing || mode !== 'pod') return;
    drawing = false;
    if (strokeFrame !== null) { cancelAnimationFrame(strokeFrame); strokeFrame = null; }
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    postStroke('od:pod-select');
  }
  document.addEventListener('pointerup', finishStroke, true);
  document.addEventListener('pointercancel', finishStroke, true);
  window.addEventListener('resize', schedulePostTargets);
  document.addEventListener('scroll', function(){
    schedulePostActiveCommentTarget();
    schedulePostTargets();
  }, true);
  var mo = new MutationObserver(schedulePostTargets);
  mo.observe(document.documentElement, { subtree: true, childList: true });
  ensureStyle();
  window.parent.postMessage({ type: 'od:url-selection-bridge-ready' }, '*');
})();
</script>`;

const URL_PREVIEW_SNAPSHOT_BRIDGE = `<script data-od-url-snapshot-bridge>
(function(){
  if (window.__odUrlSnapshotBridge) return;
  window.__odUrlSnapshotBridge = true;
  var SNAPSHOT_STYLE_PROPS = [
    'display','position','box-sizing','width','height','min-width','max-width','min-height','max-height',
    'margin','margin-top','margin-right','margin-bottom','margin-left',
    'padding','padding-top','padding-right','padding-bottom','padding-left',
    'border','border-top','border-right','border-bottom','border-left','border-radius',
    'font','font-family','font-size','font-weight','font-style','line-height','letter-spacing',
    'color','background-color','opacity','transform','transform-origin','overflow','overflow-x','overflow-y',
    'white-space','text-align','vertical-align','object-fit','object-position',
    'flex','flex-direction','flex-wrap','flex-grow','flex-shrink','flex-basis',
    'grid','grid-template-columns','grid-template-rows','grid-column','grid-row',
    'gap','row-gap','column-gap','align-items','align-content','align-self',
    'justify-items','justify-content','justify-self','inset','top','right','bottom','left',
    'z-index','box-shadow','text-shadow'
  ];
  function copyComputedStyle(source, target){
    if (!source || !target || source.nodeType !== 1 || target.nodeType !== 1) return;
    var computed = window.getComputedStyle(source);
    var style = target.getAttribute('style') || '';
    for (var i = 0; i < SNAPSHOT_STYLE_PROPS.length; i++){
      var prop = SNAPSHOT_STYLE_PROPS[i];
      var value = computed.getPropertyValue(prop);
      if (value) style += prop + ':' + value + ';';
    }
    target.setAttribute('style', style);
  }
  function syncElementState(source, target){
    var tag = source.tagName ? source.tagName.toLowerCase() : '';
    if (tag === 'img' && source.currentSrc) target.setAttribute('src', source.currentSrc);
    if (tag === 'input' || tag === 'textarea') target.setAttribute('value', source.value || '');
    if (tag === 'canvas') {
      try {
        var img = document.createElement('img');
        img.setAttribute('src', source.toDataURL('image/png'));
        img.setAttribute('style', target.getAttribute('style') || '');
        target.parentNode && target.parentNode.replaceChild(img, target);
      } catch (_) {}
    }
  }
  function inlineSnapshotStyles(originalRoot, cloneRoot){
    copyComputedStyle(originalRoot, cloneRoot);
    syncElementState(originalRoot, cloneRoot);
    var originals = originalRoot.querySelectorAll('*');
    var clones = cloneRoot.querySelectorAll('*');
    var count = Math.min(originals.length, clones.length, 3500);
    for (var i = 0; i < count; i++){
      copyComputedStyle(originals[i], clones[i]);
      syncElementState(originals[i], clones[i]);
    }
    var scripts = cloneRoot.querySelectorAll('script');
    for (var s = scripts.length - 1; s >= 0; s--) scripts[s].remove();
    var links = cloneRoot.querySelectorAll('link[rel~="stylesheet"], link[rel~="preload"], link[rel~="preconnect"]');
    for (var l = links.length - 1; l >= 0; l--) links[l].remove();
    var styles = cloneRoot.querySelectorAll('style');
    for (var st = 0; st < styles.length; st++) {
      styles[st].textContent = (styles[st].textContent || '')
        .replace(/@import[^;]+;/gi, '')
        .replace(/@font-face\\s*\\{[^}]*\\}/gi, '');
    }
  }
  function pruneHiddenSnapshotNodes(originalRoot, cloneRoot){
    var originals = originalRoot.querySelectorAll('*');
    var clones = cloneRoot.querySelectorAll('*');
    var count = Math.min(originals.length, clones.length);
    var removals = [];
    for (var i = 0; i < count; i++){
      var original = originals[i];
      var clone = clones[i];
      if (!original || !clone || !clone.parentNode) continue;
      var computed = window.getComputedStyle(original);
      if (computed && (computed.display === 'none' || computed.visibility === 'hidden')) removals.push(clone);
    }
    for (var r = removals.length - 1; r >= 0; r--) {
      if (removals[r].parentNode) removals[r].parentNode.removeChild(removals[r]);
    }
  }
  function waitForImages(){
    var imgs = Array.prototype.slice.call(document.images || []);
    return Promise.all(imgs.map(function(img){
      if (img.complete) return Promise.resolve();
      return new Promise(function(resolve){
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    }));
  }
  function scrollOffset(){
    var doc = document.documentElement;
    var body = document.body;
    return {
      x: Math.max(window.scrollX || 0, doc ? doc.scrollLeft || 0 : 0, body ? body.scrollLeft || 0 : 0),
      y: Math.max(window.scrollY || 0, doc ? doc.scrollTop || 0 : 0, body ? body.scrollTop || 0 : 0)
    };
  }
  function escapeAttribute(value){
    return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
  function snapshotBackgroundColor(){
    try {
      var probe = window.getComputedStyle(document.body || document.documentElement);
      var bg = probe && probe.backgroundColor || '';
      if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return '#ffffff';
      return bg;
    } catch (_) { return '#ffffff'; }
  }
  function canvasLooksBlank(ctx, cw, ch){
    try {
      var data = ctx.getImageData(0, 0, cw, ch).data;
      var step = Math.max(4, Math.floor((cw * ch) / 4096)) * 4;
      var first = null, samples = 0;
      for (var i = 0; i + 3 < data.length; i += step){
        samples++;
        if (!first){ first = [data[i], data[i+1], data[i+2], data[i+3]]; continue; }
        if (Math.abs(data[i]-first[0]) > 6 || Math.abs(data[i+1]-first[1]) > 6 ||
            Math.abs(data[i+2]-first[2]) > 6 || Math.abs(data[i+3]-first[3]) > 6) return false;
      }
      return samples > 8;
    } catch (_) { return false; }
  }
  function renderSnapshot(id){
    var w = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    var h = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    var dpr = window.devicePixelRatio || 1;
    var bgColor = snapshotBackgroundColor();
    var docW = Math.max(w, document.documentElement.scrollWidth || 0, document.body ? document.body.scrollWidth : 0);
    var docH = Math.max(h, document.documentElement.scrollHeight || 0, document.body ? document.body.scrollHeight : 0);
    var clone = document.documentElement.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    inlineSnapshotStyles(document.documentElement, clone);
    pruneHiddenSnapshotNodes(document.documentElement, clone);
    var scroll = scrollOffset();
    var cloneBody = clone.querySelector('body');
    var rootStyle = clone.getAttribute('style') || '';
    var bodyStyle = cloneBody ? cloneBody.getAttribute('style') || '' : '';
    var bodyContent = cloneBody ? cloneBody.innerHTML : clone.innerHTML;
    var wrapperStyle = rootStyle + bodyStyle +
      'margin:0;position:relative;left:' + (-scroll.x) + 'px;top:' + (-scroll.y) + 'px;' +
      'width:' + docW + 'px;height:' + docH + 'px;overflow:visible;';
    var html = '<div xmlns="http://www.w3.org/1999/xhtml" style="' + escapeAttribute(wrapperStyle) + '">' + bodyContent + '</div>';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<foreignObject x="0" y="0" width="' + docW + '" height="' + docH + '">' + html + '</foreignObject></svg>';
    var img = new Image();
    img.onload = function(){
      try {
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(w * dpr));
        canvas.height = Math.max(1, Math.floor(h * dpr));
        var ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.scale(dpr, dpr);
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        if (canvasLooksBlank(ctx, canvas.width, canvas.height)) {
          window.parent.postMessage({ type: 'od:snapshot:result', id: id, error: 'empty-render' }, '*');
          return;
        }
        window.parent.postMessage({ type: 'od:snapshot:result', id: id, dataUrl: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height }, '*');
      } catch (err) {
        window.parent.postMessage({ type: 'od:snapshot:result', id: id, error: String(err && err.message || err) }, '*');
      }
    };
    img.onerror = function(){
      window.parent.postMessage({ type: 'od:snapshot:result', id: id, error: 'snapshot image failed' }, '*');
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || data.type !== 'od:snapshot' || !data.id) return;
    waitForImages().then(function(){ renderSnapshot(String(data.id)); });
  });
})();
</script>`;

function previewBridgeTokens(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(previewBridgeTokens);
  if (typeof value !== 'string') return [];
  return value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
}

function wantsUrlPreviewScrollBridge(value: unknown): boolean {
  return previewBridgeTokens(value).some((token) => token === 'scroll' || token === '1' || token === 'true');
}

function wantsUrlPreviewSelectionBridge(value: unknown): boolean {
  return previewBridgeTokens(value).some((token) => token === 'selection' || token === 'comment' || token === 'comments' || token === 'annotation');
}

function wantsUrlPreviewSnapshotBridge(value: unknown): boolean {
  return previewBridgeTokens(value).some((token) => token === 'snapshot' || token === 'image' || token === 'capture');
}

function injectBeforeBodyClose(html: string, marker: string, injection: string): string {
  if (html.includes(marker)) return html;
  const bodyCloseIndex = html.search(/<\/body\s*>/i);
  if (bodyCloseIndex >= 0) {
    return `${html.slice(0, bodyCloseIndex)}${injection}${html.slice(bodyCloseIndex)}`;
  }
  return `${html}${injection}`;
}

function injectUrlPreviewBridge(html: string, bridge: 'scroll' | 'selection' | 'snapshot'): string {
  if (bridge === 'scroll') {
    return injectBeforeBodyClose(html, 'data-od-url-scroll-bridge', URL_PREVIEW_SCROLL_BRIDGE);
  }
  if (bridge === 'selection') {
    return injectBeforeBodyClose(html, 'data-od-url-selection-bridge', URL_PREVIEW_SELECTION_BRIDGE);
  }
  return injectBeforeBodyClose(html, 'data-od-url-snapshot-bridge', URL_PREVIEW_SNAPSHOT_BRIDGE);
}

function normalizeChatSessionMode(value: unknown): ChatSessionMode {
  return value === 'chat' ? 'chat' : 'design';
}

async function scanDirForPackages(dir: string): Promise<Array<{ name: string; path: string }>> {
  const packages: Array<{ name: string; path: string }> = [];

  const workspaceYamlPath = path.join(dir, 'pnpm-workspace.yaml');
  let hasWorkspace = false;
  try {
    const st = await stat(workspaceYamlPath);
    hasWorkspace = st.isFile();
  } catch { }

  if (hasWorkspace) {
    try {
      const yamlContent = await readFile(workspaceYamlPath, 'utf8');
      const lines = yamlContent.split(/\r?\n/);
      let inPackages = false;
      const globPatterns: string[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        if (trimmed.startsWith('packages:')) {
          inPackages = true;
          continue;
        }
        if (inPackages && /^[a-zA-Z]/.test(line)) {
          inPackages = false;
        }
        if (inPackages) {
          const match = trimmed.match(/^-\s*['"]?([^'"]+)['"]?/);
          if (match && match[1]) {
            globPatterns.push(match[1]);
          }
        }
      }

      for (const pattern of globPatterns) {
        if (pattern.endsWith('/*')) {
          const parentDir = path.join(dir, pattern.slice(0, -2));
          try {
            const entries = await readdir(parentDir, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.isDirectory()) {
                const pkgPath = path.join(parentDir, entry.name);
                const pkgJsonPath = path.join(pkgPath, 'package.json');
                try {
                  const pkgJsonRaw = await readFile(pkgJsonPath, 'utf8');
                  const pkgJson = JSON.parse(pkgJsonRaw);
                  if (pkgJson && pkgJson.name) {
                    packages.push({ name: pkgJson.name, path: pkgPath });
                  }
                } catch { }
              }
            }
          } catch { }
        } else {
          const pkgPath = path.join(dir, pattern);
          const pkgJsonPath = path.join(pkgPath, 'package.json');
          try {
            const pkgJsonRaw = await readFile(pkgJsonPath, 'utf8');
            const pkgJson = JSON.parse(pkgJsonRaw);
            if (pkgJson && pkgJson.name) {
              packages.push({ name: pkgJson.name, path: pkgPath });
            }
          } catch { }
        }
      }
    } catch (err) {
      console.error(`[resolveDesignSystemNpmPackages] Error reading workspaces from ${dir}:`, err);
    }
  }

  const rootPkgJsonPath = path.join(dir, 'package.json');
  try {
    const rootPkgJsonRaw = await readFile(rootPkgJsonPath, 'utf8');
    const rootPkgJson = JSON.parse(rootPkgJsonRaw);
    if (rootPkgJson && rootPkgJson.name) {
      if (!packages.some(p => p.name === rootPkgJson.name)) {
        packages.push({ name: rootPkgJson.name, path: dir });
      }
    }
  } catch { }

  return packages;
}

async function resolveDesignSystemNpmPackages(
  designSystemId: string | undefined | null,
  DESIGN_SYSTEMS_DIR: string,
  USER_DESIGN_SYSTEMS_DIR: string,
): Promise<Array<{ name: string; path: string }>> {
  if (!designSystemId) return [];

  try {
    const info = designSystemId.startsWith('user:')
      ? await readDesignSystemPackageInfo(USER_DESIGN_SYSTEMS_DIR, designSystemId, { idPrefix: 'user:' })
      : await readDesignSystemPackageInfo(DESIGN_SYSTEMS_DIR, designSystemId);

    if (!info || !info.manifest) return [];

    const manifest = info.manifest;
    const sourcePath = (manifest as any).source?.path;
    if (!sourcePath || typeof sourcePath !== 'string') {
      const dirId = designSystemId.startsWith('user:') ? designSystemId.slice('user:'.length) : designSystemId;
      const brandRoot = path.join(designSystemId.startsWith('user:') ? USER_DESIGN_SYSTEMS_DIR : DESIGN_SYSTEMS_DIR, dirId);
      return await scanDirForPackages(brandRoot);
    }

    return await scanDirForPackages(sourcePath);
  } catch (err) {
    console.error(`[resolveDesignSystemNpmPackages] Error resolving packages for ${designSystemId}:`, err);
    return [];
  }
}

async function initializeReactViteProject(
  dir: string,
  projectName: string,
  designSystemPackages: Array<{ name: string; path: string }>,
  isPublishedDesignSystem = false,
  publishedPackages: string[] = [],
  skipGitCommit = false,
) {
  await mkdir(path.join(dir, 'src'), { recursive: true });

  let dsDeps = '';
  if (isPublishedDesignSystem && publishedPackages.length > 0) {
    dsDeps = publishedPackages
      .map(pkgName => `,\n    "${pkgName}": "latest"`)
      .join('');

    const scopes = new Set<string>();
    for (const pkgName of publishedPackages) {
      if (pkgName.startsWith('@') && pkgName.includes('/')) {
        const scope = pkgName.split('/')[0];
        if (scope) {
          scopes.add(scope);
        }
      }
    }
    let npmrcContent = 'registry=http://127.0.0.1:4873/\n//127.0.0.1:4873/:_authToken="dummy-token"\n';
    for (const scope of scopes) {
      npmrcContent += `${scope}:registry=http://127.0.0.1:4873/\n`;
    }
    await writeFile(path.join(dir, '.npmrc'), npmrcContent, 'utf8');
  } else {
    dsDeps = designSystemPackages
      .map(pkg => {
        const relPath = path.relative(dir, pkg.path).replace(/\\/g, '/');
        return `,\n    "${pkg.name}": "link:${relPath}"`;
      })
      .join('');
  }

  const packageJson = `{
  "name": "${projectName.toLowerCase().replace(/[^a-z0-9-]/g, '-')}",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.2.7",
    "react-dom": "^19.2.7"${dsDeps}
  },
  "devDependencies": {
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "latest",
    "@tailwindcss/vite": "^4.3.0",
    "tailwindcss": "^4.3.0",
    "typescript": "^6.0.3",
    "vite": "^8.0.16"
  }
}`;

  const viteConfig = "import { defineConfig } from 'vite';\n" +
    "import react from '@vitejs/plugin-react';\n" +
    "import tailwindcss from '@tailwindcss/vite';\n\n" +
    "// https://vitejs.dev/config/\n" +
    "export default defineConfig({\n" +
    "  plugins: [\n" +
    "    react(),\n" +
    "    tailwindcss(),\n" +
    "  ],\n" +
    "  server: {\n" +
    "    port: 5173,\n" +
    "    strictPort: true,\n" +
    "  }\n" +
    "});\n";

  const tsConfig = "{\n" +
    "  \"compilerOptions\": {\n" +
    "    \"target\": \"ES2020\",\n" +
    "    \"useDefineForClassFields\": true,\n" +
    "    \"lib\": [\"DOM\", \"DOM.Iterable\", \"ScriptHost\", \"ES2020\"],\n" +
    "    \"module\": \"ESNext\",\n" +
    "    \"skipLibCheck\": true,\n\n" +
    "    /* Bundler mode */\n" +
    "    \"moduleResolution\": \"bundler\",\n" +
    "    \"allowImportingTsExtensions\": true,\n" +
    "    \"resolveJsonModule\": true,\n" +
    "    \"isolatedModules\": true,\n" +
    "    \"noEmit\": true,\n" +
    "    \"jsx\": \"react-jsx\",\n\n" +
    "    /* Linting */\n" +
    "    \"strict\": true,\n" +
    "    \"noUnusedLocals\": true,\n" +
    "    \"noUnusedParameters\": true,\n" +
    "    \"noFallthroughCasesInSwitch\": true\n" +
    "  },\n" +
    "  \"include\": [\"src\"]\n" +
    "}";

  const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

  const mainTsx = "import React from 'react';\n" +
    "import ReactDOM from 'react-dom/client';\n" +
    "import App from './App.tsx';\n" +
    "import './index.css';\n\n" +
    "ReactDOM.createRoot(document.getElementById('root')!).render(\n" +
    "  <React.StrictMode>\n" +
    "    <App />\n" +
    "  </React.StrictMode>,\n" +
    ");\n";

  const listItems = (isPublishedDesignSystem && publishedPackages.length > 0)
    ? publishedPackages
      .map(pkgName => `<li><strong>${pkgName}</strong> (installed from local Verdaccio registry)</li>`)
      .join('\n        ')
    : designSystemPackages
      .map(pkg => `<li><strong>${pkg.name}</strong> (linked from <code>${pkg.path}</code>)</li>`)
      .join('\n        ');

  const appTsx = `import React from 'react';

function App() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Design Project: ${projectName}</h1>
      <p>This is a functional React + Vite + TypeScript project ${(isPublishedDesignSystem && publishedPackages.length > 0) ? 'configured with' : 'linked with'} the following design system packages:</p>
      <ul>
        ${listItems}
      </ul>
      <p>Edit <code>src/App.tsx</code> to start building!</p>
    </div>
  );
}

export default App;
`;

  const indexCss = "@import \"tailwindcss\";\n";

  const viteEnvD = "/// <reference types=\"vite/client\" />\n";

  const manifestJson = JSON.stringify({
    schemaVersion: "od-design-system-project/v1",
    name: projectName,
    category: "Generated",
    description: "React Vite Design Project generated by Open Design",
    importMode: "hybrid",
    devServer: {
      url: "http://localhost:5173",
      port: 5173
    }
  }, null, 2) + '\n';

  const gitignore = `# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

node_modules
dist
dist-ssr
*.local

# Editor directories and files
.vscode/*
!.vscode/extensions.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?
`;

  await Promise.all([
    writeFile(path.join(dir, 'package.json'), packageJson, 'utf8'),
    writeFile(path.join(dir, 'vite.config.ts'), viteConfig, 'utf8'),
    writeFile(path.join(dir, 'tsconfig.json'), tsConfig, 'utf8'),
    writeFile(path.join(dir, 'manifest.json'), manifestJson, 'utf8'),
    writeFile(path.join(dir, 'index.html'), indexHtml, 'utf8'),
    writeFile(path.join(dir, 'src/main.tsx'), mainTsx, 'utf8'),
    writeFile(path.join(dir, 'src/App.tsx'), appTsx, 'utf8'),
    writeFile(path.join(dir, 'src/index.css'), indexCss, 'utf8'),
    writeFile(path.join(dir, 'src/vite-env.d.ts'), viteEnvD, 'utf8'),
    writeFile(path.join(dir, '.gitignore'), gitignore, 'utf8'),
  ]);

  try {
    const runGit = (args: string[]) => new Promise((resolve, reject) => {
      const child = spawn('git', args, { cwd: dir, stdio: 'ignore' });
      child.on('close', (code) => code === 0 ? resolve(undefined) : reject(new Error(`git ${args.join(' ')} failed with code ${code}`)));
      child.on('error', reject);
    });
    await runGit(['init']);
    await runGit(['add', '.']);
    if (!skipGitCommit) {
      await runGit(['commit', '-m', 'Initial commit']);
    }
  } catch (err) {
    console.warn('[project-routes] Failed to initialize git repository:', err);
  }
}

const npmInstallStatuses = new Map<string, 'idle' | 'running' | 'completed' | 'failed'>();
const npmInstallMessages = new Map<string, string>();
const npmInstallLogs = new Map<string, string[]>();
const activeInstallProcesses = new Map<string, ChildProcess>();

function broadcastNpmInstallStatus(
  projectId: string,
  status: 'running' | 'completed' | 'failed',
  message: string,
  activeProjectEventSinks: Map<string, Set<any>>
) {
  const sinks = activeProjectEventSinks.get(projectId);
  if (sinks && sinks.size > 0) {
    for (const sink of Array.from(sinks) as any[]) {
      try {
        sink({ type: 'npm-install-status', status, message, projectId });
      } catch {
        sinks.delete(sink);
      }
    }
    if (sinks.size === 0) activeProjectEventSinks.delete(projectId);
  }
}

function broadcastNpmInstallLog(
  projectId: string,
  line: string,
  activeProjectEventSinks: Map<string, Set<any>>
) {
  // Accumulate up to 500 lines in memory for reconnecting clients
  const logs = npmInstallLogs.get(projectId) ?? [];
  logs.push(line);
  if (logs.length > 500) logs.shift();
  npmInstallLogs.set(projectId, logs);

  const sinks = activeProjectEventSinks.get(projectId);
  if (sinks && sinks.size > 0) {
    for (const sink of Array.from(sinks) as any[]) {
      try {
        sink({ type: 'npm-install-log', line, projectId });
      } catch {
        sinks.delete(sink);
      }
    }
  }
}

function checkPnpmInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['--version'], { stdio: 'ignore', shell: process.platform === 'win32', windowsHide: true });
    child.on('error', () => {
      resolve(false);
    });
    child.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

function installPnpmGlobally(projectId: string): Promise<boolean> {
  return new Promise((resolve) => {
    console.log('[project-routes] Installing pnpm globally for project ' + projectId);
    const child = spawn('npm', ['install', '-g', 'pnpm'], { stdio: 'ignore', shell: process.platform === 'win32', windowsHide: true });
    activeInstallProcesses.set(projectId, child);
    child.on('error', (err) => {
      console.error('[project-routes] Failed to run global pnpm install:', err);
      resolve(false);
    });
    child.on('close', (code) => {
      if (activeInstallProcesses.get(projectId) === child) {
        activeInstallProcesses.delete(projectId);
      }
      resolve(code === 0);
    });
  });
}

function runProjectInstall(
  projectId: string,
  dir: string,
  tool: 'pnpm' | 'npm',
  activeProjectEventSinks: Map<string, Set<any>>
): Promise<boolean> {
  return new Promise((resolve) => {
    // When the project lives inside the Open Design monorepo tree (e.g.
    // .od/projects/<id>) pnpm walks up and finds the root pnpm-workspace.yaml,
    // causing it to run a full 24-package workspace install instead of
    // creating a local node_modules for just this project.
    // --ignore-workspace tells pnpm to treat this directory as a standalone
    // project and create its own node_modules here.
    const args = tool === 'pnpm'
      ? ['install', '--ignore-workspace']
      : ['install', '--no-workspaces', '--legacy-peer-deps'];
    console.log(`[project-routes] Running ${tool} ${args.join(' ')} in ${dir}`);
    const child = spawn(tool, args, {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      console.log(`[project-routes][${tool}] ${text.trim()}`);
      for (const rawLine of text.split('\n')) {
        // Strip ANSI colour codes before sending to the UI
        const line = rawLine.replace(/\x1B\[[0-9;]*m/g, '').trimEnd();
        if (line) broadcastNpmInstallLog(projectId, line, activeProjectEventSinks);
      }
    });
    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      console.warn(`[project-routes][${tool}] ${text.trim()}`);
      for (const rawLine of text.split('\n')) {
        const line = rawLine.replace(/\x1B\[[0-9;]*m/g, '').trimEnd();
        if (line) broadcastNpmInstallLog(projectId, line, activeProjectEventSinks);
      }
    });
    activeInstallProcesses.set(projectId, child);
    child.on('error', (err) => {
      console.error(`[project-routes] Failed to start ${tool} install:`, err);
      resolve(false);
    });
    child.on('close', (code) => {
      console.log(`[project-routes] ${tool} install exited with code ${code} for ${dir}`);
      if (activeInstallProcesses.get(projectId) === child) {
        activeInstallProcesses.delete(projectId);
      }
      resolve(code === 0);
    });
  });
}

async function installDependencies(
  projectId: string,
  dir: string,
  activeProjectEventSinks: Map<string, Set<any>>
) {
  const updateStatus = (status: 'running' | 'completed' | 'failed', message: string) => {
    npmInstallStatuses.set(projectId, status);
    npmInstallMessages.set(projectId, message);
    broadcastNpmInstallStatus(projectId, status, message, activeProjectEventSinks);
  };

  try {
    // Clear any previous log lines for a fresh install run
    npmInstallLogs.set(projectId, []);
    updateStatus('running', 'Checking for pnpm...');

    const hasPnpm = await checkPnpmInstalled();
    let usePnpm = hasPnpm;

    if (!hasPnpm) {
      updateStatus('running', 'pnpm not found. Installing pnpm globally...');
      const pnpmInstalled = await installPnpmGlobally(projectId);
      if (pnpmInstalled) {
        usePnpm = true;
      } else {
        updateStatus('running', 'Global pnpm installation failed. Falling back to npm...');
        // Wait a tiny bit so the user can read the fallback message
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    // Double check if we were cancelled during the async steps
    if (npmInstallStatuses.get(projectId) === 'failed' && npmInstallMessages.get(projectId)?.includes('terminated')) {
      return;
    }

    const tool = usePnpm ? 'pnpm' : 'npm';
    updateStatus('running', `Installing dependencies with ${tool}...`);

    const installSuccess = await runProjectInstall(projectId, dir, tool, activeProjectEventSinks);

    // Again, double check cancellation
    if (npmInstallStatuses.get(projectId) === 'failed' && npmInstallMessages.get(projectId)?.includes('terminated')) {
      return;
    }

    if (installSuccess) {
      updateStatus('completed', 'Dependencies installed successfully.');
    } else {
      updateStatus('failed', `Failed to install dependencies using ${tool}.`);
    }
  } catch (err: any) {
    console.error(`[project-routes] Installation loop error:`, err);
    updateStatus('failed', `Installation failed: ${err?.message || err}`);
  }
}

export function registerProjectRoutes(app: Express, ctx: RegisterProjectRoutesDeps) {
  const { db, design } = ctx;
  const { sendApiError, createSseResponse } = ctx.http;
  const { DESIGN_SYSTEMS_DIR, USER_DESIGN_SYSTEMS_DIR, PROJECTS_DIR, SKILLS_DIR } = ctx.paths;
  const { readAppConfig, writeAppConfig } = ctx.appConfig;
  const { insertProject, validateLinkedDirs, getProject, updateProject, dbDeleteProject, removeProjectDir } = ctx.projectStore;
  const { writeProjectFile, readProjectFile, ensureProject, listFiles, listTabs, setTabs, resolveProjectDir } = ctx.projectFiles;
  const { insertConversation, getConversation, listConversations, updateConversation, deleteConversation, listMessages, upsertMessage, listPreviewComments, upsertPreviewComment, updatePreviewCommentStatus, deletePreviewComment } = ctx.conversations;
  const { getTemplate, listTemplates, deleteTemplate, insertTemplate, findTemplateByNameAndProject, updateTemplate } = ctx.templates;
  const { listLatestProjectRunStatuses, listProjectsAwaitingInput, normalizeProjectDisplayStatus, composeProjectDisplayStatus, listProjects } = ctx.status;
  const { subscribeFileEvents, activeProjectEventSinks } = ctx.events;
  const { randomId } = ctx.ids;
  const { validateProjectDesignSystemId, validateProjectSkillId } = ctx.validation;
  async function loadPluginRegistryView() {
    const [skills, designSystems] = await Promise.all([
      listSkills(SKILLS_DIR),
      listDesignSystems(DESIGN_SYSTEMS_DIR),
    ]);
    return {
      skills: skills.map((s) => ({ id: s.id, title: s.name, description: s.description })),
      designSystems: designSystems.map((d) => ({ id: d.id, title: d.title })),
      craft: [],
      atoms: FIRST_PARTY_ATOMS.map((a) => ({ id: a.id, label: a.label })),
      scenarios: collectBundledScenarios(),
    };
  }

  function collectBundledScenarios() {
    type ScenarioEntry = {
      id: string;
      taskKind: 'new-generation' | 'figma-migration' | 'code-migration' | 'tune-collab';
      pipeline: NonNullable<NonNullable<PluginManifest['od']>['pipeline']>;
    };
    const byTaskKind = new Map<ScenarioEntry['taskKind'], ScenarioEntry>();
    try {
      const all = listInstalledPlugins(db);
      for (const row of all) {
        if (row.sourceKind !== 'bundled') continue;
        const od = row.manifest.od;
        if (!od || od.kind !== 'scenario') continue;
        if (!od.pipeline || !Array.isArray(od.pipeline.stages) || od.pipeline.stages.length === 0) continue;
        const taskKind = (od.taskKind ?? 'new-generation') as ScenarioEntry['taskKind'];
        if (
          taskKind !== 'new-generation' &&
          taskKind !== 'figma-migration' &&
          taskKind !== 'code-migration' &&
          taskKind !== 'tune-collab'
        ) {
          continue;
        }
        const entry: ScenarioEntry = { id: row.id, taskKind, pipeline: od.pipeline };
        const existing = byTaskKind.get(taskKind);
        if (!existing || entry.id === `od-${taskKind}`) {
          byTaskKind.set(taskKind, entry);
        }
      }
    } catch {
      return [];
    }
    return Array.from(byTaskKind.values());
  }

  async function configuredProjectLocations() {
    const config = await readAppConfig(ctx.paths.RUNTIME_DATA_DIR);
    const all = allProjectLocations(PROJECTS_DIR, config.projectLocations);
    const valid = all[0] ? [all[0]] : [];
    for (const location of all.slice(1)) {
      const validated = validateLinkedDirs([location.path]);
      if (validated.error) continue;
      const canonical = validated.dirs[0];
      if (!canonical) continue;
      if (locationOverlapsDaemonData(canonical)) continue;
      valid.push({ ...location, path: canonical });
    }
    return valid;
  }

  function locationOverlapsDaemonData(locationPath: string): boolean {
    const runtimeDir = ctx.paths.RUNTIME_DATA_DIR_CANONICAL || ctx.paths.RUNTIME_DATA_DIR;
    const projectsDir = path.join(runtimeDir, 'projects');
    const relativeToRuntime = pathRelative(runtimeDir, locationPath);
    const runtimeInsideLocation = pathRelative(locationPath, runtimeDir);
    const relativeToProjects = pathRelative(projectsDir, locationPath);
    const projectsInsideLocation = pathRelative(locationPath, projectsDir);
    return isInsideOrSame(relativeToRuntime) || isInsideOrSame(runtimeInsideLocation)
      || isInsideOrSame(relativeToProjects) || isInsideOrSame(projectsInsideLocation);
  }

  function pathRelative(from: string, to: string): string {
    return path.relative(from, to);
  }

  function isInsideOrSame(relative: string): boolean {
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }

  function projectBelongsToLocation(project: any, location: { id: string; path: string }): boolean {
    const metadata = project?.metadata;
    if (typeof metadata?.baseDir !== 'string') return metadata?.projectLocationId === location.id;
    const relative = path.relative(location.path, metadata.baseDir);
    return isInsideOrSame(relative) && relative !== '';
  }

  function isProjectLocationProject(project: any): boolean {
    const metadata = project?.metadata;
    return metadata?.importedFrom === 'project-location'
      || typeof metadata?.projectLocationId === 'string';
  }

  function projectVisibleForLocations(
    project: any,
    locations: Array<{ id: string; path: string; builtIn?: boolean }>,
  ): boolean {
    if (!isProjectLocationProject(project)) return true;
    return locations.some((location) => !location.builtIn && projectBelongsToLocation(project, location));
  }

  async function resolveCreateProjectLocationId(explicitProjectLocationId: unknown): Promise<string> {
    if (typeof explicitProjectLocationId === 'string' && explicitProjectLocationId.trim()) {
      return explicitProjectLocationId.trim();
    }
    const config = await readAppConfig(ctx.paths.RUNTIME_DATA_DIR);
    const configuredDefault = typeof config.defaultProjectLocationId === 'string'
      ? config.defaultProjectLocationId.trim()
      : '';
    if (!configuredDefault || configuredDefault === BUILT_IN_PROJECT_LOCATION_ID) {
      return BUILT_IN_PROJECT_LOCATION_ID;
    }
    const locations = await configuredProjectLocations();
    return locations.some((location) => !location.builtIn && location.id === configuredDefault)
      ? configuredDefault
      : BUILT_IN_PROJECT_LOCATION_ID;
  }

  function unregisterProjectsForRemovedLocations(
    previousLocations: Array<{ id: string; path: string; builtIn?: boolean }>,
    nextLocations: Array<{ id?: string; path: string }>,
  ): string[] {
    const nextIds = new Set(nextLocations.map((location) => location.id).filter(Boolean));
    const nextPaths = new Set(nextLocations.map((location) => location.path));
    const removed = previousLocations.filter(
      (location) => !location.builtIn && !nextIds.has(location.id) && !nextPaths.has(location.path),
    );
    if (removed.length === 0) return [];
    return listProjects(db)
      .filter((project: any) => removed.some((location) => projectBelongsToLocation(project, location)))
      .map((project: any) => project.id);
  }

  app.get('/api/project-locations', async (_req, res) => {
    try {
      const locations = await configuredProjectLocations();
      /** @type {import('@open-design/contracts').ProjectLocationsResponse} */
      const body = { locations };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err));
    }
  });

  app.put('/api/project-locations', async (req, res) => {
    try {
      const requested = Array.isArray(req.body?.locations) ? req.body.locations : null;
      if (!requested) return sendApiError(res, 400, 'BAD_REQUEST', 'locations must be an array');
      const previousLocations = await configuredProjectLocations();
      const prepared = [];
      for (const loc of requested) {
        if (!loc || typeof loc !== 'object' || typeof loc.path !== 'string') continue;
        const canonicalPath = await ensureProjectLocation(loc.path);
        const validated = validateLinkedDirs([canonicalPath]);
        if (validated.error) return sendApiError(res, 400, 'BAD_REQUEST', validated.error);
        if (locationOverlapsDaemonData(canonicalPath)) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'project location cannot overlap daemon data');
        }
        prepared.push({
          id: typeof loc.id === 'string' ? loc.id : undefined,
          name: typeof loc.name === 'string' ? loc.name : undefined,
          path: canonicalPath,
        });
      }
      const config = await writeAppConfig(ctx.paths.RUNTIME_DATA_DIR, { projectLocations: prepared });
      const locations = allProjectLocations(PROJECTS_DIR, config.projectLocations);
      const removedProjectIds = unregisterProjectsForRemovedLocations(previousLocations, config.projectLocations ?? []);
      /** @type {import('@open-design/contracts').ProjectLocationsResponse} */
      const body = { locations, removedProjectIds };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.post('/api/project-locations/scan', async (_req, res) => {
    try {
      const locations = (await configuredProjectLocations()).filter((loc: any) => !loc.builtIn);
      const imported = [];
      const existing: string[] = [];
      const skipped: Array<{ path: string; reason: string }> = [];
      let scanned = 0;
      const now = Date.now();
      for (const location of locations) {
        let found;
        try {
          found = await scanProjectLocation(location);
        } catch (err: any) {
          skipped.push({ path: location.path, reason: String(err?.message ?? err) });
          continue;
        }
        scanned += found.length;
        for (const entry of found) {
          const { manifest } = entry;
          if (getProject(db, manifest.id)) {
            existing.push(manifest.id);
            continue;
          }
          try {
            const project = insertProject(db, {
              id: manifest.id,
              name: manifest.name,
              skillId: manifest.skillId ?? null,
              designSystemId: manifest.designSystemId ?? null,
              pendingPrompt: null,
              metadata: {
                kind: 'prototype',
                baseDir: entry.dir,
                importedFrom: 'project-location',
                projectLocationId: location.id,
              },
              customInstructions: null,
              createdAt: manifest.createdAt,
              updatedAt: manifest.updatedAt,
            });
            insertConversation(db, {
              id: randomId(),
              projectId: manifest.id,
              title: null,
              createdAt: now,
              updatedAt: now,
            });
            if (project) imported.push(project);
          } catch (err: any) {
            skipped.push({ path: entry.dir, reason: String(err?.message ?? err) });
          }
        }
      }
      /** @type {import('@open-design/contracts').ScanProjectLocationsResponse} */
      const body = { scanned, imported, existing, skipped };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.get('/api/projects', async (_req, res) => {
    try {
      const locations = await configuredProjectLocations();
      const latestRunStatuses = listLatestProjectRunStatuses(db);
      const awaitingInputProjects = listProjectsAwaitingInput(db);
      const activeRunStatuses = new Map();
      for (const run of design.runs.list()) {
        if (!run.projectId) continue;
        const runStatus = projectStatusFromRun(run);
        if (design.runs.isTerminal(run.status)) {
          const existing = latestRunStatuses.get(run.projectId);
          if (!existing || run.updatedAt > (existing.updatedAt ?? 0)) {
            latestRunStatuses.set(run.projectId, runStatus);
          }
        } else {
          const existing = activeRunStatuses.get(run.projectId);
          if (!existing || run.updatedAt > (existing.updatedAt ?? 0)) {
            activeRunStatuses.set(run.projectId, runStatus);
          }
        }
      }
      /** @type {import('@open-design/contracts').ProjectsResponse} */
      const body = {
        projects: listProjects(db)
          .filter((project: any) => projectVisibleForLocations(project, locations))
          .map((project: any) => ({
            ...project,
            status: composeProjectDisplayStatus(
              activeRunStatuses.get(project.id) ??
              latestRunStatuses.get(project.id) ?? { value: 'not_started' },
              awaitingInputProjects,
              project.id,
            ),
            npmInstallStatus: npmInstallStatuses.get(project.id) ?? 'idle',
            npmInstallMessage: npmInstallMessages.get(project.id) ?? '',
          })),
      };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err));
    }
  });

  function projectStatusFromRun(run: any) {
    return {
      value: normalizeProjectDisplayStatus(run.status),
      updatedAt: run.updatedAt,
      runId: run.id,
    };
  }

  app.post('/api/projects', async (req, res) => {
    try {
      const { id, name, projectLocationId, skillId, designSystemId, pendingPrompt, metadata, customInstructions, skipDiscoveryBrief } =
        req.body || {};
      if (typeof id !== 'string' || !isSafeId(id)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'invalid project id');
      }
      if (typeof name !== 'string' || !name.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'name required');
      }
      // baseDir is privileged: it lets a project root directly inside the
      // user's filesystem. The /api/import/folder endpoint is the only
      // path that's allowed to set it, because that's where realpath() +
      // RUNTIME_DATA_DIR reentry checks live. Block client-supplied
      // metadata.baseDir on this generic create endpoint so an attacker
      // can't smuggle e.g. /etc through here. Same rule for
      // originalBaseDir / importedFrom='folder' — only the import path
      // owns those state fields.
      if (metadata && typeof metadata === 'object') {
        if ('baseDir' in metadata) {
          return sendApiError(
            res, 400, 'BAD_REQUEST',
            'baseDir can only be set via POST /api/import/folder',
          );
        }
        if ('fromTrustedPicker' in metadata) {
          return sendApiError(
            res, 400, 'BAD_REQUEST',
            'fromTrustedPicker can only be set via POST /api/import/folder',
          );
        }
      }
      if (customInstructions !== undefined
        && typeof customInstructions !== 'string'
        && customInstructions !== null) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'customInstructions must be a string or null');
      }
      if (typeof customInstructions === 'string' && customInstructions.length > 5000) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'customInstructions exceeds 5 000 character limit');
      }
      if (skipDiscoveryBrief !== undefined && typeof skipDiscoveryBrief !== 'boolean') {
        return sendApiError(res, 400, 'BAD_REQUEST', 'skipDiscoveryBrief must be a boolean');
      }
      const designSystemValidation = await validateProjectDesignSystemId(designSystemId);
      if (!designSystemValidation.ok) {
        return sendApiError(
          res,
          400,
          designSystemValidation.code,
          designSystemValidation.message,
        );
      }
      const normalizedDesignSystemId = designSystemValidation.id;
      const skillValidation = await validateProjectSkillId(skillId);
      if (!skillValidation.ok) {
        return sendApiError(res, 400, skillValidation.code, skillValidation.message);
      }
      const normalizedSkillId = skillValidation.id;
      const selectedLocationId = await resolveCreateProjectLocationId(projectLocationId);
      let externalProjectDir: string | null = null;
      if (selectedLocationId !== BUILT_IN_PROJECT_LOCATION_ID) {
        const location = (await configuredProjectLocations()).find((loc: any) => loc.id === selectedLocationId);
        if (!location || location.builtIn) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'unknown project location');
        }
        if (getProject(db, id)) {
          return sendApiError(res, 400, 'BAD_REQUEST', 'project id already exists');
        }
        try {
          externalProjectDir = await createLocationProjectDir(location, id);
        } catch (err: any) {
          if (err && (err.code === 'EEXIST' || err.code === 'EADDRINUSE')) {
            return sendApiError(res, 400, 'BAD_REQUEST', 'project directory already exists');
          }
          throw err;
        }
      }
      const projectMetadata =
        metadata && typeof metadata === 'object'
          ? {
            ...metadata,
            ...(skipDiscoveryBrief === true ? { skipDiscoveryBrief: true } : {}),
            ...(externalProjectDir
              ? {
                baseDir: externalProjectDir,
                importedFrom: 'project-location',
                projectLocationId: selectedLocationId,
              }
              : {}),
            ...(Array.isArray(metadata.linkedDirs)
              ? (() => {
                const v = validateLinkedDirs(metadata.linkedDirs);
                return v.error ? {} : { linkedDirs: v.dirs };
              })()
              : {}),
          }
          : skipDiscoveryBrief === true
            ? {
              skipDiscoveryBrief: true,
              ...(externalProjectDir
                ? {
                  baseDir: externalProjectDir,
                  importedFrom: 'project-location',
                  projectLocationId: selectedLocationId,
                }
                : {}),
            }
            : externalProjectDir
              ? {
                kind: 'prototype',
                baseDir: externalProjectDir,
                importedFrom: 'project-location',
                projectLocationId: selectedLocationId,
              }
              : null;
      const now = Date.now();
      let project;
      try {
        if (externalProjectDir) {
          await writeProjectManifest(externalProjectDir, {
            schemaVersion: 1,
            id,
            name: name.trim(),
            createdAt: now,
            updatedAt: now,
            skillId: normalizedSkillId,
            designSystemId: normalizedDesignSystemId,
          });
        }
        project = insertProject(db, {
          id,
          name: name.trim(),
          skillId: normalizedSkillId,
          designSystemId: normalizedDesignSystemId,
          pendingPrompt: pendingPrompt || null,
          metadata: projectMetadata,
          customInstructions:
            typeof customInstructions === 'string'
              ? customInstructions
              : null,
          createdAt: now,
          updatedAt: now,
        });

        const kind = projectMetadata?.kind;
        if (kind === 'prototype' || kind === 'deck' || kind === 'other' || kind === 'template') {
          try {
            const projectDir = await ensureProject(PROJECTS_DIR, id, projectMetadata);

            let isPublishedDesignSystem = false;
            let publishedPackages: string[] = [];

            if (normalizedDesignSystemId) {
              const dirId = normalizedDesignSystemId.startsWith('user:')
                ? normalizedDesignSystemId.slice('user:'.length)
                : normalizedDesignSystemId;
              const brandRoot = path.join(
                normalizedDesignSystemId.startsWith('user:') ? USER_DESIGN_SYSTEMS_DIR : DESIGN_SYSTEMS_DIR,
                dirId
              );

              let status = 'draft';
              try {
                const rawMeta = await readFile(path.join(brandRoot, 'metadata.json'), 'utf8');
                const parsedMeta = JSON.parse(rawMeta);
                if (parsedMeta && typeof parsedMeta.status === 'string') {
                  status = parsedMeta.status;
                }
              } catch { }

              if (status === 'published') {
                isPublishedDesignSystem = true;
                const info = normalizedDesignSystemId.startsWith('user:')
                  ? await readDesignSystemPackageInfo(USER_DESIGN_SYSTEMS_DIR, normalizedDesignSystemId, { idPrefix: 'user:' })
                  : await readDesignSystemPackageInfo(DESIGN_SYSTEMS_DIR, normalizedDesignSystemId);

                if (info && info.manifest && info.manifest.npmPackages && Array.isArray(info.manifest.npmPackages)) {
                  publishedPackages = info.manifest.npmPackages.map((pkg: any) => pkg.name);
                }
              }
            }

            const designSystemPackages = await resolveDesignSystemNpmPackages(
              normalizedDesignSystemId,
              DESIGN_SYSTEMS_DIR,
              USER_DESIGN_SYSTEMS_DIR,
            );
            await initializeReactViteProject(
              projectDir,
              name.trim(),
              designSystemPackages,
              isPublishedDesignSystem,
              publishedPackages,
              !(await getGitHubToken(ctx.paths.RUNTIME_DATA_DIR))
            );
          } catch (initErr) {
            console.error(`[project-routes] Failed to initialize React Vite project:`, initErr);
          }
        }
      } catch (err) {
        if (externalProjectDir) {
          await rm(externalProjectDir, { recursive: true, force: true }).catch(() => { });
        }
        throw err;
      }
      // Seed a default conversation so the UI always has somewhere to write.
      const cid = randomId();
      const initialSessionMode = normalizeChatSessionMode(
        req.body?.conversationMode ?? req.body?.sessionMode,
      );
      insertConversation(db, {
        id: cid,
        projectId: id,
        title: null,
        sessionMode: initialSessionMode,
        createdAt: now,
        updatedAt: now,
      });
      const explicitPlugin =
        typeof req.body?.pluginId === 'string' && req.body.pluginId.trim().length > 0
          ? true
          : typeof req.body?.appliedPluginSnapshotId === 'string'
          && req.body.appliedPluginSnapshotId.trim().length > 0;
      let resolveBody =
        explicitPlugin ? (req.body as Record<string, unknown>) : null;
      if (!resolveBody && initialSessionMode === 'design') {
        const fallbackPluginId = defaultScenarioPluginIdForProjectMetadata(projectMetadata);
        if (fallbackPluginId && getInstalledPlugin(db, fallbackPluginId)) {
          resolveBody = { ...(req.body || {}), pluginId: fallbackPluginId };
        }
      }
      let resolvedSnapshot = null;
      if (resolveBody) {
        const registry = await loadPluginRegistryView();
        const resolved = resolvePluginSnapshot({
          db,
          body: resolveBody,
          projectId: id,
          conversationId: cid,
          registry,
          activeProjectDesignSystem:
            typeof normalizedDesignSystemId === 'string' && normalizedDesignSystemId.length > 0
              ? { id: normalizedDesignSystemId }
              : undefined,
          connectorProbe: buildConnectorProbe(connectorService),
        });
        if (resolved && !resolved.ok) {
          if (!explicitPlugin) {
            console.warn(
              `[plugins] default-scenario fallback skipped for project ${id}: ${resolved.body?.error?.code ?? 'unknown'}`,
            );
          } else {
            return res.status(resolved.status).json(resolved.body);
          }
        } else {
          resolvedSnapshot = resolved;
        }
      }
      // For "from template" projects, seed the chosen template's snapshot
      // HTML into the new project folder so the agent can Read/edit files
      // on disk (the system prompt also embeds them, but a real on-disk
      // copy lets the agent treat them as the project's working state).
      if (
        metadata &&
        typeof metadata === 'object' &&
        metadata.kind === 'template' &&
        typeof metadata.templateId === 'string'
      ) {
        const tpl = getTemplate(db, metadata.templateId);
        if (tpl && Array.isArray(tpl.files) && tpl.files.length > 0) {
          await ensureProject(PROJECTS_DIR, id, projectMetadata);
          for (const f of tpl.files) {
            if (
              !f ||
              typeof f.name !== 'string' ||
              typeof f.content !== 'string'
            ) {
              continue;
            }
            try {
              await writeProjectFile(
                PROJECTS_DIR,
                id,
                f.name,
                Buffer.from(f.content, 'utf8'),
                {},
                projectMetadata,
              );
            } catch {
              // Skip individual file failures — the template snapshot is
              // best-effort; the agent still has the embedded copy.
            }
          }
        }
      }
      /** @type {import('@open-design/contracts').CreateProjectResponse} */
      const body = {
        project: resolvedSnapshot?.ok ? getProject(db, id) ?? project : project,
        conversationId: cid,
        ...(resolvedSnapshot?.ok
          ? { appliedPluginSnapshotId: resolvedSnapshot.snapshotId }
          : {}),
      };
      res.json(body);
    } catch (err: any) {
      console.error(
        `[project-routes] Error in POST /api/projects for project id: ${req.body?.id}, designSystemId: ${req.body?.designSystemId}:`,
        err
      );
      sendApiError(
        res,
        500,
        'INTERNAL_SERVER_ERROR',
        err instanceof Error ? err.message : String(err)
      );
    }
  });

  app.get('/api/projects/:id', async (req, res) => {
    const project = getProject(db, req.params.id);
    const locations = await configuredProjectLocations();
    if (!project || !projectVisibleForLocations(project, locations))
      return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
    const resolvedDir = projectDetailResolvedDir(PROJECTS_DIR, project, resolveProjectDir);
    const devServerUrl = getDevServerUrl(resolvedDir);
    /** @type {import('@open-design/contracts').ProjectResponse} */
    const body = {
      project: {
        ...project,
        ...(devServerUrl ? { devServerUrl } : {}),
        npmInstallStatus: npmInstallStatuses.get(req.params.id) ?? 'idle',
        npmInstallMessage: npmInstallMessages.get(req.params.id) ?? '',
      },
      resolvedDir,
    };
    res.json(body);
  });

  app.patch('/api/projects/:id', async (req, res) => {
    try {
      const patch = req.body || {};
      // baseDir / folder-import state is privileged: it's set only by the
      // import endpoint and otherwise immutable. Two failure modes to
      // guard against here:
      //   1. Explicit attempt to change baseDir → reject with 400.
      //   2. A regular metadata patch that *omits* baseDir (e.g. a UI
      //      that only edits linkedDirs sends `{ metadata: { kind, linkedDirs } }`).
      //      updateProject() replaces metadata wholesale, so without
      //      preservation the existing baseDir gets wiped and the project
      //      detaches from the user's folder — subsequent reads/writes
      //      silently fall back to .od/projects/<id>.
      // For case 2 we re-stamp the immutable fields from the existing
      // project record onto the incoming patch so the user can keep
      // patching other metadata without ever losing their import root.
      if (patch.metadata && typeof patch.metadata === 'object') {
        const existing = getProject(db, req.params.id);
        const existingMeta = existing?.metadata;
        if ('fromTrustedPicker' in patch.metadata
          && patch.metadata.fromTrustedPicker !== existingMeta?.fromTrustedPicker) {
          return sendApiError(
            res, 400, 'BAD_REQUEST',
            'fromTrustedPicker can only be set via POST /api/import/folder',
          );
        }
        if (existingMeta?.baseDir) {
          if ('baseDir' in patch.metadata && patch.metadata.baseDir !== existingMeta.baseDir) {
            return sendApiError(
              res, 400, 'BAD_REQUEST',
              'baseDir is immutable after import; use a new import to change it',
            );
          }
          patch.metadata = {
            ...patch.metadata,
            baseDir: existingMeta.baseDir,
            ...(existingMeta.importedFrom === 'folder'
              ? { importedFrom: 'folder' }
              : {}),
            ...(existingMeta.importedFrom === 'project-location'
              ? { importedFrom: 'project-location' }
              : {}),
            ...(typeof existingMeta.projectLocationId === 'string'
              ? { projectLocationId: existingMeta.projectLocationId }
              : {}),
            ...(existingMeta.fromTrustedPicker === true
              ? { fromTrustedPicker: true as const }
              : {}),
          };
        } else if ('baseDir' in patch.metadata) {
          // Non-imported project trying to acquire a baseDir → reject (only
          // /api/import/folder can set it).
          return sendApiError(
            res, 400, 'BAD_REQUEST',
            'baseDir can only be set via POST /api/import/folder',
          );
        }
      }
      if (patch.metadata?.linkedDirs) {
        const existing = getProject(db, req.params.id);
        const validated = validateLinkedDirs(patch.metadata.linkedDirs);
        if (validated.error) {
          return sendApiError(res, 400, 'INVALID_LINKED_DIR', validated.error);
        }
        patch.metadata.linkedDirs =
          existing?.metadata?.fromTrustedPicker === true
            ? patch.metadata.linkedDirs
            : validated.dirs;
      }
      if (patch.customInstructions !== undefined
        && typeof patch.customInstructions !== 'string'
        && patch.customInstructions !== null) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'customInstructions must be a string or null');
      }
      if (typeof patch.customInstructions === 'string' && patch.customInstructions.length > 5000) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'customInstructions exceeds 5 000 character limit');
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'designSystemId')) {
        const designSystemValidation = await validateProjectDesignSystemId(patch.designSystemId);
        if (!designSystemValidation.ok) {
          return sendApiError(
            res,
            400,
            designSystemValidation.code,
            designSystemValidation.message,
          );
        }
        patch.designSystemId = designSystemValidation.id;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'skillId')) {
        const skillValidation = await validateProjectSkillId(patch.skillId);
        if (!skillValidation.ok) {
          return sendApiError(res, 400, skillValidation.code, skillValidation.message);
        }
        patch.skillId = skillValidation.id;
      }
      const project = updateProject(db, req.params.id, patch);
      if (!project)
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
      const resolvedDir = projectDetailResolvedDir(PROJECTS_DIR, project, resolveProjectDir);
      const devServerUrl = getDevServerUrl(resolvedDir);
      /** @type {import('@open-design/contracts').ProjectResponse} */
      const body = { project: { ...project, ...(devServerUrl ? { devServerUrl } : {}) } };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.delete('/api/projects/:id', async (req, res) => {
    try {
      dbDeleteProject(db, req.params.id);
      await removeProjectDir(PROJECTS_DIR, req.params.id).catch(() => { });
      /** @type {import('@open-design/contracts').OkResponse} */
      const body = { ok: true };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.post('/api/projects/:id/dev-server', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      if (project) {
        const resolvedDir = projectDetailResolvedDir(PROJECTS_DIR, project, resolveProjectDir);
        await startDevScript(resolvedDir);
      }
      res.json({ ok: true });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_SERVER_ERROR', String(err));
    }
  });

  app.delete('/api/projects/:id/dev-server', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      if (project) {
        const resolvedDir = projectDetailResolvedDir(PROJECTS_DIR, project, resolveProjectDir);
        await stopDevScript(resolvedDir);
      }
      res.json({ ok: true });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_SERVER_ERROR', String(err));
    }
  });

  // SSE stream of file-changed events for a project. Drives preview live-reload.
  // Receipt of a `file-changed` event triggers a file-list refresh, which
  // propagates new mtimes through to FileViewer iframes (the URL-load
  // `?v=${mtime}` cache-bust from PR #384 then reloads the iframe automatically).
  // Subscribers come and go as users open/close project tabs; the underlying
  // chokidar watcher is refcounted in project-watchers.ts so we never hold
  // descriptors for projects no UI is looking at.
  app.get('/api/projects/:id/events', (req, res) => {
    if (!getProject(db, req.params.id)) {
      return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
    }
    let sub: any;
    try {
      const sse = createSseResponse(res);
      const projectEventSink = (payload: any) => {
        sse.send(payload.type, payload);
      };
      let sinks = activeProjectEventSinks.get(req.params.id);
      if (!sinks) {
        sinks = new Set();
        activeProjectEventSinks.set(req.params.id, sinks);
      }
      sinks.add(projectEventSink);
      const watchProject = getProject(db, req.params.id);

      // Trigger dependency installation when the project is opened (events connection established)
      const projectMetadata = watchProject?.metadata;
      const kind = projectMetadata?.kind;
      if (kind === 'prototype' || kind === 'deck' || kind === 'other' || kind === 'template') {
        const currentStatus = npmInstallStatuses.get(req.params.id);
        const hasActiveProc = activeInstallProcesses.has(req.params.id);
        if (currentStatus !== 'completed' && !hasActiveProc) {
          const resolvedDir = projectDetailResolvedDir(PROJECTS_DIR, watchProject, resolveProjectDir);
          installDependencies(req.params.id, resolvedDir, activeProjectEventSinks);
        } else if (currentStatus) {
          // Send current status/message immediately to this connection
          sse.send('npm-install-status', {
            type: 'npm-install-status',
            status: currentStatus,
            message: npmInstallMessages.get(req.params.id) || '',
            projectId: req.params.id,
          });
          // Replay accumulated log lines so the client's log panel is filled in
          const historicLogs = npmInstallLogs.get(req.params.id) ?? [];
          for (const line of historicLogs) {
            sse.send('npm-install-log', { type: 'npm-install-log', line, projectId: req.params.id });
          }
        }
      }

      sub = subscribeFileEvents(PROJECTS_DIR, req.params.id, (evt: any) => {
        sse.send('file-changed', evt);
      }, { metadata: watchProject?.metadata });
      sub.ready.then(() => sse.send('ready', { projectId: req.params.id })).catch(() => { });
      const cleanup = () => {
        if (sub) {
          const { unsubscribe } = sub;
          sub = null;
          Promise.resolve(unsubscribe()).catch(() => { });
        }
        const currentSinks = activeProjectEventSinks.get(req.params.id);
        currentSinks?.delete(projectEventSink);
        if (currentSinks?.size === 0) {
          activeProjectEventSinks.delete(req.params.id);

          // Terminate active install process when last UI is disposed
          const activeProc = activeInstallProcesses.get(req.params.id);
          if (activeProc) {
            console.log(`[project-routes] Terminating install process for project ${req.params.id} due to UI disposal`);
            activeInstallProcesses.delete(req.params.id);
            if (activeProc.pid) {
              try {
                process.kill(-activeProc.pid, 'SIGTERM');
              } catch (err) {
                activeProc.kill('SIGTERM');
              }
            } else {
              activeProc.kill('SIGTERM');
            }
            npmInstallStatuses.set(req.params.id, 'failed');
            npmInstallMessages.set(req.params.id, 'Installation terminated (workspace closed)');
          }
        }
      };
      res.on('close', cleanup);
      res.on('finish', cleanup);
    } catch (err: any) {
      if (sub) Promise.resolve(sub.unsubscribe()).catch(() => { });
      if (!res.headersSent) sendApiError(res, 400, 'BAD_REQUEST', String(err?.message || err));
    }
  });

  // ---- Conversations --------------------------------------------------------

  app.get('/api/projects/:id/conversations', (req, res) => {
    if (!getProject(db, req.params.id)) {
      return res.status(404).json({ error: 'project not found' });
    }
    res.json({ conversations: listConversations(db, req.params.id) });
  });

  app.post('/api/projects/:id/conversations', (req, res) => {
    if (!getProject(db, req.params.id)) {
      return res.status(404).json({ error: 'project not found' });
    }
    const { title, seedFromConversationId, forkAfterMessageId } = req.body || {};
    const now = Date.now();
    const hasExplicitSessionMode = Boolean(
      req.body && Object.prototype.hasOwnProperty.call(req.body, 'sessionMode'),
    );
    const requestedForkMessageId =
      typeof forkAfterMessageId === 'string' && forkAfterMessageId
        ? forkAfterMessageId
        : null;
    const sourceConversation =
      typeof seedFromConversationId === 'string' && seedFromConversationId
        ? getConversation(db, seedFromConversationId)
        : null;
    // Client-supplied fork snapshot. The chat "Fork" action sends the exact
    // messages the user is looking at (up to the fork point). We prefer it over
    // reading the source conversation from the DB so a fork point that was
    // never persisted — e.g. an assistant turn whose run errored / had its
    // connection reset before reaching the database — still forks instead of
    // 404ing on `forkAfterMessageId`.
    const clientSeedMessages = Array.isArray(req.body?.seedMessages)
      ? (req.body.seedMessages as any[]).filter(
        (message) => message && typeof message.role === 'string',
      )
      : null;
    let seedMessages: any[] = [];
    if (clientSeedMessages && clientSeedMessages.length > 0) {
      seedMessages = clientSeedMessages;
      if (requestedForkMessageId) {
        const forkIndex = seedMessages.findIndex(
          (message) => message.id === requestedForkMessageId,
        );
        if (forkIndex >= 0) {
          seedMessages = seedMessages.slice(0, forkIndex + 1);
        }
      }
    } else if (sourceConversation && sourceConversation.projectId === req.params.id) {
      seedMessages = listMessages(db, seedFromConversationId);
      if (requestedForkMessageId) {
        const forkIndex = seedMessages.findIndex((message) => message.id === requestedForkMessageId);
        if (forkIndex < 0) {
          return res.status(404).json({ error: 'fork message not found' });
        }
        seedMessages = seedMessages.slice(0, forkIndex + 1);
      }
    } else if (requestedForkMessageId) {
      return res.status(404).json({ error: 'fork source conversation not found' });
    }
    const sessionMode =
      hasExplicitSessionMode
        ? normalizeChatSessionMode(req.body.sessionMode)
        : sourceConversation && sourceConversation.projectId === req.params.id
          ? normalizeChatSessionMode(sourceConversation.sessionMode)
          : 'design';
    const conv = insertConversation(db, {
      id: randomId(),
      projectId: req.params.id,
      title: typeof title === 'string' ? title.trim() || null : null,
      sessionMode,
      createdAt: now,
      updatedAt: now,
    });
    // Side Chat: inherit the source conversation's context by copying its
    // messages into the fresh conversation. Be defensive — a missing or
    // cross-project source id silently yields an empty conversation.
    if (conv && seedMessages.length > 0) {
      for (const m of seedMessages) {
        // Fresh id per copied message; upsertMessage assigns the next
        // position so role/content ordering is preserved. Drop the source's
        // run pointers (runId/runStatus/lastRunEventId): they belong to the
        // OTHER conversation's runs, and a copied still-`running` assistant
        // turn would otherwise render a perpetual spinner in the side chat.
        upsertMessage(db, conv.id, {
          ...m,
          id: randomId(),
          runId: undefined,
          runStatus: undefined,
          lastRunEventId: undefined,
        });
      }
    }
    res.json({ conversation: conv });
  });

  app.patch('/api/projects/:id/conversations/:cid', (req, res) => {
    const conv = getConversation(db, req.params.cid);
    if (!conv || conv.projectId !== req.params.id) {
      return res.status(404).json({ error: 'not found' });
    }
    const updated = updateConversation(db, req.params.cid, req.body || {});
    res.json({ conversation: updated });
  });

  app.delete('/api/projects/:id/conversations/:cid', (req, res) => {
    const conv = getConversation(db, req.params.cid);
    if (!conv || conv.projectId !== req.params.id) {
      return res.status(404).json({ error: 'not found' });
    }
    deleteConversation(db, req.params.cid);
    res.json({ ok: true });
  });

  // ---- Messages -------------------------------------------------------------

  app.get('/api/projects/:id/conversations/:cid/messages', (req, res) => {
    const conv = getConversation(db, req.params.cid);
    if (!conv || conv.projectId !== req.params.id) {
      return res.status(404).json({ error: 'conversation not found' });
    }
    res.json({ messages: listMessages(db, req.params.cid) });
  });

  app.put('/api/projects/:id/conversations/:cid/messages/:mid', (req, res) => {
    const conv = getConversation(db, req.params.cid);
    if (!conv || conv.projectId !== req.params.id) {
      return res.status(404).json({ error: 'conversation not found' });
    }
    const m = req.body || {};
    if (m.id && m.id !== req.params.mid) {
      return res.status(400).json({ error: 'id mismatch' });
    }
    const saved = upsertMessage(db, req.params.cid, {
      ...m,
      id: req.params.mid,
    });
    // Bump the parent project's updatedAt so the project list re-orders.
    updateProject(db, req.params.id, {});
    ctx.telemetry?.reportFinalizedMessage(saved, m);
    res.json({ message: saved });
  });

  // ---- Preview comments ----------------------------------------------------

  app.get('/api/projects/:id/conversations/:cid/comments', (req, res) => {
    const conv = getConversation(db, req.params.cid);
    if (!conv || conv.projectId !== req.params.id) {
      return res.status(404).json({ error: 'conversation not found' });
    }
    res.json({
      comments: listPreviewComments(db, req.params.id, req.params.cid),
    });
  });

  app.post('/api/projects/:id/conversations/:cid/comments', (req, res) => {
    const conv = getConversation(db, req.params.cid);
    if (!conv || conv.projectId !== req.params.id) {
      return res.status(404).json({ error: 'conversation not found' });
    }
    try {
      const comment = upsertPreviewComment(
        db,
        req.params.id,
        req.params.cid,
        req.body || {},
      );
      updateProject(db, req.params.id, {});
      res.json({ comment });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message || err) });
    }
  });

  app.patch(
    '/api/projects/:id/conversations/:cid/comments/:commentId',
    (req, res) => {
      const conv = getConversation(db, req.params.cid);
      if (!conv || conv.projectId !== req.params.id) {
        return res.status(404).json({ error: 'conversation not found' });
      }
      try {
        const comment = updatePreviewCommentStatus(
          db,
          req.params.id,
          req.params.cid,
          req.params.commentId,
          req.body?.status,
        );
        if (!comment)
          return res.status(404).json({ error: 'comment not found' });
        updateProject(db, req.params.id, {});
        res.json({ comment });
      } catch (err: any) {
        res.status(400).json({ error: String(err?.message || err) });
      }
    },
  );

  app.delete(
    '/api/projects/:id/conversations/:cid/comments/:commentId',
    (req, res) => {
      const conv = getConversation(db, req.params.cid);
      if (!conv || conv.projectId !== req.params.id) {
        return res.status(404).json({ error: 'conversation not found' });
      }
      const ok = deletePreviewComment(
        db,
        req.params.id,
        req.params.cid,
        req.params.commentId,
      );
      if (!ok) return res.status(404).json({ error: 'comment not found' });
      updateProject(db, req.params.id, {});
      res.json({ ok: true });
    },
  );

  // ---- Tabs -----------------------------------------------------------------

  app.get('/api/projects/:id/tabs', (req, res) => {
    if (!getProject(db, req.params.id)) {
      return res.status(404).json({ error: 'project not found' });
    }
    res.json(listTabs(db, req.params.id));
  });

  app.put('/api/projects/:id/tabs', (req, res) => {
    if (!getProject(db, req.params.id)) {
      return res.status(404).json({ error: 'project not found' });
    }
    const { tabs = [], active = null, browserTabs = [] } = req.body || {};
    if (!Array.isArray(tabs) || !tabs.every((t) => typeof t === 'string')) {
      return res.status(400).json({ error: 'tabs must be string[]' });
    }
    if (!Array.isArray(browserTabs)) {
      return res.status(400).json({ error: 'browserTabs must be an array' });
    }
    const result = setTabs(
      db,
      req.params.id,
      {
        tabs,
        active: typeof active === 'string' ? active : null,
        browserTabs,
      },
    );
    res.json(result);
  });

  // ---- Templates ----------------------------------------------------------
  // User-saved snapshots of a project's HTML files. Surfaced in the
  // "From template" tab of the new-project panel so a user can spin up
  // a fresh project pre-seeded with another project's design as a
  // starting point. Created via the project's Share menu (snapshots
  // every .html file in the project folder at the moment of save).

  app.get('/api/templates', (_req, res) => {
    res.json({ templates: listTemplates(db) });
  });

  app.get('/api/templates/:id', (req, res) => {
    const t = getTemplate(db, req.params.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    res.json({ template: t });
  });

  app.post('/api/templates', async (req, res) => {
    try {
      const { name, description, sourceProjectId } = req.body || {};
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'name required' });
      }
      if (name.length > 100) {
        return res.status(400).json({ error: 'name must be 100 characters or fewer' });
      }
      if (typeof sourceProjectId !== 'string') {
        return res.status(400).json({ error: 'sourceProjectId required' });
      }
      const sourceProject = getProject(db, sourceProjectId);
      if (!sourceProject) {
        return res.status(404).json({ error: 'source project not found' });
      }
      // Snapshot every HTML / sketch / text file in the source project.
      // We deliberately skip binary uploads — templates are about the
      // generated design, not the user's reference imagery.
      const files = await listFiles(PROJECTS_DIR, sourceProjectId, {
        metadata: sourceProject.metadata,
      });
      const snapshot = [];
      for (const f of files) {
        if (f.kind !== 'html' && f.kind !== 'text' && f.kind !== 'code')
          continue;
        const entry = await readProjectFile(
          PROJECTS_DIR,
          sourceProjectId,
          f.name,
          sourceProject.metadata,
        );
        if (entry && Buffer.isBuffer(entry.buffer)) {
          snapshot.push({
            name: f.name,
            content: entry.buffer.toString('utf8'),
          });
        }
      }
      const trimmedName = name.trim();
      const descValue = typeof description === 'string' ? description : null;
      const existing = findTemplateByNameAndProject(db, trimmedName, sourceProjectId);
      let t;
      if (existing) {
        t = updateTemplate(db, existing.id, {
          description: descValue,
          files: snapshot,
        });
      } else {
        t = insertTemplate(db, {
          id: randomId(),
          name: trimmedName,
          description: descValue,
          sourceProjectId,
          files: snapshot,
          createdAt: Date.now(),
        });
      }
      res.json({ template: t });
    } catch (err: any) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.delete('/api/templates/:id', (req, res) => {
    deleteTemplate(db, req.params.id);
    res.json({ ok: true });
  });

}

export interface RegisterProjectArtifactRoutesDeps extends RouteDeps<'http' | 'uploads' | 'paths' | 'node' | 'artifacts'> { }

export function registerProjectArtifactRoutes(app: Express, ctx: RegisterProjectArtifactRoutesDeps) {
  const { upload } = ctx.uploads;
  const { ARTIFACTS_DIR } = ctx.paths;
  const { path, fs } = ctx.node;
  const { sanitizeSlug, lintArtifact, renderFindingsForAgent } = ctx.artifacts;
  app.post('/api/upload', upload.array('images', 8), (req, res) => {
    const files = ((req.files || []) as any[]).map((f: any) => ({
      name: f.originalname,
      path: f.path,
      size: f.size,
    }));
    res.json({ files });
  });

  // Persist a generated artifact (HTML) to disk so the user can re-open it
  // in their browser or hand it off. Returns the on-disk path + a served URL.
  // The body is also passed through the anti-slop linter; findings are
  // returned alongside the path so the UI can render a P0/P1 badge and the
  // chat layer can splice them into a system reminder for the agent.
  app.post('/api/artifacts/save', (req, res) => {
    try {
      const { identifier, title, html } = req.body || {};
      if (typeof html !== 'string' || html.length === 0) {
        return res.status(400).json({ error: 'html required' });
      }
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      const slug = sanitizeSlug(identifier || title || 'artifact');
      const dir = path.join(ARTIFACTS_DIR, `${stamp}-${slug}`);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'index.html');
      fs.writeFileSync(file, html, 'utf8');
      const findings = lintArtifact(html);
      res.json({
        path: file,
        url: `/artifacts/${path.basename(dir)}/index.html`,
        lint: findings,
      });
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Standalone lint endpoint — POST raw HTML, get findings back.
  // The chat layer uses this to lint streamed-in artifacts without writing
  // them to disk first, so a P0 issue can be surfaced before save.
  app.post('/api/artifacts/lint', (req, res) => {
    try {
      const { html } = req.body || {};
      if (typeof html !== 'string' || html.length === 0) {
        return res.status(400).json({ error: 'html required' });
      }
      const findings = lintArtifact(html);
      res.json({
        findings,
        agentMessage: renderFindingsForAgent(findings),
      });
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

}

export interface RegisterProjectFileRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'uploads' | 'node' | 'projectStore' | 'projectFiles' | 'documents' | 'artifacts' | 'projectPreviewScopes'> { }

export function registerProjectFileRoutes(app: Express, ctx: RegisterProjectFileRoutesDeps) {
  const { db } = ctx;
  const { sendApiError, sendMulterError } = ctx.http;
  const { PROJECTS_DIR } = ctx.paths;
  const { upload } = ctx.uploads;
  const { fs } = ctx.node;
  const { getProject } = ctx.projectStore;
  const { listFiles, listProjectFolders, createProjectFolder, deleteProjectFolder, searchProjectFiles, readProjectFile, resolveProjectDir, resolveProjectFilePath, parseByteRange, renameProjectFile, deleteProjectFile, writeProjectFile, sanitizeName, ensureProject } = ctx.projectFiles;
  const { buildDocumentPreview } = ctx.documents;
  const { validateArtifactManifestInput } = ctx.artifacts;
  const { projectPreviewScopes } = ctx;
  const projectPreviewIframeSandbox = 'allow-scripts allow-forms';
  const projectPreviewCsp = [
    `sandbox ${projectPreviewIframeSandbox}`,
    "default-src 'self' data: blob:",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; ');
  const previewScopeRe = /^[A-Za-z0-9_-]{8,128}$/u;

  function setProjectPreviewHeaders(res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', projectPreviewCsp);
  }

  async function sendProjectFile(
    req: any,
    res: Response,
    projectId: string,
    relPath: string,
    metadata?: unknown,
    beforeSend?: (mime: string) => void,
    transformFile?: (file: { mime: string; buffer: Buffer }) => Buffer | string,
  ) {
    const meta = await resolveProjectFilePath(
      PROJECTS_DIR,
      projectId,
      relPath,
      metadata,
    );
    beforeSend?.(meta.mime);

    if (meta.mime.startsWith('video/') || meta.mime.startsWith('audio/')) {
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', meta.mime);

      if (meta.size === 0) {
        res.setHeader('Content-Length', '0');
        return res.status(200).end();
      }

      const range = parseByteRange(req.headers.range, meta.size);

      if (range === 'unsatisfiable') {
        res.setHeader('Content-Range', `bytes */${meta.size}`);
        return res.status(416).end();
      }

      let start;
      let end;
      let statusCode;
      if (range) {
        ({ start, end } = range);
        statusCode = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${meta.size}`);
        res.setHeader('Content-Length', String(end - start + 1));
      } else {
        start = 0;
        end = meta.size - 1;
        statusCode = 200;
        res.setHeader('Content-Length', String(meta.size));
      }

      res.status(statusCode);
      const stream = fs.createReadStream(meta.filePath, { start, end });
      stream.on('error', (streamErr: any) => {
        if (!res.headersSent) {
          sendApiError(res, 500, 'STREAM_ERROR', String(streamErr));
        } else {
          res.destroy(streamErr);
        }
      });
      stream.pipe(res);
      return;
    }

    const file = await readProjectFile(PROJECTS_DIR, projectId, relPath, metadata);
    res.type(file.mime).send(transformFile ? transformFile(file) : file.buffer);
  }

  function previewFilePathForProject(project: any, queryFile: unknown): string {
    if (typeof queryFile === 'string' && queryFile.trim().length > 0) {
      return queryFile;
    }
    const entryFile = project?.metadata?.entryFile;
    return typeof entryFile === 'string' && entryFile.length > 0 ? entryFile : 'index.html';
  }

  function encodeProjectPathForUrl(filePath: string): string {
    return filePath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  }

  // Project files. Each project owns a flat folder under .od/projects/<id>/
  // containing every file the user has uploaded, pasted, sketched, or that
  // the agent has generated. Names are sanitized; paths are confined to the
  // project's own folder (see apps/daemon/src/projects.ts).
  app.get('/api/projects/:id/files', async (req, res) => {
    try {
      const since = Number(req.query?.since);
      const project = getProject(db, req.params.id);
      const files = await listFiles(PROJECTS_DIR, req.params.id, {
        since: Number.isFinite(since) ? since : undefined,
        metadata: project?.metadata,
      });
      /** @type {import('@open-design/contracts').ProjectFilesResponse} */
      const body = { files };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.get('/api/projects/:id/search', async (req, res) => {
    try {
      const query = String(req.query.q ?? '');
      if (!query) {
        sendApiError(res, 400, 'BAD_REQUEST', 'q query parameter is required');
        return;
      }
      const pattern = req.query.pattern ? String(req.query.pattern) : null;
      const max = Math.min(Number(req.query.max) || 200, 1000);
      const searchProject = getProject(db, req.params.id);
      const matches = await searchProjectFiles(PROJECTS_DIR, req.params.id, query, {
        pattern,
        max,
        metadata: searchProject?.metadata,
      });
      res.json({ query, matches });
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.get('/api/projects/:id/folders', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      const folders = await listProjectFolders(PROJECTS_DIR, req.params.id, {
        metadata: project.metadata,
      });
      /** @type {import('@open-design/contracts').ProjectFoldersResponse} */
      const body = { folders };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.post('/api/projects/:id/folders', async (req, res) => {
    try {
      const { name } = req.body || {};
      if (typeof name !== 'string' || !name.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'name required');
      }
      const project = getProject(db, req.params.id);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      const folder = await createProjectFolder(
        PROJECTS_DIR,
        req.params.id,
        name,
        project.metadata,
      );
      /** @type {import('@open-design/contracts').ProjectFolderResponse} */
      const body = { folder };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err?.message || err));
    }
  });

  app.delete('/api/projects/:id/folders', async (req, res) => {
    try {
      const { path: folderPath } = req.body || {};
      if (typeof folderPath !== 'string' || !folderPath.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'path required');
      }
      const project = getProject(db, req.params.id);
      if (!project) {
        return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      }
      await deleteProjectFolder(
        PROJECTS_DIR,
        req.params.id,
        folderPath,
        project.metadata,
      );
      /** @type {import('@open-design/contracts').DeleteProjectFolderResponse} */
      const body = { ok: true };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err?.message || err));
    }
  });

  app.get('/api/projects/:id/design-system-package-audit', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      if (!project) {
        sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
        return;
      }
      const projectRoot = resolveProjectDir(PROJECTS_DIR, project.id, project.metadata);
      const audit = await auditDesignSystemPackage(projectRoot);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ audit });
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err));
    }
  });

  app.get('/api/projects/:id/preview-url', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      if (!project) {
        sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
        return;
      }
      const requestedPath = previewFilePathForProject(project, req.query.file);
      const meta = await resolveProjectFilePath(
        PROJECTS_DIR,
        project.id,
        requestedPath,
        project.metadata,
      );
      const scope = projectPreviewScopes.mint(project.id);
      /** @type {import('@open-design/contracts').ProjectPreviewUrlResponse} */
      const body = {
        url: `/api/projects/${encodeURIComponent(project.id)}/preview/${scope}/${encodeProjectPathForUrl(meta.name)}`,
        file: meta.name,
        csp: projectPreviewCsp,
        iframeSandbox: projectPreviewIframeSandbox,
        opaqueOrigin: true,
      };
      res.setHeader('Cache-Control', 'no-store');
      res.json(body);
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    }
  });

  app.get(/^\/api\/projects\/([^/]+)\/preview\/([^/]+)\/(.+)$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string; 2?: string };
      const projectId = String(params[0] ?? '');
      const scope = String(params[1] ?? '');
      const relPath = String(params[2] ?? '');
      if (!previewScopeRe.test(scope)) {
        sendApiError(res, 400, 'BAD_REQUEST', 'invalid preview scope');
        return;
      }
      const project = getProject(db, projectId);
      if (!project) {
        sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
        return;
      }
      if (!projectPreviewScopes.validate(project.id, scope)) {
        sendApiError(res, 404, 'PREVIEW_SCOPE_NOT_FOUND', 'preview scope not found');
        return;
      }
      if (req.headers.origin === 'null') {
        res.header('Access-Control-Allow-Origin', '*');
      }
      await sendProjectFile(
        req,
        res,
        project.id,
        relPath,
        project.metadata,
        () => setProjectPreviewHeaders(res),
      );
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    }
  });


  // Preflight for the raw file route. Current artifact fetches are simple GETs
  // (no preflight needed), but an explicit handler future-proofs the route if
  // artifacts ever add custom request headers.
  app.options(/^\/api\/projects\/([^/]+)\/raw\/(.+)$/u, (req, res) => {
    if (req.headers.origin === 'null') {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
    }
    res.sendStatus(204);
  });

  app.get(/^\/api\/projects\/([^/]+)\/raw\/(.+)$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string };
      const projectId = String(params[0] ?? '');
      const relPath = String(params[1] ?? '');
      const project = getProject(db, projectId);
      // PreviewModal loads artifact HTML via srcdoc, giving the iframe Origin: "null".
      // data: URIs, file://, and some sandboxed iframes also send null — all are
      // local-only callers, so this is safe. Real cross-origin sites send a real
      // origin and remain blocked by the browser's same-origin policy.
      if (req.headers.origin === 'null') {
        res.header('Access-Control-Allow-Origin', '*');
      }

      await sendProjectFile(
        req,
        res,
        projectId,
        relPath,
        project?.metadata,
        undefined,
        (file) => {
          if (
            (wantsUrlPreviewScrollBridge(req.query.odPreviewBridge) ||
              wantsUrlPreviewSelectionBridge(req.query.odPreviewBridge) ||
              wantsUrlPreviewSnapshotBridge(req.query.odPreviewBridge)) &&
            /^text\/html(?:;|$)/i.test(file.mime)
          ) {
            let html = file.buffer.toString('utf8');
            if (wantsUrlPreviewScrollBridge(req.query.odPreviewBridge)) {
              html = injectUrlPreviewBridge(html, 'scroll');
            }
            if (wantsUrlPreviewSelectionBridge(req.query.odPreviewBridge)) {
              html = injectUrlPreviewBridge(html, 'selection');
            }
            if (wantsUrlPreviewSnapshotBridge(req.query.odPreviewBridge)) {
              html = injectUrlPreviewBridge(html, 'snapshot');
            }
            return html;
          }
          return file.buffer;
        },
      );
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    }
  });

  app.delete(/^\/api\/projects\/([^/]+)\/raw\/(.+)$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string };
      const projectId = String(params[0] ?? '');
      const rawSplat = String(params[1] ?? '');
      const project = getProject(db, projectId);
      await deleteProjectFile(PROJECTS_DIR, projectId, rawSplat, project?.metadata);
      /** @type {import('@open-design/contracts').DeleteProjectFileResponse} */
      const body = { ok: true };
      res.json(body);
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    }
  });

  app.get('/api/projects/:id/files/:name/preview', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      const file = await readProjectFile(
        PROJECTS_DIR,
        req.params.id,
        req.params.name,
        project?.metadata,
      );
      const preview = await buildDocumentPreview(file);
      res.json(preview);
    } catch (err: any) {
      const status =
        err && err.statusCode
          ? err.statusCode
          : err && err.code === 'ENOENT'
            ? 404
            : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        err?.message || 'preview unavailable',
      );
    }
  });

  app.get(/^\/api\/projects\/([^/]+)\/files\/(.+)$/u, async (req, res) => {
    try {
      const params = req.params as unknown as { 0?: string; 1?: string };
      const projectId = String(params[0] ?? '');
      const fileSplat = String(params[1] ?? '');
      const project = getProject(db, projectId);
      const file = await readProjectFile(
        PROJECTS_DIR,
        projectId,
        fileSplat,
        project?.metadata,
      );
      res.type(file.mime).send(file.buffer);
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    }
  });

  // Two ways to upload: multipart for binary files (images), and JSON
  // {name, content, encoding} for sketches and pasted text. The frontend
  // uses both depending on the file source.
  app.post(
    '/api/projects/:id/files',
    (req, res, next) => {
      upload.single('file')(req, res, (err: any) => {
        if (err) return sendMulterError(res, err);
        next();
      });
    },
    async (req, res) => {
      try {
        const uploadProject = getProject(db, req.params.id);
        await ensureProject(PROJECTS_DIR, req.params.id, uploadProject?.metadata);
        if (req.file) {
          const buf = await fs.promises.readFile(req.file.path);
          const desiredName = sanitizeName(
            req.body?.name || req.file.originalname,
          );
          const meta = await writeProjectFile(
            PROJECTS_DIR,
            req.params.id,
            desiredName,
            buf,
            {},
            uploadProject?.metadata,
          );
          fs.promises.unlink(req.file.path).catch(() => { });
          /** @type {import('@open-design/contracts').ProjectFileResponse} */
          const body = { file: meta };
          return res.json(body);
        }
        const { name, content, encoding, artifactManifest, artifact, overwrite } = req.body || {};
        if (typeof name !== 'string' || typeof content !== 'string') {
          return sendApiError(
            res,
            400,
            'BAD_REQUEST',
            'name and content required',
          );
        }
        if (artifactManifest !== undefined && artifactManifest !== null) {
          const validated = validateArtifactManifestInput(
            artifactManifest,
            name,
          );
          if (!validated.ok) {
            return sendApiError(
              res,
              400,
              'BAD_REQUEST',
              `invalid artifactManifest: ${validated.error}`,
            );
          }
        }
        const buf =
          encoding === 'base64'
            ? Buffer.from(content, 'base64')
            : Buffer.from(content, 'utf8');
        const meta = artifact === true
          ? await createProjectArtifactFile({
            projectsRoot: PROJECTS_DIR,
            projectId: req.params.id,
            input: { name, content, encoding, artifactManifest },
            metadata: uploadProject?.metadata,
            writeProjectFile,
          })
          : await writeProjectFile(
            PROJECTS_DIR,
            req.params.id,
            name,
            buf,
            {
              artifactManifest,
              ...(overwrite === false ? { overwrite: false } : {}),
            },
            uploadProject?.metadata,
          );
        /** @type {import('@open-design/contracts').ProjectFileResponse} */
        const body = { file: meta };
        res.json(body);
      } catch (err: any) {
        if (err instanceof ArtifactRegressionError) {
          return sendApiError(res, 422, 'ARTIFACT_REGRESSION', err.message, {
            details: {
              identifier: err.identifier,
              newSize: err.newSize,
              priorSize: err.priorSize,
              priorName: err.priorName,
            },
          });
        }
        if (err instanceof ArtifactPublicationBlockedError) {
          return sendApiError(res, 422, 'ARTIFACT_PUBLICATION_BLOCKED', err.message, {
            details: { placeholders: err.placeholders },
          });
        }
        if (err?.code === 'EEXIST') {
          return sendApiError(res, 409, 'FILE_EXISTS', 'file already exists');
        }
        if (err?.code === 'ARTIFACT_MANIFEST_REQUIRED') {
          return sendApiError(res, 400, 'ARTIFACT_MANIFEST_REQUIRED', err.message);
        }
        if (err?.code === 'ARTIFACT_MANIFEST_INVALID') {
          return sendApiError(res, 400, 'BAD_REQUEST', err.message);
        }
        sendApiError(res, 500, 'INTERNAL_ERROR', 'upload failed');
      }
    },
  );

  app.post('/api/projects/:id/files/rename', async (req, res) => {
    try {
      const { from, to } = req.body || {};
      if (typeof from !== 'string' || typeof to !== 'string') {
        return sendApiError(res, 400, 'BAD_REQUEST', 'from and to required');
      }
      const project = getProject(db, req.params.id);
      const result = await renameProjectFile(
        PROJECTS_DIR,
        req.params.id,
        from,
        to,
        project?.metadata,
      );
      /** @type {import('@open-design/contracts').RenameProjectFileResponse} */
      const body = result;
      res.json(body);
    } catch (err: any) {
      if (err?.code === 'EEXIST') {
        return sendApiError(res, 409, 'CONFLICT', String(err?.message || err));
      }
      const message = String(err?.message || err);
      if (err?.code === 'ENOENT' || message.includes('ENOENT') || message.includes('no such file or directory')) {
        return sendApiError(res, 404, 'FILE_NOT_FOUND', message);
      }
      sendApiError(res, 400, 'BAD_REQUEST', message);
    }
  });

  app.delete('/api/projects/:id/files/:name', async (req, res) => {
    try {
      const delProject = getProject(db, req.params.id);
      await deleteProjectFile(PROJECTS_DIR, req.params.id, req.params.name, delProject?.metadata);
      /** @type {import('@open-design/contracts').DeleteProjectFileResponse} */
      const body = { ok: true };
      res.json(body);
    } catch (err: any) {
      const status = err && err.code === 'ENOENT' ? 404 : 400;
      sendApiError(
        res,
        status,
        status === 404 ? 'FILE_NOT_FOUND' : 'BAD_REQUEST',
        String(err),
      );
    }
  });

  // --- Git Management Endpoints ---

  app.get('/api/projects/:id/git/status', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      if (!project) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
      const dir = projectDetailResolvedDir(PROJECTS_DIR, project, resolveProjectDir);

      const execGit = (args: string[]): Promise<string> => {
        return new Promise((resolve, reject) => {
          const child = spawn('git', args, { cwd: dir });
          let stdout = '';
          let stderr = '';
          child.stdout?.on('data', (data) => { stdout += data.toString(); });
          child.stderr?.on('data', (data) => { stderr += data.toString(); });
          child.on('close', (code) => {
            if (code === 0) resolve(stdout);
            else reject(new Error(stderr.trim() || `git ${args.join(' ')} failed with code ${code}`));
          });
          child.on('error', reject);
        });
      };

      // Ensure it is a git repository
      try {
        await execGit(['rev-parse', '--is-inside-work-tree']);
      } catch (err) {
        return res.json({ hasChanges: false, branch: 'no-git', files: [] });
      }

      const [statusOutput, branchOutput] = await Promise.all([
        execGit(['status', '--porcelain']),
        execGit(['branch', '--show-current']).catch(() => 'main'),
      ]);

      const branch = branchOutput.trim() || 'main';
      const statusLines = statusOutput.split('\n').filter(Boolean);
      const files = statusLines.map(line => {
        const indexStatus = line[0] || ' ';
        const workingDirStatus = line[1] || ' ';
        let filePath = line.slice(3);
        if (filePath.startsWith('"') && filePath.endsWith('"')) {
          filePath = filePath.slice(1, -1);
        }

        let status: 'modified' | 'added' | 'deleted' | 'untracked' | 'staged_modified' | 'staged_added' | 'staged_deleted' | 'renamed' | 'unknown' = 'unknown';
        if (indexStatus === '?' && workingDirStatus === '?') {
          status = 'untracked';
        } else if (indexStatus === 'A') {
          status = 'staged_added';
        } else if (indexStatus === 'M') {
          status = 'staged_modified';
        } else if (indexStatus === 'D') {
          status = 'staged_deleted';
        } else if (indexStatus === 'R') {
          status = 'renamed';
        } else if (workingDirStatus === 'M') {
          status = 'modified';
        } else if (workingDirStatus === 'D') {
          status = 'deleted';
        }

        return {
          path: filePath,
          workingDirStatus,
          indexStatus,
          status,
        };
      });

      res.json({
        hasChanges: files.length > 0,
        branch,
        files,
      });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message || err));
    }
  });

  app.get('/api/projects/:id/git/diff', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      if (!project) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
      const dir = projectDetailResolvedDir(PROJECTS_DIR, project, resolveProjectDir);
      const targetFile = typeof req.query.file === 'string' ? req.query.file : null;

      const execGit = (args: string[]): Promise<string> => {
        return new Promise((resolve, reject) => {
          const child = spawn('git', args, { cwd: dir });
          let stdout = '';
          let stderr = '';
          child.stdout?.on('data', (data) => { stdout += data.toString(); });
          child.stderr?.on('data', (data) => { stderr += data.toString(); });
          child.on('close', (code) => {
            if (code === 0) resolve(stdout);
            else if (stdout) resolve(stdout);
            else reject(new Error(stderr.trim() || `git ${args.join(' ')} failed with code ${code}`));
          });
          child.on('error', reject);
        });
      };

      const diffArgs = ['diff'];
      const cachedDiffArgs = ['diff', '--cached'];
      if (targetFile) {
        diffArgs.push('--', targetFile);
        cachedDiffArgs.push('--', targetFile);
      }

      const [diff, cachedDiff] = await Promise.all([
        execGit(diffArgs).catch(() => ''),
        execGit(cachedDiffArgs).catch(() => ''),
      ]);

      res.json({ diff, cachedDiff });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message || err));
    }
  });

  app.post('/api/projects/:id/git/stage', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      if (!project) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
      const dir = projectDetailResolvedDir(PROJECTS_DIR, project, resolveProjectDir);
      const { files } = req.body || {};

      if (!Array.isArray(files) || files.length === 0) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'files array is required');
      }

      const runGit = (args: string[]) => new Promise((resolve, reject) => {
        const child = spawn('git', args, { cwd: dir, stdio: 'ignore' });
        child.on('close', (code) => code === 0 ? resolve(undefined) : reject(new Error(`git ${args.join(' ')} failed with code ${code}`)));
        child.on('error', reject);
      });

      await runGit(['add', '--', ...files]);
      res.json({ ok: true });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message || err));
    }
  });

  app.post('/api/projects/:id/git/unstage', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      if (!project) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
      const dir = projectDetailResolvedDir(PROJECTS_DIR, project, resolveProjectDir);
      const { files } = req.body || {};

      if (!Array.isArray(files) || files.length === 0) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'files array is required');
      }

      const runGit = (args: string[]) => new Promise((resolve, reject) => {
        const child = spawn('git', args, { cwd: dir, stdio: 'ignore' });
        child.on('close', (code) => code === 0 ? resolve(undefined) : reject(new Error(`git ${args.join(' ')} failed with code ${code}`)));
        child.on('error', reject);
      });

      await runGit(['restore', '--staged', '--', ...files]);
      res.json({ ok: true });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message || err));
    }
  });

  app.post('/api/projects/:id/git/restore', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      if (!project) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
      const dir = projectDetailResolvedDir(PROJECTS_DIR, project, resolveProjectDir);
      const { files } = req.body || {};

      if (!Array.isArray(files) || files.length === 0) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'files array is required');
      }

      const runGit = (args: string[]) => new Promise((resolve, reject) => {
        const child = spawn('git', args, { cwd: dir, stdio: 'ignore' });
        child.on('close', (code) => code === 0 ? resolve(undefined) : reject(new Error(`git ${args.join(' ')} failed with code ${code}`)));
        child.on('error', reject);
      });

      await runGit(['restore', '--', ...files]);
      res.json({ ok: true });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message || err));
    }
  });

  app.post('/api/projects/:id/git/commit', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      if (!project) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
      const dir = projectDetailResolvedDir(PROJECTS_DIR, project, resolveProjectDir);
      const { message } = req.body || {};

      if (typeof message !== 'string' || !message.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'commit message is required');
      }

      const githubAuth = await getGitHubToken(ctx.paths.RUNTIME_DATA_DIR);
      if (!githubAuth) {
        return sendApiError(res, 401, 'UNAUTHORIZED', 'GitHub connection required to commit');
      }
      const authorName = githubAuth.username || 'Open Design User';
      const authorEmail = githubAuth.username ? `${githubAuth.username}@users.noreply.github.com` : 'user@example.com';

      const runGit = (args: string[]) => new Promise((resolve, reject) => {
        const child = spawn('git', args, { 
          cwd: dir, 
          stdio: 'ignore',
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: authorName,
            GIT_AUTHOR_EMAIL: authorEmail,
            GIT_COMMITTER_NAME: authorName,
            GIT_COMMITTER_EMAIL: authorEmail
          }
        });
        child.on('close', (code) => code === 0 ? resolve(undefined) : reject(new Error(`git ${args.join(' ')} failed with code ${code}`)));
        child.on('error', reject);
      });

      await runGit(['commit', '-m', message.trim()]);
      res.json({ ok: true });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message || err));
    }
  });

  // POST /api/projects/:id/git/suggest-commit
  // Generates a commit message via a simple LLM text completion using env-var
  // keys or the BYOK chatProvider the web client sends. Never spawns an agent
  // session — pure text completion only.
  app.post('/api/projects/:id/git/suggest-commit', async (req, res) => {
    try {
      const { systemPrompt, userPrompt, chatProvider, chatAgentId } = req.body || {};
      if (typeof systemPrompt !== 'string' || typeof userPrompt !== 'string') {
        return sendApiError(res, 400, 'BAD_REQUEST', 'systemPrompt and userPrompt required');
      }

      const commitText = await callLlmOnce({
        systemPrompt,
        userPrompt,
        chatProvider,
        chatAgentId,
      });

      res.json({ text: commitText.trim() });
    } catch (err: any) {
      if (err?.code === 'NO_AI_PROVIDER') {
        return sendApiError(res, 422, 'NO_AI_PROVIDER', err.message);
      }
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message || err));
    }
  });

  // --- GitHub Connection & Auth Status ---

  app.get('/api/github/auth-status', async (req, res) => {
    try {
      const dataDir = ctx.paths.RUNTIME_DATA_DIR;
      const tokenObj = await getGitHubToken(dataDir);
      if (!tokenObj) {
        return res.json({ connected: false });
      }
      const profileResp = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${tokenObj.accessToken}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'Open-Design-Daemon'
        }
      });
      if (!profileResp.ok) {
        if (profileResp.status === 401) {
          await clearGitHubToken(dataDir);
          return res.json({ connected: false });
        }
        return res.json({
          connected: true,
          username: tokenObj.username,
          avatarUrl: tokenObj.avatarUrl,
          scopes: tokenObj.scopes,
          savedAt: tokenObj.savedAt
        });
      }
      const profile = await profileResp.json() as any;
      console.log('GitHub Profile Response:', profile);
      const scopesHeader = profileResp.headers.get('x-oauth-scopes') || '';
      const scopes = scopesHeader ? scopesHeader.split(',').map(s => s.trim()) : [];
      
      const updatedToken = {
        accessToken: tokenObj.accessToken,
        username: profile.login,
        avatarUrl: profile.avatar_url,
        scopes,
        savedAt: Date.now()
      };
      await setGitHubToken(dataDir, updatedToken);
      
      res.json({
        connected: true,
        username: profile.login,
        avatarUrl: profile.avatar_url,
        scopes,
        savedAt: updatedToken.savedAt
      });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message || err));
    }
  });

  app.get('/api/github/repos', async (req, res) => {
    try {
      const dataDir = ctx.paths.RUNTIME_DATA_DIR;
      const tokenObj = await getGitHubToken(dataDir);
      if (!tokenObj || !tokenObj.accessToken) {
        return sendApiError(res, 401, 'UNAUTHORIZED', 'Not connected to GitHub');
      }

      const reposResp = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
        headers: {
          'Authorization': `Bearer ${tokenObj.accessToken}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!reposResp.ok) {
        return sendApiError(res, reposResp.status, 'BAD_REQUEST', `Failed to fetch repos: ${reposResp.statusText}`);
      }

      const rawRepos = await reposResp.json() as any[];
      const repos = rawRepos.map((repo) => ({
        fullName: repo.full_name,
        cloneUrl: repo.clone_url,
        private: repo.private,
      }));

      res.json(repos);
    } catch (err: any) {
      console.error('[project-routes] GET /api/github/repos error:', err);
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message || err));
    }
  });

  app.post('/api/github/connect', async (req, res) => {
    try {
      const { token } = req.body || {};
      if (typeof token !== 'string' || !token.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'token is required');
      }
      const accessToken = token.trim();
      const profileResp = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'Open-Design-Daemon'
        }
      });
      if (!profileResp.ok) {
        return sendApiError(res, profileResp.status, 'BAD_REQUEST', `GitHub token validation failed: ${profileResp.statusText}`);
      }
      
      const profile = await profileResp.json() as any;
      const scopesHeader = profileResp.headers.get('x-oauth-scopes') || '';
      const scopes = scopesHeader ? scopesHeader.split(',').map(s => s.trim()) : [];
      
      const dataDir = ctx.paths.RUNTIME_DATA_DIR;
      const storedToken = {
        accessToken,
        username: profile.login,
        avatarUrl: profile.avatar_url,
        scopes,
        savedAt: Date.now()
      };
      await setGitHubToken(dataDir, storedToken);
      
      res.json({
        connected: true,
        username: profile.login,
        avatarUrl: profile.avatar_url,
        scopes,
        savedAt: storedToken.savedAt
      });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message || err));
    }
  });

  
  app.post('/api/github/device/start', async (req, res) => {
    try {
      const resp = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ client_id: 'Iv23lim64Zye3mXvzg5O' })
      });
      if (!resp.ok) {
        return sendApiError(res, resp.status, 'BAD_REQUEST', `Failed to start device flow: ${resp.statusText}`);
      }
      const data = await resp.json();
      res.json(data);
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message || err));
    }
  });

  app.post('/api/github/device/poll', async (req, res) => {
    try {
      const { deviceCode } = req.body || {};
      if (typeof deviceCode !== 'string' || !deviceCode.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'deviceCode is required');
      }

      const resp = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id: 'Iv23lim64Zye3mXvzg5O',
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
      });

      if (!resp.ok) {
        return sendApiError(res, resp.status, 'BAD_REQUEST', `Polling failed: ${resp.statusText}`);
      }

      const data = await resp.json() as any;
      console.log('GitHub Token Response:', data);

      if (data.error === 'authorization_pending') {
        return res.json({ pending: true });
      } else if (data.error === 'slow_down') {
        return res.json({ pending: true, error: 'slow_down' });
      } else if (data.error) {
        return res.json({ pending: true, error: data.error, errorDescription: data.error_description });
      }

      const accessToken = data.access_token;
      if (!accessToken) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'No access token received');
      }

      const profileResp = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'Open-Design-Daemon'
        }
      });

      if (!profileResp.ok) {
        return sendApiError(res, profileResp.status, 'BAD_REQUEST', `GitHub token validation failed: ${profileResp.statusText}`);
      }

      const profile = await profileResp.json() as any;
      const scopesHeader = profileResp.headers.get('x-oauth-scopes') || '';
      const scopes = scopesHeader ? scopesHeader.split(',').map((s: string) => s.trim()) : [];

      const dataDir = ctx.paths.RUNTIME_DATA_DIR;
      const storedToken = {
        accessToken,
        username: profile.login,
        avatarUrl: profile.avatar_url,
        scopes,
        savedAt: Date.now()
      };
      await setGitHubToken(dataDir, storedToken);

      res.json({
        connected: true,
        username: profile.login,
        avatarUrl: profile.avatar_url,
        scopes,
        savedAt: storedToken.savedAt
      });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message || err));
    }
  });

  app.post('/api/github/disconnect', async (req, res) => {
    try {
      const dataDir = ctx.paths.RUNTIME_DATA_DIR;
      await clearGitHubToken(dataDir);
      res.json({ ok: true });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message || err));
    }
  });

  // --- Project Git Remote & Sync Endpoints ---

  function getAuthenticatedGitUrl(remoteUrl: string, token: string): string {
    const clean = remoteUrl.trim();
    let owner = '';
    let repo = '';
    const httpsMatch = /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(clean);
    const sshMatch = /git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(clean);
    if (httpsMatch) {
      owner = httpsMatch[1]!;
      repo = httpsMatch[2]!;
    } else if (sshMatch) {
      owner = sshMatch[1]!;
      repo = sshMatch[2]!;
    } else {
      return clean;
    }
    return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  }

  app.get('/api/projects/:id/git/remote', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      if (!project) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
      const dir = projectDetailResolvedDir(PROJECTS_DIR, project, resolveProjectDir);

      const execGit = (args: string[]): Promise<string> => {
        return new Promise((resolve, reject) => {
          const child = spawn('git', args, { cwd: dir });
          let stdout = '';
          let stderr = '';
          child.stdout?.on('data', (data) => { stdout += data.toString(); });
          child.stderr?.on('data', (data) => { stderr += data.toString(); });
          child.on('close', (code) => {
            if (code === 0) resolve(stdout);
            else reject(new Error(stderr.trim() || `git ${args.join(' ')} failed with code ${code}`));
          });
          child.on('error', reject);
        });
      };

      try {
        const remoteUrl = await execGit(['remote', 'get-url', 'origin']);
        res.json({ remoteUrl: remoteUrl.trim() });
      } catch (err) {
        res.json({ remoteUrl: null });
      }
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message || err));
    }
  });

  app.post('/api/projects/:id/git/remote', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      if (!project) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
      const dir = projectDetailResolvedDir(PROJECTS_DIR, project, resolveProjectDir);
      const { remoteUrl } = req.body || {};

      if (typeof remoteUrl !== 'string' || !remoteUrl.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'remoteUrl is required');
      }

      const execGit = (args: string[]): Promise<string> => {
        return new Promise((resolve, reject) => {
          const child = spawn('git', args, { cwd: dir });
          let stdout = '';
          let stderr = '';
          child.stdout?.on('data', (data) => { stdout += data.toString(); });
          child.stderr?.on('data', (data) => { stderr += data.toString(); });
          child.on('close', (code) => {
            if (code === 0) resolve(stdout);
            else reject(new Error(stderr.trim() || `git ${args.join(' ')} failed with code ${code}`));
          });
          child.on('error', reject);
        });
      };

      let hasOrigin = false;
      try {
        await execGit(['remote', 'get-url', 'origin']);
        hasOrigin = true;
      } catch {}

      if (hasOrigin) {
        await execGit(['remote', 'set-url', 'origin', remoteUrl.trim()]);
      } else {
        await execGit(['remote', 'add', 'origin', remoteUrl.trim()]);
      }

      res.json({ ok: true });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message || err));
    }
  });

  app.post('/api/projects/:id/git/push', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      if (!project) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
      const dir = projectDetailResolvedDir(PROJECTS_DIR, project, resolveProjectDir);

      const execGit = (args: string[]): Promise<string> => {
        return new Promise((resolve, reject) => {
          const child = spawn('git', args, { cwd: dir });
          let stdout = '';
          let stderr = '';
          child.stdout?.on('data', (data) => { stdout += data.toString(); });
          child.stderr?.on('data', (data) => { stderr += data.toString(); });
          child.on('close', (code) => {
            if (code === 0) resolve(stdout);
            else reject(new Error(stderr.trim() || `git ${args.join(' ')} failed with code ${code}`));
          });
          child.on('error', reject);
        });
      };

      const remoteUrlRaw = await execGit(['remote', 'get-url', 'origin']).catch(() => null);
      if (!remoteUrlRaw) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'No remote origin configured');
      }

      const branchRaw = await execGit(['branch', '--show-current']);
      const branch = branchRaw.trim() || 'main';

      const dataDir = ctx.paths.RUNTIME_DATA_DIR;
      const tokenObj = await getGitHubToken(dataDir);
      
      let pushUrl = remoteUrlRaw.trim();
      if (tokenObj && pushUrl.includes('github.com')) {
        pushUrl = getAuthenticatedGitUrl(pushUrl, tokenObj.accessToken);
      }

      await execGit(['push', pushUrl, branch]);
      res.json({ ok: true });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message || err));
    }
  });

  app.post('/api/projects/:id/git/pull', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      if (!project) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
      const dir = projectDetailResolvedDir(PROJECTS_DIR, project, resolveProjectDir);

      const execGit = (args: string[]): Promise<string> => {
        return new Promise((resolve, reject) => {
          const child = spawn('git', args, { cwd: dir });
          let stdout = '';
          let stderr = '';
          child.stdout?.on('data', (data) => { stdout += data.toString(); });
          child.stderr?.on('data', (data) => { stderr += data.toString(); });
          child.on('close', (code) => {
            if (code === 0) resolve(stdout);
            else reject(new Error(stderr.trim() || `git ${args.join(' ')} failed with code ${code}`));
          });
          child.on('error', reject);
        });
      };

      const remoteUrlRaw = await execGit(['remote', 'get-url', 'origin']).catch(() => null);
      if (!remoteUrlRaw) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'No remote origin configured');
      }

      const branchRaw = await execGit(['branch', '--show-current']);
      const branch = branchRaw.trim() || 'main';

      const dataDir = ctx.paths.RUNTIME_DATA_DIR;
      const tokenObj = await getGitHubToken(dataDir);
      
      let pullUrl = remoteUrlRaw.trim();
      if (tokenObj && pullUrl.includes('github.com')) {
        pullUrl = getAuthenticatedGitUrl(pullUrl, tokenObj.accessToken);
      }

      await execGit(['pull', pullUrl, branch]);
      res.json({ ok: true });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message || err));
    }
  });

  app.get('/api/projects/:id/git/sync-status', async (req, res) => {
    try {
      const project = getProject(db, req.params.id);
      if (!project) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'not found');
      const dir = projectDetailResolvedDir(PROJECTS_DIR, project, resolveProjectDir);

      const execGit = (args: string[]): Promise<string> => {
        return new Promise((resolve, reject) => {
          const child = spawn('git', args, { cwd: dir });
          let stdout = '';
          let stderr = '';
          child.stdout?.on('data', (data) => { stdout += data.toString(); });
          child.stderr?.on('data', (data) => { stderr += data.toString(); });
          child.on('close', (code) => {
            if (code === 0) resolve(stdout);
            else reject(new Error(stderr.trim() || `git ${args.join(' ')} failed with code ${code}`));
          });
          child.on('error', reject);
        });
      };

      const remoteUrlRaw = await execGit(['remote', 'get-url', 'origin']).catch(() => null);
      if (!remoteUrlRaw) {
        return res.json({ ahead: 0, behind: 0, status: 'no-remote' });
      }

      const branchRaw = await execGit(['branch', '--show-current']);
      const branch = branchRaw.trim() || 'main';

      const dataDir = ctx.paths.RUNTIME_DATA_DIR;
      const tokenObj = await getGitHubToken(dataDir);
      
      let fetchUrl = remoteUrlRaw.trim();
      if (tokenObj && fetchUrl.includes('github.com')) {
        fetchUrl = getAuthenticatedGitUrl(fetchUrl, tokenObj.accessToken);
      }

      try {
        await execGit(['fetch', fetchUrl, branch]);
      } catch (fetchErr: any) {
        return res.json({ ahead: 0, behind: 0, status: 'error', error: String(fetchErr?.message || fetchErr) });
      }

      const revListOutput = await execGit(['rev-list', '--left-right', '--count', `HEAD...FETCH_HEAD`]);
      const parts = revListOutput.trim().split(/\s+/);
      const ahead = Number(parts[0]) || 0;
      const behind = Number(parts[1]) || 0;

      let status: 'synced' | 'ahead' | 'behind' | 'diverged' = 'synced';
      if (ahead > 0 && behind > 0) status = 'diverged';
      else if (ahead > 0) status = 'ahead';
      else if (behind > 0) status = 'behind';

      res.json({ ahead, behind, status });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err?.message || err));
    }
  });
}


export interface RegisterProjectUploadRoutesDeps extends RouteDeps<'http' | 'uploads' | 'node'> { }

export function registerProjectUploadRoutes(app: Express, ctx: RegisterProjectUploadRoutesDeps) {
  const { sendApiError } = ctx.http;
  const { handleProjectUpload } = ctx.uploads;
  const { fs } = ctx.node;

  app.post(
    '/api/projects/:id/upload',
    handleProjectUpload,
    async (req, res) => {
      try {
        const incoming = Array.isArray(req.files) ? req.files : [];
        // Subfolder the upload targeted (sanitized, forward-slash, '' for root),
        // stashed by the multer destination resolver. Prepend it so callers
        // get the file's true project-relative path, not just its basename.
        const relDir = typeof (req as any)._uploadRelDir === 'string' ? (req as any)._uploadRelDir : '';
        const out = [];
        for (const f of incoming) {
          try {
            const stat = await fs.promises.stat(f.path);
            const rel = relDir ? `${relDir}/${f.filename}` : f.filename;
            out.push({
              name: rel,
              path: rel,
              size: stat.size,
              mtime: stat.mtimeMs,
              originalName: f.originalname,
            });
          } catch {
            // skip files that vanished mid-flight
          }
        }
        /** @type {import('@open-design/contracts').UploadProjectFilesResponse} */
        const body = { files: out };
        res.json(body);
      } catch (err: any) {
        sendApiError(res, 500, 'INTERNAL_ERROR', 'upload failed');
      }
    },
  );
}
