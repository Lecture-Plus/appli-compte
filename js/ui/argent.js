// ============================================================
// js/ui/argent.js – Page "Ce mois" : Hub mensuel + 4 vues
//
// Architecture Hub + Spokes :
//   renderHub()        → 4 cartes de navigation + bilan mensuel
//   Revenus spoke      → saisie revenus / répartition (saisie.js)
//   Charges spoke      → charges fixes du mois (saisie.js section charges)
//   Budgets spoke      → budgets variables (charges.js renderSection)
//   Dépenses spoke     → dépenses ponctuelles / imprévus inline
// ============================================================

import * as saisieModule  from './saisie.js';
import * as chargesModule from './charges.js';
import { getActiveUsers, getMonthlyData, getChargesForMonth,
         getBudgetOpsForMonth, getAchatsForMonth,
         getRepartition, getAllSettings, saveMonthlyData }    from '../db.js';
import { State, navigateTo }                                  from '../app.js';
import { nomMois, addMonth, eur, escHtml, showToast,
         openModal, closeModal, uid }                         from '../utils.js';
import { on, emit }                                           from '../events.js';
import { calcMonth }                                          from '../calculs.js';

// ── État module ──
let _chgValidated      = false;
let _chgUnsubscribe    = null;
let _monthCompleteUnsub = null;
let _currentView       = 'hub'; // 'hub' | 'revenus' | 'charges' | 'budgets' | 'depenses'

// ── Persistance validation charges ──
function _chgKey()           { const { year, month } = State; return `compta-chg-ok-${year}-${month}`; }
function _loadChgState()     { _chgValidated = localStorage.getItem(_chgKey()) === '1'; }
function _setChgValidated(v) { _chgValidated = v; if (v) localStorage.setItem(_chgKey(), '1'); else localStorage.removeItem(_chgKey()); }

// ── Événements charges ──
function _subscribeChargesEvents(container) {
  if (_chgUnsubscribe) _chgUnsubscribe();
  const unsub1 = on('charges:updated', () => {
    if (!document.contains(container)) { _chgUnsubscribe?.(); _chgUnsubscribe = null; return; }
    _setChgValidated(false);
    if (_currentView === 'hub') renderHub(container);
  });
  const unsub2 = on('charges:validated', () => {
    if (!document.contains(container)) { _chgUnsubscribe?.(); _chgUnsubscribe = null; return; }
    _setChgValidated(true);
    // Auto-avance vers Budgets
    _navigateView(container, 'budgets');
  });
  _chgUnsubscribe = () => { unsub1(); unsub2(); };
}

// ── Navigation entre vues ──
function _navigateView(container, view) {
  _currentView = view;
  _renderCurrentView(container);
}

function _renderCurrentView(container) {
  if (_currentView === 'hub') {
    renderHub(container);
  } else {
    const body = container.querySelector('#argent-body');
    if (body) _renderSpoke(container, body, _currentView);
  }
}

// ── Chargement données mois ──
async function _loadMonthData() {
  const { year, month } = State;
  const [users, md, charges, budgetOps, achats] = await Promise.all([
    getActiveUsers(),
    getMonthlyData(year, month),
    getChargesForMonth(month, year),
    getBudgetOpsForMonth(year, month),
    getAchatsForMonth(year, month),
  ]);
  return { users, md, charges, budgetOps, achats };
}

// ── Point d'entrée principal ──
export async function render(container, params = {}) {
  _loadChgState();

  // Rétrocompatibilité avec les anciens params {tab:'saisie', section:'revenus|charges'}
  if (params.tab === 'saisie' && params.section === 'revenus')  _currentView = 'revenus';
  else if (params.tab === 'saisie' && params.section === 'charges') _currentView = 'charges';
  else if (params.tab === 'budgets') _currentView = 'budgets';
  else if (params.view) _currentView = params.view;
  else if (!params.tab && !params.view) _currentView = 'hub';

  container.innerHTML = `
    <div class="argent-hub-header">
      <div class="argent-month-nav">
        <button class="month-btn" id="prev-month" aria-label="Mois précédent">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div id="argent-month-label" style="text-align:center;"></div>
        <button class="month-btn" id="next-month" aria-label="Mois suivant">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
    </div>
    <div id="argent-body"></div>
  `;

  _updateMonthLabel(container);

  container.querySelector('#prev-month').addEventListener('click', () => {
    const n = addMonth(State.year, State.month, -1);
    State.year = n.year; State.month = n.month;
    _loadChgState();
    _updateMonthLabel(container);
    _currentView = 'hub';
    renderHub(container);
  });
  container.querySelector('#next-month').addEventListener('click', () => {
    const n = addMonth(State.year, State.month, 1);
    State.year = n.year; State.month = n.month;
    _loadChgState();
    _updateMonthLabel(container);
    _currentView = 'hub';
    renderHub(container);
  });

  _subscribeChargesEvents(container);

  if (_monthCompleteUnsub) _monthCompleteUnsub();
  _monthCompleteUnsub = on('month:complete', async () => {
    if (!document.contains(container)) { _monthCompleteUnsub?.(); _monthCompleteUnsub = null; return; }
    const body = container.querySelector('#argent-body');
    await saisieModule.triggerMonthComplete(body);
  });

  on('month:complete:done', () => {
    _setChgValidated(true);
    if (document.contains(container)) {
      _currentView = 'hub';
      renderHub(container);
    }
    emit('budgetop:saved');
  });

  _renderCurrentView(container);
}

function _updateMonthLabel(container) {
  const el = container.querySelector('#argent-month-label');
  if (!el) return;
  el.innerHTML = `
    <div style="font-weight:800;font-size:1rem;letter-spacing:-0.02em;">${nomMois(State.month)}</div>
    <div style="font-size:0.72rem;color:var(--text-3);">${State.year}</div>
  `;
}

// ══════════════════════════════════════════════════════════════
// HUB — Vue principale avec les 4 cartes
// ══════════════════════════════════════════════════════════════
async function renderHub(container) {
  const body = container.querySelector('#argent-body');
  if (!body) return;

  const { users, md, charges, budgetOps, achats } = await _loadMonthData();
  const { year, month } = State;

  if (users.length === 0) {
    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">👥</div>
        <div class="empty-state-title">Aucun utilisateur configuré</div>
        <div class="empty-state-text">Allez dans <strong>Réglages</strong> pour ajouter des membres du foyer.</div>
        <button class="btn btn-primary btn-sm" style="margin-top:12px;" id="hub-go-settings">Ouvrir les réglages</button>
      </div>`;
    body.querySelector('#hub-go-settings')?.addEventListener('click', () => navigateTo('settings'));
    return;
  }

  const isDone  = md?.isComplete === true;
  const hasRev  = users.some(u => (md?.users?.[String(u.id)]?.revenus || 0) > 0);
  const hasChg  = charges.length > 0;
  const hasBudg = budgetOps.length > 0;
  const nbDep   = achats.length + (md?.imprévusList?.length || 0);
  const hasDepenses = nbDep > 0;
  if (isDone && !_chgValidated) _setChgValidated(true);

  // ── KPI ──
  const repCfg = await getRepartition(year, month);
  const s      = await getAllSettings();
  const kpi    = calcMonth(md || {}, charges, achats, repCfg, users, budgetOps);

  const solde      = kpi?.solde?.total || 0;
  const soldeColor = solde >= 0 ? 'var(--success)' : 'var(--danger)';
  const totalRev   = (kpi?.revenus?.total || 0) + (kpi?.aides?.total || 0) + (kpi?.primes?.total || 0);
  const totalChg   = kpi?.charges?.total || 0;
  const totalDep   = (kpi?.achats?.total || 0) + (kpi?.imprevus?.total || 0);
  const txEp       = kpi?.txEpargne?.total;

  // ── Budgets variables pour le hub ──
  const customBudgets   = s?.customBudgets || [];
  const pinnedBudgets   = s?.pinnedBudgets || [];
  const budgCourses = users.reduce((a, u) => a + (Number(md?.users?.[String(u.id)]?.courses) || 0), 0)
                    || (Number(s?.budgetCibles?.courses) || 0);
  const budgExtras  = users.reduce((a, u) => a + (Number(md?.users?.[String(u.id)]?.extras) || 0), 0)
                    || (Number(s?.budgetCibles?.extras) || 0);
  const spentCourses = budgetOps.filter(o => o.category === 'courses').reduce((a, o) => a + (Number(o.amount)||0), 0);
  const spentExtras  = budgetOps.filter(o => o.category === 'extras').reduce((a,  o) => a + (Number(o.amount)||0), 0);

  const hubBudgets = [];
  if (budgCourses > 0) hubBudgets.push({ id: 'courses', icon: '🛒', label: 'Courses',  budget: budgCourses, spent: spentCourses });
  if (budgExtras  > 0) hubBudgets.push({ id: 'extras',  icon: '🎮', label: 'Loisirs',  budget: budgExtras,  spent: spentExtras });
  for (const b of customBudgets.filter(b => pinnedBudgets.includes(b.id))) {
    const sp = budgetOps.filter(o => o.category === b.id).reduce((a, o) => a + (Number(o.amount)||0), 0);
    hubBudgets.push({ id: b.id, icon: b.icon || '📌', label: b.name, budget: Number(b.amount)||0, spent: sp });
  }
  const totalBudgets = hubBudgets.reduce((a, b) => a + b.spent, 0);
  const anyBudgetOver = hubBudgets.some(b => b.budget > 0 && b.spent > b.budget);

  // ── Helpers HTML ──
  function statusBadge(s) {
    const cfg = {
      done:    { cls: 'done',    icon: '✓' },
      partial: { cls: 'partial', icon: '~' },
      over:    { cls: 'over',    icon: '⚠' },
      empty:   { cls: 'empty',   icon: '○' },
    };
    const c = cfg[s] || cfg.empty;
    return `<span class="hub-status ${c.cls}">${c.icon}</span>`;
  }

  function budgetBar(budget, spent) {
    if (!budget) return '';
    const pct   = Math.min(100, Math.round(spent / budget * 100));
    const color = spent > budget ? 'var(--danger)'
                : spent / budget >= 0.8 ? 'var(--warning)'
                : 'var(--success)';
    return `<div class="hub-budget-bar-wrap">
      <div class="hub-budget-bar-track">
        <div class="hub-budget-bar-fill" style="width:${pct}%;background:${color};"></div>
      </div>
      <span class="hub-budget-bar-pct" style="color:${color};">${pct}%</span>
    </div>`;
  }

  // ── Statuts cards ──
  const stRev   = isDone || hasRev         ? 'done'    : 'empty';
  const stChg   = isDone || _chgValidated  ? 'done'    : hasChg ? 'partial' : 'empty';
  const stBudg  = isDone ? 'done' : anyBudgetOver ? 'over' : hasBudg ? 'partial' : 'empty';
  const stDep   = hasDepenses              ? 'partial' : 'empty';

  body.innerHTML = `
    <div class="hub-grid">

      <!-- REVENUS -->
      <button class="hub-card" data-view="revenus" type="button">
        <div class="hub-card-header">
          <span class="hub-card-icon">💰</span>
          <span class="hub-card-title">Revenus</span>
          ${statusBadge(stRev)}
        </div>
        <div class="hub-card-amount ${!hasRev ? 'hub-amount-empty' : ''}">${hasRev ? eur(totalRev) : '—'}</div>
        <div class="hub-card-sub">${hasRev
          ? (users.length > 1 ? users.map(u => escHtml(u.name.split(' ')[0]) + ' ' + eur(kpi?.revenus?.byUser?.[u.id]||0)).join(' · ') : '✓ Renseignés')
          : 'Salaires, aides…'}</div>
        <span class="hub-card-arrow">›</span>
      </button>

      <!-- CHARGES FIXES -->
      <button class="hub-card" data-view="charges" type="button">
        <div class="hub-card-header">
          <span class="hub-card-icon">🏠</span>
          <span class="hub-card-title">Charges fixes</span>
          ${statusBadge(stChg)}
        </div>
        <div class="hub-card-amount ${!hasChg ? 'hub-amount-empty' : ''}">${hasChg ? eur(totalChg) : '—'}</div>
        <div class="hub-card-sub">${hasChg
          ? `${charges.length} charge${charges.length > 1 ? 's' : ''} · ${_chgValidated ? '<span style="color:var(--success);">confirmées</span>' : 'à confirmer'}`
          : 'Loyer, abonnements…'}</div>
        <span class="hub-card-arrow">›</span>
      </button>

      <!-- BUDGETS VARIABLES -->
      <button class="hub-card hub-card-wide" data-view="budgets" type="button">
        <div class="hub-card-header">
          <span class="hub-card-icon">📊</span>
          <span class="hub-card-title">Budgets variables</span>
          ${statusBadge(stBudg)}
        </div>
        ${hubBudgets.length > 0 ? `
          <div class="hub-budgets-list">
            ${hubBudgets.map(b => `
              <div class="hub-budget-item">
                <div class="hub-budget-item-header">
                  <span class="hub-budget-item-label">${b.icon} ${escHtml(b.label)}</span>
                  <span class="hub-budget-item-amount" style="color:${b.budget > 0 && b.spent > b.budget ? 'var(--danger)' : 'var(--text-2)'};">${eur(b.spent)}${b.budget > 0 ? ' / ' + eur(b.budget) : ''}</span>
                </div>
                ${budgetBar(b.budget, b.spent)}
              </div>`).join('')}
          </div>
        ` : `<div class="hub-card-amount hub-amount-empty">—</div><div class="hub-card-sub">Courses, loisirs…</div>`}
        <span class="hub-card-arrow">›</span>
      </button>

      <!-- DÉPENSES -->
      <button class="hub-card" data-view="depenses" type="button">
        <div class="hub-card-header">
          <span class="hub-card-icon">💸</span>
          <span class="hub-card-title">Dépenses</span>
          ${statusBadge(stDep)}
        </div>
        <div class="hub-card-amount ${!hasDepenses ? 'hub-amount-empty' : ''}">${hasDepenses ? eur(totalDep) : '—'}</div>
        <div class="hub-card-sub">${hasDepenses ? `${nbDep} dépense${nbDep > 1 ? 's' : ''}` : 'Imprévus, achats…'}</div>
        <span class="hub-card-arrow">›</span>
      </button>

    </div>

    <!-- BILAN MENSUEL -->
    <div class="hub-bilan">
      <div class="hub-bilan-header">
        <span class="hub-bilan-title">Bilan ${nomMois(month)} ${year}</span>
        ${isDone ? `<span class="chip chip-success" style="font-size:0.68rem;">✓ Clôturé</span>` : ''}
      </div>
      <div class="hub-bilan-rows">
        <div class="hub-bilan-row"><span>Revenus</span><span style="color:var(--success);font-weight:700;">+ ${eur(totalRev)}</span></div>
        <div class="hub-bilan-row"><span>Charges fixes</span><span>− ${eur(totalChg)}</span></div>
        ${totalBudgets > 0 ? `<div class="hub-bilan-row"><span>Budgets</span><span>− ${eur(totalBudgets)}</span></div>` : ''}
        ${totalDep > 0 ? `<div class="hub-bilan-row"><span>Dépenses</span><span>− ${eur(totalDep)}</span></div>` : ''}
      </div>
      <div class="hub-bilan-total">
        <span>Il reste</span>
        <span style="color:${soldeColor};font-size:1.35rem;font-weight:900;">${eur(solde)}</span>
      </div>
      ${txEp !== undefined ? `<div class="hub-bilan-rate">Taux d'épargne : <strong>${Math.round(txEp * 100)} %</strong></div>` : ''}
    </div>

    <!-- CLÔTURER LE MOIS -->
    <div class="hub-actions">
      ${isDone
        ? `<button class="btn hub-btn-done" id="hub-btn-reopen">✅ Mois clôturé — Rouvrir</button>`
        : `<button class="btn btn-primary hub-btn-close" id="hub-btn-close">📌 Clôturer ce mois →</button>
           <p class="hub-close-hint">Les données restent modifiables après clôture.</p>`}
    </div>
  `;

  body.querySelectorAll('.hub-card[data-view]').forEach(card => {
    card.addEventListener('click', () => _navigateView(container, card.dataset.view));
  });

  body.querySelector('#hub-btn-close')?.addEventListener('click', () => emit('month:complete'));

  body.querySelector('#hub-btn-reopen')?.addEventListener('click', async () => {
    const { year, month } = State;
    const mdNow = await getMonthlyData(year, month);
    if (!mdNow) return;
    mdNow.isComplete = false;
    await saveMonthlyData(mdNow);
    _setChgValidated(false);
    showToast('Mois rouvert', 'success');
    renderHub(container);
  });
}

// ══════════════════════════════════════════════════════════════
// VUES SPOKE — avec header retour + délégation rendu
// ══════════════════════════════════════════════════════════════
async function _renderSpoke(container, body, view) {
  const viewTitles = {
    revenus:  '💰 Revenus',
    charges:  '🏠 Charges fixes',
    budgets:  '📊 Budgets',
    depenses: '💸 Dépenses',
  };

  body.innerHTML = `
    <div class="spoke-header">
      <button class="spoke-back" id="spoke-back" type="button" aria-label="Retour">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><path d="M15 18l-6-6 6-6"/></svg>
        Retour
      </button>
      <h2 class="spoke-title">${viewTitles[view] || view}</h2>
    </div>
    <div id="spoke-content" class="argent-subview"></div>
  `;

  body.querySelector('#spoke-back').addEventListener('click', () => {
    _currentView = 'hub';
    renderHub(container);
  });

  const spokeContent = body.querySelector('#spoke-content');

  if (view === 'revenus') {
    await saisieModule.render(spokeContent, { section: 'revenus' });
  } else if (view === 'charges') {
    await saisieModule.render(spokeContent, { section: 'charges' });
  } else if (view === 'budgets') {
    await chargesModule.renderSection(spokeContent, 'budgets');
  } else if (view === 'depenses') {
    await _renderDepenses(spokeContent);
  }

  // Footer sticky avec le solde restant
  _renderSpokeFooter(body);
}

async function _renderSpokeFooter(body) {
  body.querySelector('.spoke-footer')?.remove();
  const { users, md, charges, budgetOps, achats } = await _loadMonthData();
  const { year, month } = State;
  const repCfg = await getRepartition(year, month);
  const kpi    = calcMonth(md || {}, charges, achats, repCfg, users, budgetOps);
  const solde  = kpi?.solde?.total || 0;
  const color  = solde >= 0 ? 'var(--success)' : 'var(--danger)';
  const footer = document.createElement('div');
  footer.className = 'spoke-footer';
  footer.innerHTML = `
    <span class="spoke-footer-label">Il reste</span>
    <span class="spoke-footer-amount" style="color:${color};">${eur(solde)}</span>
  `;
  body.appendChild(footer);
}

// ══════════════════════════════════════════════════════════════
// VUE DÉPENSES — liste imprévus + achats impulsifs
// ══════════════════════════════════════════════════════════════
async function _renderDepenses(container) {
  const { year, month } = State;
  const [users, md, achats] = await Promise.all([
    getActiveUsers(),
    getMonthlyData(year, month),
    getAchatsForMonth(year, month),
  ]);

  const _refreshList = async () => {
    const listEl = container.querySelector('#dep-list');
    if (!listEl) return;
    const [freshMd, freshAchats] = await Promise.all([getMonthlyData(year, month), getAchatsForMonth(year, month)]);
    const all = [
      ...((freshMd?.imprévusList || []).map(i => ({ ...i, _type: 'imprevu' }))),
      ...(freshAchats.map(a => ({ ...a, _type: 'achat' }))),
    ].sort((a, b) => {
      const da = a.day || a.date || 0;
      const db_ = b.day || b.date || 0;
      return da < db_ ? 1 : -1;
    });

    if (!all.length) {
      listEl.innerHTML = `<div class="empty-state-inline">Aucune dépense ce mois-ci</div>`;
      return;
    }
    listEl.innerHTML = all.map(d => {
      const label = escHtml(d.label || d.description || '');
      const amt   = Number(d.amount) || 0;
      const icon  = d._type === 'imprevu' ? '🚨' : (d.category === 'craquage' ? '💥' : '💳');
      const sub   = d._type === 'imprevu' ? 'Inattendue' : (d.category === 'craquage' ? 'Achat impulsif' : 'Achat exceptionnel');
      return `<div class="list-item">
        <div class="list-item-icon" style="background:var(--warning-bg);color:var(--warning);">${icon}</div>
        <div class="list-item-body">
          <div class="list-item-title">${label}</div>
          <div class="list-item-sub">${sub}${d.day ? ' · jour ' + d.day : ''}</div>
        </div>
        <div class="list-item-right">
          <div class="list-item-amount negative">−${eur(amt)}</div>
        </div>
      </div>`;
    }).join('');
  };

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;padding-bottom:80px;">
      <div class="item-list" id="dep-list"></div>
      <div class="dep-actions">
        <button class="btn btn-outline" id="dep-add-imprevu">🚨 Inattendue</button>
        <button class="btn btn-outline" id="dep-add-achat">💥 Achat impulsif</button>
      </div>
    </div>
  `;

  await _refreshList();

  container.querySelector('#dep-add-imprevu')?.addEventListener('click', async () => {
    const now = new Date();
    const quiOpts = (users.length > 1 ? `<option value="shared">🤝 Partagé (tous)</option>` : '') +
      users.map(u => `<option value="${u.id}" ${users.length === 1 ? 'selected' : ''}>${escHtml(u.name)}</option>`).join('');

    openModal('🚨 Dépense inattendue', `
      <div class="form-group">
        <label class="form-label">Description</label>
        <input type="text" class="form-input" id="dep-label" placeholder="Ex : Plombier, Médicaments…" autofocus>
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">Montant</label>
          <div class="input-wrap">
            <input type="number" class="form-input input-euro" id="dep-amount" inputmode="decimal" min="0" step="0.01" placeholder="0">
            <span class="input-suffix">€</span>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Jour</label>
          <input type="number" class="form-input" id="dep-day" min="1" max="31" value="${now.getDate()}">
        </div>
      </div>
      ${users.length > 1 ? `<div class="form-group"><label class="form-label">Qui ?</label><select class="form-select" id="dep-qui">${quiOpts}</select></div>` : `<input type="hidden" id="dep-qui" value="${users[0]?.id || 0}">`}
    `, `
      <button class="btn btn-outline" id="dep-cancel-btn">Annuler</button>
      <button class="btn btn-danger" id="dep-save-btn">Enregistrer</button>
    `);

    document.getElementById('dep-cancel-btn')?.addEventListener('click', closeModal);
    document.getElementById('dep-save-btn')?.addEventListener('click', async () => {
      const label  = document.getElementById('dep-label')?.value.trim();
      const amount = Number(document.getElementById('dep-amount')?.value);
      const day    = Number(document.getElementById('dep-day')?.value) || now.getDate();
      const quiRaw = document.getElementById('dep-qui')?.value;
      const qui    = quiRaw === 'shared' ? 'shared' : Number(quiRaw);
      if (!label)  { showToast('La description est requise', 'error'); return; }
      if (!amount) { showToast('Montant invalide', 'error'); return; }
      const freshMd = await getMonthlyData(year, month) || { year, month, users: {}, imprévusList: [] };
      if (!freshMd.imprévusList) freshMd.imprévusList = [];
      freshMd.imprévusList.push({ id: uid(), label, amount, qui, day, createdAt: new Date().toISOString() });
      await saveMonthlyData(freshMd);
      closeModal();
      showToast('Dépense ajoutée ✅', 'success');
      emit('charges:updated');
      await _refreshList();
    });
  });

  container.querySelector('#dep-add-achat')?.addEventListener('click', () => {
    saisieModule.showCraquageModal(null, month, year, users, async () => {
      emit('charges:updated');
      await _refreshList();
    });
  });
}

