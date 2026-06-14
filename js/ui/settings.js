// ============================================================
// js/ui/settings.js – Page des réglages
// ============================================================

import { applyTheme, reloadUsers, State }                        from '../app.js';
import { pushVersionedBackup, pullBackup, listBackups,
         isValidDriveUrl, DRIVE_URL_KEY, DRIVE_SYNC_KEY }        from '../drive.js';
import { testDriveConnection }                                    from '../sync.js';
import { getAllSettings, getSetting, setSetting,
         exportAllData, importAllData, resetAllData,
         getAvailableYears, getMonthsByYear, getChargesForMonth,
         getAchatsForMonth, getRepartition, saveArchive,
         getAllArchives, getAllUsers, getActiveUsers,
         saveUser, softDeleteUser, restoreUser, USER_COLORS,
         saveCharge, getAllCharges, deleteCharge }            from '../db.js';
import { calcMonth, calcYear }                                    from '../calculs.js';
import { eur, escHtml, showToast, downloadJSON, pickJSONFile,
         openModal, closeModal, today, getCategoryInfo }          from '../utils.js';
import { showChargesTemplatesModal }                              from './charges.js';

export async function render(container) {
  const [s, allUsers] = await Promise.all([getAllSettings(), getAllUsers()]);
  const users    = allUsers.filter(u => u.active !== false);
  const archived = allUsers.filter(u => u.active === false);
  const N = users.length;

  container.innerHTML = await buildHTML(s, users, archived, N);
  bindEvents(container, s, users, archived, N);
}

async function buildHTML(s, users, archived, N) {
  const driveOk = s[DRIVE_URL_KEY] && isValidDriveUrl(s[DRIVE_URL_KEY]);

  return `
    <div class="settings-accordion">

    <!-- ══ FOYER ══ -->
    <details class="settings-group">
      <summary class="settings-group-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Foyer
      </summary>
      <div class="settings-group-desc">Ajoutez les membres de votre foyer et choisissez comment répartir les charges entre eux. C'est le premier réglage à faire avant toute saisie.</div>
      <div class="settings-group-body">

        <div class="card" style="margin-bottom:10px;">
            <button class="btn btn-sm btn-primary" id="btn-add-user">+ Ajouter</button>
          </div>
          ${users.length === 0
            ? `<div class="empty-state" style="padding:12px 0;">
                 <div class="empty-state-text">Aucun utilisateur configuré.<br>Commencez par en ajouter un.</div>
               </div>`
            : `<div id="users-list">${users.map(u => buildUserRow(u)).join('')}</div>`}
          <p class="form-hint" style="margin-top:8px;">La suppression conserve les données historiques.</p>
        </div>

        ${archived.length > 0 ? `
        <div class="card" style="margin-bottom:10px;">
          <div class="card-header">
            <span class="card-title" style="color:var(--text-3);">Archivés</span>
            <span class="chip" style="font-size:0.68rem;">${archived.length}</span>
          </div>
          <div class="item-list">
            ${archived.map(u => `
              <div class="list-item">
                <div class="list-item-icon" style="background:${escHtml(u.color||'#999')};opacity:0.5;">${escHtml((u.name||'?')[0].toUpperCase())}</div>
                <div class="list-item-body">
                  <div class="list-item-title" style="color:var(--text-3);">${escHtml(u.name)}</div>
                  <div class="list-item-sub">Archivé le ${u.deletedAt ? new Date(u.deletedAt).toLocaleDateString('fr-FR') : '—'}</div>
                </div>
                <button class="btn btn-sm btn-outline btn-restore" data-uid="${u.id}" style="color:var(--success);border-color:var(--success);">Restaurer</button>
              </div>`).join('')}
          </div>
        </div>` : ''}

        <div class="card" style="margin-bottom:10px;">
          <div class="card-header"><span class="card-title">Cet appareil</span></div>
          <div class="form-group">
            <label class="form-label">Qui utilise cet appareil ?</label>
            <select class="form-select" id="s-device-user">
              <option value="">-- Sélectionner --</option>
              ${users.map(u => `<option value="${u.id}"
                ${String(State.currentUserId) === String(u.id) ? 'selected' : ''}>
                ${escHtml(u.name)}</option>`).join('')}
            </select>
            <p class="form-hint">Propre à cet appareil, non synchronisé.</p>
          </div>
        </div>

        ${N >= 2 ? `
        <div class="card">
          <div class="card-header"><span class="card-title">⚖️ Répartition par défaut</span></div>
          <div class="tabs" id="repartition-tabs" style="margin-bottom:8px;">
            <button class="tab-btn ${s.defaultRepartMode === 'separe'       ? 'active' : ''}" data-mode="separe">Séparé</button>
            <button class="tab-btn ${s.defaultRepartMode === 'fixe'         ? 'active' : ''}" data-mode="fixe">Fixe %</button>
            <button class="tab-btn ${s.defaultRepartMode === 'equitable'    ? 'active' : ''}" data-mode="equitable">Équitable</button>
            <button class="tab-btn ${s.defaultRepartMode === 'personnalise' ? 'active' : ''}" data-mode="personnalise">Perso</button>
          </div>
          <div id="repartition-mode-hint" style="font-size:0.78rem;color:var(--text-3);padding:8px 10px;background:var(--bg-2);border-radius:8px;margin-bottom:6px;"></div>
          <p style="font-size:0.75rem;color:var(--text-3);">Pré-sélectionné pour les nouveaux mois.</p>
        </div>` : ''}

      </div>
    </details>

    <!-- ══ APPARENCE & RAPPELS ══ -->
    <details class="settings-group">
      <summary class="settings-group-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        Apparence &amp; Rappels
      </summary>
      <div class="settings-group-desc">Personnalisez l'apparence de l'application (clair / sombre) et configurez des rappels mensuels pour ne pas oublier votre saisie.</div>
      <div class="settings-group-body">

        <div class="card" style="margin-bottom:10px;">
          <div class="card-header"><span class="card-title">Thème</span></div>
          <div style="padding:0 0 4px;">
            <div class="theme-picker" id="theme-picker">
              ${[
                { id:'auto',     label:'Auto',        bg:'linear-gradient(135deg,#F2F2F8 50%,#13131D 50%)', ac:'#8B5CF6' },
                { id:'light',    label:'Clair',        bg:'#F2F2F8',  ac:'#6D28D9' },
                { id:'dark',     label:'Sombre',       bg:'#13131D',  ac:'#8B5CF6' },
                { id:'nebula',   label:'Nebula',       bg:'#080B14',  ac:'#22D3EE' },
                { id:'urban',    label:'Urban',        bg:'#F7F6F0',  ac:'#FF5722' },
                { id:'organic',  label:'Organic',      bg:'#F2EEE6',  ac:'#3D7A5A' },
                { id:'pulse',    label:'Pulse',        bg:'#080808',  ac:'#00E5A0' },
                { id:'bento',    label:'Bento',        bg:'#EEF2F8',  ac:'#2563EB' },
                { id:'crystal',  label:'Crystal',      bg:'linear-gradient(135deg,#C4D0EE,#D4C4EE)', ac:'#5B6AEA' },
                { id:'clay',     label:'Clay',         bg:'#E8E2D9',  ac:'#C96A4A' },
                { id:'motion',   label:'Motion',       bg:'#FAF7FF',  ac:'#D84FEA' },
                { id:'midnight', label:'Midnight',     bg:'#0A0A0C',  ac:'#60A5FA' },
                { id:'aurora',   label:'Aurora',       bg:'#0E0B18',  ac:'#8B5CF6' },
                { id:'atlas',    label:'Atlas',        bg:'#F4EFE6',  ac:'#1B6B5A' },
                { id:'horizon',   label:'Horizon',      bg:'#FFFFFF',  ac:'#0070F3' },
                { id:'cyber',     label:'Cyber',        bg:'#050A0E',  ac:'#00F5FF' },
                { id:'street',    label:'Street',       bg:'#191918',  ac:'#FF4500' },
                { id:'synthwave', label:'Synthwave',    bg:'linear-gradient(135deg,#080226,#2D0060)', ac:'#FF2D78' },
                { id:'studio',    label:'Studio',       bg:'linear-gradient(135deg,#EAE2D9,#D8D0C7)', ac:'#9A7830' },
              ].map(t => `
                <button class="theme-card${s.theme === t.id ? ' active' : ''}" data-tid="${t.id}" type="button">
                  <div class="theme-card-preview">
                    <div class="tcp-bg" style="background:${t.bg};"></div>
                    <div class="tcp-ac" style="background:${t.ac};"></div>
                  </div>
                  <span>${t.label}</span>
                </button>`).join('')}
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">🔔 Rappels</span>
            ${'Notification' in window && Notification.permission === 'granted'
              ? `<span class="chip success" style="font-size:0.68rem;">✓ Autorisé</span>`
              : 'Notification' in window && Notification.permission === 'denied'
              ? `<span class="chip danger" style="font-size:0.68rem;">Bloqué</span>`
              : `<span class="chip" style="font-size:0.68rem;">Non demandé</span>`}
          </div>
          <div class="toggle-wrap" style="margin-bottom:10px;">
            <div class="toggle-info">
              <label for="s-notif">Rappel mensuel de saisie</label>
              <p>Si la saisie n'est pas faite avant le jour indiqué</p>
            </div>
            <label class="toggle">
              <input type="checkbox" id="s-notif" ${s.notifEnabled ? 'checked' : ''} ${'Notification' in window && Notification.permission === 'denied' ? 'disabled' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="form-group" style="margin-bottom:14px;display:flex;align-items:center;gap:10px;">
            <label class="form-label" style="margin:0;white-space:nowrap;">Rappeler avant le</label>
            <input type="number" class="form-input" id="s-notif-day" min="1" max="28" step="1" value="${s.notifDay || 7}" style="width:70px;">
            <span style="font-size:0.82rem;color:var(--text-3);">du mois</span>
          </div>
          <div style="border-top:1px solid var(--border);padding-top:12px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
              <span style="font-weight:700;font-size:0.85rem;">Rappels personnalisés</span>
              <button class="btn btn-sm btn-primary" id="btn-add-reminder">+ Ajouter</button>
            </div>
            ${(s.customReminders || []).length === 0
              ? `<p style="font-size:0.78rem;color:var(--text-3);">Aucun rappel personnalisé.</p>`
              : `<div id="custom-reminders-list">${(s.customReminders || []).map(r => `
                  <div class="list-item" style="margin-bottom:6px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);">
                    <div class="list-item-body">
                      <div class="list-item-title" style="font-size:0.85rem;">${escHtml(r.label)}</div>
                      <div class="list-item-sub">Chaque mois le ${r.dayOfMonth}</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                      <label class="toggle" style="transform:scale(0.85);">
                        <input type="checkbox" class="reminder-toggle" data-rid="${r.id}" ${r.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                      </label>
                      <button class="btn-icon reminder-del" data-rid="${r.id}" style="width:26px;height:26px;color:var(--text-3);">✕</button>
                    </div>
                  </div>`).join('')}</div>`}
          </div>
        </div>

      </div>
    </details>

    <!-- ══ SAUVEGARDE & SYNC ══ -->
    <details class="settings-group">
      <summary class="settings-group-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        Sauvegarde &amp; Sync
        ${!driveOk ? `<span class="chip" style="font-size:0.63rem;margin-left:6px;background:var(--warning-bg);color:var(--warning);">Drive non configuré</span>` : `<span class="chip success" style="font-size:0.63rem;margin-left:6px;">Drive ✓</span>`}
      </summary>
      <div class="settings-group-desc">Synchronisez vos données sur plusieurs appareils via Google Drive, ou exportez une sauvegarde locale au format JSON.</div>
      <div class="settings-group-body">

        <div class="card" style="margin-bottom:10px;">
          <div class="card-header">
            <span class="card-title">☁️ Google Drive</span>
            <span id="drive-status" class="chip ${driveOk ? 'success' : ''}" style="font-size:0.68rem;">
              ${driveOk ? '● Configuré' : '○ Non configuré'}
            </span>
          </div>
          <p style="font-size:0.78rem;color:var(--text-2);margin-bottom:12px;">
            Synchronisez vos données sur tous vos appareils.
            <button class="btn btn-sm" id="btn-drive-help" style="font-size:0.72rem;color:var(--primary);text-decoration:underline;padding:0;margin-left:4px;">Comment configurer ?</button>
          </p>
          <div class="form-group" style="margin-bottom:10px;">
            <label class="form-label">URL du Web App Apps Script</label>
            <input type="url" class="form-input" id="s-drive-url"
              placeholder="https://script.google.com/macros/s/..."
              value="${escHtml(s[DRIVE_URL_KEY] || '')}">
            <p class="form-hint">Partagez cette URL entre vos appareils.</p>
          </div>
          <button class="btn btn-outline btn-full btn-sm" id="s-save-drive-url" style="margin-bottom:10px;">Enregistrer l'URL</button>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
            <button class="btn btn-sm btn-secondary" style="flex:1;min-width:100px;" id="btn-drive-test">🔍 Tester</button>
            <button class="btn btn-sm btn-outline" style="flex:1;min-width:100px;" id="btn-drive-qr">📲 QR Code</button>
          </div>
          <div id="drive-qr-wrap" style="display:none;text-align:center;margin-bottom:10px;padding:12px;background:var(--bg-2);border-radius:10px;">
            <canvas id="drive-qr-canvas" style="border-radius:6px;"></canvas>
            <p style="font-size:0.72rem;color:var(--text-3);margin-top:6px;">Scannez ce QR code sur un autre appareil.</p>
          </div>
          <div id="drive-test-result" style="display:none;font-size:0.75rem;padding:8px 10px;border-radius:8px;margin-bottom:10px;"></div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            <button class="btn btn-secondary" style="flex:1;min-width:120px;" id="btn-push-drive">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/><path d="M5 21h14"/></svg>
              Envoyer ☁️
            </button>
            <button class="btn btn-outline" style="flex:1;min-width:120px;" id="btn-pull-drive">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polyline points="7 16 12 21 17 16"/><line x1="12" y1="21" x2="12" y2="9"/><path d="M5 3h14"/></svg>
              Récupérer ⬇️
            </button>
          </div>
          <p id="drive-last-sync" style="font-size:0.7rem;color:var(--text-3);text-align:center;margin-top:8px;">
            ${s[DRIVE_SYNC_KEY] ? 'Dernière sync : ' + new Date(s[DRIVE_SYNC_KEY]).toLocaleString('fr-FR') : ''}
          </p>
          <label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:0.8rem;cursor:pointer;">
            <input type="checkbox" id="s-drive-import-disabled" ${s.driveImportDisabled ? 'checked' : ''}>
            Bloquer l'importation automatique depuis Drive
          </label>
        </div>

        <div class="card" style="margin-bottom:10px;">
          <div class="card-header"><span class="card-title">💾 Sauvegarde locale (JSON)</span></div>
          <p style="font-size:0.78rem;color:var(--text-3);margin-bottom:12px;">
            Export/import manuel de toutes vos données.
            ${s.lastBackup ? `Dernière sauvegarde : ${new Date(s.lastBackup).toLocaleDateString('fr-FR')}` : ''}
          </p>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <button class="btn btn-secondary btn-full" id="btn-export">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Exporter (JSON)
            </button>
            <button class="btn btn-outline btn-full" id="btn-import">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Importer depuis un fichier JSON
            </button>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">📋 Charges types</span></div>
          <p style="font-size:0.78rem;color:var(--text-3);margin-bottom:10px;">Importez des charges prédéfinies (loyer, EDF, internet…) pour démarrer rapidement.</p>
          <button class="btn btn-outline btn-full" id="btn-import-templates">Importer des charges types</button>
        </div>

      </div>
    </details>

    <!-- ══ AVANCÉ ══ -->
    <details class="settings-group">
      <summary class="settings-group-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        Avancé
        <span class="badge-optional">Expert</span>
      </summary>
      <div class="settings-group-desc">Options avancées : vider le cache ou réinitialiser complètement l'application. ⚠️ Ces actions sont irréversibles.</div>
      <div class="settings-group-body">

        <div class="card">
          <div class="card-header"><span class="card-title" style="color:var(--danger);">⚠️ Zone dangereuse</span></div>
          <button class="btn btn-outline btn-full" style="margin-bottom:8px;" id="btn-clear-cache">🔄 Vider le cache et recharger</button>
          <button class="btn btn-danger btn-full" id="btn-reset">Effacer toutes les données…</button>
        </div>

      </div>
    </details>

    </div><!-- /.settings-accordion -->

    <div style="text-align:center;color:var(--text-3);font-size:0.75rem;margin:16px 0 24px;">
      Compta+ · Données stockées localement sur cet appareil
    </div>
  `;
}

function buildUserRow(u) {
  return `
    <div class="user-row" data-uid="${u.id}" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">
      <div class="user-color-dot" style="background:${escHtml(u.color||'#6C63FF')};width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:0.9rem;flex-shrink:0;">
        ${escHtml((u.name||'?')[0].toUpperCase())}
      </div>
      <div style="flex:1;font-weight:600;">${escHtml(u.name)}</div>
      <button class="btn btn-sm btn-outline btn-user-edit" data-uid="${u.id}" style="padding:4px 10px;">Modifier</button>
      <button class="btn btn-sm btn-danger" data-uid="${u.id}" id="del-user-${u.id}" style="padding:4px 10px;" aria-label="Supprimer ${escHtml(u.name)}">✕</button>
    </div>
  `;
}

function bindEvents(container, s, users, archived, N) {
  // ── Ajouter un utilisateur ──
  container.querySelector('#btn-add-user')?.addEventListener('click', () => {
    showUserModal(null, () => render(container));
  });

  // ── Modifier / supprimer un utilisateur ──
  container.querySelectorAll('.btn-user-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const uid  = Number(btn.dataset.uid);
      const user = users.find(u => u.id === uid);
      if (user) showUserModal(user, () => render(container));
    });
  });

  users.forEach(u => {
    container.querySelector(`#del-user-${u.id}`)?.addEventListener('click', () => {
      openModal(`Supprimer ${escHtml(u.name)} ?`, `
        <p style="margin-bottom:10px;">Les données historiques de <strong>${escHtml(u.name)}</strong> seront conservées pour ne pas fausser les statistiques.</p>
        <p style="color:var(--text-2);font-size:0.82rem;">Cette action est irréversible mais les données restent visibles dans les archives.</p>
      `, `
        <button class="btn btn-outline" id="del-cancel">Annuler</button>
        <button class="btn btn-danger"  id="del-confirm">Supprimer</button>
      `);
      document.getElementById('del-cancel')?.addEventListener('click', closeModal);
      document.getElementById('del-confirm')?.addEventListener('click', async () => {
        await softDeleteUser(u.id);
        await reloadUsers();
        closeModal();
        showToast(`${u.name} supprimé (données conservées)`, 'success');
        // Si plus aucun utilisateur actif → retour à l'onboarding
        const remaining = await getActiveUsers();
        if (remaining.length === 0) {
          localStorage.removeItem('currentDeviceUserId');
          setTimeout(() => { location.href = location.pathname; }, 800);
        } else {
          render(container);
        }
      });
    });
  });

  // ── Restaurer un utilisateur archivé ──
  container.querySelectorAll('.btn-restore').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid  = Number(btn.dataset.uid);
      const user = archived.find(u => u.id === uid);
      if (!user) return;
      if (!confirm(`Restaurer ${user.name} ?`)) return;
      await restoreUser(uid);
      await reloadUsers();
      showToast(`${user.name} restauré ✅`, 'success');
      render(container);
    });
  });

  // ── Mon profil (appareil) ──
  container.querySelector('#s-device-user')?.addEventListener('change', (e) => {
    const uid = e.target.value;
    localStorage.setItem('currentDeviceUserId', uid);
    State.currentUserId = uid || null;
    showToast('Profil de cet appareil mis à jour ✅', 'success');
  });

  // ── Mode répartition ──
  const _REPART_HINTS = {
    separe:       '🔀 Séparé : chaque personne paie ses charges personnelles + la moitié des charges communes. Ex: loyer 1 000 € → chacun paie 500 €.',
    fixe:         '📊 Fixe % : les charges communes sont réparties selon des pourcentages fixes. Ex: A paie 60 %, B paie 40 % — quelle que soit leur situation.',
    equitable:    '⚖️ Équitable : les charges communes sont réparties au prorata des revenus. Ex: A gagne 3 000 €, B gagne 2 000 € → A paie 60 %, B 40 % des 1 000 € → A paie 600 €, B paie 400 €.',
    personnalise: '🎛 Personnalisé : vous définissez manuellement la répartition charge par charge. Idéal quand chaque dépense a sa propre logique.',
  };
  const _updateRepartHint = (mode) => {
    const el = container.querySelector('#repartition-mode-hint');
    if (el) el.textContent = _REPART_HINTS[mode] || '';
    // IL-3 : avertissement mode personnalisé (non supporté dans les calculs auto)
    let warn = container.querySelector('#repartition-mode-warn');
    if (!warn) {
      warn = document.createElement('div');
      warn.id = 'repartition-mode-warn';
      warn.style.cssText = 'font-size:0.75rem;color:var(--warning,#F59E0B);background:var(--warning-bg,#FEF3C7);border-radius:var(--radius-sm,6px);padding:6px 10px;margin-top:6px;';
      el?.insertAdjacentElement('afterend', warn);
    }
    warn.style.display = mode === 'personnalise' ? '' : 'none';
    warn.textContent   = '⚠️ Non supporté dans les calculs automatiques — utilisez Séparé, Fixe % ou Équitable.';
  };
  _updateRepartHint(s.defaultRepartMode || 'separe');

  container.querySelectorAll('#repartition-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      container.querySelectorAll('#repartition-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _updateRepartHint(btn.dataset.mode);
      await setSetting('defaultRepartMode', btn.dataset.mode);
      showToast('Mode de répartition enregistré', 'success');
    });
  });

  // ── Sélecteur de thème visuel ──
  container.querySelector('#theme-picker')?.addEventListener('click', async e => {
    const card = e.target.closest('.theme-card');
    if (!card) return;
    const tid = card.dataset.tid;
    await setSetting('theme', tid);
    applyTheme(tid);
    container.querySelectorAll('.theme-card').forEach(c => c.classList.toggle('active', c.dataset.tid === tid));
  });

  // ── Notifications ──
  container.querySelector('#s-notif')?.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    if (enabled && 'Notification' in window) {
      if (Notification.permission === 'denied') {
        e.target.checked = false;
        showToast('Les notifications sont bloquées. Modifiez les permissions dans votre navigateur.', 'error');
        return;
      }
      if (Notification.permission !== 'granted') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          e.target.checked = false;
          showToast('Permission refusée — notifications non activées', 'error');
          return;
        }
        // Recharger la section pour afficher le nouveau statut
        await render(container);
        return;
      }
    }
    await setSetting('notifEnabled', enabled);
    // Reset lastNotifSent pour permettre une notification immmédiate
    if (enabled) await setSetting('lastNotifSent', null);
    showToast(enabled ? 'Rappels activés ✅' : 'Rappels désactivés', 'success');
  });

  // ── Jour de rappel mensuel ──
  container.querySelector('#s-notif-day')?.addEventListener('change', async (e) => {
    const d = Math.min(28, Math.max(1, parseInt(e.target.value, 10) || 7));
    e.target.value = d;
    await setSetting('notifDay', d);
    showToast(`Rappel fixé au ${d} du mois`, 'success');
  });

  // ── Rappels personnalisés ──
  container.querySelector('#btn-add-reminder')?.addEventListener('click', () => {
    openModal('+ Rappel personnalisé', `
      <div class="form-group" style="margin-bottom:10px;"><label class="form-label">Libellé *</label><input type="text" class="form-input" id="rem-label" placeholder="Ex: Loyer dû, Assurance…" autocomplete="off"></div>
      <div class="form-group"><label class="form-label">Jour du mois (1-28)</label><input type="number" class="form-input" id="rem-day" min="1" max="28" value="1"></div>
    `, `<button class="btn btn-primary btn-full" id="rem-save">Créer</button>`);
    document.getElementById('rem-label')?.focus();
    document.getElementById('rem-save')?.addEventListener('click', async () => {
      const label = document.getElementById('rem-label')?.value.trim();
      const day   = Math.min(28, Math.max(1, parseInt(document.getElementById('rem-day')?.value, 10) || 1));
      if (!label) { showToast('Saisissez un libellé', 'error'); return; }
      const existing = s.customReminders || [];
      await setSetting('customReminders', [...existing, { id: 'rem_' + Date.now(), label, dayOfMonth: day, enabled: true }]);
      closeModal(); showToast('Rappel créé ✅', 'success'); render(container);
    });
  });

  container.querySelectorAll('.reminder-toggle').forEach(inp => {
    inp.addEventListener('change', async () => {
      const rid = inp.dataset.rid;
      const updated = (s.customReminders || []).map(r => r.id === rid ? { ...r, enabled: inp.checked } : r);
      await setSetting('customReminders', updated);
    });
  });

  container.querySelectorAll('.reminder-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const rid = btn.dataset.rid;
      const updated = (s.customReminders || []).filter(r => r.id !== rid);
      await setSetting('customReminders', updated);
      showToast('Rappel supprimé', 'success'); render(container);
    });
  });

  // ── Templates de charges (Sauvegarde accordion) ──
  container.querySelector('#btn-import-templates')?.addEventListener('click', () => showChargesTemplatesModal());

    // ── Export JSON ──
  container.querySelector('#btn-export')?.addEventListener('click', async () => {
    try {
      const data = await exportAllData();
      const date = new Date().toISOString().slice(0, 10);
      downloadJSON(data, `compta-plus-backup-${date}.json`);
      await setSetting('lastBackup', new Date().toISOString());
      showToast('Données exportées ✅', 'success');
    } catch (e) { showToast('Erreur lors de l\'export', 'error'); }
  });

  // ── Import JSON ──
  container.querySelector('#btn-import')?.addEventListener('click', async () => {
    try {
      const data = await pickJSONFile();
      _showImportConfirmModal(data);
    } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
  });

  // ── Archive ──
  container.querySelector('#btn-archive')?.addEventListener('click', async () => {
    const years      = await getAvailableYears();
    const archivable = years.filter(y => y < today().year);
    if (!archivable.length) { showToast('Aucune année passée à archiver', ''); return; }

    openModal('Archiver une année', `
      <p style="margin-bottom:12px;">Sélectionnez l'année à clôturer :</p>
      <select class="form-select" id="arch-year">${archivable.map(y => `<option value="${y}">${y}</option>`).join('')}</select>
    `, `
      <button class="btn btn-outline" id="arch-cancel">Annuler</button>
      <button class="btn btn-primary" id="arch-confirm">Archiver</button>
    `);
    document.getElementById('arch-cancel')?.addEventListener('click', closeModal);
    document.getElementById('arch-confirm')?.addEventListener('click', async () => {
      const year = Number(document.getElementById('arch-year')?.value);
      const monthsData = await getMonthsByYear(year);
      const currentUsers = await getActiveUsers();
      const results = [];
      for (let m = 1; m <= 12; m++) {
        const md  = monthsData.find(d => d.month === m) ?? null;
        const chg = await getChargesForMonth(m, year);
        const ach = await getAchatsForMonth(year, m);
        const rp  = await getRepartition(year, m);
        results.push(md ? calcMonth(md, chg, ach, rp, currentUsers) : null);
      }
      await saveArchive({ year, archivedAt: new Date().toISOString(), summary: calcYear(results.filter(Boolean)), monthsData });
      closeModal();
      showToast(`Année ${year} archivée ✅`, 'success');
    });
  });

  // ── Voir archives ──
  container.querySelector('#btn-see-archives')?.addEventListener('click', async () => {
    const archives = await getAllArchives();
    const body = archives.length
      ? archives.map(a => `
          <div class="list-item" style="flex-direction:column;align-items:flex-start;gap:4px;margin-bottom:8px;">
            <div style="font-weight:700;">📁 ${a.year}</div>
            <div style="font-size:0.75rem;color:var(--text-3);">Archivé le ${new Date(a.archivedAt).toLocaleDateString('fr-FR')}</div>
            ${a.summary ? `<div style="font-size:0.8rem;">Revenus: ${eur(a.summary.revenus.total + a.summary.primes.total)} · Épargne: ${eur(a.summary.epargne.total)}</div>` : ''}
          </div>`).join('')
      : '<div class="empty-state"><div class="empty-state-icon">🗂️</div><div class="empty-state-text">Aucune archive</div></div>';
    openModal('Archives', body, `<button class="btn btn-outline btn-full" id="arch-close">Fermer</button>`);
    document.getElementById('arch-close')?.addEventListener('click', closeModal);
  });

  // ── Drive : aide ──
  container.querySelector('#btn-drive-help')?.addEventListener('click', () => {
    openModal('⚙️ Configurer le Sync Drive', `
      <div style="font-size:0.875rem;line-height:1.7;">
        <ol style="padding-left:20px;display:flex;flex-direction:column;gap:8px;">
          <li>Aller sur <a href="https://script.google.com" target="_blank" style="color:var(--primary);">script.google.com</a></li>
          <li>Nouveau projet → nom : <strong>Compta+ Sync</strong></li>
          <li>Coller le script Apps Script dans l'éditeur
            <button id="btn-copy-code-gs" style="margin-left:6px;font-size:0.75rem;padding:2px 8px;border:1px solid var(--primary);border-radius:4px;background:transparent;color:var(--primary);cursor:pointer;">📋 Copier le code</button>
          </li>
          <li>Déployer → Application Web → Exécuter en tant que : Moi → Accès : Tout le monde</li>
          <li>Copier l'URL et la coller dans le champ ci-dessus</li>
          <li>Partager cette même URL sur vos autres appareils</li>
        </ol>
        <div style="margin-top:12px;padding:10px;background:var(--primary-bg);border-radius:var(--radius-sm);font-size:0.8rem;">
          💡 <strong>Auto-save</strong> : l'app sauvegarde automatiquement sur Drive toutes les 2 minutes quand vous êtes actif. Au démarrage, elle récupère toujours la dernière version disponible.
        </div>
      </div>
    `, '<button class="btn btn-primary btn-full" id="close-help">Compris !</button>');
    document.getElementById('close-help')?.addEventListener('click', closeModal);
    document.getElementById('btn-copy-code-gs')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-copy-code-gs');
      try {
        const res = await fetch('https://raw.githubusercontent.com/Lecture-Plus/appli-compte/main/setup/Code.gs');
        const code = await res.text();
        await navigator.clipboard.writeText(code);
        btn.textContent = '✅ Copié !';
        setTimeout(() => { btn.textContent = '📋 Copier le code'; }, 2000);
      } catch { btn.textContent = '❌ Erreur'; }
    });
  });

  // ── Drive : tester la connexion ──
  container.querySelector('#btn-drive-test')?.addEventListener('click', async () => {
    const btn  = container.querySelector('#btn-drive-test');
    const info = container.querySelector('#drive-test-result');
    btn.disabled = true; btn.textContent = '⏳ Test en cours…';
    info.style.display = 'none';
    const res = await testDriveConnection();
    btn.disabled = false; btn.textContent = '🔍 Tester la connexion';
    info.style.display = 'block';
    if (res.ok) {
      info.style.background = 'var(--success-light, #d1fae5)';
      info.style.color      = 'var(--success, #065f46)';
      let msg = `✅ Connexion OK — ${res.count} sauvegarde${res.count !== 1 ? 's' : ''} trouvée${res.count !== 1 ? 's' : ''}`;
      if (res.latest?.name) msg += ` · dernière : ${escHtml(res.latest.name)}`;
      info.textContent = msg;
    } else {
      info.style.background = 'var(--danger-light, #fee2e2)';
      info.style.color      = 'var(--danger, #991b1b)';
      info.textContent = `❌ ${escHtml(res.error)}`;
    }
  });

  // ── Drive : enregistrer URL ──
  container.querySelector('#s-save-drive-url')?.addEventListener('click', async () => {
    const url = container.querySelector('#s-drive-url')?.value.trim();
    if (url && !isValidDriveUrl(url)) { showToast('URL invalide.', 'error'); return; }
    await setSetting(DRIVE_URL_KEY, url || '');
    container.querySelector('#drive-status').textContent = url ? '● Configuré' : '○ Non configuré';
    container.querySelector('#drive-status').className   = `chip ${url ? 'success' : ''}`;
    showToast(url ? 'URL Drive enregistrée ✅' : 'URL supprimée', 'success');
  });

  container.querySelector('#s-drive-import-disabled')?.addEventListener('change', async (e) => {
    await setSetting('driveImportDisabled', e.target.checked);
    showToast(e.target.checked ? 'Import Drive désactivé ✅' : 'Import Drive réactivé', 'success');
  });

  // ── Drive : QR code ──
  container.querySelector('#btn-drive-qr')?.addEventListener('click', async () => {
    const url = (container.querySelector('#s-drive-url')?.value.trim()) ||
                (await getSetting(DRIVE_URL_KEY) || '').trim();
    const wrap = container.querySelector('#drive-qr-wrap');
    if (!url) { showToast('Saisissez d\'abord une URL Drive.', 'error'); return; }
    wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
    if (wrap.style.display === 'none') return;
    const canvas = container.querySelector('#drive-qr-canvas');
    // Chargement lazy du générateur QR (bibliothèque UMD ~10KB)
    if (!window.qrcode) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      }).catch(() => null);
    }
    try {
      const qr = window.qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      const moduleCount = qr.getModuleCount();
      const size = 180;
      const cellSize = Math.floor(size / moduleCount);
      const ctx = canvas.getContext('2d');
      canvas.width  = moduleCount * cellSize;
      canvas.height = moduleCount * cellSize;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#1a1a2e';
      for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
          if (qr.isDark(row, col)) ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
    } catch (_) {
      // Fallback offline : afficher l'URL sous forme copiable
      canvas.style.display = 'none';
      const p = document.createElement('p');
      p.style.cssText = 'font-size:0.72rem;word-break:break-all;color:var(--text-2);background:var(--bg-1);padding:8px;border-radius:6px;';
      p.textContent = url;
      wrap.insertBefore(p, wrap.querySelector('p'));
    }
  });

  // ── Drive : pousser ──
  container.querySelector('#btn-push-drive')?.addEventListener('click', async () => {
    const url = (await getSetting(DRIVE_URL_KEY) || '').trim();
    if (!isValidDriveUrl(url)) { showToast('Configurez d\'abord l\'URL Drive', 'error'); return; }
    const btn = container.querySelector('#btn-push-drive');
    btn.disabled = true; btn.textContent = '⏳ Envoi…';
    try {
      const data = await exportAllData();
      const res  = await pushVersionedBackup(url, data);
      const now  = new Date().toISOString();
      await setSetting(DRIVE_SYNC_KEY, now);
      container.querySelector('#drive-last-sync').textContent = 'Dernière sync : ' + new Date(now).toLocaleString('fr-FR');
      showToast(`Envoyé : ${res?.filename || '✅'}`, 'success');
    } catch(e) { showToast('Erreur : ' + e.message, 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/><path d="M5 21h14"/></svg> Envoyer ☁️'; }
  });

  // ── Drive : récupérer (avec liste des backups) ──
  container.querySelector('#btn-pull-drive')?.addEventListener('click', async () => {
    const url = (await getSetting(DRIVE_URL_KEY) || '').trim();
    if (!isValidDriveUrl(url)) { showToast('Configurez d\'abord l\'URL Drive', 'error'); return; }
    const btn = container.querySelector('#btn-pull-drive');
    btn.disabled = true; btn.textContent = '⏳ Chargement…';
    try {
      const backups = await listBackups(url);
      if (!backups?.length) { showToast('Aucune sauvegarde trouvée sur Drive', ''); return; }
      _showPickBackupModal(url, backups);
    } catch(e) { showToast('Erreur : ' + e.message, 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polyline points="7 16 12 21 17 16"/><line x1="12" y1="21" x2="12" y2="9"/><path d="M5 3h14"/></svg> Récupérer ⬇️'; }
  });

  // ── Reset cache ──
  container.querySelector('#btn-clear-cache')?.addEventListener('click', async () => {
    const btn = container.querySelector('#btn-clear-cache');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Nettoyage…'; }
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
      showToast('Cache vidé, rechargement…', 'success');
      setTimeout(() => window.location.reload(), 800);
    } catch(e) {
      showToast('Erreur lors du nettoyage', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Vider le cache et recharger l\'application'; }
    }
  });

  // ── Reset ──
  container.querySelector('#btn-reset')?.addEventListener('click', () => {
    openModal('⚠️ Effacer toutes les données', `
      <p style="color:var(--danger);font-weight:600;margin-bottom:10px;">Cette action est irréversible.</p>
      <p style="margin-bottom:12px;">Toutes vos données seront définitivement supprimées.</p>
      <label class="form-label">Tapez <strong>EFFACER</strong> pour confirmer</label>
      <input type="text" class="form-input" id="reset-confirm-input" placeholder="EFFACER" autocomplete="off" style="margin-top:6px;">
    `, `
      <button class="btn btn-outline" id="reset-cancel">Annuler</button>
      <button class="btn btn-danger" id="reset-confirm">Tout effacer</button>
    `);
    document.getElementById('reset-cancel')?.addEventListener('click', closeModal);
    document.getElementById('reset-confirm')?.addEventListener('click', async () => {
      const confirmBtn = document.getElementById('reset-confirm');
      if (confirmBtn) confirmBtn.disabled = true; // BM-5 : éviter double-clic accidentel
      const val = document.getElementById('reset-confirm-input')?.value.trim();
      if (val !== 'EFFACER') {
        if (confirmBtn) confirmBtn.disabled = false;
        showToast('Tapez EFFACER pour confirmer', 'error'); return;
      }
      await resetAllData();
      localStorage.removeItem('currentDeviceUserId');
      closeModal();
      showToast('Données effacées. Rechargement…', 'success');
      setTimeout(() => { location.href = location.pathname; }, 1200);
    });
  });
}

// ── Modal : créer / modifier un utilisateur ──
function showUserModal(user, onSave) {
  const isNew = !user;
  const u = user ?? { name: '', color: USER_COLORS[0] };

  openModal(isNew ? 'Nouvel utilisateur' : 'Modifier l\'utilisateur', `
    <div class="form-group" style="margin-bottom:12px;">
      <label class="form-label">Prénom</label>
      <input type="text" class="form-input" id="um-name" placeholder="Ex: Alice" maxlength="30" value="${escHtml(u.name)}">
    </div>
    <div class="form-group">
      <label class="form-label">Couleur</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;" id="um-colors">
        ${USER_COLORS.map(c => `
          <button type="button" class="color-swatch ${c === u.color ? 'selected' : ''}" data-color="${c}"
            style="width:40px;height:40px;border-radius:50%;background:${c};border:3px solid ${c === u.color ? '#fff' : 'transparent'};box-shadow:${c === u.color ? '0 0 0 2px '+c : 'none'};cursor:pointer;">
          </button>`).join('')}
      </div>
    </div>
  `, `
    <button class="btn btn-outline" id="um-cancel">Annuler</button>
    <button class="btn btn-primary" id="um-save">${isNew ? 'Ajouter' : 'Enregistrer'}</button>
  `);

  let selectedColor = u.color;

  const colorsEl = document.getElementById('um-colors');
  colorsEl?.querySelectorAll('.color-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      colorsEl.querySelectorAll('.color-swatch').forEach(b => {
        b.style.border = '3px solid transparent';
        b.style.boxShadow = 'none';
      });
      btn.style.border    = '3px solid #fff';
      btn.style.boxShadow = `0 0 0 2px ${btn.dataset.color}`;
      selectedColor = btn.dataset.color;
    });
  });

  document.getElementById('um-cancel')?.addEventListener('click', closeModal);

  document.getElementById('um-save')?.addEventListener('click', async () => {
    const name = document.getElementById('um-name')?.value.trim();
    if (!name) { showToast('Le prénom est requis', 'error'); return; }
    const payload = { ...u, name, color: selectedColor, active: true, createdAt: u.createdAt || new Date().toISOString(), deletedAt: null };
    const prevCount = (await getActiveUsers()).length;
    await saveUser(payload);
    await reloadUsers();
    closeModal();
    showToast(isNew ? `${name} ajouté ✅` : 'Utilisateur mis à jour ✅', 'success');
    if (isNew && prevCount === 1) {
      setTimeout(() => showToast('💡 Mode équitable activé automatiquement. Vérifiez la répartition dans Saisie.', 'success', 4500), 700);
    }
    onSave();
  });
}

// ── Modal : choisir un backup Drive ──
function _showPickBackupModal(url, backups) {
  const rows = backups.map((b, i) => `
    <label style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:var(--radius-sm);cursor:pointer;background:${i===0 ? 'var(--primary-bg)' : 'transparent'};">
      <input type="radio" name="backup-pick" value="${escHtml(b.filename)}" ${i === 0 ? 'checked' : ''}>
      <div>
        <div style="font-size:0.87rem;font-weight:600;">${escHtml(b.filename)}</div>
        <div style="font-size:0.72rem;color:var(--text-3);">${new Date(b.savedAt).toLocaleString('fr-FR')} · ${Math.round(b.size/1024)} Ko</div>
        ${i === 0 ? '<span class="chip primary" style="font-size:0.6rem;padding:1px 6px;">plus récent</span>' : ''}
      </div>
    </label>
  `).join('');

  openModal('⬇️ Choisir une sauvegarde', `
    <p style="margin-bottom:10px;color:var(--text-2);font-size:0.85rem;">Sélectionnez la sauvegarde à importer :</p>
    <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:10px;">${rows}</div>
    <p style="font-size:0.78rem;color:var(--danger);">⚠️ Vos données locales actuelles seront remplacées.</p>
  `, `
    <button class="btn btn-outline" id="pick-cancel">Annuler</button>
    <button class="btn btn-danger"  id="pick-confirm">Importer</button>
  `);

  document.getElementById('pick-cancel')?.addEventListener('click', closeModal);
  document.getElementById('pick-confirm')?.addEventListener('click', async () => {
    const selected = document.querySelector('input[name="backup-pick"]:checked')?.value;
    if (!selected) return;
    try {
      const data = await pullBackup(url, selected);
      if (!data) { showToast('Impossible de lire ce backup', 'error'); return; }
      await _showImportConfirmModal(data);
    } catch(e) { showToast('Erreur : ' + e.message, 'error'); }
  });
}

// ── Modal : confirmer l'import ──
async function _showImportConfirmModal(data) {
  openModal('Importer des données', `
    <div style="padding:4px 0;">
      <p style="margin-bottom:10px;">Fichier de sauvegarde :</p>
      <div class="chip primary" style="margin-bottom:10px;">${escHtml(data.appName || 'Compta+')}</div>
      <p>Exporté le : <strong>${data.exportedAt ? new Date(data.exportedAt).toLocaleString('fr-FR') : 'Inconnu'}</strong></p>
      <p style="margin-top:8px;color:var(--danger);font-size:0.82rem;">⚠️ Toutes vos données actuelles seront remplacées.</p>
    </div>
  `, `
    <button class="btn btn-outline" id="imp-cancel">Annuler</button>
    <button class="btn btn-danger" id="imp-confirm">Importer et remplacer</button>
  `);
  document.getElementById('imp-cancel')?.addEventListener('click', closeModal);
  document.getElementById('imp-confirm')?.addEventListener('click', async () => {
    try {
      await importAllData(data);
      await setSetting(DRIVE_SYNC_KEY, new Date().toISOString());
      closeModal();
      showToast('Données importées ✅', 'success');
      setTimeout(() => location.reload(), 1200);
    } catch(e) { showToast('Erreur : ' + e.message, 'error'); }
  });
}
