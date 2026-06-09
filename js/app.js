// ============================================================
// js/app.js – Application principale : router, navigation, état global
// ============================================================

import { getAllSettings, getSetting, setSetting, getActiveUsers, getMonthsByYear, onWrite,
         getAllBudgetOps }                                        from './db.js';
import { initDriveSync, startAutoSave, initActivityTracking,
         markDirty, testDriveConnection }                         from './sync.js';
import { today, showToast, closeModal, openModal, nomMois,
         addMonth, isMonthEmpty }                                 from './utils.js';
import { DRIVE_URL_KEY, isValidDriveUrl }                         from './drive.js';

// ── État global de l'application ──
export const State = {
  page:          'dashboard',
  year:          today().year,
  month:         today().month,
  users:         [],   // utilisateurs actifs chargés en mémoire
  currentUserId: null, // ID de l'utilisateur de cet appareil (localStorage)
  settings:      {},
};

// ── Mapping pages → modules ──
const PAGES = {
  dashboard: () => import('./ui/dashboard.js'),
  argent:    () => import('./ui/argent.js'),
  charges:   () => import('./ui/charges.js'),  // toujours accessible (utilisé par argent.js)
  savings:   () => import('./ui/savings.js'),  // toujours accessible (utilisé par argent.js)
  stats:     () => import('./ui/stats.js'),
  settings:  () => import('./ui/settings.js'),
};

const PAGE_TITLES = {
  dashboard: 'Accueil',
  argent:    'Argent',
  charges:   'Charges & Budgets',
  savings:   'Épargne',
  stats:     'Analyse',
  settings:  'Réglages',
};

let _currentCleanup = null;

// ── Navigation vers une page ──
export async function navigateTo(page, params = {}) {
  if (!PAGES[page]) page = 'dashboard';

  if (_currentCleanup) { try { _currentCleanup(); } catch (e) {} }

  State.page = page;
  if (params.year)  State.year  = params.year;
  if (params.month) State.month = params.month;

  // FAB : masquer sur la page argent
  if (window._fabUpdater) window._fabUpdater();

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  document.getElementById('page-title').textContent = PAGE_TITLES[page] ?? 'Compta+';
  window.location.hash = page;

  const content = document.getElementById('app-content');
  content.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  content.scrollTop = 0;

  try {
    const mod = await PAGES[page]();
    _currentCleanup = await mod.render(content, params) ?? null;
    content.classList.remove('page-enter');
    // Double rAF : garantit un cycle de layout entre les deux états CSS
    requestAnimationFrame(() => requestAnimationFrame(() => content.classList.add('page-enter')));
    _initCounters(content);
    // Mettre à jour les badges nav en arrière-plan
    setTimeout(() => { checkBudgetAlerts().catch(()=>{}); }, 500);
  } catch (err) {
    console.error('[App] Erreur lors du rendu de la page :', err);
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <div class="empty-state-title">Erreur de chargement</div>
        <div class="empty-state-text">${err.message}</div>
      </div>`;
  }
}

// ── Rechargement des utilisateurs en mémoire ──
export async function reloadUsers() {
  State.users = await getActiveUsers();
}

/** @deprecated — utiliser reloadUsers directement */
// export async function reloadNames() { return reloadUsers(); }

// ── Vérification des mois non remplis + notification push ──
async function checkUnfilledMonths() {
  try {
    const { year, month } = today();

    const monthsData = await getMonthsByYear(year);
    const monthMap   = Object.fromEntries(monthsData.map(m => [m.month, m]));

    let unfilled = 0;
    for (let m = 1; m <= month; m++) {
      if (isMonthEmpty(monthMap[m])) unfilled++;
    }

    const badge = document.querySelector('[data-page="dashboard"] .nav-badge');
    if (badge) {
      badge.textContent = unfilled > 0 ? unfilled : '';
      badge.classList.toggle('hidden', unfilled === 0);
    }

    await _checkAndFireNotification(year, month, monthMap[month]);
  } catch (e) { /* silencieux */ }
}

// ── Alerte dépassement budget sur la nav ──
async function checkBudgetAlerts() {
  try {
    const { year, month } = State;
    const [md, ops, s]    = await Promise.all([
      (await import('./db.js')).getMonthlyData(year, month),
      (await import('./db.js')).getBudgetOpsForMonth(year, month),
      getAllSettings(),
    ]);
    const budgets      = s.customBudgets || [];
    const users        = await getActiveUsers();
    const budgCourses  = users.reduce((a, u) => a + (Number(md?.users?.[String(u.id)]?.courses) || 0), 0);
    const budgExtras   = users.reduce((a, u) => a + (Number(md?.users?.[String(u.id)]?.extras)  || 0), 0);
    const spent        = cat => ops.filter(o => o.category === cat).reduce((s, o) => s + (Number(o.amount) || 0), 0);

    const exceeded = [
      { id: 'courses', budget: budgCourses },
      { id: 'extras',  budget: budgExtras  },
      ...budgets.map(b => ({ id: b.id, budget: Number(b.amount) || 0 })),
    ].filter(b => b.budget > 0 && spent(b.id) >= b.budget * 0.8).length;

    const badge = document.getElementById('badge-budget');
    if (badge) {
      badge.textContent = exceeded > 0 ? exceeded : '';
      badge.classList.toggle('hidden', exceeded === 0);
    }
  } catch (e) { /* silencieux */ }
}

// ── Notification push réelle (system) ──
async function _checkAndFireNotification(year, month, md) {
  try {
    const settings = await getAllSettings();
    if (!settings.notifEnabled) return;
    if (!('Notification' in window)) return;

    // Vérifier la permission
    if (Notification.permission !== 'granted') return;

    // Ne notifier que si le mois n'est pas rempli
    if (!isMonthEmpty(md)) return;

    // Éviter de notifier plusieurs fois le même mois
    const lastNotifStr = await getSetting('lastNotifSent');
    if (lastNotifStr) {
      const d = new Date(lastNotifStr);
      if (d.getFullYear() === year && d.getMonth() + 1 === month) return;
    }

    // Déclencher seulement avant le jour configuré (défaut 7)
    const day    = new Date().getDate();
    const cutoff = Number(settings.notifDay) || 7;
    if (day < cutoff) return;

    // Stocker la date de notification pour éviter les doublons
    await setSetting('lastNotifSent', new Date().toISOString());

    const body = `Le mois de ${nomMois(month)} n'a pas encore été rempli. 📋`;

    // Préférer la notification via Service Worker (reste visible hors focus)
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification('Compta+', {
        body,
        icon:  './icons/icon.svg',
        badge: './icons/icon.svg',
        tag:   'monthly-reminder',
        data:  { page: 'dashboard' },
        actions: [{ action: 'open', title: 'Saisir' }],
      });
    } else {
      new Notification('Compta+', { body, icon: './icons/icon.svg' });
    }

    // Rappels personnalisés
    const customReminders = settings.customReminders || [];
    for (const r of customReminders) {
      if (!r.enabled) continue;
      if (day !== r.dayOfMonth) continue;
      const lastKey = `lastReminderSent_${r.id}`;
      const lastRem = await getSetting(lastKey);
      if (lastRem) {
        const d = new Date(lastRem);
        if (d.getFullYear() === year && d.getMonth() + 1 === month) continue;
      }
      await setSetting(lastKey, new Date().toISOString());
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification('Compta+ – Rappel', {
          body: r.label,
          icon:  './icons/icon.svg',
          badge: './icons/icon.svg',
          tag:   `reminder-${r.id}`,
          data:  { page: 'dashboard' },
        });
      } else {
        new Notification('Compta+ – Rappel', { body: r.label, icon: './icons/icon.svg' });
      }
    }
  } catch (e) { /* silencieux */ }
}

// ── Nav hide/show on scroll ──
function _initNavScroll() {
  const content = document.getElementById('app-content');
  const nav     = document.getElementById('bottom-nav');
  if (!content || !nav) return;
  let lastY = 0;
  let ticking = false;
  content.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = content.scrollTop;
      if (y > lastY + 8 && y > 60) {
        nav.classList.add('nav-hidden');
      } else if (y < lastY - 8) {
        nav.classList.remove('nav-hidden');
      }
      lastY = y;
      ticking = false;
    });
  }, { passive: true });
}

// ── Counter animation pour éléments .data-counter[data-value] ──
let _counterRafs = [];
function _initCounters(root) {
  // Annuler les animations précédentes
  _counterRafs.forEach(id => cancelAnimationFrame(id));
  _counterRafs = [];
  const elements = root.querySelectorAll('.data-counter[data-value]');
  elements.forEach(el => {
    const target = parseFloat(el.dataset.value);
    if (isNaN(target)) return;
    const isEuro = el.dataset.euro !== undefined;
    const duration = 700;
    const start = performance.now();
    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      // ease-out cubic
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = target * ease;
      el.textContent = isEuro
        ? current.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
        : current.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
      if (progress < 1) {
        const rafId = requestAnimationFrame(tick);
        _counterRafs.push(rafId);
      }
    }
    const rafId = requestAnimationFrame(tick);
    _counterRafs.push(rafId);
  });
}

// ── Initialisation ──
async function init() {
  try {
    State.settings = await getAllSettings();
  } catch (e) {
    console.warn('[App] Impossible de charger les réglages :', e);
  }

  // Utilisateur de cet appareil
  State.currentUserId = localStorage.getItem('currentDeviceUserId');

  // Utilisateurs actifs en mémoire
  await reloadUsers();

  // Thème
  applyTheme(State.settings.theme ?? 'auto');

  // Tracking d'activité (pour auto-save)
  initActivityTracking();

  // Connecter le dirty flag IDB → sync
  onWrite(markDirty);

  // Navigation
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });

  // Nav scroll hide/show
  _initNavScroll();

  // Settings via icône header
  document.getElementById('btn-settings')?.addEventListener('click', () => navigateTo('settings'));

  // Modal : fermeture
  document.getElementById('modal-close')?.addEventListener('click', closeModal);
  document.getElementById('modal-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  // ── FAB Saisie rapide ──
  const fab = document.getElementById('fab-quick');
  if (fab) {
    fab.style.display = 'flex';
    fab.addEventListener('click', () => navigateTo('argent', { tab: 'saisir' }));
    // Cacher sur les pages où la saisie rapide est hors sujet
    const _fabHiddenPages = new Set(['argent', 'settings']);
    const _updateFab = () => {
      const hide = _fabHiddenPages.has(State.page);
      fab.style.opacity  = hide ? '0' : '1';
      fab.style.pointerEvents = hide ? 'none' : '';
    };
    // patch navigateTo pour mettre à jour le FAB
    const _origNav = navigateTo;
    window._fabUpdater = _updateFab; // accessible depuis navigateTo hook ci-dessous
    _updateFab();
  }

  // ── Raccourcis clavier (desktop) ──
  document.addEventListener('keydown', e => {
    // Escape → fermer modal
    if (e.key === 'Escape') { closeModal(); return; }
    // Alt+1..6 → navigation pages
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const pageKeys = ['dashboard','argent','charges','savings','stats','settings'];
      const n = parseInt(e.key);
      if (n >= 1 && n <= pageKeys.length) { e.preventDefault(); navigateTo(pageKeys[n-1]); return; }
      // Alt+N → mois suivant, Alt+P → mois précédent (dashboard uniquement)
      if (e.key === 'n' && State.page === 'dashboard') {
        e.preventDefault();
        const nx = addMonth(State.year, State.month, 1);
        State.year = nx.year; State.month = nx.month;
        navigateTo('dashboard');
        return;
      }
      if (e.key === 'p' && State.page === 'dashboard') {
        e.preventDefault();
        const pv = addMonth(State.year, State.month, -1);
        State.year = pv.year; State.month = pv.month;
        navigateTo('dashboard');
        return;
      }
      // Alt+? → aide raccourcis
      if (e.key === '?') {
        e.preventDefault();
        openModal('⌨️ Raccourcis clavier',
          `<div style="font-size:0.85rem;line-height:1.9;">
            <div><kbd>Alt+1</kbd> → Accueil &nbsp; <kbd>Alt+2</kbd> → Argent</div>
            <div><kbd>Alt+3</kbd> → Charges &nbsp; <kbd>Alt+4</kbd> → Épargne</div>
            <div><kbd>Alt+5</kbd> → Statistiques &nbsp; <kbd>Alt+6</kbd> → Paramètres</div>
            <div><kbd>Alt+N</kbd> → Mois suivant &nbsp; <kbd>Alt+P</kbd> → Mois précédent</div>
            <div><kbd>Échap</kbd> → Fermer modal &nbsp; <kbd>Alt+?</kbd> → Cette aide</div>
          </div>`,
          `<button class="btn btn-primary" onclick="document.getElementById('modal-close').click()">Fermer</button>`
        );
        return;
      }
    }
  });

  // ── Swipe horizontal pour navigation entre mois (dashboard) ──
  let _swipeX = null;
  document.getElementById('app-content')?.addEventListener('touchstart', e => {
    _swipeX = e.touches[0].clientX;
  }, { passive: true });
  document.getElementById('app-content')?.addEventListener('touchend', e => {
    if (_swipeX === null || State.page !== 'dashboard') { _swipeX = null; return; }
    const delta = e.changedTouches[0].clientX - _swipeX;
    _swipeX = null;
    if (Math.abs(delta) < 60) return; // seuil 60px
    const dir = delta < 0 ? 1 : -1;  // swipe gauche = mois suivant
    const nx = addMonth(State.year, State.month, dir);
    State.year = nx.year; State.month = nx.month;
    navigateTo('dashboard');
  }, { passive: true });

  // Hash URL
  const hash   = window.location.hash.replace('#', '').trim();

  // ── Synchronisation Drive au lancement ──
  await initDriveSync();

  // Re-charger les users après import potentiel depuis Drive
  await reloadUsers();

  // Alias #saisie → page argent onglet saisir
  if (hash === 'saisie') {
    await navigateTo('argent', { tab: 'saisir' });
  } else {
    const urlPage = hash && PAGES[hash] ? hash : 'dashboard';
    await navigateTo(urlPage);
  }

  // Vérifications en arrière-plan
  setTimeout(checkUnfilledMonths, 1500);
  setTimeout(checkBudgetAlerts, 2000);

  // Auto-save Drive toutes les 2 minutes si actif
  startAutoSave();

  // ── Drive warning banner (seulement après le 3e lancement) ──
  State.settings = await getAllSettings(); // refresh after initDriveSync
  const _lc = (Number(State.settings.appLaunchCount) || 0) + 1;
  await setSetting('appLaunchCount', _lc);
  State.settings.appLaunchCount = _lc;
  showDriveWarningBanner(State.settings);

  // ── First-run: "Qui utilise cet appareil ?" ──
  await showFirstRunModal();

  // ── Tour guidé (1ère fois seulement) ──
  const tourDone = await getSetting('tourCompleted');
  if (!tourDone) setTimeout(() => _startTour(), 1000);

  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        reg.update();
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          window.location.reload();
        });
      })
      .catch(err => console.warn('[SW] Enregistrement échoué :', err));

    // Gérer les messages du SW (ex: clic sur notification)
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'navigate' && event.data.page) {
        navigateTo(event.data.page);
      }
    });
  }
}

// ── First-run modal "Qui utilise cet appareil ?" ──
async function showFirstRunModal() {
  if (State.currentUserId) return; // déjà configuré
  const users = State.users ?? [];
  if (users.length < 1) return; // pas encore d'utilisateurs créés

  const overlay = document.getElementById('modal-overlay');
  const title   = document.getElementById('modal-title');
  const body    = document.getElementById('modal-body');
  const foot    = document.getElementById('modal-footer');
  const closeBtn= document.getElementById('modal-close');
  if (!overlay || !body) return;

  if (title) title.textContent = '👋 Qui utilise cet appareil ?';
  body.innerHTML = `
    <p style="font-size:0.85rem;color:var(--text-3);margin-bottom:16px;">Sélectionnez votre profil pour personnaliser l'expérience.</p>
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${users.map(u => `
        <button class="btn btn-outline btn-full firstrun-user-btn" data-uid="${u.id}" style="display:flex;align-items:center;gap:12px;padding:14px 16px;font-size:0.95rem;font-weight:700;border-color:${(u.color||'#6C63FF')};">
          <span style="width:34px;height:34px;border-radius:50%;background:${(u.color||'#6C63FF')};color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.1rem;font-weight:800;flex-shrink:0;">${((u.name||'?')[0].toUpperCase())}</span>
          ${u.name||'?'}
        </button>`).join('')}
      <button class="btn btn-ghost btn-full" id="firstrun-skip" style="font-size:0.78rem;color:var(--text-3);margin-top:4px;">Continuer sans choisir</button>
    </div>`;
  if (foot) foot.innerHTML = '';
  if (closeBtn) closeBtn.style.display = 'none';

  overlay.classList.add('active');
  const stopClose = e => e.stopPropagation();
  overlay.addEventListener('click', stopClose, { capture: true });

  const finish = (uid) => {
    overlay.removeEventListener('click', stopClose, true);
    if (closeBtn) closeBtn.style.display = '';
    closeModal();
    if (uid) {
      localStorage.setItem('currentDeviceUserId', String(uid));
      State.currentUserId = String(uid);
    }
  };

  body.querySelectorAll('.firstrun-user-btn').forEach(btn => {
    btn.addEventListener('click', () => finish(btn.dataset.uid));
  });
  body.querySelector('#firstrun-skip')?.addEventListener('click', () => finish(null));
}

// ── Drive warning banner ──
let _driveBannerDismissed = false;

function showDriveWarningBanner(s) {
  if (s[DRIVE_URL_KEY] && isValidDriveUrl(s[DRIVE_URL_KEY])) return;
  if (_driveBannerDismissed) return;
  // N'afficher qu'à partir du 3e lancement pour ne pas surcharger les nouveaux
  if ((Number(s.appLaunchCount) || 0) < 3) return;

  document.getElementById('drive-banner')?.remove();

  const banner = document.createElement('div');
  banner.id = 'drive-banner';
  banner.style.cssText = 'background:#FFB020;padding:10px 16px;display:flex;align-items:center;gap:10px;position:fixed;top:0;left:0;right:0;z-index:10000;box-sizing:border-box;';
  banner.innerHTML = `
    <span style="font-size:1.1rem;flex-shrink:0;">☁️</span>
    <div style="flex:1;font-size:0.82rem;color:#1a1308;">
      <strong>Sync Drive non configurée</strong> — vos données ne sont sauvegardées que sur cet appareil.
    </div>
    <button id="drive-banner-go" class="btn btn-sm" style="white-space:nowrap;flex-shrink:0;background:#fff;color:#1a1308;font-weight:700;border-radius:6px;padding:4px 10px;">Configurer</button>
    <button id="drive-banner-close" class="btn-icon" style="width:28px;height:28px;flex-shrink:0;font-size:1.1rem;color:#1a1308;" aria-label="Fermer">✕</button>`;

  document.body.appendChild(banner);

  const closeBanner = () => { _driveBannerDismissed = true; banner.remove(); };
  document.getElementById('drive-banner-close')?.addEventListener('click', closeBanner);
  document.getElementById('drive-banner-go')?.addEventListener('click', () => { closeBanner(); _showDriveConfigModal(s); });
}

// ── Modal de configuration Drive ──
async function _showDriveConfigModal(s) {
  const currentUrl = (s && s[DRIVE_URL_KEY]) || '';
  openModal('☁️ Configurer la Sync Drive', `
    <p style="font-size:0.82rem;color:var(--text-2);margin-bottom:12px;">
      La synchronisation Drive sauvegarde vos données sur Google et les partage entre vos appareils.
    </p>
    <div style="background:var(--bg-2);border-radius:var(--radius);padding:12px;margin-bottom:14px;">
      <div style="font-size:0.78rem;font-weight:700;color:var(--text);margin-bottom:8px;">&#x1F4CB; Étapes de configuration :</div>
      <ol style="font-size:0.78rem;color:var(--text-2);padding-left:18px;margin:0;line-height:2;">
        <li>Aller sur <a href="https://script.google.com" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:underline;">script.google.com</a></li>
        <li>Créer un projet → nom : <strong>Compta+ Sync</strong></li>
        <li>Copier-coller le contenu de <strong>setup/Code.gs</strong></li>
        <li>Cliquer <strong>Déployer → Application Web</strong></li>
        <li>Accès : <strong>Tout le monde</strong> → Copier l'URL</li>
      </ol>
    </div>
    <div class="form-group" style="margin-bottom:8px;">
      <label class="form-label">URL du Web App Apps Script</label>
      <input type="url" class="form-input" id="modal-drive-url"
        placeholder="https://script.google.com/macros/s/…"
        value="${currentUrl}">
      <p class="form-hint">Doit commencer par https://script.google.com/macros/s/</p>
    </div>
    <div id="modal-drive-result" style="display:none;font-size:0.78rem;padding:8px 10px;border-radius:var(--radius-sm);margin-top:8px;"></div>
  `,
  `<button class="btn btn-primary" id="modal-drive-save">Enregistrer et tester</button>
   <button class="btn btn-outline" id="modal-drive-cancel">Annuler</button>`);

  document.getElementById('modal-drive-cancel')?.addEventListener('click', closeModal);
  document.getElementById('modal-drive-save')?.addEventListener('click', async () => {
    const url     = document.getElementById('modal-drive-url')?.value.trim();
    const resultEl = document.getElementById('modal-drive-result');
    resultEl.style.display = '';
    if (!url || !isValidDriveUrl(url)) {
      resultEl.style.background = 'var(--danger-bg)';
      resultEl.style.color      = 'var(--danger)';
      resultEl.textContent      = '❌ URL invalide. Elle doit commencer par https://script.google.com/macros/s/';
      return;
    }
    await setSetting(DRIVE_URL_KEY, url);
    const saveBtn = document.getElementById('modal-drive-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Test en cours…'; }
    resultEl.style.background = 'var(--bg-2)';
    resultEl.style.color      = 'var(--text-2)';
    resultEl.textContent      = 'Test de la connexion…';
    const res = await testDriveConnection();
    if (res.ok) {
      resultEl.style.background = 'var(--success-bg)';
      resultEl.style.color      = 'var(--success)';
      resultEl.textContent      = `✅ Connexion OK — ${res.count} sauvegarde(s) trouvée(s). URL enregistrée !`;
      setTimeout(() => closeModal(), 2000);
    } else {
      resultEl.style.background = 'var(--danger-bg)';
      resultEl.style.color      = 'var(--danger)';
      resultEl.textContent      = `❌ ${res.error}`;
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Enregistrer et tester'; }
    }
  });
}

// ── Application du thème ──
export function applyTheme(theme) {
  if (theme === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

document.addEventListener('DOMContentLoaded', () => init());

// ── Tour guidé ──────────────────────────────────────────────
const TOUR_STEPS = [
  {
    selector: '[data-page="dashboard"]',
    title:    '👋 Bienvenue dans Compta+ !',
    text:     'Le <strong>Dashboard</strong> affiche votre solde, score budgétaire et budget journalier restant. Cliquez sur le score pour voir le détail.',
  },
  {
    selector: '[data-page="argent"]',
    title:    '✏️ Saisir les données du mois',
    text:     'La page <strong>Argent</strong> centralise la saisie des revenus, charges, budgets et épargne. À faire en début de mois !',
  },
  {
    selector: '#fab-quick',
    title:    '⚡ Accès rapide',
    text:     'Ce bouton flottant vous amène directement à la saisie depuis n\'importe quelle page.',
  },
  {
    selector: '[data-page="stats"]',
    title:    '📈 Analysez vos finances',
    text:     'La page <strong>Analyse</strong> propose des graphiques, comparaison N vs N-1, insights automatiques et export PDF.',
  },
  {
    selector: '[data-page="settings"] || #btn-settings',
    title:    '⚙️ Paramètres',
    text:     'Configurez le mode de répartition, synchronisez sur Drive, importez des charges types et personnalisez l\'app. <br><br><em>Appuyez sur <kbd>Alt+?</kbd> pour voir les raccourcis clavier.</em>',
  },
];

export async function _startTour(force = false) {
  const done = await getSetting('tourCompleted');
  if (done && !force) return;

  let step = 0;
  const overlay = document.createElement('div');
  overlay.id = 'tour-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;pointer-events:none;';
  document.body.appendChild(overlay);

  const bubble = document.createElement('div');
  bubble.style.cssText = 'position:fixed;z-index:9001;background:var(--bg-card);border:2px solid var(--primary);border-radius:14px;box-shadow:0 8px 32px rgba(108,99,255,.35);padding:16px 18px;max-width:300px;pointer-events:all;';
  document.body.appendChild(bubble);

  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:8999;background:rgba(0,0,0,.45);';
  backdrop.addEventListener('click', skip);
  document.body.appendChild(backdrop);

  function skip() {
    cleanup();
    setSetting('tourCompleted', true);
  }

  function cleanup() {
    overlay.remove(); bubble.remove(); backdrop.remove();
  }

  function showStep(i) {
    if (i >= TOUR_STEPS.length) { skip(); return; }
    const s = TOUR_STEPS[i];
    const target = document.querySelector(s.selector.split(' || ')[0]) || document.querySelector((s.selector.split(' || ')[1] || '').trim());
    bubble.innerHTML = `
      <div style="font-size:0.7rem;color:var(--text-3);margin-bottom:6px;">${i + 1} / ${TOUR_STEPS.length}</div>
      <div style="font-weight:800;font-size:0.95rem;margin-bottom:6px;">${s.title}</div>
      <div style="font-size:0.82rem;color:var(--text-2);line-height:1.5;">${s.text}</div>
      <div style="display:flex;justify-content:space-between;margin-top:14px;">
        <button id="tour-skip" style="background:transparent;border:none;font-size:0.78rem;color:var(--text-3);cursor:pointer;">Passer</button>
        <button id="tour-next" class="btn btn-primary" style="padding:6px 16px;font-size:0.82rem;">${i < TOUR_STEPS.length - 1 ? 'Suivant →' : 'Terminer ✓'}</button>
      </div>
    `;
    bubble.querySelector('#tour-skip')?.addEventListener('click', skip);
    bubble.querySelector('#tour-next')?.addEventListener('click', () => showStep(i + 1));

    if (target) {
      const rect = target.getBoundingClientRect();
      const bw = 300, bh = 160;
      let left = Math.min(rect.left + rect.width / 2 - bw / 2, window.innerWidth - bw - 12);
      let top  = rect.bottom + 12;
      if (top + bh > window.innerHeight) top = rect.top - bh - 12;
      bubble.style.left = Math.max(8, left) + 'px';
      bubble.style.top  = Math.max(8, top) + 'px';
    } else {
      bubble.style.left = '50%';
      bubble.style.top  = '50%';
      bubble.style.transform = 'translate(-50%,-50%)';
    }
  }

  showStep(0);
}
