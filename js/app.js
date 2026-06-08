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
const _V = '?v=10';
const PAGES = {
  dashboard: () => import('./ui/dashboard.js' + _V),
  saisie:    () => import('./ui/saisie.js'    + _V),
  charges:   () => import('./ui/charges.js'   + _V),
  savings:   () => import('./ui/savings.js'   + _V),
  stats:     () => import('./ui/stats.js'     + _V),
  settings:  () => import('./ui/settings.js'  + _V),
};

const PAGE_TITLES = {
  dashboard: 'Accueil',
  saisie:    'Saisie du mois',
  charges:   'Charges & Achats',
  savings:   'Épargne',
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

// ── Vérification des mois non remplis ──
async function checkUnfilledMonths() {
  try {
    const { getMonthsByYear } = await import('./db.js');
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

    const settings = await getAllSettings();
    if (settings.notifEnabled && isMonthEmpty(monthMap[month])) {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Budget Foyer', {
          body: `Le mois de ${nomMois(month)} n'a pas encore été rempli.`,
          icon: './icons/icon.svg',
        });
      }
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
        // Vérifier les mises à jour dès le chargement
        reg.update();
        // Détecter quand un nouveau SW prend le contrôle → recharger
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          window.location.reload();
        });
      })
      .catch(err => console.warn('[SW] Enregistrement échoué :', err));
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
