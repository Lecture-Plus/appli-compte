// ============================================================
// js/ui/saisie.js – Page de saisie mensuelle (multi-users)
// ============================================================

import { State }                                       from '../app.js';
import { getMonthlyData, saveMonthlyData,
         getChargesForMonth, getAchatsForMonth,
         getAllCharges, saveCharge, deleteCharge,
         saveAchat, deleteAchat, getRepartition, saveRepartition,
         getAllSettings, saveSavingsOperation,
         saveBudgetOp, getBudgetOpsForMonth,
         getActiveUsers, getUserMonthData }             from '../db.js';
import { calcMonth, whatIf }                           from '../calculs.js';
import { eur, pct, nomMois, addMonth, escHtml,
         signClass, debounce, showToast, uid,
         openModal, closeModal, MOIS,
         getCategoryInfo }                             from '../utils.js';
import { showChargeModal,
         showChargesTemplatesModal }                   from './charges.js';

let _md       = null;
let _repCfg   = null;
let _users    = [];
let _saveInd  = null; // référence à l'indicateur "Sauvegardé"
// Cache chargé une fois par render pour éviter les DB reads répétés
let _chargesCache = [];
let _achatsCache  = [];
let _budgetOpsCache = [];
let _settings = null;
let _coursesFoyerMode = localStorage.getItem('coursesFoyerMode') === '1';
let _extrasFoyerMode  = localStorage.getItem('extrasFoyerMode')  === '1';

export async function render(container) {
  _users = await getActiveUsers();
  const s     = await getAllSettings();
  _settings = s;
  const { year, month } = State;
  const N = _users.length;

  [_md, _repCfg, _chargesCache, _achatsCache, _budgetOpsCache] = await Promise.all([
    getMonthlyData(year, month),
    getRepartition(year, month),
    getChargesForMonth(month, year),
    getAchatsForMonth(year, month),
    getBudgetOpsForMonth(year, month),
  ]);

  // Pré-remplissage depuis le mois précédent
  const prevM = addMonth(year, month, -1);
  const prevMd = await getMonthlyData(prevM.year, prevM.month);
  const _isEmptyMonth = _users.every(u => (_md.users?.[String(u.id)]?.revenus || 0) === 0);
  const _hasPrevData  = !!prevMd && _users.some(u => (prevMd.users?.[String(u.id)]?.revenus || 0) > 0);

  // Assurer que chaque user a ses données initialisées
  _users.forEach(u => getUserMonthData(_md, u.id));
  // Initialiser la liste des imprévus si absente
  if (!_md.imprévusList) _md.imprévusList = [];

  // Normaliser le mode de répartition pour le contexte multi-user
  if (N > 1) {
    // `solo` ne devrait jamais être sauvegardé, mais on le corrige au cas où
    if (!_repCfg.mode || _repCfg.mode === 'solo') {
      _repCfg.mode = 'equitable';
    }
    // Si mode `separe` et qu'au moins un user n'a pas encore de revenus déclarés
    // (transition typique mono→multi), basculer silencieusement sur équitable
    if (_repCfg.mode === 'separe') {
      const someUserNoRevenue = _users.some(u => {
        const ud = _md.users?.[String(u.id)];
        return !ud || ((ud.revenus || 0) + (ud.primes || 0) === 0);
      });
      if (someUserNoRevenue) _repCfg.mode = 'equitable';
    }
  }

  const modeHidden = N <= 1;

  container.innerHTML = `
    <!-- Navigation mois -->
    <div class="month-nav" style="margin-bottom:12px;">
      <button class="month-btn" id="prev-month">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <div style="text-align:center;">
        <div class="month-nav-label">${nomMois(month)}</div>
        <div class="month-nav-year">${year}</div>
      </div>
      <button class="month-btn" id="next-month">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
      </button>
    </div>

    ${N === 0 ? `
      <div class="empty-state">
        <div class="empty-state-icon">👥</div>
        <div class="empty-state-title">Aucun utilisateur configuré</div>
        <div class="empty-state-text">Allez dans <strong>Réglages → Utilisateurs du foyer</strong> pour ajouter des personnes.</div>
      </div>
    ` : `

    ${_isEmptyMonth && _hasPrevData ? `<div id="prefill-banner" style="background:var(--primary-bg);border-left:3px solid var(--primary);border-radius:var(--radius);padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;"><div><div style="font-weight:600;font-size:0.82rem;color:var(--primary);">Pré-remplir depuis ${nomMois(prevM.month)} ${prevM.year} ?</div><div style="font-size:0.72rem;color:var(--text-3);margin-top:2px;">Revenus et budgets copiés — modifiez si besoin.</div></div><button class="btn btn-primary btn-sm" id="btn-prefill" style="flex-shrink:0;">Copier</button></div>` : ''}

    <!-- Accordion 1: Revenus -->
    <details class="settings-group" open>
      <summary class="settings-group-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
        💰 Revenus ${nomMois(month)}
      </summary>
      <div class="settings-group-body">
        <div class="form-grid-${Math.min(N, 4)}" style="margin-bottom:10px;">
          ${_users.map(u => inputField(`rev-${u.id}`, u, _md.users[String(u.id)]?.revenus, '€')).join('')}
        </div>
        <div style="margin-bottom:8px;">
          <button class="btn btn-sm btn-outline" id="btn-toggle-aides" style="font-size:0.72rem;">⬇ Aides &amp; primes</button>
        </div>
        <div id="aides-primes-section" style="display:none;padding-top:10px;border-top:1px solid var(--border);">
          <div style="font-size:0.75rem;font-weight:600;color:var(--text-3);margin-bottom:8px;">Aides (CAF, APL, allocations…)</div>
          ${_users.map(u => {
            const aidesVal = _md.users[String(u.id)]?.aides ?? '';
            const aidesRep = (_repCfg.aidesRepartition || {})[String(u.id)] ?? false;
            return `
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                <span style="flex:1;font-size:0.8rem;font-weight:600;display:flex;align-items:center;gap:5px;">
                  <span style="width:8px;height:8px;border-radius:50%;background:${escHtml(u.color||'#6C63FF')};display:inline-block;"></span>
                  ${escHtml(u.name)}
                </span>
                <div class="input-wrap" style="width:110px;">
                  <input type="number" class="form-input input-euro" id="aid-${u.id}" min="0" step="1" placeholder="0" value="${Number(aidesVal)||''}" style="padding-right:22px;font-size:0.82rem;">
                  <span class="input-suffix">€</span>
                </div>
                <label style="display:flex;align-items:center;gap:4px;font-size:0.72rem;color:var(--text-2);cursor:pointer;white-space:nowrap;">
                  <input type="checkbox" id="aid-rep-${u.id}" ${aidesRep ? 'checked' : ''}> Répartition
                </label>
              </div>`;
          }).join('')}
          <div style="font-size:0.75rem;font-weight:600;color:var(--text-3);margin:12px 0 8px;">Primes &amp; Bonus</div>
          <p style="font-size:0.72rem;color:var(--text-3);margin:-4px 0 8px;">Personnels — jamais comptabilisés dans la répartition</p>
          <div class="form-grid-${Math.min(N, 4)}">
            ${_users.map(u => inputField(`pri-${u.id}`, u, _md.users[String(u.id)]?.primes, '€')).join('')}
          </div>
        </div>
        ${!modeHidden ? `
        <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);">
          <div style="font-size:0.78rem;font-weight:700;color:var(--text-2);margin-bottom:8px;">⚖️ Répartition des charges</div>
          <div class="tabs" id="mode-tabs">
            <button class="tab-btn ${_repCfg.mode === 'separe'       ? 'active' : ''}" data-mode="separe">Séparé</button>
            <button class="tab-btn ${_repCfg.mode === 'fixe'         ? 'active' : ''}" data-mode="fixe">Fixe %</button>
            <button class="tab-btn ${_repCfg.mode === 'equitable'    ? 'active' : ''}" data-mode="equitable">Équitable</button>
            <button class="tab-btn ${_repCfg.mode === 'personnalise' ? 'active' : ''}" data-mode="personnalise">🎛 Perso</button>
          </div>
          <div id="mode-options" class="form-grid-${Math.min(N, 4)}" style="margin-top:8px;${_repCfg.mode !== 'fixe' ? 'display:none;' : ''}">
            ${_users.map(u => `
              <div class="form-group">
                <label class="form-label" style="display:flex;align-items:center;gap:6px;">
                  <span style="background:${escHtml(u.color||'#6C63FF')};width:12px;height:12px;border-radius:50%;display:inline-block;"></span>
                  ${escHtml(u.name)} (%)
                </label>
                <div class="input-wrap">
                  <input type="number" class="form-input input-euro pct-field" data-uid="${u.id}"
                    min="0" max="100" step="1" value="${_repCfg.pcts?.[u.id] ?? Math.round(100/_users.length)}">
                  <span class="input-suffix">%</span>
                </div>
              </div>`).join('')}
          </div>
          <div id="equitable-info" style="margin-top:8px;${_repCfg.mode !== 'equitable' ? 'display:none;' : ''}"></div>
          <div id="mode-desc" style="font-size:0.78rem;color:var(--text-3);margin-top:6px;">${getModeDesc(_repCfg.mode)}</div>
        </div>` : ''}
      </div>
    </details>

    <!-- Accordion 2: Charges du mois -->
    <details class="settings-group" open>
      <summary class="settings-group-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
        🏠 Charges du mois
      </summary>
      <div class="settings-group-body">
        <div style="display:flex;gap:8px;margin-bottom:12px;">
          <button class="btn btn-sm btn-outline" id="btn-import-charges">📥 Importer</button>
          <button class="btn btn-sm btn-primary" id="btn-add-charge">+ Ajouter</button>
        </div>
        <div id="saisie-charges-list"></div>
        <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <div style="font-weight:700;font-size:0.82rem;">⚡ Imprévus</div>
            <button class="btn btn-sm btn-secondary" id="btn-add-imprevu">+ Ajouter</button>
          </div>
          <p style="font-size:0.75rem;color:var(--text-3);margin:0 0 6px;">Dépenses non planifiées (panne, urgence…). Pour les achats ponctuels importants, utilisez <strong>Ce mois → Budgets</strong>.</p>
          <div id="imprevu-list"></div>
        </div>
      </div>
    </details>

    <!-- Accordion 3: Récapitulatif prévisionnel -->
    <details class="settings-group">
      <summary class="settings-group-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        📋 Récapitulatif prévisionnel
      </summary>
      <div class="settings-group-body">
        <div id="saisie-prev-table" style="margin-bottom:10px;"></div>
        <div class="form-group">
          <label class="form-label" style="margin-bottom:4px;font-size:0.78rem;">📝 Notes du mois</label>
          <textarea id="notes-field" class="form-input" rows="3"
            placeholder="Remarques, événements du mois…" style="resize:vertical;">${escHtml(_md.notes || '')}</textarea>
        </div>
      </div>
    </details>

    <!-- ── Footer sticky ── -->
    <!-- ── Footer sticky ── -->
    <div class="saisie-footer" id="saisie-footer">
      <div>
        <div class="saisie-footer-label">Solde du mois</div>
        <div id="footer-solde" class="saisie-footer-amount">…</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <span id="save-indicator" class="save-indicator hidden">✓ Sauvegardé</span>
        <button class="btn btn-outline btn-sm" id="btn-complete" style="display:flex;align-items:center;gap:5px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M20 6L9 17l-5-5"/></svg>
          <span id="btn-complete-text">${_md.isComplete ? '✅ Complet' : 'Marquer complet'}</span>
        </button>
      </div>
    </div>
    `}
  `;

  if (N === 0) return;

  _saveInd = container.querySelector('#save-indicator');

  // Mise à jour immédiate de l'aperçu
  updatePreview(container);
  _updateModeOptions(container);

  // ── Toggle : Aides & primes ──
  container.querySelector('#btn-toggle-aides')?.addEventListener('click', () => {
    const sec = container.querySelector('#aides-primes-section');
    const btn = container.querySelector('#btn-toggle-aides');
    if (!sec || !btn) return;
    const open = sec.style.display !== 'none';
    sec.style.display = open ? 'none' : '';
    btn.textContent = open ? '⬇ Aides & primes' : '⬆ Masquer';
  });

  // ── Navigation mois ──
  container.querySelector('#prev-month')?.addEventListener('click', () => {
    const n = addMonth(State.year, State.month, -1);
    State.year = n.year; State.month = n.month;
    render(container);
  });
  container.querySelector('#next-month')?.addEventListener('click', () => {
    const n = addMonth(State.year, State.month, 1);
    State.year = n.year; State.month = n.month;
    render(container);
  });

  // ── Mode répartition ──
  const debouncedSave = debounce(() => doSave(container), 800);

  container.querySelectorAll('#mode-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('#mode-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _repCfg.mode = btn.dataset.mode;
      _updateModeOptions(container);
      const descEl = container.querySelector('#mode-desc');
      if (descEl) descEl.textContent = getModeDesc(_repCfg.mode);
      updatePreview(container);
      debouncedSave();
    });
  });

  // ── Saisie des champs (auto-save debounced) ──
  const fieldSelectors = [
    ...Array.from(container.querySelectorAll('input[id^="rev-"], input[id^="pri-"], input[id^="ext-"], input[id^="aid-"]:not([type="checkbox"]), input[id^="crs-"]')),
    ...Array.from(container.querySelectorAll('.pct-field')),
  ];

  fieldSelectors.forEach(input => {
    input.addEventListener('input', () => {
      syncFormToState(container);
      updatePreview(container);
      debouncedSave();
      if (_repCfg.mode === 'equitable') _updateModeOptions(container);
    });
  });

  // Checkboxes aides répartition
  container.querySelectorAll('input[id^="aid-rep-"]').forEach(chk => {
    chk.addEventListener('change', () => {
      syncFormToState(container);
      updatePreview(container);
      debouncedSave();
      if (_repCfg.mode === 'equitable') _updateModeOptions(container);
    });
  });

  container.querySelector('#notes-field')?.addEventListener('input', () => {
    _md.notes = container.querySelector('#notes-field').value;
    debouncedSave();
  });

  // ── Courses toggle (foyer / individuel) — N>1 only ──
  container.querySelector('#courses-section')?.addEventListener('input', (e) => {
    if (e.target.matches('input[type="number"]')) {
      syncFormToState(container);
      updatePreview(container);
      debouncedSave();
    }
  });
  container.querySelector('#btn-courses-mode')?.addEventListener('click', () => {
    syncFormToState(container);
    _coursesFoyerMode = !_coursesFoyerMode;
    localStorage.setItem('coursesFoyerMode', _coursesFoyerMode ? '1' : '0');
    const btn = container.querySelector('#btn-courses-mode');
    if (btn) btn.textContent = _coursesFoyerMode ? '👤 Par personne' : '🏠 Foyer';
    const contentEl = container.querySelector('#courses-content');
    if (contentEl) contentEl.innerHTML = _buildCoursesContent(N);
    updatePreview(container);
    debouncedSave();
  });

  container.querySelector('#btn-extras-mode')?.addEventListener('click', () => {
    syncFormToState(container);
    _extrasFoyerMode = !_extrasFoyerMode;
    localStorage.setItem('extrasFoyerMode', _extrasFoyerMode ? '1' : '0');
    const btn = container.querySelector('#btn-extras-mode');
    if (btn) btn.textContent = _extrasFoyerMode ? '👤 Par personne' : '🏠 Foyer';
    const contentEl = container.querySelector('#extras-content');
    if (contentEl) contentEl.innerHTML = _buildExtrasContent(N);
    container.querySelector('#ext-foyer')?.addEventListener('input', () => {
      syncFormToState(container); updatePreview(container); debouncedSave();
    });
    updatePreview(container);
    debouncedSave();
  });

  // Lier #ext-foyer si le mode foyer est déjà actif au premier rendu
  if (_extrasFoyerMode) {
    container.querySelector('#ext-foyer')?.addEventListener('input', () => {
      syncFormToState(container); updatePreview(container); debouncedSave();
    });
  }

  // ── Imprévus (liste dynamique) ──
  _recomputeImprévus();
  _renderImprévusList(container);
  container.querySelector('#btn-add-imprevu')?.addEventListener('click', () => {
    showImprévuModal(container, month, year);
  });

  // ── Pré-remplissage ──
  container.querySelector('#btn-prefill')?.addEventListener('click', async () => {
    _users.forEach(u => {
      const uid = String(u.id);
      const prevU = prevMd?.users?.[uid];
      if (!prevU) return;
      if (!_md.users[uid]) _md.users[uid] = {};
      _md.users[uid].revenus = prevU.revenus ?? 0;
      _md.users[uid].courses = prevU.courses ?? 0;
      _md.users[uid].extras  = prevU.extras  ?? 0;
      _md.users[uid].aides   = prevU.aides   ?? 0;
      _md.users[uid].primes  = prevU.primes  ?? 0;
    });
    await saveMonthlyData(_md);
    render(container);
    showToast(`Données de ${nomMois(prevM.month)} ${prevM.year} copiées ✅`, 'success');
  });

  // ── Marquer complet ──
  container.querySelector('#btn-complete')?.addEventListener('click', async () => {
    syncFormToState(container);
    if (_md.isComplete) {
      _md.isComplete = false;
      await saveMonthlyData(_md);
      showToast('Mois marqué comme en cours', 'success');
      const btn = container.querySelector('#btn-complete');
      const txt = container.querySelector('#btn-complete-text');
      if (btn) btn.style.color = '';
      if (txt) txt.textContent = 'Marquer complet';
    } else {
      await _showEndOfMonthWizard(container, month, year);
      if (_md.isComplete) {
        const btn = container.querySelector('#btn-complete');
        const txt = container.querySelector('#btn-complete-text');
        if (btn) btn.style.color = 'var(--success)';
        if (txt) txt.textContent = '✅ Complet';
      }
    }
  });

  if (_md.isComplete) {
    const btn = container.querySelector('#btn-complete');
    if (btn) btn.style.color = 'var(--success)';
  }

  // ── Charges du mois ──
  _renderSaisieChargesList(container);
  container.querySelector('#btn-add-charge')?.addEventListener('click', () => {
    showChargeModal(null, () => { _renderSaisieChargesList(container); updatePreview(container); });
  });
  container.querySelector('#btn-import-charges')?.addEventListener('click', () => {
    _showImportChargesOptions(container);
  });
}

// ── Render inline charges list ──
function _renderSaisieChargesList(container) {
  const el = container.querySelector('#saisie-charges-list');
  if (!el) return;
  if (!_chargesCache.length) {
    el.innerHTML = `<p style="font-size:0.78rem;color:var(--text-3);text-align:center;padding:8px 0;">Aucune charge ce mois-ci.</p>`;
    return;
  }
  const byCat = {};
  for (const c of _chargesCache) { (byCat[c.category || 'autre'] ??= []).push(c); }
  el.innerHTML = Object.entries(byCat).map(([catId, items]) => {
    const info = getCategoryInfo(catId);
    const total = items.reduce((s, c) => s + (c.lines?.reduce((ss, l) => ss + (Number(l.amount)||0), 0) || Number(c.amount)||0), 0);
    return `<div style="margin-bottom:10px;">
      <div style="font-size:0.72rem;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:4px;">${escHtml(info.icon || '')} ${escHtml(info.label || catId)} — ${eur(total)}</div>
      <div class="item-list">
        ${items.map(c => {
          const lines = c.lines?.length ? c.lines : [{ amount: c.amount, qui: c.qui }];
          const lineTotal = lines.reduce((s, l) => s + (Number(l.amount)||0), 0);
          return `<div class="list-item charge-item" data-cid="${c.id}" style="cursor:pointer;">
            <div class="list-item-body"><div class="list-item-title">${escHtml(c.label)}</div></div>
            <div class="list-item-right"><div class="list-item-amount">${eur(lineTotal)}</div></div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('.charge-item[data-cid]').forEach(item => {
    item.addEventListener('click', async () => {
      const id = Number(item.dataset.cid);
      const charges = await getAllCharges();
      const charge = charges.find(c => c.id === id);
      if (charge) showChargeModal(charge, async () => {
        _chargesCache = await getChargesForMonth(State.month, State.year);
        _renderSaisieChargesList(container);
        updatePreview(container);
      });
    });
  });
}

// ── Import charges options ──
function _showImportChargesOptions(container) {
  const { year, month } = State;
  openModal('📥 Importer des charges',
    `<div style="display:flex;flex-direction:column;gap:10px;">
      <button class="btn btn-outline" id="imp-prev-month" style="text-align:left;padding:14px;white-space:normal;width:100%;">
        <strong>📅 Du mois précédent</strong><br>
        <span style="font-size:0.78rem;color:var(--text-3);">Copie toutes les charges du mois passé</span>
      </button>
      <button class="btn btn-outline" id="imp-templates" style="text-align:left;padding:14px;white-space:normal;width:100%;">
        <strong>📋 Charges types</strong><br>
        <span style="font-size:0.78rem;color:var(--text-3);">Sélectionnez des charges prédéfinies</span>
      </button>
    </div>`,
    `<button class="btn btn-outline" id="imp-cancel">Annuler</button>`
  );
  document.getElementById('imp-cancel')?.addEventListener('click', closeModal);
  document.getElementById('imp-templates')?.addEventListener('click', () => {
    closeModal();
    showChargesTemplatesModal(async () => {
      _chargesCache = await getChargesForMonth(month, year);
      _renderSaisieChargesList(container);
      updatePreview(container);
    });
  });
  document.getElementById('imp-prev-month')?.addEventListener('click', async () => {
    const prevM = addMonth(year, month, -1);
    const prevCharges = (await getAllCharges()).filter(c => c.year === prevM.year && c.month === prevM.month);
    if (!prevCharges.length) {
      showToast('Aucune charge le mois précédent', 'warning');
      closeModal();
      return;
    }
    for (const c of prevCharges) {
      const { id: _id, ...rest } = c;
      await saveCharge({ ...rest, year, month });
    }
    _chargesCache = await getChargesForMonth(month, year);
    _renderSaisieChargesList(container);
    updatePreview(container);
    closeModal();
    showToast(`${prevCharges.length} charge(s) importée(s) ✅`, 'success');
  });
}

// ── Synchronise les inputs vers _md et _repCfg ──
function syncFormToState(container) {
  if (!_md.users) _md.users = {};
  const _v = id => Math.max(0, Number(container.querySelector(`#${id}`)?.value) || 0);
  _users.forEach(u => {
    const uid = String(u.id);
    if (!_md.users[uid]) _md.users[uid] = {};
    _md.users[uid].revenus  = _v(`rev-${u.id}`);
    _md.users[uid].primes   = _v(`pri-${u.id}`);
    _md.users[uid].aides    = _v(`aid-${u.id}`);
    // courses/extras/imprevus are NOT reset here (managed separately)
  });
  // Aides répartition
  if (!_repCfg.aidesRepartition) _repCfg.aidesRepartition = {};
  _users.forEach(u => {
    _repCfg.aidesRepartition[String(u.id)] = container.querySelector(`#aid-rep-${u.id}`)?.checked ?? false;
  });

  if (!_repCfg.pcts) _repCfg.pcts = {};
  container.querySelectorAll('.pct-field').forEach(input => {
    _repCfg.pcts[input.dataset.uid] = Number(input.value) || 0;
  });
}

// ── Recompute imprevus per-user from the list ──
function _recomputeImprévus() {
  const N = _users.length || 1;
  if (!_md.users) _md.users = {};
  _users.forEach(u => {
    if (!_md.users[String(u.id)]) _md.users[String(u.id)] = {};
    _md.users[String(u.id)].imprevus = 0;
  });
  for (const item of (_md.imprévusList || [])) {
    const amt = Number(item.amount) || 0;
    if (item.qui === 'shared' && item.splitPcts && typeof item.splitPcts === 'object') {
      const sumPcts = _users.reduce((s, u) => s + (Number(item.splitPcts[String(u.id)]) || 0), 0) || 100;
      _users.forEach(u => { _md.users[String(u.id)].imprevus += amt * ((Number(item.splitPcts[String(u.id)]) || 0) / sumPcts); });
    } else if (item.qui === 'shared') {
      _users.forEach(u => { _md.users[String(u.id)].imprevus += amt / N; });
    } else {
      const uid = String(item.qui);
      if (_md.users[uid] !== undefined) _md.users[uid].imprevus += amt;
    }
  }
}

// ── Rendu de la liste des imprévus ──
function _renderImprévusList(container) {
  const el = container.querySelector('#imprevu-list');
  if (!el) return;
  const list = _md.imprévusList || [];
  const total = list.reduce((s, i) => s + (Number(i.amount) || 0), 0);

  if (!list.length) {
    el.innerHTML = `<p style="font-size:0.78rem;color:var(--text-3);text-align:center;padding:8px 0;">Aucun imprévu ce mois-ci</p>`;
    return;
  }

  el.innerHTML = `
    <div style="margin-bottom:4px;">
      ${list.map(item => {
        const quiLabel = item.qui === 'shared' ? '🤝 Partagé' : (_users.find(u => String(u.id) === String(item.qui))?.name ?? item.qui);
        return `
          <div class="imprevu-item" data-iid="${item.id}" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--danger-bg);border-radius:var(--radius-sm);margin-bottom:6px;">
            <span style="font-size:1rem;">⚡</span>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:0.85rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(item.label)}</div>
              <div style="font-size:0.72rem;color:var(--text-3);">${escHtml(quiLabel)}${item.day ? ` · j.${item.day}` : ''}</div>
            </div>
            <span style="font-weight:700;font-size:0.95rem;color:var(--danger);flex-shrink:0;">${eur(Number(item.amount)||0)}</span>
            <button class="btn-icon imp-del" data-iid="${item.id}" style="color:var(--text-3);width:28px;height:28px;flex-shrink:0;" title="Supprimer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        `;
      }).join('')}
    </div>
    <div style="text-align:right;font-size:0.8rem;font-weight:700;color:var(--danger);">Total : ${eur(total)}</div>
  `;

  el.querySelectorAll('.imp-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const iid = btn.dataset.iid;
      _md.imprévusList = (_md.imprévusList || []).filter(i => i.id !== iid);
      _recomputeImprévus();
      _renderImprévusList(container);
      updatePreview(container);
      await saveMonthlyData(_md);
    });
  });
}

// ── Aperçu + table prévisionnel ──
function updatePreview(container) {
  syncFormToState(container);

  const budgCibles = _settings?.budgetCibles || {};
  const N = _users.length || 1;
  const prevUsers = {};
  for (const u of _users) {
    const uid = String(u.id);
    const base = _md.users?.[uid] || {};
    prevUsers[uid] = {
      ...base,
      courses: Number(base.courses) || (Number(budgCibles.courses) || 0) / N,
      extras:  Number(base.extras)  || (Number(budgCibles.extras)  || 0) / N,
    };
  }
  const mdPrev = { ..._md, users: prevUsers };
  const kpiPrev = calcMonth(mdPrev, _chargesCache, _achatsCache, _repCfg, _users);

  // kpiReel = avec budgetOps réels + charges dont le jour est passé (si mois courant)
  const { year, month } = State;
  const now = new Date();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  const todayDay = now.getDate();
  const chargesReel = isCurrentMonth
    ? _chargesCache.filter(c => !c.dayOfMonth || Number(c.dayOfMonth) <= todayDay)
    : _chargesCache;
  const kpiReel = calcMonth(mdPrev, chargesReel, _achatsCache, _repCfg, _users, _budgetOpsCache);

  const footerSolde = container.querySelector('#footer-solde');
  if (footerSolde) {
    footerSolde.textContent = eur(kpiPrev.solde.total);
    footerSolde.className = 'saisie-footer-amount ' + signClass(kpiPrev.solde.total);
  }
  _renderPrevTable(container, kpiPrev, kpiReel);
}

// ── Table récapitulatif — identique à Historique → Détail ──
function _renderPrevTable(container, kpiPrev, kpiReel) {
  const el = container.querySelector('#saisie-prev-table');
  if (!el) return;
  const { year, month } = State;
  const N = _users.length;
  const customBudgets = _settings?.customBudgets || [];
  const salarialePlanned = _settings?.salarialePlanned || {};
  let detailMode = 'previsionnel';

  const realCourses = _budgetOpsCache.filter(o => o.category === 'courses').reduce((s, o) => s + (Number(o.amount)||0), 0);
  const realExtras  = _budgetOpsCache.filter(o => o.category === 'extras').reduce((s, o) => s + (Number(o.amount)||0), 0);

  function buildTable() {
    const isReel = detailMode === 'reel';
    const dk = isReel ? kpiReel : kpiPrev;
    const courses = isReel ? realCourses : (kpiPrev.courses?.total || 0);
    const extras  = isReel ? realExtras  : (kpiPrev.extras?.total  || 0);
    const uCols   = N > 1;
    const hdr = uCols ? _users.map(u =>
      `<th style="text-align:right"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${escHtml(u.color||'#7C5CFC')};margin-right:3px;"></span>${escHtml(u.name)}</th>`
    ).join('') : '';
    const buildRow = (label, cat) => {
      if (!cat) return '';
      const uc = uCols ? _users.map(u => `<td style="text-align:right">${eur(cat.byUser?.[u.id]??0)}</td>`).join('') : '';
      return `<tr><td>${label}</td>${uc}<td style="text-align:right">${eur(cat.total)}</td></tr>`;
    };
    const sTotal = dk.solde?.total ?? 0;
    const revenusAides = { total: (dk.revenus?.total||0)+(dk.aides?.total||0), byUser: uCols ? Object.fromEntries(_users.map(u=>[u.id,(dk.revenus?.byUser?.[u.id]??0)+(dk.aides?.byUser?.[u.id]??0)])) : {} };
    return `<div style="overflow-x:auto;"><table class="data-table">
      <thead><tr><th>Catégorie</th>${hdr}<th style="text-align:right">Total</th></tr></thead>
      <tbody>
        ${buildRow('Revenus &amp; Aides', revenusAides)}
        ${(dk.primes?.total??0)>0 ? buildRow('Primes', dk.primes) : ''}
        ${buildRow('Charges', dk.charges)}
        ${courses > 0 ? `<tr><td>${isReel?'Courses (confirmé)':'Budget courses'}</td>${uCols?_users.map(u=>`<td style="text-align:right">${eur(dk.courses?.byUser?.[u.id]??0)}</td>`).join(''):''}<td style="text-align:right">${eur(courses)}</td></tr>` : ''}
        ${extras > 0 ? `<tr><td>${isReel?'Loisirs (confirmé)':'Budget loisirs'}</td>${uCols?_users.map(u=>`<td style="text-align:right">${eur(dk.extras?.byUser?.[u.id]??0)}</td>`).join(''):''}<td style="text-align:right">${eur(extras)}</td></tr>` : ''}
        ${buildRow('Dép. ponctuelles', dk.achats ?? {total:0,byUser:{}})}
        ${buildRow('Imprévus', dk.imprevus ?? {total:0,byUser:{}})}
        ${customBudgets.map(b => {
          if (isReel) {
            const bOps = _budgetOpsCache.filter(o=>o.category===b.id);
            const spent = bOps.reduce((s,o)=>s+(Number(o.amount)||0),0);
            const bByUser = uCols ? (() => { const acc={}; for(const o of bOps){if(o.userId){const k=String(o.userId);acc[k]=(acc[k]||0)+(Number(o.amount)||0);}else{const share=(Number(o.amount)||0)/_users.length;for(const u of _users){const k=String(u.id);acc[k]=(acc[k]||0)+share;}}} return acc; })() : {};
            return `<tr><td>${b.icon||'📌'} ${escHtml(b.name)}</td>${uCols?_users.map(u=>`<td style="text-align:right">${eur(bByUser[String(u.id)]??0)}</td>`).join(''):''}<td style="text-align:right">${eur(spent)}</td></tr>`;
          } else {
            const bgt = b.allocation==='equal'?(Number(b.amount)||0)*_users.length:b.allocation==='custom'?Object.values(b.amountByUser||{}).reduce((s,v)=>s+(Number(v)||0),0):Number(b.amount)||0;
            const bByUserP = uCols ? (() => { const acc={}; if(b.allocation==='custom'){for(const u of _users)acc[String(u.id)]=Number(b.amountByUser?.[u.id]??b.amountByUser?.[String(u.id)])||0;}else if(b.allocation==='equal'){for(const u of _users)acc[String(u.id)]=Number(b.amount)||0;}else{const sh=_users.length?bgt/_users.length:bgt;for(const u of _users)acc[String(u.id)]=sh;} return acc; })() : {};
            return `<tr><td>${b.icon||'📌'} ${escHtml(b.name)}</td>${uCols?_users.map(u=>`<td style="text-align:right">${eur(bByUserP[String(u.id)]??0)}</td>`).join(''):''}<td style="text-align:right">${eur(bgt)}</td></tr>`;
          }
        }).join('')}
        ${(() => {
          const salTotal = _users.reduce((s,u)=>s+(Number(salarialePlanned[String(u.id)])||0),0);
          if (!salTotal) return '';
          const salByUser = uCols ? Object.fromEntries(_users.map(u=>[String(u.id), Number(salarialePlanned[String(u.id)])||0])) : {};
          return `<tr><td>💼 Épargne salariale</td>${uCols?_users.map(u=>`<td style="text-align:right">${eur(salByUser[String(u.id)]??0)}</td>`).join(''):''}<td style="text-align:right">${eur(salTotal)}</td></tr>`;
        })()}
      </tbody>
      <tfoot>
        ${uCols ? `<tr class="row-total"><td>${isReel?'À payer':'À envoyer (prév.)'}</td>${_users.map(u=>`<td style="text-align:right">${eur(dk.aPayer?.byUser?.[u.id]??0)}</td>`).join('')}<td style="text-align:right">${eur(dk.aPayer?.total||0)}</td></tr>` : ''}
        <tr class="row-total"><td>Solde ${isReel?'net':'prévisionnel'}</td>${uCols?_users.map(u=>{const v=dk.solde?.byUser?.[u.id]??0;return`<td style="text-align:right;color:${v>=0?'var(--success)':'var(--danger)'}">${eur(v)}</td>`;}).join(''):''}<td style="text-align:right;color:${sTotal>=0?'var(--success)':'var(--danger)'}">${eur(sTotal)}</td></tr>
      </tfoot>
    </table></div>${!isReel ? '<p style="font-size:0.72rem;color:var(--text-3);margin-top:8px;padding:0 2px;">💡 Ce calcul utilise les plafonds de budget et la répartition configurée. Il représente le maximum à envoyer sur le compte joint.</p>' : ''}`;
  }

  el.innerHTML = `<div class="card" style="margin-bottom:0;">
    <div class="card-header" style="flex-wrap:wrap;gap:6px;">
      <span class="card-title">📋 Détail ${escHtml(MOIS[month-1])} ${year}</span>
      <div style="margin-left:auto;display:flex;gap:4px;">
        <button class="btn btn-sm saisie-dmode btn-outline" data-dmode="reel" style="font-size:0.68rem;padding:2px 8px;">✅ Réel</button>
        <button class="btn btn-sm saisie-dmode btn-primary" data-dmode="previsionnel" style="font-size:0.68rem;padding:2px 8px;">📅 Prévisionnel</button>
      </div>
    </div>
    <p class="saisie-detail-hint" style="font-size:0.72rem;color:var(--text-3);margin-bottom:8px;">📅 Simulation avec tous les budgets et charges du mois configurés</p>
    <div class="saisie-detail-table">${buildTable()}</div>
  </div>`;

  el.onclick = e => {
    const btn = e.target.closest('.saisie-dmode');
    if (!btn) return;
    detailMode = btn.dataset.dmode;
    el.querySelectorAll('.saisie-dmode').forEach(b => {
      b.classList.toggle('btn-primary', b.dataset.dmode === detailMode);
      b.classList.toggle('btn-outline',  b.dataset.dmode !== detailMode);
    });
    const hint = el.querySelector('.saisie-detail-hint');
    if (hint) hint.textContent = detailMode === 'reel'
      ? '✅ Opérations confirmées + charges dont la date de prélèvement est passée'
      : '📅 Simulation avec tous les budgets et charges du mois configurés';
    const tableDiv = el.querySelector('.saisie-detail-table');
    if (tableDiv) tableDiv.innerHTML = buildTable();
  };
}

// ── Auto-save ──
async function doSave(container) {
  syncFormToState(container);
  try {
    await Promise.all([saveMonthlyData(_md), saveRepartition(_repCfg)]);
    if (_saveInd) {
      _saveInd.classList.remove('hidden');
      clearTimeout(_saveInd._timer);
      _saveInd._timer = setTimeout(() => _saveInd.classList.add('hidden'), 2000);
    }
  } catch (e) {
    showToast('Erreur lors de la sauvegarde', 'error');
    console.error(e);
  }
}

// ── Modal What-if ──
function showWhatIfModal(container, month, year) {
  openModal('🧮 Simulateur What-if', `
    <p style="font-size:0.85rem;color:var(--text-2);margin-bottom:12px;">
      Simulez l'impact d'un revenu supplémentaire sur votre solde.
    </p>
    <div class="form-grid-${Math.min(_users.length, 2)}" style="margin-bottom:12px;">
      ${_users.map(u => `
        <div class="form-group">
          <label class="form-label">+ Revenus ${escHtml(u.name)} (€)</label>
          <div class="input-wrap">
            <input type="number" class="form-input input-euro wi-extra" data-uid="${u.id}" min="0" step="10" value="0">
            <span class="input-suffix">€</span>
          </div>
        </div>`).join('')}
    </div>
    <div id="wi-result" style="background:var(--primary-bg);border-radius:var(--radius-sm);padding:14px;display:none;"></div>
  `, `
    <button class="btn btn-secondary btn-full" id="wi-calc">Calculer</button>
    <button class="btn btn-outline" id="wi-close">Fermer</button>
  `);

  document.getElementById('wi-close')?.addEventListener('click', closeModal);
  document.getElementById('wi-calc')?.addEventListener('click', async () => {
    const extraByUser = {};
    document.querySelectorAll('.wi-extra').forEach(inp => {
      extraByUser[inp.dataset.uid] = Number(inp.value) || 0;
    });
    const charges = _chargesCache;
    const achats  = _achatsCache;
    const base    = calcMonth(_md, charges, achats, _repCfg, _users, _budgetOpsCache);
    const sim     = whatIf(base, extraByUser, _users);
    const res     = document.getElementById('wi-result');
    if (!res || !sim) return;
    res.style.display = '';
    res.innerHTML = `
      <div style="font-size:0.78rem;font-weight:700;color:var(--primary);margin-bottom:8px;text-transform:uppercase;">Résultat</div>
      <div class="calc-preview-row"><span>Revenu supplémentaire</span><span style="color:var(--success);font-weight:700;">+ ${eur(sim.deltaTotal)}</span></div>
      <div class="calc-preview-row"><span>Nouveau solde net</span><span style="font-weight:700;">${eur(sim.newSolde.total)}</span></div>
      <div class="calc-preview-row"><span>Nouveau taux d'épargne</span><span style="font-weight:700;">${pct(sim.newTxEpargne.total, 1)}</span></div>
    `;
  });
}

// ── Modal Imprévu ──
function showImprévuModal(container, month, year) {
  const now  = new Date();
  const quiOptions = (
    (_users.length > 1 ? `<option value="shared">🤝 Partagé (tous)</option>` : '') +
    _users.map(u => `<option value="${u.id}" ${_users.length === 1 ? 'selected' : ''}>${escHtml(u.name)}</option>`).join('')
  );

  openModal('⚡ Ajouter un imprévu', `
    <p style="font-size:0.82rem;color:var(--text-2);margin-bottom:14px;">
      Dépense non prévue survenue ce mois-ci (panne, urgence, soin…)
    </p>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Description</label>
      <input type="text" class="form-input" id="imp-label" placeholder="Ex: Plombier, Médicaments, Pneu…" autofocus>
    </div>
    <div class="form-grid-2" style="margin-bottom:10px;">
      <div class="form-group">
        <label class="form-label">Montant (€)</label>
        <div class="input-wrap">
          <input type="number" class="form-input input-euro" id="imp-amount" min="0" step="0.01" placeholder="0.00">
          <span class="input-suffix">€</span>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Jour du mois</label>
        <input type="number" class="form-input" id="imp-day" min="1" max="31" placeholder="Ex: 15" value="${now.getDate()}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Qui est concerné ?</label>
      <select class="form-select" id="imp-qui">${quiOptions}</select>
    </div>
    ${_users.length > 1 ? `
    <div id="imp-split-section" style="display:none;padding:8px;background:var(--bg-secondary);border-radius:var(--radius-sm);margin-top:8px;">
      <div style="font-size:0.7rem;color:var(--text-3);margin-bottom:6px;">Répartition personnalisée (%) — total doit faire 100%</div>
      ${_users.map(u => {
        const defPct = Math.round(100 / _users.length);
        return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${escHtml(u.color||'#6C63FF')};display:inline-block;"></span>
          <span style="flex:1;font-size:0.78rem;">${escHtml(u.name)}</span>
          <input type="number" class="form-input imp-split-pct" data-uid="${u.id}" min="0" max="100" step="1" value="${defPct}" style="width:62px;text-align:right;padding:4px 6px;">
          <span style="color:var(--text-3);font-size:0.78rem;">%</span>
        </div>`;
      }).join('')}
      <div id="imp-split-hint" style="text-align:right;font-size:0.7rem;margin-top:2px;"></div>
    </div>` : ''}
  `, `
    <button class="btn btn-outline" id="imp-cancel">Annuler</button>
    <button class="btn btn-danger" id="imp-save">Enregistrer</button>
  `);

  document.getElementById('imp-cancel')?.addEventListener('click', closeModal);

  // ── Répartition personnalisée ──
  const impQuiSel = document.getElementById('imp-qui');
  const impSplitSec = document.getElementById('imp-split-section');
  const updateImpSplitHint = () => {
    const total = [...document.querySelectorAll('.imp-split-pct')].reduce((s, i) => s + (Number(i.value)||0), 0);
    const hint = document.getElementById('imp-split-hint');
    if (hint) { hint.style.color = Math.abs(total-100)<0.5 ? 'var(--success)' : 'var(--danger)'; hint.textContent = `Total : ${total}%${Math.abs(total-100)>=0.5?' ⚠️':' ✅'}`; }
  };
  if (impSplitSec) {
    impQuiSel?.addEventListener('change', () => {
      impSplitSec.style.display = impQuiSel.value === 'shared' ? '' : 'none';
      if (impQuiSel.value === 'shared') updateImpSplitHint();
    });
    document.querySelectorAll('.imp-split-pct').forEach(i => i.addEventListener('input', updateImpSplitHint));
    // Afficher si déjà sur Partagé au chargement
    if (impQuiSel?.value === 'shared') {
      impSplitSec.style.display = '';
      updateImpSplitHint();
    }
  }

  document.getElementById('imp-save')?.addEventListener('click', async () => {
    const label = document.getElementById('imp-label')?.value.trim();
    if (!label) { showToast('La description est requise', 'error'); return; }
    const amount = Number(document.getElementById('imp-amount')?.value);
    if (!amount || amount <= 0) { showToast('Montant invalide', 'error'); return; }
    const quiRaw = document.getElementById('imp-qui')?.value;
    const qui = quiRaw === 'shared' ? 'shared' : Number(quiRaw);
    const splitInputs = document.querySelectorAll('.imp-split-pct');
    const splitPcts = (qui === 'shared' && splitInputs.length > 0 && impSplitSec?.style.display !== 'none')
      ? Object.fromEntries([...splitInputs].map(inp => [inp.dataset.uid, Number(inp.value)||0]))
      : null;
    const day = Number(document.getElementById('imp-day')?.value) || now.getDate();

    if (!_md.imprévusList) _md.imprévusList = [];
    _md.imprévusList.push({ id: uid(), label, amount, qui, ...(splitPcts ? { splitPcts } : {}), day, createdAt: now.toISOString() });
    _recomputeImprévus();
    closeModal();
    _renderImprévusList(container);
    updatePreview(container);
    await saveMonthlyData(_md);
    showToast('Imprévu ajouté ✅', 'success');
  });
}

// ── Modal Craquage et dépassement (exportable) ──
export async function showCraquageModal(container, month, year, usersOverride = null, onSave = null, prefill = null) {
  const users         = usersOverride || _users;
  const now           = new Date();
  const settings      = await getAllSettings();
  const customBudgets = settings.customBudgets || [];
  const budgetOpts    = [
    ...customBudgets.map(b => ({ id: b.id, label: `${b.icon || '📌'} ${escHtml(b.name)}` })),
  ];

  // Budget limits for greying maxed options
  let budgetLimitsMap = {};
  try {
    const [mdBgt, bOps] = await Promise.all([getMonthlyData(year, month), getBudgetOpsForMonth(year, month)]);
    for (const b of budgetOpts) {
      const lim = b.id === 'courses'
        ? users.reduce((s, u) => s + (Number(mdBgt?.users?.[String(u.id)]?.courses) || 0), 0)
        : b.id === 'extras'
          ? users.reduce((s, u) => s + (Number(mdBgt?.users?.[String(u.id)]?.extras) || 0), 0)
          : Number(customBudgets.find(cb => cb.id === b.id)?.amount || 0);
      if (lim > 0) {
        const sp = bOps.filter(o => o.category === b.id).reduce((s, o) => s + (Number(o.amount)||0), 0);
        budgetLimitsMap[b.id] = { budget: lim, spent: sp, remaining: lim - sp };
      }
    }
  } catch (e) { /* ignore */ }

  let rows = [{ source: 'balance', amount: prefill?.amount ? String(prefill.amount) : '', subValue: 'courses' }];

  const sourceOptions = `
    <option value="balance">📅 Budget mensuel</option>
    <option value="savings">💰 Économies</option>
    <option value="perso">🪙 Compte perso</option>
  `;

  function buildSubField(r) {
    if (r.source === 'balance') {
      return `<select class="form-input crq-sub" style="width:100%;font-size:0.78rem;padding:6px 8px;">
        ${budgetOpts.map(b => {
          const lim = budgetLimitsMap[b.id];
          const isMaxed = lim && lim.remaining <= 0;
          const suffix = isMaxed ? ' — épuisé' : (lim && lim.budget > 0 ? ` (${eur(lim.remaining)} restant)` : '');
          return `<option value="${b.id}" ${r.subValue === b.id ? 'selected' : ''} ${isMaxed ? 'disabled' : ''}>${b.label}${suffix}</option>`;
        }).join('')}
      </select>`;
    }
    if (r.source === 'savings' && users.length > 1) {
      const currentQui  = document.getElementById('crq-qui')?.value ?? 'shared';
      const showCommon  = (currentQui === 'shared');
      return `<select class="form-input crq-sub" style="width:100%;font-size:0.78rem;padding:6px 8px;">
        ${showCommon ? `<option value="" ${!r.subValue ? 'selected' : ''}>— Épargne commune —</option>` : ''}
        ${users.map(u => `<option value="${u.id}" ${r.subValue === String(u.id) ? 'selected' : ''}>${escHtml(u.name)}</option>`).join('')}
      </select>`;
    }
    if (r.source === 'perso') {
      return `<input type="text" class="form-input crq-sub" placeholder="Note (ex: compte courant, cash…)" value="${escHtml(r.subValue || '')}" style="width:100%;font-size:0.78rem;">`;
    }
    return '';
  }

  function buildRows() {
    return rows.map((r, i) => `
      <div class="craquage-row" style="padding:10px;background:var(--bg-2);border-radius:var(--radius-sm);margin-bottom:8px;" data-i="${i}">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:${r.source !== 'savings' || _users.length <= 1 ? (r.source === 'balance' || r.source === 'perso' ? '6px' : '0') : '6px'}">
          <div class="input-wrap" style="flex:1.2;">
            <input type="number" class="form-input input-euro crq-amount" min="0" step="0.01" placeholder="0.00" value="${r.amount}" style="font-size:0.9rem;">
            <span class="input-suffix">€</span>
          </div>
          <select class="form-input crq-source" style="flex:1.4;font-size:0.82rem;padding:8px;">
            ${sourceOptions.replace(`value="${r.source}"`, `value="${r.source}" selected`)}
          </select>
          ${rows.length > 1
            ? `<button class="btn-icon crq-del" data-i="${i}" style="flex-shrink:0;color:var(--danger);">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
               </button>`
            : '<div style="width:28px;"></div>'}
        </div>
        ${buildSubField(r) ? `<div style="padding-left:2px;">${buildSubField(r)}</div>` : ''}
      </div>`).join('');
  }

  const userOptions = users.map(u =>
    `<option value="${u.id}">${escHtml(u.name)}</option>`
  ).join('');

  openModal('💥 Craquage et dépassement', `
    <p style="font-size:0.82rem;color:var(--text-2);margin-bottom:12px;">
      Dépense imprévue ou dépassement de budget.
    </p>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Description</label>
      <input type="text" class="form-input" id="crq-label" placeholder="Ex: Restaurant, Vêtement impulsif…" autofocus value="${escHtml(prefill?.label || '')}">
    </div>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Qui a dépensé ?</label>
      <select class="form-select" id="crq-qui">
        ${users.length > 1 ? `<option value="shared">🤝 Partagé (tous)</option>` : ''}
        ${userOptions}
      </select>
    </div>
    <div class="form-group" style="margin-bottom:6px;">
      <label class="form-label">Source de financement</label>
      <p style="font-size:0.72rem;color:var(--text-3);margin-bottom:6px;">D'où vient l'argent pour couvrir cette dépense ?</p>
      <div id="crq-rows">${buildRows()}</div>
      <button class="btn btn-outline btn-sm btn-full" id="crq-add-row" style="margin-top:4px;">+ Ajouter une source</button>
    </div>
    <div id="crq-total-line" style="text-align:right;font-size:0.82rem;font-weight:600;color:var(--text-2);margin-top:6px;"></div>
  `, `
    <button class="btn btn-outline" id="crq-cancel">Annuler</button>
    <button class="btn btn-danger"  id="crq-save">Enregistrer</button>
  `);

  function rebuildRows() {
    document.getElementById('crq-rows').innerHTML = buildRows();
    bindRowEvents();
    updateTotal();
  }
  function updateTotal() {
    const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const el = document.getElementById('crq-total-line');
    if (el) el.textContent = total > 0 ? `Total : ${eur(total)}` : '';
  }
  function syncRows() {
    document.querySelectorAll('.craquage-row').forEach((row, i) => {
      if (!rows[i]) return;
      rows[i].amount   = row.querySelector('.crq-amount')?.value ?? '';
      rows[i].source   = row.querySelector('.crq-source')?.value ?? 'balance';
      rows[i].subValue = row.querySelector('.crq-sub')?.value ?? '';
    });
  }
  function bindRowEvents() {
    document.querySelectorAll('.craquage-row').forEach((row, i) => {
      row.querySelector('.crq-amount')?.addEventListener('input', () => { syncRows(); updateTotal(); });
      row.querySelector('.crq-source')?.addEventListener('change', () => {
        syncRows();
        rows[i].subValue = '';
        rebuildRows();
      });
      row.querySelector('.crq-sub')?.addEventListener('change', () => syncRows());
      row.querySelector('.crq-sub')?.addEventListener('input',  () => syncRows());
      row.querySelector('.crq-del')?.addEventListener('click', () => {
        syncRows(); rows.splice(i, 1); rebuildRows();
      });
    });
  }
  bindRowEvents();

  // Reconstruire les sub-fields si "qui" change (économie commune dépend de qui)
  document.getElementById('crq-qui')?.addEventListener('change', () => {
    syncRows();
    rebuildRows();
  });

  document.getElementById('crq-add-row')?.addEventListener('click', () => {
    syncRows(); rows.push({ source: 'balance', amount: '', subValue: 'courses' }); rebuildRows();
  });
  document.getElementById('crq-cancel')?.addEventListener('click', closeModal);

  document.getElementById('crq-save')?.addEventListener('click', async () => {
    syncRows();
    const label = document.getElementById('crq-label')?.value.trim();
    const qui   = document.getElementById('crq-qui')?.value;
    if (!label) { showToast('Ajoutez une description', 'error'); return; }
    const validRows = rows.filter(r => Number(r.amount) > 0);
    if (!validRows.length) { showToast('Montant invalide', 'error'); return; }

    const N = users.length || 1;

    for (const r of validRows) {
      const amt = Number(r.amount);

      // ── Bug 1: "À tous" → un achat par user avec amount/N ──
      const achatsList = (qui === 'shared' && N > 1)
        ? users.map(u => ({ quiId: String(u.id), quiAmt: amt / N }))
        : [{ quiId: qui, quiAmt: amt }];

      for (const { quiId, quiAmt } of achatsList) {
        await saveAchat({
          year, month, label, amount: quiAmt, qui: quiId,
          category:               'craquage',
          craquage_source:        r.source,
          craquage_budget:        r.source === 'balance' ? (r.subValue || 'courses') : null,
          craquage_savings_user:  r.source === 'savings' ? (r.subValue || null)      : null,
          craquage_note:          r.source === 'perso'   ? (r.subValue || null)      : null,
          day: now.getDate(), createdAt: now.toISOString(),
        });
      }

      // ── Bug 2: Budget mensuel → enregistrer une opération de budget ──
      if (r.source === 'balance') {
        const budgetCat = r.subValue || 'courses';
        await saveBudgetOp({
          category: budgetCat, year, month,
          day: now.getDate(), label: `💥 ${label}`, amount: amt,
          userId: (qui !== 'shared' && qui) ? qui : null,
        });
      }

      // ── Bug 3: Épargne commune → diviser par N users ──
      if (r.source === 'savings') {
        if (!r.subValue && N > 1) {
          const amtPerUser = amt / N;
          for (const u of users) {
            await saveSavingsOperation({
              amount: -amtPerUser, label: `Craquage : ${label}`,
              type: 'craquage_cover', userId: String(u.id),
              year, month, day: now.getDate(), createdAt: now.toISOString(),
            });
          }
        } else {
          await saveSavingsOperation({
            amount: -amt, label: `Craquage : ${label}`,
            type: 'craquage_cover', userId: r.subValue || null,
            year, month, day: now.getDate(), createdAt: now.toISOString(),
          });
        }
      }
    }

    if (prefill?.pendingId) await deleteAchat(prefill.pendingId);
    closeModal();
    const total = validRows.reduce((s, r) => s + Number(r.amount), 0);
    showToast(`Craquage enregistré : ${eur(total)} 💥`, 'success');
    if (container) {
      _achatsCache = await getAchatsForMonth(year, month);
      updatePreview(container);
    }
    if (onSave) await onSave();
  });
}


// ── Helpers ──
function _updateModeOptions(container) {
  const optsEl   = container.querySelector('#mode-options');
  const eqInfoEl = container.querySelector('#equitable-info');
  if (_repCfg.mode === 'fixe') {
    if (optsEl)   optsEl.style.display   = '';
    if (eqInfoEl) eqInfoEl.style.display = 'none';
  } else if (_repCfg.mode === 'equitable') {
    if (optsEl)   optsEl.style.display   = 'none';
    if (eqInfoEl) {
      eqInfoEl.style.display = '';
      let totalRev = 0;
      const revByUser = {};
      _users.forEach(u => {
        const r = Number(container.querySelector(`#rev-${u.id}`)?.value) || 0;
        const a = Number(container.querySelector(`#aid-${u.id}`)?.value) || 0;
        const aidInRep = container.querySelector(`#aid-rep-${u.id}`)?.checked ?? false;
        // Primes exclues du calcul équitable (elles appartiennent 100% à l'user)
        revByUser[String(u.id)] = r + (aidInRep ? a : 0);
        totalRev += r + (aidInRep ? a : 0);
      });
      const base = totalRev || 1;
      eqInfoEl.innerHTML = `
        <div style="font-size:0.72rem;color:var(--text-3);margin-bottom:6px;">Parts calculées au prorata des <strong>revenus</strong> (primes exclues) :</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${_users.map(u => {
            const pctVal = Math.round(revByUser[String(u.id)] / base * 100);
            return `<span style="display:inline-flex;align-items:center;gap:5px;background:var(--bg-card);border:1px solid var(--border);border-radius:20px;padding:3px 10px;font-size:0.8rem;">
              <span style="width:8px;height:8px;border-radius:50%;background:${escHtml(u.color||'#6C63FF')};display:inline-block;flex-shrink:0;"></span>
              <span style="font-weight:600;">${escHtml(u.name)}: ${pctVal}%</span>
            </span>`;
          }).join('')}
        </div>
      `;
    }
  } else {
    if (optsEl)   optsEl.style.display   = 'none';
    if (eqInfoEl) eqInfoEl.style.display = 'none';
  }
}

function _buildCoursesContent(N) {
  if (_coursesFoyerMode && N > 1) {
    const total = _users.reduce((s, u) => s + (Number(_md?.users?.[String(u.id)]?.courses) || 0), 0);
    return `
      <div class="form-hint" style="margin-bottom:8px;">Budget commun du foyer (réparti équitablement)</div>
      <div class="input-wrap" style="max-width:200px;">
        <input type="number" class="form-input input-euro" id="crs-foyer"
          min="0" step="0.01" placeholder="0.00" value="${total || ''}">
        <span class="input-suffix">€</span>
      </div>`;
  }
  return `
    <div class="form-hint" style="margin-bottom:8px;">Ce que chacun a payé en caisse</div>
    <div class="form-grid-${Math.min(N, 4)}">
      ${_users.map(u => inputField(`crs-${u.id}`, u, _md?.users?.[String(u.id)]?.courses, '€')).join('')}
    </div>`;
}

function _buildExtrasContent(N) {
  if (_extrasFoyerMode && N > 1) {
    const total = _users.reduce((s, u) => s + (Number(_md?.users?.[String(u.id)]?.extras) || 0), 0);
    return `
      <div class="form-hint" style="margin-bottom:8px;">Budget loisirs commun du foyer (réparti équitablement)</div>
      <div class="input-wrap" style="max-width:200px;">
        <input type="number" class="form-input input-euro" id="ext-foyer"
          min="0" step="0.01" placeholder="0.00" value="${total || ''}">
        <span class="input-suffix">€</span>
      </div>`;
  }
  return `
    <div class="form-hint" style="margin-bottom:8px;">Loisirs, sorties, activités</div>
    <div class="form-grid-${Math.min(N, 4)}">
      ${_users.map(u => inputField(`ext-${u.id}`, u, _md?.users?.[String(u.id)]?.extras, '€')).join('')}
    </div>`;
}

function getModeDesc(mode) {
  if (mode === 'fixe')         return 'Les charges communes sont partagées selon des pourcentages fixes.';
  if (mode === 'equitable')    return 'Les charges communes sont partagées au prorata des revenus de chacun.';
  if (mode === 'personnalise') return 'Chaque charge partagée peut avoir sa propre répartition (définie ligne par ligne dans les charges).';
  return 'Chaque personne assume ses charges personnelles + une part égale des charges communes et courses.';
}

function inputField(id, user, value, suffix) {
  return `
    <div class="form-group">
      <label class="form-label" style="display:flex;align-items:center;gap:6px;">
        <span style="width:10px;height:10px;border-radius:50%;background:${escHtml(user.color||'#6C63FF')};display:inline-block;"></span>
        ${escHtml(user.name)}
      </label>
      <div class="input-wrap">
        <input type="number" class="form-input input-euro" id="${id}"
          min="0" step="0.01" placeholder="0.00" value="${Number(value) || ''}">
        <span class="input-suffix">${suffix}</span>
      </div>
    </div>`;
}

// ── Wizard de fin de mois ──────────────────────────────────
async function _showEndOfMonthWizard(container, month, year) {
  const kpi = calcMonth(_md, _chargesCache, _achatsCache, _repCfg, _users, _budgetOpsCache);
  const txEp   = kpi.txEpargne?.total ?? 0;
  const solde  = kpi.solde.total;
  const txColor = txEp >= 0.15 ? 'var(--success)' : txEp >= 0.05 ? 'var(--warning)' : 'var(--danger)';
  const soldeColor = solde >= 0 ? 'var(--success)' : 'var(--danger)';

  const step1 = `
    <div style="text-align:center;padding:8px 0 16px;">
      <div style="font-size:2rem;margin-bottom:8px;">🎉</div>
      <div style="font-size:1rem;font-weight:700;margin-bottom:4px;">Récapitulatif de ${nomMois(month)} ${year}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
      <div style="background:var(--bg-2);border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:0.7rem;color:var(--text-3);text-transform:uppercase;">Solde</div>
        <div style="font-size:1.3rem;font-weight:800;color:${soldeColor};">${eur(solde)}</div>
      </div>
      <div style="background:var(--bg-2);border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:0.7rem;color:var(--text-3);text-transform:uppercase;">Taux épargne</div>
        <div style="font-size:1.3rem;font-weight:800;color:${txColor};">${pct(txEp)}</div>
      </div>
      <div style="background:var(--bg-2);border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:0.7rem;color:var(--text-3);text-transform:uppercase;">Revenus</div>
        <div style="font-size:1rem;font-weight:700;">${eur(kpi.revenus.total)}</div>
      </div>
      <div style="background:var(--bg-2);border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:0.7rem;color:var(--text-3);text-transform:uppercase;">Dépenses</div>
        <div style="font-size:1rem;font-weight:700;color:var(--danger);">${eur(kpi.depenses.total)}</div>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">📝 Note du mois (optionnel)</label>
      <textarea class="form-input" id="wizard-note" rows="2" style="resize:none;font-size:0.85rem;" placeholder="Événements particuliers ce mois…">${escHtml(_md.notes || '')}</textarea>
    </div>`;

  openModal(`✅ Clôturer ${nomMois(month)} ${year}`, step1,
    `<button class="btn btn-outline" id="wiz-cancel">Annuler</button>
     <button class="btn btn-primary" id="wiz-confirm">Marquer complet ✅</button>`
  );

  document.getElementById('wiz-cancel')?.addEventListener('click', closeModal);
  document.getElementById('wiz-confirm')?.addEventListener('click', async () => {
    const note = document.getElementById('wizard-note')?.value?.trim();
    if (note !== undefined) _md.notes = note;
    _md.isComplete = true;
    await saveMonthlyData(_md);
    closeModal();
    showToast('Mois clôturé ✅', 'success');
    const btn = container.querySelector('#btn-complete');
    if (btn) btn.style.color = 'var(--success)';
  });
}
