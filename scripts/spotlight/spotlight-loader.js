"use strict";

(function () {
  var STYLE_ID = "abyss-spotlight-frame-style";
  var FRAME_CLASS = "featurediframe";

  var spotlightUrl = "ui/spotlight.html";
  try {
    var cs = document.currentScript;
    if (cs && cs.src) {
      spotlightUrl = new URL("spotlight.html", cs.src).href;
    }
  } catch (e) {
    // Fall back to the relative default above.
  }

  var lifecycleObserver = null;
  var lifecycleCleanup = function () { };
  var currentIndexPage = null;
  var currentHomeTab = null;
  var currentFavoritesTab = null;
  var currentIframe = null;
  // The iframe only becomes keyboard/gamepad-focusable once it reports "ready".
  // If its script never runs (e.g. an older TV browser can't parse it) it stays
  // out of the focus order, so arrow keys can't get trapped in a dead frame.
  var spotlightReady = false;
  var spotlightFailed = false;
  var READY_TIMEOUT_MS = 10000;
  var readyTimer = null;
  var backdropOverlay = null;
  var backdropLayerA = null;
  var backdropLayerB = null;
  var activeBackdropLayer = null;

  function safe(fn) {
    // Runs fn and swallows/reports any error so one failure never kills the loader.
    try {
      fn();
    } catch (err) {
      try {
        console.warn("[abyss-spotlight]", err);
      } catch (e2) {
        // console unavailable, nothing more we can do
      }
    }
  }

  var BACKDROP_SELECTOR = ".backdropContainer .backdropImage";
  var BACKDROP_MARK_ATTR = "data-abyss-spotlight-backdrop";

  function applySpotlightBackdrop(url) {
    if (!url) { clearSpotlightBackdrop(); return; }
    safe(function () {
      var els = document.querySelectorAll(BACKDROP_SELECTOR);
      for (var i = 0; i < els.length; i++) {
        els[i].setAttribute(BACKDROP_MARK_ATTR, "true");
        els[i].style.backgroundImage = 'url("' + url + '")';
      }
    });
  }

  function clearSpotlightBackdrop() {
    safe(function () {
      var els = document.querySelectorAll(BACKDROP_SELECTOR + "[" + BACKDROP_MARK_ATTR + "]");
      for (var i = 0; i < els.length; i++) {
        els[i].style.backgroundImage = "";
        els[i].removeAttribute(BACKDROP_MARK_ATTR);
      }
    });
  }

  function clearSpotlightLifecycle() {
    safe(lifecycleCleanup);
    lifecycleCleanup = function () { };
    lifecycleObserver = null;
    currentIndexPage = null;
    currentHomeTab = null;
    currentFavoritesTab = null;
    currentIframe = null;
    currentSync = null;
    spotlightFocused = false;
    spotlightReady = false;
    spotlightFailed = false;
    if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
    document.documentElement.classList.remove("abyss-spotlight-visible");
    clearSpotlightBackdrop();
  }

  function installFrameStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      "#indexPage.abyss-spotlight-active { padding: 0 !important; }" +
      "#homeTab.abyss-spotlight-active { padding: 0 !important; margin: 0 !important; }" +
      "." + FRAME_CLASS + " { width:100%;display:block;border:0;margin:0;padding:0;height:70vh;min-height:420px;max-height:680px; }" +
      "." + FRAME_CLASS + ":focus { outline: none; }" +
      "@media (min-width:1400px) { ." + FRAME_CLASS + " { height:72vh;max-height:760px; } }" +
      "@media (min-width:1920px) { ." + FRAME_CLASS + " { height:68vh;max-height:860px; } }" +
      "@media (max-width:1024px) and (orientation:portrait) and (hover:none) and (pointer:coarse) { ." + FRAME_CLASS + " { height:90vh;min-height:320px;max-height:720px; } }" +
      "@media (max-width:1024px) and (orientation:landscape) and (hover:none) and (pointer:coarse) { ." + FRAME_CLASS + " { height:100vh;min-height:280px;max-height:420px; } }" +
      "@media (max-width:600px) and (orientation:portrait) and (hover:none) and (pointer:coarse) { ." + FRAME_CLASS + " { height:90vh;min-height:260px;max-height:720px; } }" +
      "@media (max-width:900px) and (orientation:landscape) and (max-height:500px) and (hover:none) and (pointer:coarse) { ." + FRAME_CLASS + " { height:100vh;min-height:200px; } }";
    document.head.appendChild(style);
  }

  function installBackdropOverlay() {
    if (backdropOverlay) return;
    var container = document.querySelector(".backdropContainer");
    if (!container || !container.parentNode) return;

    backdropOverlay = document.createElement("div");
    backdropOverlay.id = "abyss-spotlight-backdrop";
    backdropLayerA = document.createElement("div");
    backdropLayerB = document.createElement("div");
    backdropLayerA.className = "abyss-spotlight-backdrop-layer";
    backdropLayerB.className = "abyss-spotlight-backdrop-layer";
    backdropOverlay.appendChild(backdropLayerA);
    backdropOverlay.appendChild(backdropLayerB);

    container.parentNode.insertBefore(backdropOverlay, container.nextSibling);

    var style = document.createElement("style");
    style.id = "abyss-spotlight-backdrop-style";
    style.textContent =
      "#abyss-spotlight-backdrop{position:fixed;inset:0;pointer-events:none;opacity:0;transition:opacity .6s ease;}" +
      "html.abyss-spotlight-visible #abyss-spotlight-backdrop{opacity:1;}" +
      ".abyss-spotlight-backdrop-layer{position:absolute;inset:0;background-size:cover;background-position:center;opacity:0;" +
      "transition:opacity .9s ease;filter:blur(var(--abyss-backdrop-blur,23px)) saturate(120%) contrast(120%) brightness(25%);}" +
      ".abyss-spotlight-backdrop-layer.is-active{opacity:1;}";
    document.head.appendChild(style);
  }

  function setSpotlightBackdrop(url) {
    if (!url || !backdropOverlay) return;
    safe(function () {
      var incoming = activeBackdropLayer === backdropLayerA ? backdropLayerB : backdropLayerA;
      var outgoing = activeBackdropLayer;

      var img = new Image();
      img.onload = function () {
        safe(function () {
          incoming.style.backgroundImage = 'url("' + url + '")';
          requestAnimationFrame(function () {
            incoming.classList.add("is-active");
            if (outgoing && outgoing !== incoming) {
              setTimeout(function () {
                outgoing.classList.remove("is-active");
              }, 50);
            }
          });
          activeBackdropLayer = incoming;
        });
      };
      img.src = url;
    });
  }

  function postToFrame(iframe, action) {
    if (!iframe || !iframe.contentWindow) return;
    var targetOrigin = "*";
    try {
      if (window.location && window.location.origin && window.location.origin !== "null") {
        targetOrigin = window.location.origin;
      }
    } catch (e) {
      // keep "*" fallback
    }
    safe(function () {
      iframe.contentWindow.postMessage({ type: "abyss-spotlight", action: action }, targetOrigin);
    });
  }


  var spotlightFocused = false;

  function isEditableElement(el) {
    var tag = el && el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || (el && el.isContentEditable);
  }

  var NAV_SELECTOR = [
    "a[href]", "button:not([disabled])", "input:not([disabled]):not([type=hidden])",
    "select:not([disabled])", "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])",
    "[role=menuitem]", "[role=tab]", ".focusable"
  ].join(",");
  // Hover-only overlay controls and secondary links would otherwise add extra stops inside every card.
  var NAV_SKIP = ".cardOverlayButton, .cardOverlayContainer, .textActionButton, .cardText a, .MuiBackdrop-root, [tabindex='-1']:not([role=menuitem])";
  var OVERLAY_SELECTOR = ".MuiMenu-root, .MuiPopover-root, .MuiDialog-root, .MuiDrawer-root .MuiDrawer-paper[role], .dialogContainer, .actionSheet";

  function isShown(el) {
    if (!el || !el.isConnected || el.getClientRects().length === 0) return false;
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    return window.getComputedStyle(el).visibility !== "hidden";
  }

  function openOverlay() {
    var list = document.querySelectorAll(OVERLAY_SELECTOR);
    for (var i = list.length - 1; i >= 0; i--) {
      if (isShown(list[i]) && list[i].querySelector(NAV_SELECTOR)) return list[i];
    }
    return null;
  }

  // Everything arrow-key navigation may land on; confined to the open menu/dialog if there is one.
  function collectNavCandidates() {
    var root = openOverlay() || document;
    return Array.prototype.filter.call(root.querySelectorAll(NAV_SELECTOR), function (el) {
      return !el.matches(NAV_SKIP) && !el.closest("[aria-hidden='true']") && isShown(el);
    });
  }

  function nearestFocusable(originRect, direction, pool) {
    var horizontal = direction === "left" || direction === "right";
    var ocx = originRect.left + originRect.width / 2;
    var ocy = originRect.top + originRect.height / 2;
    var active = document.activeElement;
    var best = null;
    var bestScore = Infinity;

    pool.forEach(function (el) {
      if (!el.isConnected || el === active) return;
      if (active && active !== document.body && (el.contains(active) || active.contains(el))) return;
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;

      var gap, cross;
      if (direction === "down") { if (r.top < originRect.bottom - 4) return; gap = r.top - originRect.bottom; cross = Math.abs(r.left + r.width / 2 - ocx); }
      else if (direction === "up") { if (r.bottom > originRect.top + 4) return; gap = originRect.top - r.bottom; cross = Math.abs(r.left + r.width / 2 - ocx); }
      else if (direction === "right") { if (r.left < originRect.right - 4) return; gap = r.left - originRect.right; cross = Math.abs(r.top + r.height / 2 - ocy); }
      else { if (r.right > originRect.left + 4) return; gap = originRect.left - r.right; cross = Math.abs(r.top + r.height / 2 - ocy); }

      // Sideways moves stay in the current row.
      if (horizontal && (r.top >= originRect.bottom || r.bottom <= originRect.top)) return;

      var score = Math.max(gap, 0) + cross * 2;
      if (score < bestScore) { best = el; bestScore = score; }
    });
    return best;
  }

  var PAD_FOCUS_CLASS = "abyss-pad-focus";

  function ensureFocusStyle() {
    if (document.getElementById("abyss-pad-focus-style")) return;
    var style = document.createElement("style");
    style.id = "abyss-pad-focus-style";
    style.textContent = "." + PAD_FOCUS_CLASS + "{outline:3px solid rgba(var(--abyss-accent,245,245,247),.9)!important;outline-offset:3px;border-radius:12px;}";
    document.head.appendChild(style);
  }

  function focusElement(el) {
    ensureFocusStyle();
    var old = document.querySelectorAll("." + PAD_FOCUS_CLASS);
    for (var i = 0; i < old.length; i++) old[i].classList.remove(PAD_FOCUS_CLASS);
    el.classList.add(PAD_FOCUS_CLASS);
    el.addEventListener("blur", function onBlur() {
      el.classList.remove(PAD_FOCUS_CLASS);
      el.removeEventListener("blur", onBlur);
    });
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    if (el.closest("header, .skinHeader")) {
      try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { window.scrollTo(0, 0); }
      return;
    }
    var tall = el.getBoundingClientRect().height > window.innerHeight * 0.6;
    try { el.scrollIntoView({ block: tall ? "start" : "center", inline: "nearest", behavior: "smooth" }); } catch (e) { /* old engine */ }
  }

  // Desktop layout: Jellyfin doesn't move focus on arrow keys, so do it here.
  // (TV layout has Jellyfin's own navigation, which we leave alone.)
  var NATIVE_ARROW_TAGS = { INPUT: 1, TEXTAREA: 1, SELECT: 1, VIDEO: 1 };

  document.addEventListener("keydown", function (event) {
    var direction = { ArrowDown: "down", ArrowUp: "up", ArrowLeft: "left", ArrowRight: "right" }[event.key];
    if (!direction || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (document.documentElement.classList.contains("layout-tv")) return;
    if (/^#\/video/.test(location.hash)) return;
    var active = document.activeElement;
    if (active && (NATIVE_ARROW_TAGS[active.tagName] || active.isContentEditable || active.getAttribute("role") === "slider")) return;

    var origin = active && active !== document.body && isShown(active)
      ? active.getBoundingClientRect()
      : { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
    var target = nearestFocusable(origin, direction, collectNavCandidates());
    if (!target) return; // nothing that way: let the page scroll as normal

    event.preventDefault();
    if (target === currentIframe && spotlightReady) { enterSpotlight(target); return; }
    focusElement(target);
  });

  function enterSpotlight(iframe) {
    spotlightFocused = true;
    safe(function () { iframe.focus(); });
    postToFrame(iframe, "tv-focus");
  }

  document.addEventListener("keydown", function (event) {
    if (spotlightFocused) return; // events go straight to the iframe's own document while it holds focus
    if (!currentIframe || !currentIframe.isConnected || !spotlightReady) return;
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    var active = document.activeElement;
    if (!active || active === document.body || isEditableElement(active)) return;

    var direction = event.key === "ArrowDown" ? "down" : "up";
    var nearest = nearestFocusable(active.getBoundingClientRect(), direction, collectNavCandidates());

    if (nearest === currentIframe) {
      event.preventDefault();
      event.stopPropagation();
      enterSpotlight(currentIframe);
    }
  }, true); // capture phase... runs before Jellyfin's own keydown handling

  function focusNearestOutside(iframe, direction) {
    try {
      var rect = iframe.getBoundingClientRect();
      // Up from the frame goes to the top nav (the current section's button), even when the
      // frame has scrolled partly under the fixed header and nothing is strictly above it.
      var nearest = null;
      if (direction === "up") {
        var tabs = collectNavTabs();
        if (tabs.length) nearest = tabs[Math.max(activeTabIndex(tabs), 0)];
      }
      var pool = collectNavCandidates().filter(function (el) { return el !== iframe; });
      if (!nearest) nearest = nearestFocusable(rect, direction, pool);
      if (!nearest) return false;
      focusElement(nearest);
      return true;
    } catch (e) {
      return false;
    }
  }

  window.addEventListener("message", function (event) {
    if (!currentIframe || event.source !== currentIframe.contentWindow) return;
    if (!event.data || event.data.type !== "abyss-spotlight") return;
    if (event.data.action === "ready") {
      spotlightReady = true;
      spotlightFailed = false;
      if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
      currentIframe.classList.add("focusable");
      currentIframe.setAttribute("tabindex", "0");
      if (currentSync) safe(currentSync);
      return;
    }
    if (event.data.action === "leave") {
      spotlightFocused = false;
      safe(function () {
        focusNearestOutside(currentIframe, event.data.direction || "down");
      });
      return;
    }
    if (event.data.action === "backdrop-sync") {
      if (document.documentElement.classList.contains("abyss-spotlight-visible")) {
        setSpotlightBackdrop(event.data.url);
      }
      return;
    }
  });

  function isRouteVisible(indexPage, homeTab) {
    if (!indexPage || !indexPage.isConnected || !homeTab || !homeTab.isConnected) return false;
    if (document.hidden) return false;
    if (indexPage.classList.contains("hide") || indexPage.hidden) return false;
    var style = window.getComputedStyle(homeTab);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return homeTab.offsetParent !== null || homeTab.getClientRects().length > 0;
  }

  function connectLifecycle(indexPage, homeTab, favoritesTab, iframe) {
    safe(lifecycleCleanup);
    var lastAction = "";

    var sync = function () {
      safe(function () {
        if (!iframe || !iframe.isConnected) {
          clearSpotlightLifecycle();
          return;
        }
        var favoritesActive = !!(favoritesTab && favoritesTab.classList && favoritesTab.classList.contains("is-active"));
        var active = isRouteVisible(indexPage, homeTab) && !favoritesActive && !spotlightFailed;
        indexPage.classList.toggle("abyss-spotlight-active", !spotlightFailed);
        homeTab.classList.toggle("abyss-spotlight-active", !spotlightFailed);
        var action = active ? "resume" : "pause";
        document.documentElement.classList.toggle("abyss-spotlight-visible", active);
        iframe.style.display = active ? "block" : "none";
        if (action !== lastAction) {
          postToFrame(iframe, action);
          lastAction = action;
          if (action === "pause") clearSpotlightBackdrop();
        }
      });
    };

    if (typeof MutationObserver === "function") {
      safe(function () {
        lifecycleObserver = new MutationObserver(sync);
        lifecycleObserver.observe(indexPage, { attributes: true, attributeFilter: ["class", "hidden"] });
        lifecycleObserver.observe(homeTab, { attributes: true, attributeFilter: ["class", "style"] });
        if (favoritesTab) lifecycleObserver.observe(favoritesTab, { attributes: true, attributeFilter: ["class"] });
        var ancestor = indexPage.parentElement;
        while (ancestor) {
          lifecycleObserver.observe(ancestor, { attributes: true, attributeFilter: ["class", "hidden", "style"] });
          if (ancestor === document.body) break;
          ancestor = ancestor.parentElement;
        }
      });
    }

    var handleLoad = function () {
      lastAction = "";
      sync();
    };
    iframe.addEventListener("load", handleLoad);
    document.addEventListener("visibilitychange", sync);

    lifecycleCleanup = function () {
      if (lifecycleObserver) safe(function () { lifecycleObserver.disconnect(); });
      iframe.removeEventListener("load", handleLoad);
      document.removeEventListener("visibilitychange", sync);
    };

    sync();

    return sync;
  }

  var currentSync = null;

  function findVisibleById(id) {
    var candidates = document.querySelectorAll('[id="' + id + '"]');
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (
        el.isConnected &&
        !el.classList.contains("hide") &&
        !el.hidden
      ) {
        return el;
      }
    }
    return candidates.length ? candidates[candidates.length - 1] : null;
  }

  function installSpotlight() {
    var installed = false;
    safe(function () {
      var indexPage = findVisibleById("indexPage");
      if (!indexPage) {
        clearSpotlightLifecycle();
        return;
      }
      var homeTab = indexPage.querySelector("#homeTab");
      if (!homeTab) {
        clearSpotlightLifecycle();
        return;
      }
      var favoritesTab = indexPage.querySelector("#favoritesTab");

      installFrameStyle();
      installBackdropOverlay();

      var iframe = homeTab.querySelector ? homeTab.querySelector("." + FRAME_CLASS) : null;
      if (!iframe) {
        iframe = document.createElement("iframe");
        iframe.className = FRAME_CLASS;
        iframe.setAttribute("tabindex", "-1");
        iframe.src = spotlightUrl;
        iframe.title = "Abyss Spotlight";
        iframe.addEventListener("blur", function () { spotlightFocused = false; });
        var sections = homeTab.querySelector ? homeTab.querySelector(".sections") : null;
        homeTab.insertBefore(iframe, sections || homeTab.firstChild);
      }

      safe(function () {
        if (indexPage.classList) indexPage.classList.add("abyss-spotlight-active");
        if (homeTab.classList) homeTab.classList.add("abyss-spotlight-active");
      });

      if (
        indexPage !== currentIndexPage ||
        homeTab !== currentHomeTab ||
        favoritesTab !== currentFavoritesTab ||
        iframe !== currentIframe
      ) {
        currentIndexPage = indexPage;
        currentHomeTab = homeTab;
        currentFavoritesTab = favoritesTab;
        currentIframe = iframe;
        currentSync = connectLifecycle(indexPage, homeTab, favoritesTab, iframe);
        if (readyTimer) clearTimeout(readyTimer);
        readyTimer = setTimeout(function () {
          readyTimer = null;
          if (spotlightReady) return;
          spotlightFailed = true;
          if (currentSync) safe(currentSync);
        }, READY_TIMEOUT_MS);
      }
      installed = true;
    });
    return installed;
  }

  function boot() {
    var installScheduled = false;

    var scheduleInstall = function () {
      var alreadyGood =
        currentIndexPage && currentIndexPage.isConnected &&
        currentIndexPage === findVisibleById("indexPage") &&
        currentHomeTab && currentHomeTab.isConnected &&
        currentIframe && currentIframe.isConnected &&
        (!currentFavoritesTab || currentFavoritesTab.isConnected);
      if (alreadyGood) return;
      if (installScheduled) return;
      installScheduled = true;

      var run = function () {
        installScheduled = false;
        installSpotlight();
      };

      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(run);
      } else {
        setTimeout(run, 16);
      }
    };

    if (typeof MutationObserver === "function" && document.body) {
      safe(function () {
        var observer = new MutationObserver(function () {
          scheduleInstall();
        });
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }

    // Safety-net poll: re-verifies element connectivity and forces a fresh
    // visibility sync every 2s, so stale SPA navigation state self-corrects
    // without needing a hard refresh.
    setInterval(function () {
      scheduleInstall();
      if (currentSync) safe(currentSync);
    }, 2000);

    installSpotlight();
  }

  function start() {
    safe(function () {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot, { once: true });
      } else {
        boot();
      }
    });
  }

  // Jellyfin only moves focus on arrow keys in its TV layout, and "Auto" doesn't
  // always detect an Xbox. Default Xbox clients to TV once, unless a layout was chosen.
  safe(function () {
    if (/Xbox/i.test(navigator.userAgent) && !localStorage.getItem("layout")) {
      localStorage.setItem("layout", "tv");
      location.reload();
    }
  });

  // ---------------------------------------------------------------------------
  // Gamepad support (Standard Gamepad mapping, e.g. Xbox controllers)
  //   LB / RB      previous / next section in the nav bar
  //   D-pad/stick  move focus (sent as arrow keys, only if the host isn't already doing it)
  //   A / B        select / back
  //   Menu         open / close the user menu (settings etc.)
  // ---------------------------------------------------------------------------
  var PAD_LB = 4, PAD_RB = 5, PAD_A = 0, PAD_B = 1, PAD_MENU = 9;
  var PAD_DPAD = { 12: "ArrowUp", 13: "ArrowDown", 14: "ArrowLeft", 15: "ArrowRight" };
  var ARROW_CODES = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39 };
  var STICK_THRESHOLD = 0.6;
  var REPEAT_DELAY_MS = 400;
  var REPEAT_RATE_MS = 130;
  var HOST_CHECK_MS = 150;
  var HOST_WINDOW_MS = 300;

  var padLoopRunning = false;
  var padPrev = {};          // button index -> pressed last frame
  var padHeld = null;        // { key, next } for the direction currently held
  var hostTranslatesPad = false; // true once the platform is seen turning pad input into real key events
  var lastTrustedArrowAt = 0;

  var lastPadDirAt = 0;

  document.addEventListener("keydown", function (event) {
    if (!event.isTrusted || !ARROW_CODES[event.key]) return;
    lastTrustedArrowAt = Date.now();
    // A real arrow key right next to a pad press means the host is already translating the pad.
    if (Math.abs(lastTrustedArrowAt - lastPadDirAt) < HOST_WINDOW_MS) hostTranslatesPad = true;
  }, true);

  function isVisible(el) {
    return !!el && el.isConnected && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);
  }

  function collectNavTabs() {
    var sets = [
      "header.MuiAppBar-root > .MuiToolbar-root > .MuiStack-root:first-of-type .MuiButton-root",
      ".headerTabs .emby-tab-button"
    ];
    for (var i = 0; i < sets.length; i++) {
      var found = Array.prototype.filter.call(document.querySelectorAll(sets[i]), isVisible);
      if (found.length > 1) return found;
    }
    return [];
  }

  function activeTabIndex(tabs) {
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      if (t.classList.contains("MuiButton-colorPrimary") || t.classList.contains("emby-tab-button-active") ||
        t.getAttribute("aria-current") || t.getAttribute("aria-selected") === "true") return i;
    }
    return -1;
  }

  function switchNavSection(step) {
    var tabs = collectNavTabs();
    if (!tabs.length) return;
    var current = activeTabIndex(tabs);
    var next = current < 0 ? (step > 0 ? 0 : tabs.length - 1) : current + step;
    if (next < 0 || next >= tabs.length || next === current) return;
    tabs[next].click();
  }

  function keyTarget() {
    if (spotlightFocused && currentIframe) {
      try {
        var d = currentIframe.contentDocument;
        return (d && d.activeElement) || d.body;
      } catch (e) { /* cross-origin frame, fall through */ }
    }
    return document.activeElement || document.body;
  }

  function sendArrow(key) {
    var target = keyTarget();
    if (!target) return;
    var view = target.ownerDocument.defaultView || window;
    var ev = new view.KeyboardEvent("keydown", {
      key: key, code: key, keyCode: ARROW_CODES[key], which: ARROW_CODES[key],
      bubbles: true, cancelable: true
    });
    target.dispatchEvent(ev);
  }

  function pressDirection(key) {
    if (hostTranslatesPad) return; // real key events are already arriving
    var pressedAt = Date.now();
    lastPadDirAt = pressedAt;
    // The host's key can land just before this poll sees the press, or just after.
    if (pressedAt - lastTrustedArrowAt < HOST_WINDOW_MS) { hostTranslatesPad = true; return; }
    setTimeout(function () {
      if (hostTranslatesPad || lastTrustedArrowAt >= pressedAt) { hostTranslatesPad = true; return; }
      sendArrow(key);
    }, padHeld && padHeld.repeating ? 0 : HOST_CHECK_MS);
  }

  function activateFocused() {
    var el = keyTarget();
    if (!el || el === document.body || isEditableElement(el)) return;
    if (typeof el.click === "function") el.click();
  }

  function closeOverlay() {
    var overlay = openOverlay();
    if (!overlay) return false;
    var esc = { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true };
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", esc));
    if (openOverlay()) {
      var backdrop = document.querySelector(".MuiBackdrop-root, .dialogBackdrop");
      if (backdrop) backdrop.click();
    }
    return true;
  }

  var lastMenuAt = 0;

  function toggleMenu() {
    var now = Date.now();
    if (now - lastMenuAt < 400) return; // pad API and host key events can both report one press
    lastMenuAt = now;
    if (closeOverlay()) return;
    // MUI header (desktop) and the legacy header (TV layout) name the user button differently.
    var candidates = document.querySelectorAll(
      "header button[aria-label='User Menu'], .headerUserButton, header button[aria-label*='drawer' i], .mainDrawerButton");
    var btn = null;
    for (var i = 0; i < candidates.length && !btn; i++) if (isShown(candidates[i])) btn = candidates[i];
    if (!btn) return;
    btn.click();
    setTimeout(function () {
      var overlay = openOverlay();
      if (!overlay || overlay.contains(document.activeElement)) return;
      var first = overlay.querySelector("[role=menuitem], " + NAV_SELECTOR);
      if (first) focusElement(first);
    }, 200);
  }

  function goBack() {
    if (closeOverlay()) return;
    if (/^#\/?(home)?(\?.*)?$/.test(location.hash) || location.hash === "#/home.html") return;
    history.back();
  }

  // Some hosts (e.g. Xbox) report the Menu button as a key rather than a pad button.
  document.addEventListener("keydown", function (event) {
    if (event.key === "GamepadMenu" || event.keyCode === 207) safe(toggleMenu);
  }, true);

  function pollGamepads() {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var pad = null;
    for (var i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i].connected) { pad = pads[i]; break; }
    }
    if (!pad) { padLoopRunning = false; padPrev = {}; padHeld = null; return; }

    if (!document.hidden) {
      var down = function (n) { return !!(pad.buttons[n] && pad.buttons[n].pressed); };
      var edge = function (n) { var d = down(n); var was = padPrev[n]; padPrev[n] = d; return d && !was; };

      if (edge(PAD_LB)) safe(function () { switchNavSection(-1); });
      if (edge(PAD_RB)) safe(function () { switchNavSection(1); });
      if (edge(PAD_MENU)) safe(toggleMenu);
      if (edge(PAD_A) && !hostTranslatesPad) safe(activateFocused);
      if (edge(PAD_B) && !hostTranslatesPad) safe(goBack);

      var dir = null;
      for (var b in PAD_DPAD) { if (down(+b)) dir = PAD_DPAD[b]; }
      if (!dir && pad.axes.length >= 2) {
        var x = pad.axes[0], y = pad.axes[1];
        if (Math.abs(x) > STICK_THRESHOLD || Math.abs(y) > STICK_THRESHOLD) {
          dir = Math.abs(x) > Math.abs(y) ? (x > 0 ? "ArrowRight" : "ArrowLeft") : (y > 0 ? "ArrowDown" : "ArrowUp");
        }
      }

      var now = Date.now();
      if (!dir) {
        padHeld = null;
      } else if (!padHeld || padHeld.key !== dir) {
        padHeld = { key: dir, next: now + REPEAT_DELAY_MS, repeating: false };
        safe(function () { pressDirection(dir); });
      } else if (now >= padHeld.next) {
        padHeld.next = now + REPEAT_RATE_MS;
        padHeld.repeating = true;
        safe(function () { pressDirection(dir); });
      }
    }
    requestAnimationFrame(pollGamepads);
  }

  function startGamepadLoop() {
    if (padLoopRunning || typeof requestAnimationFrame !== "function") return;
    padLoopRunning = true;
    requestAnimationFrame(pollGamepads);
  }

  safe(function () {
    window.addEventListener("gamepadconnected", startGamepadLoop);
    // Some consoles never fire gamepadconnected until a button is pressed; check anyway.
    if (navigator.getGamepads) startGamepadLoop();
  });

  start();
})();