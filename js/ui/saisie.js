// ============================================================
// js/ui/saisie.js – Page de saisie mensuelle (multi-users)
// ============================================================

import { State }                                       from '../app.js';
import { getMonthlyData, saveMonthlyData,
         getChargesForMonth, getAchatsForMonth,
         saveAchat, getRepartition, saveRepartition,
         getAllSettings, saveSavingsOperation,
         getActiveUsers, getUserMonthData }             from '../db.js';
import { calcMonth, whatIf }                           from '../calculs.js';
import { eur, pct, nomMois, addMonth, escHtml,
         signClass, debounce, showToast, uid,
         openModal, closeModal, MOIS }                 from '../utils.js';

let _md       = null;
let _repCfg   = null;
let _users    = [];
let _saveInd  = null; // référence à l'indicateur "Sauvegardé"
// Cache chargé une fois par render pour éviter les DB reads répétés
let _chargesCache = [];
let _achatsCache  = [];

export async function render(container) {
  _users = await getActiveUsers();
  const s     = await getAllSettings();
  const { year, month } = State;
  const N = _users.length;

  [_md, _repCfg, _chargesCache, _achatsCache] = await Promise.all([
    getMonthlyData(year, month),
    getRepartition(year, month),
    getChargesForMonth(month),
    getAchatsForMonth(year, month),
  ]);

  // Assurer que chaque user a ses données initialisées
  _users.forEach(u => getUserMonthData(_md, u.id));

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

    <!-- Mode répartition (masqué si solo) -->
    ${!modeHidden ? `
    <div class="form-section" style="margin-bottom:12px;">
      <div class="form-section-title"><span class="section-icon">⚖️</span>Mode de répartition des charges</div>
      <div class="tabs" id="mode-tabs">
        <button class="tab-btn ${_repCfg.mode === 'separe'    ? 'active' : ''}" data-mode="separe">Séparé</button>
        <button class="tab-btn ${_repCfg.mode === 'fixe'      ? 'active' : ''}" data-mode="fixe">Fixe %</button>
        <button class="tab-btn ${_repCfg.mode === 'equitable' ? 'active' : ''}" data-mode="equitable">Équitable</button>
      </div>
      ${_repCfg.mode === 'fixe' ? `
      <div id="mode-options" class="form-grid-${Math.min(N, 4)}" style="margin-top:8px;">
        ${_users.map(u => `
          <div class="form-group">
            <label class="form-label" style="display:flex;align-items:center;gap:6px;">
              <span class="user-color-dot" style="background:${escHtml(u.color||'#6C63FF')};width:12px;height:12px;border-radius:50%;display:inline-block;"></span>
              ${escHtml(u.name)} (%)
            </label>
            <div class="input-wrap">
              <input type="number" class="form-input input-euro pct-field" data-uid="${u.id}"
                min="0" max="100" step="1" value="${_repCfg.pcts?.[u.id] ?? Math.round(100/_users.length)}">
              <span class="input-suffix">%</span>
            </div>
          </div>`).join('')}
      </div>` : `<div id="mode-options" style="display:none;"></div>`}
      <div id="mode-desc" style="font-size:0.78rem;color:var(--text-3);margin-top:6px;">${getModeDesc(_repCfg.mode)}</div>
    </div>` : ''}

    <!-- Revenus -->
    <div class="form-section">
      <div class="form-section-title"><span class="section-icon">💰</span>Revenus</div>
      <div class="form-grid-${Math.min(N, 4)}">
        ${_users.map(u => inputField(`rev-${u.id}`, u, _md.users[String(u.id)]?.revenus, '€')).join('')}
      </div>
    </div>

    <!-- Primes -->
    <div class="form-section">
      <div class="form-section-title"><span class="section-icon">⭐</span>Primes & Aides</div>
      <div class="form-grid-${Math.min(N, 4)}">
        ${_users.map(u => inputField(`pri-${u.id}`, u, _md.users[String(u.id)]?.primes, '€')).join('')}
      </div>
    </div>

    <!-- Courses -->
    <div class="form-section">
      <div class="form-section-title"><span class="section-icon">🛒</span>Courses alimentaires</div>
      <div class="form-hint" style="margin-bottom:8px;">Ce que chacun a payé en caisse</div>
      <div class="form-grid-${Math.min(N, 4)}">
        ${_users.map(u => inputField(`crs-${u.id}`, u, _md.users[String(u.id)]?.courses, '€')).join('')}
      </div>
    </div>

    <!-- Extras -->
    <div class="form-section">
      <div class="form-section-title"><span class="section-icon">🎉</span>Extras & Sorties</div>
      <div class="form-grid-${Math.min(N, 4)}">
        ${_users.map(u => inputField(`ext-${u.id}`, u, _md.users[String(u.id)]?.extras, '€')).join('')}
      </div>
    </div>

    <!-- Imprévus -->
    <div class="form-section">
      <div class="form-section-title"><span class="section-icon">⚡</span>Imprévus</div>
      <div class="form-grid-${Math.min(N, 4)}">
        ${_users.map(u => inputField(`imp-${u.id}`, u, _md.users[String(u.id)]?.imprevus, '€')).join('')}
      </div>
    </div>

    <!-- Notes -->
    <div class="form-section">
      <div class="form-section-title"><span class="section-icon">📝</span>Notes du mois</div>
      <textarea id="notes-field" class="form-input" rows="3"
        placeholder="Remarques, événements du mois…" style="resize:vertical;">${escHtml(_md.notes || '')}</textarea>
    </div>

    <!-- Aperçu calcul -->
    <div class="calc-preview" id="calc-preview">
      <div class="calc-preview-title">⚡ Aperçu en temps réel</div>
      <div id="calc-rows">Calcul en cours…</div>
    </div>

    <!-- Simulateur What-if -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header">
        <span class="card-title">🧮 Simulateur What-if</span>
        <button class="btn btn-sm btn-secondary" id="btn-whatif">Simuler</button>
      </div>
      <p style="font-size:0.78rem;color:var(--text-3);">Que se passerait-il si vous gagniez plus ce mois-ci ?</p>
    </div>

    <!-- Actions -->
    <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;">
      <span id="save-indicator" class="save-indicator hidden">✓ Sauvegardé</span>
      <button class="btn btn-outline" id="btn-complete" title="Marquer comme complet" style="margin-left:auto;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
      </button>
    </div>

    <!-- Craquage FAB -->
    <button class="btn" id="btn-craquage"
      style="width:100%;background:var(--danger);color:#fff;font-weight:700;font-size:1rem;padding:14px;border-radius:var(--radius);margin-bottom:24px;display:flex;align-items:center;justify-content:center;gap:10px;">
      <span style="font-size:1.4rem;">💥</span> Enregistrer un craquage
    </button>
    `}
  `;

  if (N === 0) return;

  _saveInd = container.querySelector('#save-indicator');

  // Mise à jour immédiate de l'aperçu
  updatePreview(container);

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
      // Afficher/cacher les champs de %
      const optsEl = container.querySelector('#mode-options');
      if (optsEl) optsEl.style.display = _repCfg.mode === 'fixe' ? '' : 'none';
      const descEl = container.querySelector('#mode-desc');
      if (descEl) descEl.textContent = getModeDesc(_repCfg.mode);
      updatePreview(container);
      debouncedSave();
    });
  });

  // ── Saisie des champs (auto-save debounced) ──
  const fieldSelectors = [
    ...Array.from(container.querySelectorAll('input[id^="rev-"], input[id^="pri-"], input[id^="crs-"], input[id^="ext-"], input[id^="imp-"]')),
    ...Array.from(container.querySelectorAll('.pct-field')),
  ];

  fieldSelectors.forEach(input => {
    input.addEventListener('input', () => {
      syncFormToState(container);
      updatePreview(container);
      debouncedSave();
    });
  });

  container.querySelector('#notes-field')?.addEventListener('input', () => {
    _md.notes = container.querySelector('#notes-field').value;
    debouncedSave();
  });

  // ── Marquer complet ──
  container.querySelector('#btn-complete')?.addEventListener('click', async () => {
    syncFormToState(container);
    _md.isComplete = !_md.isComplete;
    await saveMonthlyData(_md);
    showToast(_md.isComplete ? 'Mois marqué comme complet ✅' : 'Mois marqué comme en cours', 'success');
    const btn = container.querySelector('#btn-complete');
    if (btn) btn.style.color = _md.isComplete ? 'var(--success)' : '';
  });

  if (_md.isComplete) {
    const btn = container.querySelector('#btn-complete');
    if (btn) btn.style.color = 'var(--success)';
  }

  // ── What-if ──
  container.querySelector('#btn-whatif')?.addEventListener('click', () => {
    showWhatIfModal(container, month, year);
  });

  // ── Craquage ──
  container.querySelector('#btn-craquage')?.addEventListener('click', () => {
    showCraquageModal(container, month, year);
  });
}

// ── Synchronise les inputs vers _md et _repCfg ──
function syncFormToState(container) {
  if (!_md.users) _md.users = {};
  _users.forEach(u => {
    const uid = String(u.id);
    if (!_md.users[uid]) _md.users[uid] = {};
    const v = id => Number(container.querySelector(`#${id}`)?.value) || 0;
    _md.users[uid].revenus  = v(`rev-${u.id}`);
    _md.users[uid].primes   = v(`pri-${u.id}`);
    _md.users[uid].courses  = v(`crs-${u.id}`);
    _md.users[uid].extras   = v(`ext-${u.id}`);
    _md.users[uid].imprevus = v(`imp-${u.id}`);
  });

  if (!_repCfg.pcts) _repCfg.pcts = {};
  container.querySelectorAll('.pct-field').forEach(input => {
    _repCfg.pcts[input.dataset.uid] = Number(input.value) || 0;
  });
}

// ── Aperçu ──
function updatePreview(container) {
  const el = container.querySelector('#calc-rows');
  if (!el) return;

  syncFormToState(container);

  const kpi = calcMonth(_md, _chargesCache, _achatsCache, _repCfg, _users);

  let byUserRows = '';
  if (_users.length > 1) {
    byUserRows = _users.map(u => {
      const uid = String(u.id);
      return `
        <div class="calc-preview-row total">
          <span style="display:flex;align-items:center;gap:6px;">
            <span style="width:8px;height:8px;border-radius:50%;background:${escHtml(u.color||'#6C63FF')};display:inline-block;"></span>
            ${escHtml(u.name)} : à payer
          </span>
          <span>${eur(kpi.aPayer.byUser[uid] ?? 0)}</span>
        </div>
        <div class="calc-preview-row">
          <span style="padding-left:14px;">Solde ${escHtml(u.name)}</span>
          <span class="${signClass(kpi.solde.byUser[uid] ?? 0)}">${eur(kpi.solde.byUser[uid] ?? 0)}</span>
        </div>
      `;
    }).join('');
  }

  el.innerHTML = `
    <div class="calc-preview-row"><span>Revenus + Primes</span><span>${eur(kpi.revenus.total + kpi.primes.total)}</span></div>
    <div class="calc-preview-row"><span>Charges récurrentes</span><span>${eur(kpi.charges.total)}</span></div>
    <div class="calc-preview-row"><span>Courses</span><span>${eur(kpi.courses.total)}</span></div>
    <div class="calc-preview-row"><span>Extras</span><span>${eur(kpi.extras.total)}</span></div>
    <div class="calc-preview-row"><span>Imprévus</span><span>${eur(kpi.imprevus.total)}</span></div>
    ${byUserRows}
    <div class="calc-preview-row total" style="font-size:1rem;">
      <span>Solde net total</span>
      <span class="${signClass(kpi.solde.total)}">${eur(kpi.solde.total)}</span>
    </div>
    <div class="calc-preview-row">
      <span>Taux d'épargne</span>
      <span>${pct(kpi.txEpargne.total, 1)}</span>
    </div>
  `;
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
    const base    = calcMonth(_md, charges, achats, _repCfg, _users);
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

// ── Modal Craquage ──
function showCraquageModal(container, month, year) {
  const now  = new Date();
  let rows   = [{ source: 'balance', amount: '' }];

  function buildRows() {
    return rows.map((r, i) => `
      <div class="craquage-row" style="display:flex;gap:8px;align-items:center;margin-bottom:6px;" data-i="${i}">
        <div class="input-wrap" style="flex:1.2;">
          <input type="number" class="form-input input-euro crq-amount" min="0" step="0.01" placeholder="0.00" value="${r.amount}" style="font-size:0.9rem;">
          <span class="input-suffix">€</span>
        </div>
        <select class="form-input crq-source" style="flex:1.5;font-size:0.85rem;padding:8px 10px;">
          <option value="balance" ${r.source === 'balance' ? 'selected' : ''}>📊 Budget mensuel</option>
          <option value="savings" ${r.source === 'savings' ? 'selected' : ''}>💰 Économies</option>
        </select>
        ${rows.length > 1
          ? `<button class="btn-icon crq-del" data-i="${i}" style="flex-shrink:0;color:var(--danger);">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
             </button>`
          : '<div style="width:28px;"></div>'}
      </div>`).join('');
  }

  const userOptions = _users.map(u =>
    `<option value="${u.id}">${escHtml(u.name)}</option>`
  ).join('');

  openModal('💥 Craquage', `
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Description</label>
      <input type="text" class="form-input" id="crq-label" placeholder="Ex: Restaurant, Vêtement impulsif…">
    </div>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Qui a craqué ?</label>
      <select class="form-select" id="crq-qui">
        ${_users.length > 1 ? `<option value="shared">À tous</option>` : ''}
        ${userOptions}
      </select>
    </div>
    <div class="form-group" style="margin-bottom:6px;">
      <label class="form-label">Répartition par source</label>
      <div id="crq-rows">${buildRows()}</div>
      <button class="btn btn-outline btn-sm btn-full" id="crq-add-row" style="margin-top:4px;">+ Ajouter une source</button>
    </div>
    <div id="crq-total-line" style="text-align:right;font-size:0.78rem;color:var(--text-3);margin-top:6px;"></div>
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
    if (el) el.textContent = `Total : ${eur(total)}`;
  }
  function syncRows() {
    document.querySelectorAll('.craquage-row').forEach((row, i) => {
      rows[i].amount = row.querySelector('.crq-amount')?.value ?? '';
      rows[i].source = row.querySelector('.crq-source')?.value ?? 'balance';
    });
  }
  function bindRowEvents() {
    document.querySelectorAll('.craquage-row').forEach((row, i) => {
      row.querySelector('.crq-amount')?.addEventListener('input', () => { syncRows(); updateTotal(); });
      row.querySelector('.crq-source')?.addEventListener('change', () => syncRows());
      row.querySelector('.crq-del')?.addEventListener('click', () => {
        syncRows(); rows.splice(i, 1); rebuildRows();
      });
    });
  }
  bindRowEvents();

  document.getElementById('crq-add-row')?.addEventListener('click', () => {
    syncRows(); rows.push({ source: 'balance', amount: '' }); rebuildRows();
  });
  document.getElementById('crq-cancel')?.addEventListener('click', closeModal);

  document.getElementById('crq-save')?.addEventListener('click', async () => {
    syncRows();
    const label = document.getElementById('crq-label')?.value.trim();
    const qui   = document.getElementById('crq-qui')?.value;
    if (!label) { showToast('Ajoutez une description', 'error'); return; }
    const validRows = rows.filter(r => Number(r.amount) > 0);
    if (!validRows.length) { showToast('Montant invalide', 'error'); return; }

    for (const r of validRows) {
      const amt = Number(r.amount);
      await saveAchat({ year, month, label, amount: amt, qui, category: 'craquage',
        craquage_source: r.source, day: now.getDate(), createdAt: now.toISOString() });
      if (r.source === 'savings') {
        await saveSavingsOperation({ amount: -amt, label: `Craquage : ${label}`,
          type: 'craquage_cover', year, month, day: now.getDate(), createdAt: now.toISOString() });
      }
    }
    closeModal();
    const total = validRows.reduce((s, r) => s + Number(r.amount), 0);
    showToast(`Craquage enregistré : ${eur(total)} 💥`, 'success');
    // Rafraîchit le cache achats puis l'aperçu
    _achatsCache = await getAchatsForMonth(year, month);
    updatePreview(container);
  });
}

// ── Helpers ──
function getModeDesc(mode) {
  if (mode === 'fixe')      return 'Les charges communes sont partagées selon des pourcentages fixes.';
  if (mode === 'equitable') return 'Les charges communes sont partagées au prorata des revenus de chacun.';
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

