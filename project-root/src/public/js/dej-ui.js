/* Shared UI bootstrap: navbar authentication state and colour theme.
   Loaded synchronously in <head> of every view, so the html element carries the
   correct state before the first paint. */
(function () {
  'use strict';

  var root = document.documentElement;

  // ── Theme ───────────────────────────────────────────────────────────────
  var THEME_KEY = 'dej-theme';

  function storedTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (e) {
      return null;
    }
  }

  function prefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyTheme(theme) {
    root.classList.toggle('dark', theme === 'dark');
    root.setAttribute('data-dej-theme', theme);
    document.querySelectorAll('.dej-theme-toggle').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(theme === 'dark'));
      btn.setAttribute('title', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    });
  }

  var currentTheme = storedTheme() || (prefersDark() ? 'dark' : 'light');
  applyTheme(currentTheme);

  function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(THEME_KEY, currentTheme);
    } catch (e) {
      /* storage unavailable — theme still applies for this page */
    }
    applyTheme(currentTheme);
  }

  var ICONS =
    '<svg class="dej-icon-moon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"/></svg>' +
    '<svg class="dej-icon-sun" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="M12 3v1.5m0 15V21m9-9h-1.5m-15 0H3m15.36-6.36l-1.06 1.06M6.7 17.3l-1.06 1.06m12.72 0l-1.06-1.06M6.7 6.7L5.64 5.64M15.5 12a3.5 3.5 0 11-7 0 3.5 3.5 0 017 0z"/></svg>';

  function createToggle(variant) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dej-theme-toggle' + (variant ? ' dej-theme-toggle--' + variant : '');
    btn.innerHTML = ICONS + (variant === 'block' ? '<span class="dej-theme-label"></span>' : '');
    btn.addEventListener('click', toggleTheme);
    return btn;
  }

  // ── Auth state ──────────────────────────────────────────────────────────
  var CACHE_KEY = 'dej-auth-state';

  function cachedAuth() {
    try {
      return JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
    } catch (e) {
      return null;
    }
  }

  function cacheAuth(state) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(state));
    } catch (e) {
      /* ignore */
    }
  }

  // Server-injected state is authoritative; the session cache only covers pages
  // that are served without it.
  var auth = window.__DEJ_AUTH__ || cachedAuth();
  if (window.__DEJ_AUTH__) cacheAuth(window.__DEJ_AUTH__);

  function setAuthFlag(state) {
    root.setAttribute('data-dej-auth', !state ? 'unknown' : state.isAuthenticated ? 'in' : 'out');
  }

  setAuthFlag(auth);

  function initials(name) {
    return name
      .split(/\s+/)
      .map(function (part) { return part[0]; })
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  function renderAuth(state) {
    setAuthFlag(state);

    document.querySelectorAll('.dej-user-menu, .dej-mobile-user').forEach(function (el) { el.remove(); });
    if (!state || !state.isAuthenticated) return;

    var user = state.user || {};
    var displayName = user.name || user.email || 'User';

    var desktopAnchor = document.getElementById('authLinks');
    if (desktopAnchor && desktopAnchor.parentNode) {
      var menu = document.createElement('span');
      menu.className = 'dej-user-menu';
      menu.innerHTML =
        '<span class="dej-avatar" aria-hidden="true">' + initials(displayName) + '</span>' +
        '<span class="dej-user-name">' + displayName + '</span>' +
        '<a href="/logout" class="dej-logout">Logout</a>';
      desktopAnchor.parentNode.insertBefore(menu, desktopAnchor.nextSibling);
    }

    var mobileAnchor = document.getElementById('mobileAuthLinks');
    if (mobileAnchor && mobileAnchor.parentNode) {
      var mobile = document.createElement('div');
      mobile.className = 'dej-mobile-user border-t border-white/10 pt-4 mt-3';
      mobile.innerHTML =
        '<div class="text-sm text-white/70 mb-2 font-medium px-1">' + displayName + '</div>' +
        '<a href="/logout" class="block w-full text-center border border-white/10 px-4 py-3 rounded-xl text-white/70">Logout</a>';
      mobileAnchor.parentNode.insertBefore(mobile, mobileAnchor.nextSibling);
    }

    ['dashboardTab', 'mobileDashboardTab'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.remove('hidden');
    });
  }

  // ── Mount ───────────────────────────────────────────────────────────────
  function isVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function onDarkSurface(el) {
    for (var node = el; node && node.nodeType === 1; node = node.parentElement) {
      var cls = node.className && node.className.baseVal !== undefined ? node.className.baseVal : node.className;
      if (typeof cls === 'string' && /bg-navy-(8|9)\d*/.test(cls)) return true;
    }
    return false;
  }

  function mountThemeToggles() {
    if (document.querySelector('.dej-theme-toggle')) return;

    var desktopNav =
      document.querySelector('header nav[role="navigation"]') ||
      document.querySelector('header nav') ||
      document.querySelector('body > nav') ||
      document.querySelector('nav');
    var authLinks = document.getElementById('authLinks');
    var mounted = false;

    if (desktopNav && isVisible(desktopNav)) {
      var toggle = createToggle(onDarkSurface(desktopNav) ? null : 'light');
      if (authLinks && authLinks.parentNode === desktopNav) {
        desktopNav.insertBefore(toggle, authLinks);
      } else {
        desktopNav.appendChild(toggle);
      }
      mounted = isVisible(toggle);
      if (!mounted) toggle.remove();
    }

    var mobileMenu = document.getElementById('mobileMenu');
    if (mobileMenu) {
      var container = mobileMenu.firstElementChild || mobileMenu;
      var mobileToggle = createToggle('block');
      mobileToggle.classList.add('text-white/80', 'border-white/10');
      container.appendChild(mobileToggle);
    }

    // Pages without a usable navbar (auth screens, print views) get a floating
    // control so the theme can be switched everywhere.
    if (!mounted) document.body.appendChild(createToggle('floating'));

    applyTheme(currentTheme);
  }

  function init() {
    mountThemeToggles();
    renderAuth(auth);

    // Pages served outside the express view pipeline have no injected state.
    if (!window.__DEJ_AUTH__) {
      fetch('/api/me', { credentials: 'include' })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          cacheAuth(data);
          renderAuth(data);
        })
        .catch(function () { setAuthFlag({ isAuthenticated: false }); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
