// ===== Cursor relay (keeps the parent's secret buttons reachable) =====
// Forward this frame's cursor position up to the parent, translating any
// coordinates relayed from our own child iframes into this frame's space.
(function () {
  function up(x, y) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ __cursor: true, x, y }, '*');
    }
  }
  document.addEventListener('mousemove', (e) => up(e.clientX, e.clientY));
  window.addEventListener('message', (e) => {
    if (!e.data || !e.data.__cursor) return;
    const frames = document.querySelectorAll('iframe');
    for (const f of frames) {
      if (f.contentWindow === e.source) {
        const r = f.getBoundingClientRect();
        up(e.data.x + r.left, e.data.y + r.top);
        break;
      }
    }
  });
})();

// Detect if running inside an iframe and add embedded class
if (window !== window.parent) {
  document.documentElement.classList.add('embedded');
  document.body.classList.add('embedded');
  document.body.classList.add('modal-active');

  // Store personalization data until slackbot-dm-view iframe is ready
  let pendingPersonalization = null;
  let slackbotDmViewReady = false;
  let landOnView = 'slackbot-dm'; // which view to land on after the modal closes

  // Listen for parent to show/hide top-bar items and relay personalization
  window.addEventListener('message', (e) => {
    if (e.data === 'modal-dismissed') {
      document.body.classList.remove('modal-active');
      const sidebar = document.querySelector('.sidebar');

      if (landOnView === 'new-channel') {
        // ===== Design B: land on #tractor-channel =====
        // Sidebar is open right away; the channel's cards animate in instead.
        if (typeof window.landOnTractorChannel === 'function') window.landOnTractorChannel();
        // Sidebar is open instantly (no slide-in) for Design B.
        if (sidebar) sidebar.classList.add('instant', 'revealed');
        // Tell the channel view to play its intro animation.
        const channelIframe = document.querySelector('.channel-view-iframe');
        const playCardIntro = () => {
          if (channelIframe && channelIframe.contentWindow) {
            channelIframe.contentWindow.postMessage('channel-intro', '*');
          }
        };
        setTimeout(playCardIntro, 200);
        if (channelIframe) channelIframe.addEventListener('load', playCardIntro);
        // Auto-open the setup peek (pinned) 2s after the app lands.
        setTimeout(() => {
          if (typeof showPocketGuide === 'function') showPocketGuide(true);
        }, 2000);
      } else {
        // ===== Design A: land on Launchpad (sidebar reveals after a beat) =====
        if (sidebar) {
          setTimeout(() => {
            requestAnimationFrame(() => sidebar.classList.add('revealed'));
          }, 1440);

          // Sidebar width and content fade both finish at 1.2s after reveal
          // 1440ms start + 1200ms = 2640ms
          setTimeout(() => {
            const slackbotDmIframe = document.querySelector('.slackbot-dm-view-iframe');
            if (slackbotDmIframe && slackbotDmIframe.contentWindow) {
              slackbotDmIframe.contentWindow.postMessage('sidebar-content-ready', '*');
            }
          }, 2640);
        }
      }
      // Send any pending personalization after dismiss
      if (pendingPersonalization) {
        sendToSlackbotDmView(pendingPersonalization);
      }
    }
    // Parent (a secret menu) opened — dismiss the setup peek.
    if (e.data === 'dismiss-peek' && typeof hidePocketGuide === 'function') {
      hidePocketGuide();
    }
    // Relay onboarding-complete to the slackbot-dm-view iframe
    if (e.data && e.data.type === 'onboarding-complete') {
      pendingPersonalization = e.data;
      if (e.data.landOn) landOnView = e.data.landOn;
      // Design B (lands on the channel) enables the sidebar setup peek.
      window.__designB = e.data.landOn === 'new-channel';
      sendToSlackbotDmView(e.data);
    }
    // Slackbot DM view iframe signals it's ready
    if (e.data === 'slackbot-dm-view-ready') {
      slackbotDmViewReady = true;
      if (pendingPersonalization) {
        sendToSlackbotDmView(pendingPersonalization);
      }
    }
  });

  function sendToSlackbotDmView(data) {
    const slackbotDmIframe = document.querySelector('.slackbot-dm-view-iframe');
    if (slackbotDmIframe && slackbotDmIframe.contentWindow) {
      slackbotDmIframe.contentWindow.postMessage(data, '*');
    }
  }
} else {
  // Standalone mode — reveal sidebar after a brief delay
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    setTimeout(() => {
      requestAnimationFrame(() => sidebar.classList.add('revealed'));
    }, 300);

    // Trigger intro animation in slackbot-dm-view after sidebar starts revealing
    setTimeout(() => {
      const slackbotDmIframe = document.querySelector('.slackbot-dm-view-iframe');
      if (slackbotDmIframe && slackbotDmIframe.contentWindow) {
        slackbotDmIframe.contentWindow.postMessage({ type: 'onboarding-complete' }, '*');
      }
    }, 400);

    // Signal sidebar content ready after sidebar finishes expanding
    setTimeout(() => {
      const slackbotDmIframe = document.querySelector('.slackbot-dm-view-iframe');
      if (slackbotDmIframe && slackbotDmIframe.contentWindow) {
        slackbotDmIframe.contentWindow.postMessage('sidebar-content-ready', '*');
      }
    }, 1500);
  }
}

// Section collapse/expand
document.querySelectorAll('.section-header-iconic').forEach(header => {
  header.addEventListener('click', () => {
    const items = header.nextElementSibling;
    if (items && items.classList.contains('section-items')) {
      items.classList.toggle('collapsed');
      header.classList.toggle('collapsed');
    }
  });
});

// Unified sidebar selection + view switching
const slackbotDmView = document.querySelector('.slackbot-dm-view-frame');
const placeholderView = document.querySelector('.placeholder-view');
const channelView = document.querySelector('.channel-view-frame');

// Navigation history for back/forward
// Each entry: { view: 'slackbot-dm', substate: 'home' | 'conversation' }
const navHistory = [{ view: 'slackbot-dm', substate: 'home' }];
let navIndex = 0;
let isNavigating = false; // flag to prevent re-pushing during back/forward
const btnBack = document.getElementById('btnBack');
const btnForward = document.getElementById('btnForward');

function updateNavButtons() {
  if (btnBack) {
    btnBack.disabled = navIndex <= 0;
    btnBack.classList.toggle('disabled', navIndex <= 0);
  }
  if (btnForward) {
    btnForward.disabled = navIndex >= navHistory.length - 1;
    btnForward.classList.toggle('disabled', navIndex >= navHistory.length - 1);
  }
}

function pushNavState(state) {
  if (isNavigating) return;
  navHistory.splice(navIndex + 1);
  navHistory.push(state);
  navIndex = navHistory.length - 1;
  updateNavButtons();
}

function clearAllSelections() {
  document.querySelectorAll('.page-row').forEach(r => r.classList.remove('active-page'));
  document.querySelectorAll('.channel-row').forEach(r => r.classList.remove('active-channel'));
  document.querySelectorAll('.dm-row').forEach(r => r.classList.remove('active-dm'));
}

function selectSidebarItem(viewName) {
  clearAllSelections();
  const pageRow = document.querySelector(`.page-row[data-view="${viewName}"]`);
  if (pageRow) { pageRow.classList.add('active-page'); return; }
  const channelRow = document.querySelector(`.channel-row[data-view="${viewName}"]`);
  if (channelRow) { channelRow.classList.add('active-channel'); return; }
  const dmRow = document.querySelector(`.dm-row[data-view="${viewName}"]`);
  if (dmRow) { dmRow.classList.add('active-dm'); }
}

function showView(viewName, addToHistory) {
  slackbotDmView.style.display = 'none';
  placeholderView.style.display = 'none';
  channelView.style.display = 'none';

  if (viewName === 'slackbot-dm') {
    slackbotDmView.style.display = '';
  } else if (viewName === 'new-channel') {
    channelView.style.display = '';
  } else {
    placeholderView.style.display = '';
  }

  // Push to history unless navigating via back/forward
  if (addToHistory !== false) {
    pushNavState({ view: viewName, substate: 'home' });
  }
  updateNavButtons();
}

// Design B entry point: land on the #tractor-channel after the modal closes.
window.landOnTractorChannel = function () {
  const channelRow = document.querySelector('.channel-row[data-view="new-channel"]');
  selectSidebarItem('new-channel');
  showView('new-channel');
};

// Listen for substate changes from slackbot-dm-view iframe
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'nav-state-push') {
    pushNavState({ view: 'slackbot-dm', substate: e.data.substate });
  }
});

function restoreState(state) {
  isNavigating = true;
  selectSidebarItem(state.view);

  // Show the correct view
  slackbotDmView.style.display = 'none';
  placeholderView.style.display = 'none';
  channelView.style.display = 'none';

  if (state.view === 'slackbot-dm') {
    slackbotDmView.style.display = '';
    // Tell iframe to restore substate
    const iframe = document.querySelector('.slackbot-dm-view-iframe');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'nav-restore', substate: state.substate }, '*');
    }
  } else if (state.view === 'new-channel') {
    channelView.style.display = '';
  } else {
    placeholderView.style.display = '';
  }

  isNavigating = false;
  updateNavButtons();
}

if (btnBack) {
  btnBack.addEventListener('click', () => {
    if (navIndex > 0) {
      navIndex--;
      restoreState(navHistory[navIndex]);
    }
  });
}

if (btnForward) {
  btnForward.addEventListener('click', () => {
    if (navIndex < navHistory.length - 1) {
      navIndex++;
      restoreState(navHistory[navIndex]);
    }
  });
}

updateNavButtons();

// Workspace name escape hatch — full reset to default Slackbot home
const workspaceHome = document.getElementById('workspaceHome');
if (workspaceHome) {
  workspaceHome.addEventListener('click', () => {
    clearAllSelections();
    const slackbotRow = document.querySelector('.page-row[data-view="slackbot-dm"]');
    if (slackbotRow) slackbotRow.classList.add('active-page');

    // Reset navigation history
    navHistory.length = 0;
    navHistory.push({ view: 'slackbot-dm', substate: 'home' });
    navIndex = 0;
    isNavigating = true;

    // Show slackbot view
    slackbotDmView.style.display = '';
    placeholderView.style.display = 'none';
    channelView.style.display = 'none';

    // Tell iframe to fully reset
    const iframe = document.querySelector('.slackbot-dm-view-iframe');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'nav-full-reset' }, '*');
    }

    isNavigating = false;
    updateNavButtons();
  });
}

// ===== Sidebar setup peek (Pocket Guide) — Design B only =====
const setupRow = document.querySelector('.page-row.setup-row');
const pocketGuide = document.getElementById('pocketGuide');
const pocketGuideClose = document.getElementById('pocketGuideClose');
let pocketHideTimer = null;
let pocketPinned = false; // pinned = stays open until X dismiss (click/auto-open)

function positionPocketGuide() {
  if (!setupRow || !pocketGuide) return;
  const r = setupRow.getBoundingClientRect();
  const top = r.top - 8;
  // Flush to the right of the sidebar row.
  pocketGuide.style.left = (r.right + 10) + 'px';
  pocketGuide.style.top = top + 'px';
  // Center the tail on the row's vertical midpoint (tail is 12px tall).
  const tail = pocketGuide.querySelector('.pocket-guide__tail');
  if (tail) tail.style.top = (r.top + r.height / 2 - top - 6) + 'px';
}
function showPocketGuide(pin) {
  if (!setupRow || !pocketGuide || !window.__designB) return;
  cancelPocketHide();
  positionPocketGuide();
  if (pin) {
    pocketPinned = true;
    pocketGuide.classList.add('pinned');
  }
  pocketGuide.classList.add('visible');
  pocketGuide.setAttribute('aria-hidden', 'false');
  // Keep the sidebar row highlighted (Hover state) while the peek is open.
  setupRow.classList.add('peek-open');
}
function hidePocketGuide() {
  if (!pocketGuide) return;
  pocketPinned = false;
  // Restore the first-item preview for the next time the peek opens.
  pocketGuide.classList.remove('visible', 'pinned', 'interacted');
  pocketGuide.setAttribute('aria-hidden', 'true');
  if (setupRow) setupRow.classList.remove('peek-open');
}
function schedulePocketHide() {
  if (pocketPinned) return; // pinned peeks ignore hover-out
  pocketHideTimer = setTimeout(hidePocketGuide, 150);
}
function cancelPocketHide() { if (pocketHideTimer) { clearTimeout(pocketHideTimer); pocketHideTimer = null; } }

// Page rows (Slackbot, Directory, Huddles)
document.querySelectorAll('.page-row').forEach(row => {
  row.addEventListener('click', () => {
    // Design B: the "Set up your Slack" row opens the peek (pinned) instead of a view.
    if (window.__designB && row.classList.contains('setup-row')) {
      showPocketGuide(true);
      return;
    }
    clearAllSelections();
    row.classList.add('active-page');
    showView(row.dataset.view);
  });
});

if (setupRow && pocketGuide) {
  // The first task previews its expanded state until the user interacts with
  // the peek; then normal hover behavior takes over.
  function markInteracted() { pocketGuide.classList.add('interacted'); }

  setupRow.addEventListener('mouseenter', () => {
    if (!window.__designB) return;
    cancelPocketHide();
    showPocketGuide(false);
  });
  setupRow.addEventListener('mouseleave', schedulePocketHide);
  pocketGuide.addEventListener('mouseenter', () => { cancelPocketHide(); markInteracted(); });
  pocketGuide.addEventListener('mouseleave', schedulePocketHide);
  // X dismiss button.
  if (pocketGuideClose) {
    pocketGuideClose.addEventListener('click', (e) => {
      e.stopPropagation();
      hidePocketGuide();
    });
  }
  // Clicking a task opens the placeholder modal (does not check it off).
  pocketGuide.querySelectorAll('.pocket-guide__task').forEach(task => {
    task.addEventListener('click', () => {
      const title = task.querySelector('.pocket-guide__task-title');
      window.top.postMessage({ type: 'open-placeholder', title: title ? title.textContent.trim() : '' }, '*');
    });
  });
}

// Channel rows (exclude add-row)
document.querySelectorAll('.channel-row:not(.add-row)').forEach(row => {
  row.addEventListener('click', () => {
    clearAllSelections();
    row.classList.add('active-channel');
    showView(row.dataset.view);
  });
});

// DM rows
document.querySelectorAll('.dm-row').forEach(row => {
  row.addEventListener('click', () => {
    clearAllSelections();
    row.classList.add('active-dm');
    showView(row.dataset.view);
  });
});

// Search bar focus interaction
const searchBar = document.querySelector('.search-bar');
if (searchBar) {
  searchBar.addEventListener('click', () => {
    searchBar.style.background = 'rgba(249, 237, 255, 0.35)';
    searchBar.style.boxShadow = '0 0 0 1px #1264A3, 0 0 7px rgba(18, 100, 163, 0.3)';
  });
  document.addEventListener('click', (e) => {
    if (!searchBar.contains(e.target)) {
      searchBar.style.background = '';
      searchBar.style.boxShadow = '';
    }
  });
}

// Trial badge tooltip positioning
const trialWrapper = document.querySelector('.trial-tag-wrapper');
const trialTag = document.querySelector('.trial-tag');
const trialTooltip = document.querySelector('.trial-tooltip');
if (trialWrapper && trialTag && trialTooltip) {
  // Move tooltip to body so it isn't clipped by sidebar overflow:hidden
  document.body.appendChild(trialTooltip);

  trialWrapper.addEventListener('mouseenter', () => {
    const rect = trialTag.getBoundingClientRect();
    trialTooltip.style.display = 'flex';
    const tooltipHeight = trialTooltip.offsetHeight;
    trialTooltip.style.top = (rect.top + rect.height / 2 - tooltipHeight / 2) + 'px';
    trialTooltip.style.left = (rect.right + 8) + 'px';
  });
  trialWrapper.addEventListener('mouseleave', () => {
    trialTooltip.style.display = 'none';
  });
}

// Nav bar iframe: toggle width when more menu opens/closes
const navIframe = document.querySelector('.nav-bar-iframe');
window.addEventListener('message', (e) => {
  if (!navIframe) return;
  if (e.data === 'more-menu-open') {
    navIframe.classList.add('menu-open');
  } else if (e.data === 'more-menu-close') {
    navIframe.classList.remove('menu-open');
  }
});

// Dismiss nav bar more menu when clicking outside the iframe
document.addEventListener('click', () => {
  if (navIframe && navIframe.contentWindow) {
    navIframe.contentWindow.postMessage('dismiss-more-menu', '*');
  }
});

// Connect Apps hover menu
const connectAppsTrigger = document.querySelector('.connect-apps-trigger');
const connectAppsMenu = document.querySelector('.connect-apps-menu');
let connectAppsHideTimeout = null;

function showConnectAppsMenu() {
  if (!connectAppsTrigger || !connectAppsMenu) return;
  if (typeof hidePocketGuide === 'function') hidePocketGuide(); // close the setup peek
  const rect = connectAppsTrigger.getBoundingClientRect();
  connectAppsMenu.style.left = (rect.right + 8) + 'px';
  connectAppsMenu.style.top = (rect.top - 8) + 'px';
  connectAppsMenu.classList.add('visible');
}

function hideConnectAppsMenu() {
  if (connectAppsMenu) connectAppsMenu.classList.remove('visible');
}

function scheduleConnectAppsHide() {
  connectAppsHideTimeout = setTimeout(() => { hideConnectAppsMenu(); }, 150);
}

function cancelConnectAppsHide() {
  if (connectAppsHideTimeout) { clearTimeout(connectAppsHideTimeout); connectAppsHideTimeout = null; }
}

if (connectAppsTrigger && connectAppsMenu) {
  connectAppsTrigger.addEventListener('mouseenter', () => {
    cancelConnectAppsHide();
    showConnectAppsMenu();
  });
  connectAppsTrigger.addEventListener('mouseleave', () => {
    scheduleConnectAppsHide();
  });
  connectAppsMenu.addEventListener('mouseenter', () => {
    cancelConnectAppsHide();
  });
  connectAppsMenu.addEventListener('mouseleave', () => {
    scheduleConnectAppsHide();
  });
  document.addEventListener('click', (e) => {
    if (!connectAppsMenu.contains(e.target) && !connectAppsTrigger.contains(e.target)) {
      hideConnectAppsMenu();
    }
  });
}

// Show the same Connect Apps menu when hovering the "Connect your work apps
// and tools" task inside the launchpad iframe. The row reports its position
// relative to the iframe; we offset by the iframe's on-screen position.
function showConnectAppsMenuAt(left, top) {
  if (!connectAppsMenu) return;
  connectAppsMenu.style.left = left + 'px';
  connectAppsMenu.style.top = top + 'px';
  connectAppsMenu.classList.add('visible');
}

window.addEventListener('message', (e) => {
  if (!connectAppsMenu) return;
  const viewIframe = document.querySelector('.slackbot-dm-view-iframe');
  if (e.data && e.data.type === 'connect-apps-anchor' && viewIframe) {
    cancelConnectAppsHide();
    const frameRect = viewIframe.getBoundingClientRect();
    // Align the menu's right edge with the row's right edge, dropping it
    // just below the row top (360 = menu width from styles.css).
    const left = frameRect.left + e.data.right - 360;
    const top = frameRect.top + e.data.top + 40;
    showConnectAppsMenuAt(Math.max(left, 8), top);
  }
  if (e.data && e.data.type === 'connect-apps-hide') {
    scheduleConnectAppsHide();
  }
});

// Keyboard accessibility for interactive elements
document.querySelectorAll('.page-row, .section-header-iconic, .channel-row, .dm-row').forEach(el => {
  if (!el.hasAttribute('tabindex')) {
    el.setAttribute('tabindex', '0');
  }
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      el.click();
    }
  });
});


// Sidebar fadeable sections: reveal all permanently on first hover of any
const fadeableSections = document.querySelectorAll('.sidebar-fadeable');
function revealAllFadeables() {
  fadeableSections.forEach(s => s.classList.add('section-revealed'));
}
fadeableSections.forEach(section => {
  section.addEventListener('mouseenter', revealAllFadeables, { once: true });
});

// AI banner dismiss
const aiBannerClose = document.getElementById('aiBannerClose');
if (aiBannerClose) {
  aiBannerClose.addEventListener('click', () => {
    document.getElementById('aiBanner').classList.add('hidden');
    // Content will naturally expand since banner is removed from flow
    // Notify slackbot-dm-view iframe to expand
    const slackbotDmIframe = document.querySelector('.slackbot-dm-view-iframe');
    if (slackbotDmIframe && slackbotDmIframe.contentWindow) {
      slackbotDmIframe.contentWindow.postMessage('banner-dismissed', '*');
    }
  });
}

// Dev menu toggle and design switching
const devMenuBtn = document.getElementById('devMenuBtn');
const devMenu = document.getElementById('devMenu');

if (devMenuBtn && devMenu) {
  // Restore saved design choice on load
  const savedDesign = localStorage.getItem('slackbot-design') || 'a';
  if (savedDesign !== 'a') {
    devMenu.querySelectorAll('.dev-menu-item').forEach(i => i.classList.remove('active'));
    const savedItem = devMenu.querySelector(`.dev-menu-item[data-design="${savedDesign}"]`);
    if (savedItem) savedItem.classList.add('active');
  }

  devMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    devMenu.classList.toggle('visible');
  });

  document.addEventListener('click', (e) => {
    if (!devMenu.contains(e.target) && !devMenuBtn.contains(e.target)) {
      devMenu.classList.remove('visible');
    }
  });

  devMenu.querySelectorAll('.dev-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      devMenu.querySelectorAll('.dev-menu-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      devMenu.classList.remove('visible');

      const design = item.dataset.design;
      localStorage.setItem('slackbot-design', design);
      const iframe = document.querySelector('.slackbot-dm-view-iframe');
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'switch-design', design: design }, '*');
      }
    });
  });
}
