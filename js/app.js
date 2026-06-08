// ============================================================
// js/app.js – Application principale : router, navigation, état global
// ============================================================

import { getAllSettings, getSetting, setSetting, getActiveUsers } from './db.js';
import { initDriveSync, startAutoSave, initActivityTracking,
         testDriveConnection }                                     from './sync.js';
import { today, showToast, closeModal, openModal, nomMois }      from './utils.js';
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
const _V = '?v=20';
const PAGES = {
  dashboard: () => import('./ui/dashboard.js' + _V),
  argent:    () => import('./ui/argent.js'    + _V),
  charges:   () => import('./ui/charges.js'   + _V),  // toujours accessible (utilisé par argent.js)
  savings:   () => import('./ui/savings.js'   + _V),  // toujours accessible (utilisé par argent.js)
  stats:     () => import('./ui/stats.js'     + _V),
  settings:  () => import('./ui/settings.js'  + _V),
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
    // Force reflow then add class for animation
    void content.offsetWidth;
    content.classList.add('page-enter');
    _initCounters(content);
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
function _initCounters(root) {
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
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
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
  State.settings = await getAllSettings(); // refresh after initDriveSync
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
let _driveBannerDismissed = false;

function showDriveWarningBanner(s) {
  if (s[DRIVE_URL_KEY] && isValidDriveUrl(s[DRIVE_URL_KEY])) return;
  if (_driveBannerDismissed) return;

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
