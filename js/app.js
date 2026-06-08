// ============================================================
// js/app.js – Application principale : router, navigation, état global
// ============================================================

import { getAllSettings, getSetting, setSetting, getActiveUsers } from './db.js';
import { initDriveSync, startAutoSave, initActivityTracking }     from './sync.js';
import { today, showToast, closeModal, nomMois }                  from './utils.js';

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
const _V = '?v=12';
const PAGES = {
  dashboard: () => import('./ui/dashboard.js' + _V),
  saisie:    () => import('./ui/saisie.js'    + _V),
  charges:   () => import('./ui/charges.js'   + _V),
  savings:   () => import('./ui/savings.js'   + _V),
  budgets:   () => import('./ui/budgets.js'   + _V),
  stats:     () => import('./ui/stats.js'     + _V),
  settings:  () => import('./ui/settings.js'  + _V),
};

const PAGE_TITLES = {
  dashboard: 'Accueil',
  saisie:    'Saisie du mois',
  charges:   'Charges & Achats',
  savings:   'Épargne',
  budgets:   'Suivi Budgets',
  stats:     'Statistiques',
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

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  document.getElementById('page-title').textContent = PAGE_TITLES[page] ?? 'Budget Foyer';
  window.location.hash = page;

  const content = document.getElementById('app-content');
  content.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const mod = await PAGES[page]();
    _currentCleanup = await mod.render(content, params) ?? null;
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

/** @deprecated use reloadUsers */
export async function reloadNames() { return reloadUsers(); }

// ── Vérification des mois non remplis + notification push ──
async function checkUnfilledMonths() {
  try {
    const { getMonthsByYear, getMonthlyData } = await import('./db.js');
    const { isMonthEmpty }    = await import('./utils.js');
    const { year, month }     = today();

    const monthsData = await getMonthsByYear(year);
    const monthMap   = Object.fromEntries(monthsData.map(m => [m.month, m]));

    let unfilled = 0;
    for (let m = 1; m <= month; m++) {
      if (isMonthEmpty(monthMap[m])) unfilled++;
    }

    const badge = document.querySelector('[data-page="saisie"] .nav-badge');
    if (badge) {
      badge.textContent = unfilled > 0 ? unfilled : '';
      badge.classList.toggle('hidden', unfilled === 0);
    }

    await _checkAndFireNotification(year, month, monthMap[month]);
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
    const { isMonthEmpty } = await import('./utils.js');
    if (!isMonthEmpty(md)) return;

    // Éviter de notifier plusieurs fois le même mois
    const lastNotifStr = await getSetting('lastNotifSent');
    if (lastNotifStr) {
      const d = new Date(lastNotifStr);
      if (d.getFullYear() === year && d.getMonth() + 1 === month) return;
    }

    // Déclencher seulement dans les 7 premiers jours du mois
    const day = new Date().getDate();
    if (day > 7) return;

    // Stocker la date de notification pour éviter les doublons
    await setSetting('lastNotifSent', new Date().toISOString());

    const { nomMois: nm } = await import('./utils.js');
    const body = `Le mois de ${nm(month)} n'a pas encore été rempli. 📋`;

    // Préférer la notification via Service Worker (reste visible hors focus)
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification('Budget Foyer', {
        body,
        icon:  './icons/icon.svg',
        badge: './icons/icon.svg',
        tag:   'monthly-reminder',
        data:  { page: 'saisie' },
        actions: [{ action: 'open', title: 'Saisir' }],
      });
    } else {
      new Notification('Budget Foyer', { body, icon: './icons/icon.svg' });
    }
  } catch (e) { /* silencieux */ }
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

  // Navigation
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });

  // Modal : fermeture
  document.getElementById('modal-close')?.addEventListener('click', closeModal);
  document.getElementById('modal-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  // Hash URL
  const hash   = window.location.hash.replace('#', '').trim();
  const urlPage = hash && PAGES[hash] ? hash : 'dashboard';

  // ── Synchronisation Drive au lancement ──
  await initDriveSync();

  // Re-charger les users après import potentiel depuis Drive
  await reloadUsers();

  // Première page
  await navigateTo(urlPage);

  // Vérifications en arrière-plan
  setTimeout(checkUnfilledMonths, 1500);

  // Auto-save Drive toutes les 2 minutes si actif
  startAutoSave();

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

// ── Application du thème ──
export function applyTheme(theme) {
  if (theme === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

document.addEventListener('DOMContentLoaded', () => init());
