// ============================================================
// js/ui/settings.js – Page des réglages
// ============================================================

import { applyTheme, reloadNames }                        from '../app.js';
import { pushToDrive, pullFromDrive,
         isValidDriveUrl, DRIVE_URL_KEY,
         DRIVE_SYNC_KEY }                                  from '../drive.js';
import { getAllSettings, getSetting, setSetting,
         exportAllData, importAllData,
         resetAllData, getAvailableYears,
         getMonthsByYear, getChargesForMonth,
         getAchatsForMonth, getRepartition,
         saveArchive, getAllArchives }                     from '../db.js';
import { calcMonth, calcYear }                             from '../calculs.js';
import { eur, escHtml, showToast, downloadJSON,
         pickJSONFile, openModal, closeModal,
         today }                                           from '../utils.js';

export async function render(container) {
  const s = await getAllSettings();

  container.innerHTML = `
    <!-- Section : Personnes -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header"><span class="card-title">👥 Personnes du foyer</span></div>
      <div class="form-group" style="margin-bottom:10px;">
        <label class="form-label">Prénom Personne 1</label>
        <input type="text" class="form-input" id="s-p1" value="${escHtml(s.p1Name)}" placeholder="Ex: Julien">
      </div>
      <div class="form-group">
        <label class="form-label">Prénom Personne 2</label>
        <input type="text" class="form-input" id="s-p2" value="${escHtml(s.p2Name)}" placeholder="Ex: Océane">
      </div>
      <button class="btn btn-primary btn-full" id="s-save-names" style="margin-top:12px;">Enregistrer les prénoms</button>
    </div>

    <!-- Section : Objectif d'épargne -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header"><span class="card-title">🎯 Objectif d'épargne</span></div>
      <div class="form-group" style="margin-bottom:10px;">
        <label class="form-label">Libellé de l'objectif</label>
        <input type="text" class="form-input" id="s-goal-label" value="${escHtml(s.savingsGoalLabel)}" placeholder="Ex: Vacances, Apport…">
      </div>
      <div class="form-grid-2" style="margin-bottom:10px;">
        <div class="form-group">
          <label class="form-label">Montant cible (€)</label>
          <div class="input-wrap">
            <input type="number" class="form-input input-euro" id="s-goal" min="0" step="100" value="${s.savingsGoal || ''}">
            <span class="input-suffix">€</span>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Année</label>
          <input type="number" class="form-input" id="s-goal-year" min="2020" max="2099" value="${s.savingsGoalYear || today().year}">
        </div>
      </div>
      <div class="form-group" style="margin-bottom:10px;">
        <label class="form-label">Seuil d'alerte mensuel (€)</label>
        <div class="input-wrap">
          <input type="number" class="form-input input-euro" id="s-threshold" min="0" step="10" value="${s.epargneThreshold || 100}">
          <span class="input-suffix">€</span>
        </div>
        <p class="form-hint">Sous ce seuil d'épargne mensuelle, l'indicateur passe en rouge.</p>
      </div>
      <div class="form-group" style="margin-bottom:12px;">
        <label class="form-label">Budget courses hebdomadaire (€)</label>
        <div class="input-wrap">
          <input type="number" class="form-input input-euro" id="s-weekly-courses" min="0" step="5" value="${s.weeklyCoursesEstimate || 85}">
          <span class="input-suffix">€/sem</span>
        </div>
        <p class="form-hint">Utilisé par le prévisionnel pour estimer les courses quotidiennes.</p>
      </div>
      <button class="btn btn-primary btn-full" id="s-save-goal">Enregistrer</button>
    </div>

    <!-- Section : Répartition par défaut -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header"><span class="card-title">⚖️ Mode de répartition par défaut</span></div>
      <div class="tabs" id="repartition-tabs" style="margin-bottom:8px;">
        <button class="tab-btn ${s.defaultRepartMode === 'separe'    ? 'active' : ''}" data-mode="separe">Séparé</button>
        <button class="tab-btn ${s.defaultRepartMode === 'fixe'      ? 'active' : ''}" data-mode="fixe">Fixe %</button>
        <button class="tab-btn ${s.defaultRepartMode === 'equitable' ? 'active' : ''}" data-mode="equitable">Équitable</button>
      </div>
      <p style="font-size:0.78rem;color:var(--text-3);">Ce mode sera pré-sélectionné pour les nouveaux mois.</p>
    </div>

    <!-- Section : Apparence -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header"><span class="card-title">🎨 Apparence</span></div>
      <div class="settings-row">
        <span class="settings-row-label">Thème</span>
        <select class="form-select" id="s-theme" style="width:140px;">
          <option value="auto"  ${s.theme === 'auto'  ? 'selected' : ''}>Automatique</option>
          <option value="dark"  ${s.theme === 'dark'  ? 'selected' : ''}>Sombre</option>
          <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Clair</option>
        </select>
      </div>
    </div>

    <!-- Section : Notifications -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header"><span class="card-title">🔔 Rappels</span></div>
      <div class="toggle-wrap">
        <div class="toggle-info">
          <label for="s-notif">Notifications de rappel</label>
          <p>Rappel si un mois n'est pas rempli</p>
        </div>
        <label class="toggle">
          <input type="checkbox" id="s-notif" ${s.notifEnabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>

    <!-- Section : Archivage -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header">
        <span class="card-title">🗂️ Archives</span>
        <button class="btn btn-sm btn-secondary" id="btn-see-archives">Voir</button>
      </div>
      <p style="font-size:0.82rem;color:var(--text-2);margin-bottom:12px;">
        L'archivage clôture une année et la sauvegarde en lecture seule.
      </p>
      <button class="btn btn-outline btn-full" id="btn-archive">Archiver une année…</button>
    </div>

    <!-- Section : Sync Google Drive -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header">
        <span class="card-title">☁️ Sync Google Drive</span>
        <span id="drive-status" class="chip ${s[DRIVE_URL_KEY] && isValidDriveUrl(s[DRIVE_URL_KEY]) ? 'success' : ''}"
          style="font-size:0.68rem;">
          ${s[DRIVE_URL_KEY] && isValidDriveUrl(s[DRIVE_URL_KEY]) ? '● Configuré' : '○ Non configuré'}
        </span>
      </div>
      <p style="font-size:0.78rem;color:var(--text-2);margin-bottom:12px;">
        Synchronisez vos données sur tous vos appareils via Google Drive.
        <button class="btn btn-sm" id="btn-drive-help" style="font-size:0.72rem;color:var(--primary);text-decoration:underline;padding:0;margin-left:4px;">Comment configurer ?</button>
      </p>
      <div class="form-group" style="margin-bottom:10px;">
        <label class="form-label">URL du Web App Apps Script</label>
        <input type="url" class="form-input" id="s-drive-url"
          placeholder="https://script.google.com/macros/s/..."
          value="${escHtml(s[DRIVE_URL_KEY] || '')}">
        <p class="form-hint">Partagez cette URL avec votre partenaire pour synchroniser les 4 appareils.</p>
      </div>
      <button class="btn btn-outline btn-full btn-sm" id="s-save-drive-url" style="margin-bottom:10px;">Enregistrer l'URL</button>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-secondary" style="flex:1;" id="btn-push-drive">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/><path d="M5 21h14"/></svg>
          Envoyer ☁️
        </button>
        <button class="btn btn-outline" style="flex:1;" id="btn-pull-drive">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polyline points="7 16 12 21 17 16"/><line x1="12" y1="21" x2="12" y2="9"/><path d="M5 3h14"/></svg>
          Récupérer ⬇️
        </button>
      </div>
      <p id="drive-last-sync" style="font-size:0.7rem;color:var(--text-3);text-align:center;margin-top:8px;">
        ${s[DRIVE_SYNC_KEY] ? 'Dernière sync : ' + new Date(s[DRIVE_SYNC_KEY]).toLocaleString('fr-FR') : ''}
      </p>
    </div>

    <!-- Section : Données -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header"><span class="card-title">💾 Sauvegarde locale</span></div>
      <p style="font-size:0.78rem;color:var(--text-3);margin-bottom:12px;">
        Exportez vos données en JSON pour les sauvegarder ou les transférer d'un appareil à l'autre (PC ↔ Téléphone).
        ${s.lastBackup ? `<br>Dernière sauvegarde: ${new Date(s.lastBackup).toLocaleDateString('fr-FR')}` : ''}
      </p>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button class="btn btn-secondary btn-full" id="btn-export">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Exporter toutes les données (JSON)
        </button>
        <button class="btn btn-outline btn-full" id="btn-import">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Importer depuis un fichier JSON
        </button>
      </div>
    </div>

    <!-- Section : Danger zone -->
    <div class="card" style="margin-bottom:24px; border-color: var(--danger);">
      <div class="card-header"><span class="card-title" style="color:var(--danger);">⚠️ Zone dangereuse</span></div>
      <button class="btn btn-danger btn-full" id="btn-reset">Effacer toutes les données…</button>
    </div>

    <!-- Infos app -->
    <div style="text-align:center; color:var(--text-3); font-size:0.75rem; margin-bottom:24px;">
      Budget Foyer v1.0 · Données stockées localement sur cet appareil
    </div>
  `;

  bindEvents(container, s);
}

function bindEvents(container, s) {
  // ── Prénoms ──
  container.querySelector('#s-save-names')?.addEventListener('click', async () => {
    const p1 = container.querySelector('#s-p1')?.value.trim();
    const p2 = container.querySelector('#s-p2')?.value.trim();
    if (!p1 || !p2) { showToast('Les deux prénoms sont requis', 'error'); return; }
    await setSetting('p1Name', p1);
    await setSetting('p2Name', p2);
    await reloadNames();
    showToast('Prénoms mis à jour ✅', 'success');
  });

  // ── Objectif épargne ──
  container.querySelector('#s-save-goal')?.addEventListener('click', async () => {
    const goal        = Number(container.querySelector('#s-goal')?.value) || 0;
    const goalLabel   = container.querySelector('#s-goal-label')?.value.trim() || 'Mon objectif';
    const goalYear    = Number(container.querySelector('#s-goal-year')?.value) || today().year;
    const threshold   = Number(container.querySelector('#s-threshold')?.value) || 100;
    const weeklyCrs   = Number(container.querySelector('#s-weekly-courses')?.value) || 85;
    await Promise.all([
      setSetting('savingsGoal',             goal),
      setSetting('savingsGoalLabel',        goalLabel),
      setSetting('savingsGoalYear',         goalYear),
      setSetting('epargneThreshold',        threshold),
      setSetting('weeklyCoursesEstimate',   weeklyCrs),
    ]);
    showToast('Paramètres enregistrés ✅', 'success');
  });

  // ── Mode répartition ──
  container.querySelectorAll('#repartition-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      container.querySelectorAll('#repartition-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      await setSetting('defaultRepartMode', btn.dataset.mode);
      showToast('Mode de répartition enregistré', 'success');
    });
  });

  // ── Thème ──
  container.querySelector('#s-theme')?.addEventListener('change', async (e) => {
    const theme = e.target.value;
    await setSetting('theme', theme);
    applyTheme(theme);
    showToast('Thème mis à jour', 'success');
  });

  // ── Notifications ──
  container.querySelector('#s-notif')?.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    if (enabled && 'Notification' in window && Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        e.target.checked = false;
        showToast('Notifications refusées par le navigateur', 'error');
        return;
      }
    }
    await setSetting('notifEnabled', enabled);
    showToast(enabled ? 'Rappels activés ✅' : 'Rappels désactivés', 'success');
  });

  // ── Export JSON ──
  container.querySelector('#btn-export')?.addEventListener('click', async () => {
    try {
      const data = await exportAllData();
      const date = new Date().toISOString().slice(0, 10);
      downloadJSON(data, `budget-foyer-backup-${date}.json`);
      await setSetting('lastBackup', new Date().toISOString());
      showToast('Données exportées ✅', 'success');
    } catch (e) {
      showToast('Erreur lors de l\'export', 'error');
    }
  });

  // ── Import JSON ──
  container.querySelector('#btn-import')?.addEventListener('click', async () => {
    try {
      const data = await pickJSONFile();
      openModal('Importer des données', `
        <div style="padding:8px 0;">
          <p style="margin-bottom:12px;">Fichier de sauvegarde détecté :</p>
          <div class="chip primary" style="margin-bottom:12px;">${escHtml(data.appName || 'Budget Foyer')}</div>
          <p>Exporté le : <strong>${data.exportedAt ? new Date(data.exportedAt).toLocaleDateString('fr-FR') : 'Inconnu'}</strong></p>
          <p style="margin-top:8px; color:var(--danger); font-size:0.82rem;">
            ⚠️ Cette action remplacera <strong>toutes</strong> vos données actuelles.
          </p>
        </div>
      `, `
        <button class="btn btn-outline" id="imp-cancel">Annuler</button>
        <button class="btn btn-danger" id="imp-confirm">Importer et remplacer</button>
      `);

      document.getElementById('imp-cancel')?.addEventListener('click', closeModal);
      document.getElementById('imp-confirm')?.addEventListener('click', async () => {
        try {
          await importAllData(data);
          closeModal();
          showToast('Données importées avec succès ✅', 'success');
          setTimeout(() => location.reload(), 1500);
        } catch (e) {
          showToast('Erreur : ' + e.message, 'error');
        }
      });
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
  });

  // ── Archivage ──
  container.querySelector('#btn-archive')?.addEventListener('click', async () => {
    const years    = await getAvailableYears();
    const currentY = today().year;
    const archivable = years.filter(y => y < currentY);

    if (!archivable.length) {
      showToast('Aucune année passée à archiver', '');
      return;
    }

    const yearOpts = archivable.map(y => `<option value="${y}">${y}</option>`).join('');

    openModal('Archiver une année', `
      <p style="margin-bottom:12px;color:var(--text-2);">Sélectionnez l'année à clôturer et archiver :</p>
      <select class="form-select" id="arch-year">${yearOpts}</select>
      <p style="margin-top:10px; font-size:0.78rem; color:var(--text-3);">
        Les données restent accessibles en lecture seule dans les archives.
      </p>
    `, `
      <button class="btn btn-outline" id="arch-cancel">Annuler</button>
      <button class="btn btn-primary" id="arch-confirm">Archiver</button>
    `);

    document.getElementById('arch-cancel')?.addEventListener('click', closeModal);
    document.getElementById('arch-confirm')?.addEventListener('click', async () => {
      const year = Number(document.getElementById('arch-year')?.value);
      if (!year) return;

      try {
        // Calcul du résumé annuel
        const monthsData = await getMonthsByYear(year);
        const monthMap   = Object.fromEntries(monthsData.map(m => [m.month, m]));
        const results    = [];
        for (let m = 1; m <= 12; m++) {
          const md  = monthMap[m] ?? null;
          const chg = await getChargesForMonth(m);
          const ach = await getAchatsForMonth(year, m);
          const rp  = await getRepartition(year, m);
          results.push(md ? calcMonth(md, chg, ach, rp) : null);
        }
        const summary = calcYear(results.filter(Boolean));

        await saveArchive({ year, archivedAt: new Date().toISOString(), summary, monthsData });
        closeModal();
        showToast(`Année ${year} archivée ✅`, 'success');
      } catch (e) {
        showToast('Erreur lors de l\'archivage', 'error');
        console.error(e);
      }
    });
  });

  // ── Voir les archives ──
  container.querySelector('#btn-see-archives')?.addEventListener('click', async () => {
    const archives = await getAllArchives();

    const body = archives.length
      ? archives.map(a => {
          const s = a.summary;
          return `
            <div class="list-item" style="flex-direction:column;align-items:flex-start;gap:6px;margin-bottom:8px;">
              <div style="font-weight:700;font-size:1rem;">📁 ${a.year}</div>
              <div style="font-size:0.78rem;color:var(--text-3);">Archivé le ${new Date(a.archivedAt).toLocaleDateString('fr-FR')}</div>
              ${s ? `<div style="font-size:0.82rem;">Revenus: ${eur(s.revenus.total + s.primes.total)} · Épargne: ${eur(s.epargne.total)}</div>` : ''}
            </div>`;
        }).join('')
      : `<div class="empty-state"><div class="empty-state-icon">🗂️</div><div class="empty-state-text">Aucune archive</div></div>`;

    openModal('Archives des années', body, `<button class="btn btn-outline btn-full" id="arch-close">Fermer</button>`);
    document.getElementById('arch-close')?.addEventListener('click', closeModal);
  });

  // ── Drive : aide configuration ──
  container.querySelector('#btn-drive-help')?.addEventListener('click', () => {
    openModal('⚙️ Configurer le Sync Google Drive', `
      <div style="font-size:0.875rem; line-height:1.7;">
        <p style="margin-bottom:12px;color:var(--text-2);">Suivez ces étapes <strong>une seule fois</strong> :</p>
        <ol style="padding-left:20px; display:flex; flex-direction:column; gap:10px;">
          <li>Aller sur <a href="https://script.google.com" target="_blank" style="color:var(--primary);">script.google.com</a></li>
          <li>Cliquer <strong>"Nouveau projet"</strong></li>
          <li>Nommer le projet : <strong>Budget Foyer Sync</strong></li>
          <li>Remplacer tout le contenu par le fichier <code>setup/Code.gs</code> (dans le dossier de l'appli)</li>
          <li>Cliquer <strong>"Déployer" → "Nouveau déploiement"</strong></li>
          <li>Type : <strong>Application Web</strong></li>
          <li>Exécuter en tant que : <strong>Moi</strong></li>
          <li>Accès autorisé à : <strong>Tout le monde</strong></li>
          <li>Cliquer <strong>"Déployer"</strong> → Autoriser les permissions</li>
          <li>Copier l'<strong>URL du Web App</strong></li>
          <li>Coller l'URL dans le champ ci-dessus</li>
        </ol>
        <div style="margin-top:14px; padding:10px; background:var(--warning-bg); border-radius:var(--radius-sm);">
          <strong style="color:var(--warning);">💡 Partage entre appareils</strong><br>
          <span style="font-size:0.8rem;">Partagez simplement l'URL avec votre partenaire par message. Chacun la colle dans ses Réglages. Toutes vos données seront synchronisées.</span>
        </div>
      </div>
    `, '<button class="btn btn-primary btn-full" id="close-help">Compris !</button>');
    document.getElementById('close-help')?.addEventListener('click', closeModal);
  });

  // ── Drive : enregistrer URL ──
  container.querySelector('#s-save-drive-url')?.addEventListener('click', async () => {
    const url = container.querySelector('#s-drive-url')?.value.trim();
    if (url && !isValidDriveUrl(url)) {
      showToast('URL invalide. Elle doit commencer par https://script.google.com/macros/s/', 'error');
      return;
    }
    await setSetting(DRIVE_URL_KEY, url || '');
    const badge = container.querySelector('#drive-status');
    if (badge) {
      badge.textContent = url ? '● Configuré' : '○ Non configuré';
      badge.className   = url ? 'chip success' : 'chip';
    }
    showToast(url ? 'URL Drive enregistrée ✅' : 'URL supprimée', 'success');
  });

  // ── Drive : envoyer vers le cloud ──
  container.querySelector('#btn-push-drive')?.addEventListener('click', async () => {
    const url = (await getSetting(DRIVE_URL_KEY) || '').trim();
    if (!isValidDriveUrl(url)) {
      showToast('Configurez d\'abord l\'URL du Web App', 'error');
      return;
    }
    const btn = container.querySelector('#btn-push-drive');
    btn.disabled   = true;
    btn.textContent = '⏳ Envoi…';
    try {
      const data = await exportAllData();
      await pushToDrive(url, data);
      const now = new Date().toISOString();
      await setSetting(DRIVE_SYNC_KEY, now);
      const el = container.querySelector('#drive-last-sync');
      if (el) el.textContent = 'Dernière sync : ' + new Date(now).toLocaleString('fr-FR');
      showToast('Données envoyées vers Google Drive ✅', 'success');
    } catch(e) {
      showToast('Erreur : ' + e.message, 'error');
    } finally {
      btn.disabled   = false;
      btn.innerHTML  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/><path d="M5 21h14"/></svg> Envoyer ☁️';
    }
  });

  // ── Drive : récupérer depuis le cloud ──
  container.querySelector('#btn-pull-drive')?.addEventListener('click', async () => {
    const url = (await getSetting(DRIVE_URL_KEY) || '').trim();
    if (!isValidDriveUrl(url)) {
      showToast('Configurez d\'abord l\'URL du Web App', 'error');
      return;
    }
    const btn = container.querySelector('#btn-pull-drive');
    btn.disabled    = true;
    btn.textContent  = '⏳ Récupération…';
    try {
      const data = await pullFromDrive(url);
      if (!data) {
        showToast('Aucune sauvegarde trouvée sur Drive', '');
        return;
      }
      openModal('⬇️ Récupérer depuis Drive', `
        <p style="margin-bottom:12px;">Sauvegarde Drive trouvée :</p>
        <div class="chip primary" style="margin-bottom:8px;">${escHtml(data.appName || 'Budget Foyer')}</div>
        <p>Exportée le : <strong>${data.exportedAt ? new Date(data.exportedAt).toLocaleString('fr-FR') : 'Inconnu'}</strong></p>
        <p style="margin-top:10px;color:var(--danger);font-size:0.82rem;">⚠️ Vos données locales actuelles seront remplacées.</p>
      `, `
        <button class="btn btn-outline" id="pull-cancel">Annuler</button>
        <button class="btn btn-danger" id="pull-confirm">Importer et remplacer</button>
      `);
      document.getElementById('pull-cancel')?.addEventListener('click', closeModal);
      document.getElementById('pull-confirm')?.addEventListener('click', async () => {
        try {
          await importAllData(data);
          const now = new Date().toISOString();
          await setSetting(DRIVE_SYNC_KEY, now);
          closeModal();
          showToast('Données Drive importées ✅', 'success');
          setTimeout(() => location.reload(), 1200);
        } catch(e) {
          showToast('Erreur : ' + e.message, 'error');
        }
      });
    } catch(e) {
      showToast('Erreur : ' + e.message, 'error');
    } finally {
      btn.disabled   = false;
      btn.innerHTML  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polyline points="7 16 12 21 17 16"/><line x1="12" y1="21" x2="12" y2="9"/><path d="M5 3h14"/></svg> Récupérer ⬇️';
    }
  });

  // ── Reset ──
  container.querySelector('#btn-reset')?.addEventListener('click', () => {
    openModal('⚠️ Effacer toutes les données', `
      <p style="color:var(--danger);font-weight:600;margin-bottom:12px;">Cette action est irréversible.</p>
      <p style="color:var(--text-2);">Toutes vos données (saisies, charges, archives, réglages) seront définitivement supprimées.</p>
      <p style="margin-top:10px;font-size:0.82rem;color:var(--text-3);">Pensez à exporter vos données avant de continuer.</p>
    `, `
      <button class="btn btn-outline" id="reset-cancel">Annuler</button>
      <button class="btn btn-danger" id="reset-confirm">Tout effacer</button>
    `);

    document.getElementById('reset-cancel')?.addEventListener('click', closeModal);
    document.getElementById('reset-confirm')?.addEventListener('click', async () => {
      await resetAllData();
      closeModal();
      showToast('Données effacées', 'success');
      setTimeout(() => location.reload(), 1000);
    });
  });
}
