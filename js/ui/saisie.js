// ============================================================
// js/ui/saisie.js – Page de saisie mensuelle
// ============================================================

import { State }                                      from '../app.js';
import { getMonthlyData, saveMonthlyData,
         getChargesForMonth, getAchatsForMonth,
         saveAchat, getRepartition, saveRepartition,
         getAllSettings, saveSavingsOperation }         from '../db.js';
import { calcMonth, whatIf }                           from '../calculs.js';
import { eur, pct, nomMois, addMonth, escHtml,
         signClass, debounce, showToast, uid,
         openModal, closeModal, MOIS }                 from '../utils.js';

let _md     = null; // données du mois en cours d'édition
let _repCfg = null;

export async function render(container) {
  const s      = await getAllSettings();
  const p1Name = escHtml(s.p1Name || 'Personne 1');
  const p2Name = escHtml(s.p2Name || 'Personne 2');
  const { year, month } = State;

  [_md, _repCfg] = await Promise.all([
    getMonthlyData(year, month),
    getRepartition(year, month),
  ]);

  const p1 = _md.p1;
  const p2 = _md.p2;

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

    <!-- Mode répartition -->
    <div class="form-section" style="margin-bottom:12px;">
      <div class="form-section-title">
        <span class="section-icon">⚖️</span>
        Mode de répartition des charges
      </div>
      <div class="tabs" id="mode-tabs">
        <button class="tab-btn ${_repCfg.mode === 'separe'   ? 'active' : ''}" data-mode="separe">Séparé</button>
        <button class="tab-btn ${_repCfg.mode === 'fixe'     ? 'active' : ''}" data-mode="fixe">Fixe %</button>
        <button class="tab-btn ${_repCfg.mode === 'equitable'? 'active' : ''}" data-mode="equitable">Équitable</button>
      </div>
      <div id="mode-options" style="${_repCfg.mode === 'fixe' ? '' : 'display:none;'}">
        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label">${p1Name} (%)</label>
            <div class="input-wrap">
              <input type="number" class="form-input input-euro" id="pct-p1"
                min="0" max="100" step="1" value="${_repCfg.pct_p1 ?? 50}">
              <span class="input-suffix">%</span>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">${p2Name} (%)</label>
            <div class="input-wrap">
              <input type="number" class="form-input input-euro" id="pct-p2"
                min="0" max="100" step="1" value="${_repCfg.pct_p2 ?? 50}">
              <span class="input-suffix">%</span>
            </div>
          </div>
        </div>
        <p class="form-hint">En mode Équitable, la répartition se fait automatiquement au prorata des revenus.</p>
      </div>
      <div id="mode-desc" style="font-size:0.78rem; color:var(--text-3); margin-top:6px;">${getModeDesc(_repCfg.mode)}</div>
    </div>

    <!-- Revenus -->
    <div class="form-section">
      <div class="form-section-title"><span class="section-icon">💰</span>Revenus</div>
      <div class="form-grid-2">
        ${inputField('rev-p1', p1Name, p1.revenus, '€')}
        ${inputField('rev-p2', p2Name, p2.revenus, '€')}
      </div>
    </div>

    <!-- Primes -->
    <div class="form-section">
      <div class="form-section-title"><span class="section-icon">⭐</span>Primes & Aides</div>
      <div class="form-grid-2">
        ${inputField('pri-p1', p1Name, p1.primes, '€')}
        ${inputField('pri-p2', p2Name, p2.primes, '€')}
      </div>
    </div>

    <!-- Courses -->
    <div class="form-section">
      <div class="form-section-title"><span class="section-icon">🛒</span>Courses alimentaires</div>
      <div class="form-hint" style="margin-bottom:10px;">Saisissez ce que chacun a payé (partagé automatiquement)</div>
      <div class="form-grid-2">
        ${inputField('crs-p1', p1Name, p1.courses, '€')}
        ${inputField('crs-p2', p2Name, p2.courses, '€')}
      </div>
    </div>

    <!-- Extras / Sorties -->
    <div class="form-section">
      <div class="form-section-title"><span class="section-icon">🎉</span>Extras & Sorties</div>
      <div class="form-grid-2">
        ${inputField('ext-p1', p1Name, p1.extras, '€')}
        ${inputField('ext-p2', p2Name, p2.extras, '€')}
      </div>
    </div>

    <!-- Imprévus -->
    <div class="form-section">
      <div class="form-section-title"><span class="section-icon">⚡</span>Imprévus</div>
      <div class="form-grid-2">
        ${inputField('imp-p1', p1Name, p1.imprevus, '€')}
        ${inputField('imp-p2', p2Name, p2.imprevus, '€')}
      </div>
    </div>

    <!-- Notes -->
    <div class="form-section">
      <div class="form-section-title"><span class="section-icon">📝</span>Notes du mois</div>
      <textarea id="notes-field" class="form-input" rows="3"
        placeholder="Remarques, événements du mois…"
        style="resize:vertical;">${escHtml(_md.notes || '')}</textarea>
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
      <p style="font-size:0.78rem; color:var(--text-3);">
        Que se passerait-il si vous gagniez plus ce mois-ci ?
      </p>
    </div>

    <!-- Actions -->
    <div style="display:flex; gap:8px; margin-bottom:12px;">
      <button class="btn btn-primary btn-full" id="btn-save">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        Enregistrer
      </button>
      <button class="btn btn-outline" id="btn-complete" title="Marquer comme complet">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
      </button>
    </div>

    <!-- Craquage FAB -->
    <button class="btn" id="btn-craquage"
      style="width:100%;background:var(--danger);color:#fff;font-weight:700;font-size:1rem;padding:14px;border-radius:var(--radius);margin-bottom:24px;display:flex;align-items:center;justify-content:center;gap:10px;">
      <span style="font-size:1.4rem;">💥</span> Enregistrer un craquage
    </button>
  `;

  // Mise à jour immédiate de l'aperçu
  updatePreview(container, p1Name, p2Name, month, year);

  // ── Événements navigation mois ──
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

  // ── Onglets mode répartition ──
  container.querySelectorAll('#mode-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('#mode-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _repCfg.mode = btn.dataset.mode;
      const opts = container.querySelector('#mode-options');
      const desc = container.querySelector('#mode-desc');
      opts.style.display = _repCfg.mode === 'fixe' ? '' : 'none';
      desc.textContent   = getModeDesc(_repCfg.mode);
      updatePreview(container, p1Name, p2Name, month, year);
    });
  });

  // ── Saisie des champs (auto-save debounced) ──
  const debouncedSave = debounce(() => doSave(container, false), 800);

  const fieldIds = ['rev-p1','rev-p2','pri-p1','pri-p2','crs-p1','crs-p2','ext-p1','ext-p2','imp-p1','imp-p2','pct-p1','pct-p2'];
  fieldIds.forEach(id => {
    container.querySelector(`#${id}`)?.addEventListener('input', () => {
      syncFormToState(container);
      updatePreview(container, p1Name, p2Name, month, year);
      debouncedSave();
    });
  });

  container.querySelector('#notes-field')?.addEventListener('input', () => {
    _md.notes = container.querySelector('#notes-field').value;
    debouncedSave();
  });

  // ── Sauvegarde manuelle ──
  container.querySelector('#btn-save')?.addEventListener('click', () => doSave(container, true));

  // ── Marquer complet ──
  container.querySelector('#btn-complete')?.addEventListener('click', async () => {
    syncFormToState(container);
    _md.isComplete = !_md.isComplete;
    await saveMonthlyData(_md);
    showToast(_md.isComplete ? 'Mois marqué comme complet ✅' : 'Mois marqué comme en cours', 'success');
    const btn = container.querySelector('#btn-complete');
    btn.style.color = _md.isComplete ? 'var(--success)' : '';
  });

  // ── What-if ──
  container.querySelector('#btn-whatif')?.addEventListener('click', () => {
    showWhatIfModal(container, p1Name, p2Name, month, year);
  });

  // ── Craquage ──
  container.querySelector('#btn-craquage')?.addEventListener('click', () => {
    showCraquageModal(container, p1Name, p2Name, month, year);
  });

  // Couleur du bouton complet si déjà complet
  if (_md.isComplete) {
    const btn = container.querySelector('#btn-complete');
    if (btn) btn.style.color = 'var(--success)';
  }
}

// ── Synchronise les inputs vers _md et _repCfg ──
function syncFormToState(container) {
  const v = (id) => Number(container.querySelector(`#${id}`)?.value) || 0;

  _md.p1.revenus  = v('rev-p1');
  _md.p2.revenus  = v('rev-p2');
  _md.p1.primes   = v('pri-p1');
  _md.p2.primes   = v('pri-p2');
  _md.p1.courses  = v('crs-p1');
  _md.p2.courses  = v('crs-p2');
  _md.p1.extras   = v('ext-p1');
  _md.p2.extras   = v('ext-p2');
  _md.p1.imprevus = v('imp-p1');
  _md.p2.imprevus = v('imp-p2');

  _repCfg.pct_p1 = v('pct-p1') || 50;
  _repCfg.pct_p2 = v('pct-p2') || 50;
}

// ── Met à jour l'aperçu de calcul ──
async function updatePreview(container, p1Name, p2Name, month, year) {
  const el = container.querySelector('#calc-rows');
  if (!el) return;

  syncFormToState(container);

  const charges = await getChargesForMonth(month);
  const achats  = await getAchatsForMonth(year, month);
  const kpi     = calcMonth(_md, charges, achats, _repCfg);

  el.innerHTML = `
    <div class="calc-preview-row">
      <span class="calc-preview-label">Revenus + Primes</span>
      <span class="calc-preview-value">${eur(kpi.revenus.total + kpi.primes.total)}</span>
    </div>
    <div class="calc-preview-row">
      <span class="calc-preview-label">Charges récurrentes</span>
      <span class="calc-preview-value">${eur(kpi.charges.total)}</span>
    </div>
    <div class="calc-preview-row">
      <span class="calc-preview-label">Courses</span>
      <span class="calc-preview-value">${eur(kpi.courses.total)}</span>
    </div>
    <div class="calc-preview-row">
      <span class="calc-preview-label">Extras</span>
      <span class="calc-preview-value">${eur(kpi.extras.total)}</span>
    </div>
    <div class="calc-preview-row">
      <span class="calc-preview-label">Imprévus</span>
      <span class="calc-preview-value">${eur(kpi.imprevus.total)}</span>
    </div>
    <div class="calc-preview-row total">
      <span class="calc-preview-label">${p1Name} : à payer</span>
      <span class="calc-preview-value">${eur(kpi.aPayer.p1)}</span>
    </div>
    <div class="calc-preview-row total">
      <span class="calc-preview-label">${p2Name} : à payer</span>
      <span class="calc-preview-value">${eur(kpi.aPayer.p2)}</span>
    </div>
    <div class="calc-preview-row total" style="font-size:1rem;">
      <span class="calc-preview-label">Solde net total</span>
      <span class="calc-preview-value ${kpi.solde.total >= 0 ? 'pos' : 'neg'}">${eur(kpi.solde.total)}</span>
    </div>
    <div class="calc-preview-row" style="margin-top:4px;">
      <span class="calc-preview-label">Taux d'épargne</span>
      <span class="calc-preview-value">${pct(kpi.txEpargne.total, 1)}</span>
    </div>
  `;
}

// ── Sauvegarde en DB ──
async function doSave(container, showFeedback = true) {
  syncFormToState(container);
  try {
    await Promise.all([
      saveMonthlyData(_md),
      saveRepartition(_repCfg),
    ]);
    if (showFeedback) showToast('Données enregistrées ✅', 'success');
  } catch (e) {
    showToast('Erreur lors de l\'enregistrement', 'error');
    console.error(e);
  }
}

// ── Modale What-if ──
function showWhatIfModal(container, p1Name, p2Name, month, year) {
  const body = `
    <p style="font-size:0.85rem; color:var(--text-2); margin-bottom:16px;">
      Simulez l'impact d'un revenu supplémentaire sur votre solde et taux d'épargne.
    </p>
    <div class="form-grid-2" style="margin-bottom:12px;">
      <div class="form-group">
        <label class="form-label">+ Revenus ${p1Name} (€)</label>
        <div class="input-wrap">
          <input type="number" class="form-input input-euro" id="wi-p1" min="0" step="10" value="0">
          <span class="input-suffix">€</span>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">+ Revenus ${p2Name} (€)</label>
        <div class="input-wrap">
          <input type="number" class="form-input input-euro" id="wi-p2" min="0" step="10" value="0">
          <span class="input-suffix">€</span>
        </div>
      </div>
    </div>
    <div id="wi-result" style="background:var(--primary-bg); border-radius:var(--radius-sm); padding:14px; display:none;"></div>
  `;

  openModal('🧮 Simulateur What-if', body, `
    <button class="btn btn-secondary btn-full" id="wi-calc">Calculer</button>
    <button class="btn btn-outline" id="wi-close">Fermer</button>
  `);

  document.getElementById('wi-close')?.addEventListener('click', closeModal);

  document.getElementById('wi-calc')?.addEventListener('click', async () => {
    const extraP1 = Number(document.getElementById('wi-p1')?.value) || 0;
    const extraP2 = Number(document.getElementById('wi-p2')?.value) || 0;

    const charges = await getChargesForMonth(month);
    const achats  = await getAchatsForMonth(year, month);
    const base    = calcMonth(_md, charges, achats, _repCfg);
    const sim     = whatIf(base, extraP1, extraP2);

    const res = document.getElementById('wi-result');
    if (!res || !sim) return;
    res.style.display = '';
    res.innerHTML = `
      <div style="font-size:0.78rem; font-weight:700; color:var(--primary); margin-bottom:8px; text-transform:uppercase; letter-spacing:0.05em;">Résultat de la simulation</div>
      <div class="calc-preview-row"><span>Revenu supplémentaire</span><span style="color:var(--success);font-weight:700;">+ ${eur(sim.deltaTotal)}</span></div>
      <div class="calc-preview-row"><span>Nouveau solde net</span><span style="font-weight:700;">${eur(sim.newSolde.total)}</span></div>
      <div class="calc-preview-row"><span>Nouveau taux d'épargne</span><span style="font-weight:700;">${pct(sim.newTxEpargne.total, 1)}</span></div>
      <div class="calc-preview-row"><span>Gain épargne vs actuel</span><span style="color:var(--success);font-weight:700;">+ ${eur(sim.deltaTotal)}</span></div>
    `;
  });
}

// ── Descriptions des modes ──
function getModeDesc(mode) {
  switch (mode) {
    case 'fixe':      return 'Les charges communes sont partagées selon des pourcentages fixes.';
    case 'equitable': return 'Les charges communes sont partagées au prorata des revenus de chacun.';
    default:          return 'Chaque personne assume ses charges + la moitié des courses.';
  }
}

// ── Helper : génère un champ de saisie ──
function inputField(id, label, value, suffix) {
  return `
    <div class="form-group">
      <label class="form-label">${label}</label>
      <div class="input-wrap">
        <input type="number" class="form-input input-euro" id="${id}"
          min="0" step="0.01" placeholder="0.00" value="${Number(value) || ''}">
        <span class="input-suffix">${suffix}</span>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════
// MODAL CRAQUAGE
// ══════════════════════════════════════════════════
// Chaque ligne de la modale représente une "source" (budget mensuel ou épargne)
// avec un montant. La somme des lignes doit égaler le montant total.
function showCraquageModal(container, p1Name, p2Name, month, year) {
  const now  = new Date();
  let rows   = [{ source: 'balance', amount: '' }];

  function buildRows() {
    return rows.map((r, i) => `
      <div class="craquage-row" style="display:flex;gap:8px;align-items:center;margin-bottom:6px;" data-i="${i}">
        <div class="input-wrap" style="flex:1.2;">
          <input type="number" class="form-input input-euro crq-amount"
            min="0" step="0.01" placeholder="0.00" value="${r.amount}"
            style="font-size:0.9rem;">
          <span class="input-suffix">€</span>
        </div>
        <select class="form-input crq-source" style="flex:1.5;font-size:0.85rem;padding:8px 10px;">
          <option value="balance"  ${r.source === 'balance'  ? 'selected' : ''}>📊 Budget mensuel</option>
          <option value="savings"  ${r.source === 'savings'  ? 'selected' : ''}>💰 Économies</option>
        </select>
        ${rows.length > 1
          ? `<button class="btn-icon crq-del" data-i="${i}" style="flex-shrink:0;color:var(--danger);">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
             </button>`
          : '<div style="width:28px;"></div>'}
      </div>
    `).join('');
  }

  function buildBody() {
    return `
      <div class="form-group" style="margin-bottom:10px;">
        <label class="form-label">Description du craquage</label>
        <input type="text" class="form-input" id="crq-label"
          placeholder="Ex: Restaurant, Vêtement impulsif…">
      </div>
      <div class="form-group" style="margin-bottom:10px;">
        <label class="form-label">Qui a craqué ?</label>
        <div class="tabs" id="crq-qui-tabs" style="margin-top:4px;">
          <button class="tab-btn active" data-qui="les_deux">À deux</button>
          <button class="tab-btn" data-qui="p1">${p1Name}</button>
          <button class="tab-btn" data-qui="p2">${p2Name}</button>
        </div>
      </div>
      <div class="form-group" style="margin-bottom:6px;">
        <label class="form-label">Répartition par source</label>
        <div id="crq-rows">${buildRows()}</div>
        <button class="btn btn-outline btn-sm btn-full" id="crq-add-row" style="margin-top:4px;">
          + Ajouter une source
        </button>
      </div>
      <div id="crq-total-line" style="text-align:right;font-size:0.78rem;color:var(--text-3);margin-top:6px;"></div>
    `;
  }

  openModal('💥 Craquage', buildBody(), `
    <button class="btn btn-outline" id="crq-cancel">Annuler</button>
    <button class="btn btn-danger"  id="crq-save">Enregistrer</button>
  `);

  // Variables locales modal
  let _qui = 'les_deux';

  function rebuildRows() {
    const rowsEl = document.getElementById('crq-rows');
    if (rowsEl) rowsEl.innerHTML = buildRows();
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
        syncRows();
        rows.splice(i, 1);
        rebuildRows();
      });
    });
  }

  bindRowEvents();

  document.querySelectorAll('#crq-qui-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#crq-qui-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _qui = btn.dataset.qui;
    });
  });

  document.getElementById('crq-add-row')?.addEventListener('click', () => {
    syncRows();
    rows.push({ source: 'balance', amount: '' });
    rebuildRows();
  });

  document.getElementById('crq-cancel')?.addEventListener('click', closeModal);

  document.getElementById('crq-save')?.addEventListener('click', async () => {
    syncRows();
    const label = document.getElementById('crq-label')?.value.trim();
    if (!label) { showToast('Ajoutez une description', 'error'); return; }

    const validRows = rows.filter(r => Number(r.amount) > 0);
    if (!validRows.length) { showToast('Montant invalide', 'error'); return; }

    const total  = validRows.reduce((s, r) => s + Number(r.amount), 0);
    const dayNum = now.getDate();

    // Pour la répartition : si "à deux" → 50/50, sinon tout sur la personne
    for (const r of validRows) {
      const amt   = Number(r.amount);
      let aP1, aP2;
      if (_qui === 'p1')       { aP1 = amt;     aP2 = 0; }
      else if (_qui === 'p2')  { aP1 = 0;       aP2 = amt; }
      else                     { aP1 = amt / 2; aP2 = amt / 2; }

      await saveAchat({
        id: uid(),
        year, month,
        label,
        amount_p1: aP1,
        amount_p2: aP2,
        qui: _qui,
        category: 'craquage',
        craquage_source: r.source,  // 'balance' ou 'savings'
        day: dayNum,
        createdAt: now.toISOString(),
      });

      // Si source = épargne → enregistre aussi dans savings_operations
      if (r.source === 'savings') {
        await saveSavingsOperation({
          amount:    -amt,
          label:     `Craquage : ${label}`,
          type:      'craquage_cover',
          year, month, day: dayNum,
          createdAt: now.toISOString(),
        });
      }
    }

    closeModal();
    showToast(`Craquage enregistré : ${eur(total)} 💥`, 'success');
    // Recharge la prévisualisation
    updatePreview(container, p1Name, p2Name, month, year);
  });
}
