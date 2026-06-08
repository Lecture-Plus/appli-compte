// ============================================================
// js/app.js – Application principale : router, navigation, état global
// ============================================================

import { getAllSettings, getSetting, setSetting, getActiveUsers } from './db.js';
import { initDriveSync, startAutoSave, initActivityTracking }     from './sync.js';
import { today, showToast, closeModal, nomMois }                  from './utils.js';
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
const _V = '?v=12';
const PAGES = {
  dashboard: () => import('./ui/dashboard.js' + _V),
  charges:   () => import('./ui/charges.js'   + _V),
  savings:   () => import('./ui/savings.js'   + _V),
  stats:     () => import('./ui/stats.js'     + _V),
  settings:  () => import('./ui/settings.js'  + _V),
};

const PAGE_TITLES = {
  dashboard: 'Accueil',
  charges:   'Charges & Budgets',
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

    const badge = document.querySelector('[data-page="dashboard"] .nav-badge');
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

    // Déclencher seulement avant le jour configuré (défaut 7)
    const day    = new Date().getDate();
    const cutoff = Number(settings.notifDay) || 7;
    if (day > cutoff) return;

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
        data:  { page: 'dashboard' },
        actions: [{ action: 'open', title: 'Saisir' }],
      });
    } else {
      new Notification('Budget Foyer', { body, icon: './icons/icon.svg' });
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
        await reg.showNotification('Budget Foyer – Rappel', {
          body: r.label,
          icon:  './icons/icon.svg',
          badge: './icons/icon.svg',
          tag:   `reminder-${r.id}`,
          data:  { page: 'dashboard' },
        });
      } else {
        new Notification('Budget Foyer – Rappel', { body: r.label, icon: './icons/icon.svg' });
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

  // ── Drive warning banner ──
  showDriveWarningBanner(State.settings);

  // ── First-run: "Qui utilise cet appareil ?" ──
  await showFirstRunModal();

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
function showDriveWarningBanner(s) {
  if (s[DRIVE_URL_KEY] && isValidDriveUrl(s[DRIVE_URL_KEY])) return; // déjà configuré
  if (s.driveWarningDismissed) return; // ne plus afficher

  const banner = document.createElement('div');
  banner.id    = 'drive-banner';
  banner.innerHTML = `
    <div style="background:var(--warning-bg);border-bottom:2px solid var(--warning);padding:10px 16px;display:flex;align-items:center;gap:10px;z-index:9999;position:relative;">
      <span style="font-size:1.1rem;">☁️</span>
      <div style="flex:1;font-size:0.82rem;color:var(--text-2);">
        <strong>Sync Drive non configurée</strong> — vos données ne sont sauvegardées que sur cet appareil.
      </div>
      <label style="display:flex;align-items:center;gap:5px;font-size:0.74rem;cursor:pointer;white-space:nowrap;">
        <input type="checkbox" id="drive-banner-dismiss"> Ne plus afficher
      </label>
      <button id="drive-banner-go" class="btn btn-sm btn-primary" style="white-space:nowrap;">Configurer</button>
      <button id="drive-banner-close" class="btn-icon" style="width:28px;height:28px;flex-shrink:0;font-size:1.1rem;" aria-label="Fermer">✕</button>
    </div>`;

  const appEl = document.getElementById('app');
  if (appEl) appEl.prepend(banner);

  const closeBanner = async () => {
    const dismiss = document.getElementById('drive-banner-dismiss')?.checked;
    if (dismiss) await setSetting('driveWarningDismissed', true);
    banner.remove();
  };

  document.getElementById('drive-banner-close')?.addEventListener('click', closeBanner);
  document.getElementById('drive-banner-go')?.addEventListener('click', async () => {
    await closeBanner();
    navigateTo('settings');
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
