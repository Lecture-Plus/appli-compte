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
         getBudgetOpsForMonth, getAchatsForMonth, deleteAchat,
         getRepartition, getAllSettings, saveMonthlyData,
         saveRepartition, saveCharge }                        from '../db.js';
import { State, navigateTo }                                  from '../app.js';
import { nomMois, addMonth, eur, escHtml, showToast,
         openModal, closeModal, uid, debounce,
         getCategoryInfo }                                    from '../utils.js';
import { on, emit }                                           from '../events.js';
import { calcMonth }                                          from '../calculs.js';

// ── État module ──
let _chgValidated       = false;
let _chgUnsubscribe     = null;
let _monthCompleteUnsub    = null;
let _monthCompleteDoneUnsub = null;
let _spokeBudgUnsub     = null;  // listener budgetop:saved dans le spoke budgets
let _currentView        = 'hub'; // 'hub' | 'revenus' | 'charges' | 'budgets' | 'depenses'
let _bilanMode          = localStorage.getItem('compta-bilan-mode') || 'previsionnel'; // 'previsionnel' | 'reel'

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

  if (_monthCompleteDoneUnsub) _monthCompleteDoneUnsub();
  _monthCompleteDoneUnsub = on('month:complete:done', () => {
    _setChgValidated(true);
    if (document.contains(container)) {
      _currentView = 'hub';
      renderHub(container);
    }
    emit('budgetop:saved');
  });

  _renderCurrentView(container);

  return () => {
    if (_chgUnsubscribe) { _chgUnsubscribe(); _chgUnsubscribe = null; }
    if (_monthCompleteUnsub) { _monthCompleteUnsub(); _monthCompleteUnsub = null; }
    if (_monthCompleteDoneUnsub) { _monthCompleteDoneUnsub(); _monthCompleteDoneUnsub = null; }
    if (_spokeBudgUnsub) { _spokeBudgUnsub(); _spokeBudgUnsub = null; }
  };
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
  // Si aucun budgetOp, passer null pour que calcMonth utilise extras/courses de md
  const kpi    = calcMonth(md || {}, charges, achats, repCfg, users, budgetOps.length ? budgetOps : null);

  const solde      = kpi?.solde?.total || 0;
  const soldeColor = solde >= 0 ? 'var(--success)' : 'var(--danger)';
  const totalRev   = (kpi?.revenus?.total || 0) + (kpi?.aides?.total || 0) + (kpi?.primes?.total || 0);
  const totalChg   = kpi?.charges?.total || 0;
  // Imprévus : total du champ saisie (ud.imprevus) + items de imprévusList (spoke dépenses)
  const imprévusListTotal = (md?.imprévusList || []).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const totalDep   = (kpi?.achats?.total || 0) + (kpi?.imprevus?.total || 0) + imprévusListTotal;
  const txEp       = kpi?.txEpargne?.total;

  // ── Budgets variables — uniquement les customBudgets gérés par le spoke Budgets ──
  const customBudgets = s?.customBudgets || [];
  const hubBudgets = [];
  for (const b of customBudgets) {
    const sp = budgetOps.filter(o => o.category === b.id).reduce((a, o) => a + (Number(o.amount)||0), 0);
    const effectiveBudget = b.allocation === 'equal' ? (Number(b.amount)||0) * users.length
                          : b.allocation === 'custom' ? Object.values(b.amountByUser||{}).reduce((s,v)=>s+(Number(v)||0),0)
                          : Number(b.amount)||0;
    hubBudgets.push({ id: b.id, icon: b.icon || '📌', label: b.name, budget: effectiveBudget, spent: sp });
  }
  const totalBudgets        = hubBudgets.reduce((a, b) => a + b.spent, 0);
  const totalBudgetsCeilings = hubBudgets.reduce((a, b) => a + b.budget, 0);
  const anyBudgetOver        = hubBudgets.some(b => b.budget > 0 && b.spent > b.budget);
  const hasBudgets           = customBudgets.length > 0;

  // ── Prévisionnel vs Réel ──
  const isPrevo        = _bilanMode === 'previsionnel';
  const bilanBudgets   = isPrevo ? totalBudgetsCeilings : totalBudgets;
  const bilanSolde     = totalRev - totalChg - bilanBudgets - totalDep;
  const bilanColor     = bilanSolde >= 0 ? 'var(--success)' : 'var(--danger)';
  // Per-user prévisionnel : distribuer les budgets selon la répartition kpi.part
  const totalPartKpi   = kpi?.part?.total || 1;
  const bilanUserSolde = uid => {
    const uRev   = (kpi?.revenus?.byUser?.[uid] || 0) + (kpi?.aides?.byUser?.[uid] || 0) + (kpi?.primes?.byUser?.[uid] || 0);
    if (!isPrevo) return kpi?.solde?.byUser?.[uid] ?? 0;
    const uShare = totalPartKpi > 0 ? (kpi?.part?.byUser?.[uid] || 0) / totalPartKpi : (1 / (users.length || 1));
    const uBudg  = bilanBudgets * uShare;
    const uDep   = totalDep * uShare;
    return uRev - (kpi?.charges?.byUser?.[uid] || 0) - uBudg - uDep;
  };

  // ── "À payer" per user = charges share + budgets share + imprévusList share ──
  // (sans achats ponctuels ni craquages — ils surviennent plus tard dans le mois)
  const _N = users.length || 1;
  const _getShareRatio = uid => {
    const uId = String(uid);
    if (_N <= 1) return 1;
    const mode = repCfg?.mode || 'separe';
    if (mode === 'equitable') {
      const base = users.reduce((s, u) => s + (kpi?.revenus?.byUser?.[String(u.id)] || 0), 0);
      return base > 0 ? (kpi?.revenus?.byUser?.[uId] || 0) / base : 1 / _N;
    } else if (mode === 'fixe') {
      const pcts = repCfg?.pcts ?? {};
      const sum  = Object.values(pcts).reduce((s, v) => s + (Number(v) || 0), 0) || 100;
      return (Number(pcts[uId]) || 0) / sum;
    }
    return 1 / _N; // separe, personnalise
  };
  const aPayerPerUser = {};
  for (const u of users) {
    const uId = String(u.id);
    const chgShare = kpi?.charges?.byUser?.[uId] || 0;

    // Part de budget = plafond de chaque budget selon son mode d'allocation
    let budgShare = 0;
    for (const b of customBudgets) {
      const alloc = b.allocation || 'shared';
      if (alloc === 'custom') {
        // Montant personnalisé par personne
        budgShare += Number((b.amountByUser || {})[uId]) || 0;
      } else if (alloc === 'equal') {
        // Même montant pour chaque personne
        budgShare += Number(b.amount) || 0;
      } else {
        // Budget commun : répartir selon la clé foyer
        budgShare += (Number(b.amount) || 0) * _getShareRatio(u.id);
      }
    }

    let impShare = 0;
    for (const imp of (md?.imprévusList || [])) {
      const amt = Number(imp.amount) || 0;
      if (imp.qui === 'shared' || !imp.qui) {
        impShare += amt * _getShareRatio(u.id);
      } else if (String(imp.qui) === uId) {
        impShare += amt;
      }
    }
    aPayerPerUser[uId] = chgShare + budgShare + impShare;
  }

  // ── Correction payerViaPerso : la part déjà payée de sa poche est déduite de son à payer ──
  for (const c of charges) {
    if (!c.payerViaPerso || c.perso) continue;
    const amt = Number(c.amount) || 0;
    if (!amt) continue;
    const payerUid = String(c.payerViaPerso);
    if (aPayerPerUser[payerUid] === undefined) continue;
    const qui = c.qui ? String(c.qui) : 'shared';
    let payerShare = 0;
    if (c.splitPcts && typeof c.splitPcts === 'object') {
      const sumPcts = users.reduce((s, u) => s + (Number(c.splitPcts[String(u.id)]) || 0), 0) || 100;
      payerShare = amt * ((Number(c.splitPcts[payerUid]) || 0) / sumPcts);
    } else if (qui !== 'shared' && users.some(u => String(u.id) === qui)) {
      payerShare = qui === payerUid ? amt : 0;
    } else {
      payerShare = amt * _getShareRatio(payerUid);
    }
    aPayerPerUser[payerUid] -= payerShare;
  }

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
  const stBudg  = isDone ? 'done' : anyBudgetOver ? 'over' : (hasBudg || hasBudgets) ? 'partial' : 'empty';
  const stDep   = hasDepenses              ? 'partial' : 'empty';

  // ── Affichage des budgets sur la carte (max 3, +N si trop) ──
  const displayBudgets = hubBudgets.slice(0, 3);
  const extraBudgets   = hubBudgets.length - displayBudgets.length;

  // ── Données bilan détaillé ──
  const imprévus = md?.imprévusList || [];
  const totalImprévus = imprévus.reduce((s, i) => s + (Number(i.amount)||0), 0);

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
        ${displayBudgets.length > 0 ? `
          <div class="hub-budgets-list">
            ${displayBudgets.map(b => `
              <div class="hub-budget-item">
                <div class="hub-budget-item-header">
                  <span class="hub-budget-item-label">${b.icon} ${escHtml(b.label)}</span>
                  <span class="hub-budget-item-amount" style="color:${b.budget > 0 && b.spent > b.budget ? 'var(--danger)' : 'var(--text-2)'};">${eur(b.spent)}${b.budget > 0 ? ' / ' + eur(b.budget) : ''}</span>
                </div>
                ${budgetBar(b.budget, b.spent)}
              </div>`).join('')}
            ${extraBudgets > 0 ? `<div style="font-size:0.68rem;color:var(--text-3);margin-top:2px;">+${extraBudgets} autre${extraBudgets>1?'s':''} →</div>` : ''}
          </div>
        ` : hasBudgets ? `<div class="hub-card-amount hub-amount-empty">—</div><div class="hub-card-sub">Aucune dépense encore</div>` : `<div class="hub-card-amount hub-amount-empty">—</div><div class="hub-card-sub">Créez vos budgets →</div>`}
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

    <!-- BILAN MENSUEL DÉTAILLÉ -->
    <div class="hub-bilan">
      <div class="hub-bilan-header">
        <span class="hub-bilan-title">Bilan ${nomMois(month)} ${year}</span>
        <div style="display:flex;align-items:center;gap:6px;">
          ${isDone ? `<span class="chip chip-success" style="font-size:0.68rem;">✓ Clôturé</span>` : ''}
          <button id="bilan-mode-toggle" type="button" class="hub-bilan-mode-btn ${isPrevo ? 'prevo' : 'reel'}" title="Basculer Prévisionnel / Réel">
            ${isPrevo ? '📊 Prévisionnel' : '📈 Réel'}
          </button>
        </div>
      </div>
      ${isPrevo ? `<p class="hub-bilan-mode-hint">Basé sur vos plafonds de budget. <span style="color:var(--primary);cursor:pointer;" id="bilan-hint-switch">Voir le réel →</span></p>` : `<p class="hub-bilan-mode-hint" style="color:var(--primary);">Dépenses réelles validées. <span style="color:var(--text-3);cursor:pointer;" id="bilan-hint-switch">← Prévisionnel</span></p>`}

      <!-- Revenus -->
      <div class="hub-bilan-section-title">Revenus</div>
      <div class="hub-bilan-rows">
        ${users.length > 1 ? users.map(u => `
          <div class="hub-bilan-row hub-bilan-row-sub">
            <span style="display:flex;align-items:center;gap:5px;">
              <span style="width:7px;height:7px;border-radius:50%;background:${escHtml(u.color||'#7C5CFC')};display:inline-block;"></span>
              ${escHtml(u.name)}
            </span>
            <span style="color:var(--success);">+ ${eur(kpi?.revenus?.byUser?.[u.id]||0)}</span>
          </div>`).join('') : ''}
        ${(kpi?.aides?.total||0) > 0 ? `<div class="hub-bilan-row hub-bilan-row-sub"><span>Aides</span><span style="color:var(--success);">+ ${eur(kpi.aides.total)}</span></div>` : ''}
        ${(kpi?.primes?.total||0) > 0 ? `<div class="hub-bilan-row hub-bilan-row-sub"><span>Primes &amp; bonus</span><span style="color:var(--success);">+ ${eur(kpi.primes.total)}</span></div>` : ''}
        <div class="hub-bilan-row hub-bilan-row-total">
          <span>Total revenus</span>
          <span style="color:var(--success);font-weight:800;">+ ${eur(totalRev)}</span>
        </div>
      </div>

      <!-- Charges fixes -->
      ${totalChg > 0 ? `
      <div class="hub-bilan-section-title">Charges fixes</div>
      <div class="hub-bilan-rows">
        <div class="hub-bilan-row"><span>${charges.length} charge${charges.length>1?'s':''}</span><span>− ${eur(totalChg)}</span></div>
      </div>` : ''}

      <!-- Budgets variables -->
      ${hubBudgets.length > 0 ? `
      <div class="hub-bilan-section-title">Budgets variables ${isPrevo ? '<span style="font-size:0.65rem;color:var(--text-3);font-weight:400;">(plafonds)</span>' : '<span style="font-size:0.65rem;color:var(--text-3);font-weight:400;">(réel)</span>'}</div>
      <div class="hub-bilan-rows">
        ${hubBudgets.map(b => {
          const showAmt = isPrevo ? b.budget : b.spent;
          const isOver  = b.budget > 0 && b.spent > b.budget;
          const color   = !isPrevo && isOver ? 'var(--danger)' : isPrevo ? 'var(--text-2)' : 'var(--text-2)';
          return `<div class="hub-bilan-row hub-bilan-row-sub">
            <span>${b.icon} ${escHtml(b.label)}${!isPrevo && b.budget > 0 ? ` <span style="color:var(--text-3);font-size:0.65rem;">/ ${eur(b.budget)}</span>` : ''}</span>
            <span style="color:${color};">− ${eur(showAmt)}</span>
          </div>`;
        }).join('')}
        <div class="hub-bilan-row hub-bilan-row-total"><span>Total budgets</span><span>− ${eur(bilanBudgets)}</span></div>
      </div>` : ''}

      <!-- Dépenses ponctuelles (achats) —toujours réel— -->
      ${achats.length > 0 ? `
      <div class="hub-bilan-section-title">Dépenses ponctuelles</div>
      <div class="hub-bilan-rows">
        ${achats.map(a => `
          <div class="hub-bilan-row hub-bilan-row-sub">
            <span>${escHtml(a.label || a.description || 'Achat')}</span>
            <span style="color:var(--danger);">− ${eur(Number(a.amount)||0)}</span>
          </div>`).join('')}
      </div>` : ''}

      <!-- Imprévus —toujours réel— -->
      ${imprévus.length > 0 ? `
      <div class="hub-bilan-section-title">Dépenses imprévues</div>
      <div class="hub-bilan-rows">
        ${imprévus.map(i => `
          <div class="hub-bilan-row hub-bilan-row-sub">
            <span>${escHtml(i.label || 'Imprevu')}</span>
            <span style="color:var(--danger);">− ${eur(Number(i.amount)||0)}</span>
          </div>`).join('')}
      </div>` : ''}

      <!-- Il reste -->
      <div class="hub-bilan-total">
        <span>Il reste</span>
        <span style="color:${bilanColor};font-size:1.35rem;font-weight:900;">${eur(bilanSolde)}</span>
      </div>

      <!-- Par user -->
      ${users.length > 1 ? `
      <div class="hub-bilan-peruser">
        ${users.map(u => {
          const uSolde = bilanUserSolde(u.id);
          const uAp    = aPayerPerUser[String(u.id)] || 0;
          const uColor = uSolde >= 0 ? 'var(--success)' : 'var(--danger)';
          const uTx    = totalRev > 0 ? uSolde / ((kpi?.revenus?.byUser?.[u.id]||0) + (kpi?.aides?.byUser?.[u.id]||0) + (kpi?.primes?.byUser?.[u.id]||0) || 1) : 0;
          return `<div class="hub-bilan-user-row">
            <div style="display:flex;align-items:center;gap:5px;">
              <span style="width:8px;height:8px;border-radius:50%;background:${escHtml(u.color||'#7C5CFC')};display:inline-block;"></span>
              <span style="font-size:0.8rem;font-weight:600;">${escHtml(u.name)}</span>
            </div>
            <div style="text-align:right;">
              <div style="font-size:0.68rem;color:var(--text-3);margin-bottom:1px;">à payer : ${eur(uAp)}</div>
              <div style="font-size:0.9rem;font-weight:800;color:${uColor};">${eur(uSolde)}</div>
              ${totalRev > 0 ? `<div style="font-size:0.66rem;color:var(--text-3);">${isPrevo ? 'prévu ' : ''}épargne ${Math.max(0, Math.round(uTx*100))} %</div>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>` : ''}

      ${totalRev > 0 ? `
      <div class="hub-bilan-rate">${isPrevo ? 'Taux d\'épargne prévu' : 'Taux d\'épargne réel'} : <strong>${Math.round(Math.max(0, bilanSolde / (totalRev || 1)) * 100)} %</strong></div>` : ''}
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

  // Toggle prévisionnel / réel
  const _toggleBilanMode = () => {
    _bilanMode = _bilanMode === 'previsionnel' ? 'reel' : 'previsionnel';
    localStorage.setItem('compta-bilan-mode', _bilanMode);
    renderHub(container);
  };
  body.querySelector('#bilan-mode-toggle')?.addEventListener('click', _toggleBilanMode);
  body.querySelector('#bilan-hint-switch')?.addEventListener('click', _toggleBilanMode);

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
  const viewOrder = ['revenus', 'charges', 'budgets', 'depenses'];
  const nextView  = viewOrder[viewOrder.indexOf(view) + 1] ?? null;

  body.innerHTML = `
    <div class="spoke-header">
      <button class="spoke-back" id="spoke-back" type="button" aria-label="Retour">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><path d="M15 18l-6-6 6-6"/></svg>
        Retour
      </button>
      <h2 class="spoke-title">${viewTitles[view] || view}</h2>
      ${nextView ? `<button class="spoke-next" id="spoke-next" type="button">${viewTitles[nextView].split(' ').slice(1).join(' ')} <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M9 18l6-6-6-6"/></svg></button>` : ''}
    </div>
    <div id="spoke-content" class="argent-subview"></div>
  `;

  body.querySelector('#spoke-back').addEventListener('click', () => {
    // Nettoyer listeners spoke
    const btn = body.querySelector('#spoke-back');
    if (btn._budgUnsub) { btn._budgUnsub(); btn._budgUnsub = null; }
    _currentView = 'hub';
    renderHub(container);
  });

  body.querySelector('#spoke-next')?.addEventListener('click', () => {
    const btn = body.querySelector('#spoke-back');
    if (btn?._budgUnsub) { btn._budgUnsub(); btn._budgUnsub = null; }
    _currentView = nextView;
    _renderSpoke(container, body, nextView);
  });

  const spokeContent = body.querySelector('#spoke-content');

  if (view === 'revenus') {
    await _renderRevenus(spokeContent);
  } else if (view === 'charges') {
    await _renderCharges(spokeContent);
  } else if (view === 'budgets') {
    await chargesModule.renderSection(spokeContent, 'budgets');
    // Rafraîchir le footer quand une opération budget est ajoutée
    const unsubBudg = on('budgetop:saved', () => { if (document.contains(spokeContent)) _renderSpokeFooter(body); });
    if (_spokeBudgUnsub) _spokeBudgUnsub();
    _spokeBudgUnsub = unsubBudg;
    body.querySelector('#spoke-back')._budgUnsub = unsubBudg;
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
  const kpi    = calcMonth(md || {}, charges, achats, repCfg, users, budgetOps.length ? budgetOps : null);
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
// VUE REVENUS — saisie par user, aides, primes, répartition
// ══════════════════════════════════════════════════════════════
async function _renderRevenus(container) {
  const { year, month } = State;
  const [users, md, repCfg] = await Promise.all([
    getActiveUsers(),
    getMonthlyData(year, month),
    getRepartition(year, month),
  ]);
  if (!md) { container.innerHTML = `<div class="empty-state-inline">Aucune donnée pour ce mois.</div>`; return; }
  const N = users.length;

  const _v = u => Number(md?.users?.[String(u.id)]?.revenus) || '';
  const _a = u => Number(md?.users?.[String(u.id)]?.aides)   || '';
  const _p = u => Number(md?.users?.[String(u.id)]?.primes)  || '';

  const repModes = [
    { key: 'equitable',    label: '⚖️ Équitable' },
    { key: 'fixe',         label: '% Fixe' },
    { key: 'separe',       label: '🔀 Séparé' },
    { key: 'personnalise', label: '🎛 Perso' },
  ];

  container.innerHTML = `
    <div class="spoke-section">
      <div class="spoke-section-title">💰 Revenus</div>
      <div class="spoke-rev-grid">
        ${users.map(u => `
          <div class="spoke-rev-user">
            <div class="spoke-rev-user-label">
              <span class="spoke-user-dot" style="background:${escHtml(u.color||'#7C5CFC')};"></span>
              ${escHtml(u.name)}
            </div>
            <div class="input-wrap">
              <input type="number" class="form-input input-euro rev-input" id="rv-rev-${u.id}"
                inputmode="decimal" min="0" step="1" placeholder="0" value="${_v(u)}">
              <span class="input-suffix">€</span>
            </div>
          </div>`).join('')}
      </div>
    </div>

    <details class="settings-group" id="aides-details" style="margin-bottom:12px;">
      <summary class="settings-group-title" style="font-size:0.84rem;">➕ Aides &amp; primes</summary>
      <div class="settings-group-body">
        <div class="spoke-section-title" style="margin-bottom:8px;">Aides (CAF, APL, allocations…)</div>
        ${users.map(u => `
          <div class="spoke-rev-user" style="margin-bottom:8px;">
            <div class="spoke-rev-user-label">
              <span class="spoke-user-dot" style="background:${escHtml(u.color||'#7C5CFC')};"></span>
              ${escHtml(u.name)}
            </div>
            <div class="input-wrap">
              <input type="number" class="form-input input-euro rev-input" id="rv-aid-${u.id}"
                inputmode="decimal" min="0" step="1" placeholder="0" value="${_a(u)}">
              <span class="input-suffix">€</span>
            </div>
          </div>`).join('')}
        <div class="spoke-section-title" style="margin:12px 0 8px;">Primes &amp; bonus</div>
        <p style="font-size:0.7rem;color:var(--text-3);margin:0 0 8px;">Non comptés dans la répartition des charges</p>
        ${users.map(u => `
          <div class="spoke-rev-user" style="margin-bottom:8px;">
            <div class="spoke-rev-user-label">
              <span class="spoke-user-dot" style="background:${escHtml(u.color||'#7C5CFC')};"></span>
              ${escHtml(u.name)}
            </div>
            <div class="input-wrap">
              <input type="number" class="form-input input-euro rev-input" id="rv-pri-${u.id}"
                inputmode="decimal" min="0" step="1" placeholder="0" value="${_p(u)}">
              <span class="input-suffix">€</span>
            </div>
          </div>`).join('')}
      </div>
    </details>

    ${N > 1 ? `
    <details class="settings-group" id="rep-details" style="margin-bottom:12px;">
      <summary class="settings-group-title" style="font-size:0.84rem;">⚖️ Répartition des charges</summary>
      <div class="settings-group-body">
        <div class="tabs" id="rep-tabs">
          ${repModes.map(m => `<button class="tab-btn ${repCfg.mode === m.key ? 'active' : ''}" data-mode="${m.key}">${m.label}</button>`).join('')}
        </div>
        <div id="rep-pcts" style="margin-top:8px;${repCfg.mode !== 'fixe' ? 'display:none;' : ''}">
          ${users.map(u => `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <span style="flex:1;font-size:0.8rem;">${escHtml(u.name)}</span>
              <div class="input-wrap" style="width:80px;">
                <input type="number" class="form-input pct-input" data-uid="${u.id}"
                  min="0" max="100" step="1" value="${repCfg.pcts?.[u.id] ?? Math.round(100/N)}">
                <span class="input-suffix">%</span>
              </div>
            </div>`).join('')}
        </div>
        <p id="rep-desc" style="font-size:0.76rem;color:var(--text-3);margin-top:6px;"></p>
      </div>
    </details>` : ''}

    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0 80px;">
      <span id="rv-save-ind" style="font-size:0.76rem;color:var(--success);display:none;">✓ Sauvegardé</span>
    </div>
  `;

  // ── Mode répartition labels ──
  const modeDescs = {
    separe:       'Chacun paie ses dépenses personnelles uniquement.',
    equitable:    'Les charges communes sont divisées proportionnellement aux revenus.',
    fixe:         'Chacun paie un % fixe des charges communes.',
    personnalise: 'Répartition définie manuellement par charge.',
  };
  const repDescEl = container.querySelector('#rep-desc');
  if (repDescEl) repDescEl.textContent = modeDescs[repCfg.mode] || '';

  // ── Auto-save ──
  const _saveInd = () => {
    const ind = container.querySelector('#rv-save-ind');
    if (ind) { ind.style.display = 'inline'; setTimeout(() => ind.style.display = 'none', 2200); }
    // Rafraîchir le footer du spoke
    const body = container.closest('#argent-body');
    if (body) _renderSpokeFooter(body);
  };
  const _doSave = debounce(async () => {
    const fresh = await getMonthlyData(year, month) || { year, month, users: {} };
    if (!fresh.users) fresh.users = {};
    for (const u of users) {
      const uid = String(u.id);
      if (!fresh.users[uid]) fresh.users[uid] = {};
      const rv  = container.querySelector(`#rv-rev-${u.id}`);
      const aid = container.querySelector(`#rv-aid-${u.id}`);
      const pri = container.querySelector(`#rv-pri-${u.id}`);
      if (rv)  fresh.users[uid].revenus = Number(rv.value)  || 0;
      if (aid) fresh.users[uid].aides   = Number(aid.value) || 0;
      if (pri) fresh.users[uid].primes  = Number(pri.value) || 0;
    }
    await saveMonthlyData(fresh);
    _saveInd();
    emit('charges:updated');
  }, 600);

  container.querySelectorAll('.rev-input').forEach(inp => inp.addEventListener('input', _doSave));

  // ── Mode répartition ──
  if (N > 1) {
    container.querySelectorAll('#rep-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        container.querySelectorAll('#rep-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const freshRep = await getRepartition(year, month);
        freshRep.mode = btn.dataset.mode;
        const pctDiv = container.querySelector('#rep-pcts');
        if (pctDiv) pctDiv.style.display = freshRep.mode === 'fixe' ? '' : 'none';
        if (repDescEl) repDescEl.textContent = modeDescs[freshRep.mode] || '';
        // Lire les % si fixe
        if (freshRep.mode === 'fixe') {
          if (!freshRep.pcts) freshRep.pcts = {};
          container.querySelectorAll('.pct-input').forEach(inp => {
            freshRep.pcts[inp.dataset.uid] = Number(inp.value) || Math.round(100/N);
          });
        }
        await saveRepartition(freshRep);
        _saveInd();
        emit('charges:updated');
      });
    });
    container.querySelectorAll('.pct-input').forEach(inp => {
      inp.addEventListener('input', async () => {
        const freshRep = await getRepartition(year, month);
        if (!freshRep.pcts) freshRep.pcts = {};
        container.querySelectorAll('.pct-input').forEach(i => {
          freshRep.pcts[i.dataset.uid] = Number(i.value) || 0;
        });
        await saveRepartition(freshRep);
        _saveInd();
        emit('charges:updated');
      });
    });
  }
}

// ══════════════════════════════════════════════════════════════
// VUE CHARGES FIXES — liste, import, ajouter, confirmer
// ══════════════════════════════════════════════════════════════
async function _renderCharges(container) {
  const { year, month } = State;
  const [users, charges] = await Promise.all([
    getActiveUsers(),
    getChargesForMonth(month, year),
  ]);

  const _refresh = () => _renderCharges(container);

  const totalChg = charges.reduce((s, c) => {
    const lines = c.lines?.length ? c.lines : [{ amount: c.amount }];
    return s + lines.reduce((ss, l) => ss + (Number(l.amount)||0), 0);
  }, 0);

  const byCat = {};
  for (const c of charges) { (byCat[c.category || 'autre'] ??= []).push(c); }

  container.innerHTML = `
    <div class="spoke-toolbar">
      <button class="btn btn-outline" id="chg-import">📥 Importer</button>
      <button class="btn btn-primary" id="chg-add">+ Ajouter</button>
    </div>
    ${charges.length === 0 ? `
      <div class="empty-state" style="padding:28px 0;">
        <div class="empty-state-icon">🏠</div>
        <div class="empty-state-title">Aucune charge ce mois-ci</div>
        <div class="empty-state-text"><strong>📥 Importer</strong> copie les charges du mois précédent en un clic.</div>
      </div>
    ` : `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <span style="font-size:0.78rem;color:var(--text-3);">${charges.length} charge${charges.length>1?'s':''}</span>
        <span class="chip danger">Total : ${eur(totalChg)}</span>
      </div>
      <div class="item-list" id="chg-list">
        ${Object.entries(byCat).map(([catId, items]) => {
          const info = getCategoryInfo(catId);
          const catTotal = items.reduce((s, c) => {
            const lines = c.lines?.length ? c.lines : [{ amount: c.amount }];
            return s + lines.reduce((ss, l) => ss + (Number(l.amount)||0), 0);
          }, 0);
          return `<div style="margin-bottom:10px;">
            <div class="chg-cat-header">${escHtml((info.emoji||'') + ' ' + (info.label||catId))} — ${eur(catTotal)}</div>
            ${items.map(c => {
              const lines = c.lines?.length ? c.lines : [{ amount: c.amount }];
              const lineTotal = lines.reduce((s, l) => s + (Number(l.amount)||0), 0);
              return `<div class="list-item spoke-charge-item" data-cid="${c.id}" style="cursor:pointer;">
                <div class="list-item-body"><div class="list-item-title">${escHtml(c.label)}</div></div>
                <div class="list-item-right"><div class="list-item-amount">${eur(lineTotal)}</div></div>
              </div>`;
            }).join('')}
          </div>`;
        }).join('')}
      </div>
    `}
    <div class="spoke-confirm-wrap">
      <button class="btn btn-primary spoke-confirm-btn" id="chg-confirm" style="width:100%;padding:13px;">
        ✓ Confirmer les charges
      </button>
      ${_chgValidated ? '<p style="text-align:center;font-size:0.7rem;color:var(--success);margin:6px 0 0;">✅ Déjà confirmées ce mois</p>' : ''}
    </div>
  `;

  // Click-to-edit
  container.querySelectorAll('.spoke-charge-item').forEach(el => {
    el.addEventListener('click', () => {
      const c = charges.find(x => x.id === Number(el.dataset.cid));
      if (c) chargesModule.showChargeModal(c, () => { emit('charges:updated'); _refresh(); });
    });
  });

  container.querySelector('#chg-add')?.addEventListener('click', () => {
    chargesModule.showChargeModal(null, () => { emit('charges:updated'); _refresh(); });
  });

  container.querySelector('#chg-import')?.addEventListener('click', () => {
    _showImportChargesModal(users, year, month, _refresh);
  });

  container.querySelector('#chg-confirm')?.addEventListener('click', () => {
    emit('charges:validated');
    showToast('Charges confirmées ✅', 'success');
  });
}

// ── Import modal charges (indépendant de saisie.js) ──
async function _showImportChargesModal(users, year, month, onDone) {
  openModal('📥 Importer des charges', `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <button class="btn btn-outline" id="imp-prev" style="text-align:left;padding:14px;white-space:normal;">
        <strong>📅 Du mois précédent</strong><br>
        <span style="font-size:0.78rem;color:var(--text-3);">Copie toutes les charges du mois passé</span>
      </button>
      <button class="btn btn-outline" id="imp-tpl" style="text-align:left;padding:14px;white-space:normal;">
        <strong>📋 Charges prédéfinies</strong><br>
        <span style="font-size:0.78rem;color:var(--text-3);">Sélectionnez parmi une liste de charges courantes</span>
      </button>
    </div>
  `, `<button class="btn btn-outline" id="imp-cancel-btn">Annuler</button>`);

  document.getElementById('imp-cancel-btn')?.addEventListener('click', closeModal);

  document.getElementById('imp-tpl')?.addEventListener('click', () => {
    closeModal();
    chargesModule.showChargesTemplatesModal(() => { emit('charges:updated'); onDone(); });
  });

  document.getElementById('imp-prev')?.addEventListener('click', async () => {
    const prevM     = addMonth(year, month, -1);
    const prevChargesRaw = await getChargesForMonth(prevM.month, prevM.year);
    if (!prevChargesRaw.length) { showToast('Aucune charge le mois précédent', 'warning'); closeModal(); return; }
    // getChargesForMonth expand les multi-lignes : dédupliquer par id pour ne sauvegarder qu'une fois par charge originale
    const seenIds = new Set();
    const prevCharges = prevChargesRaw.filter(c => { if (seenIds.has(c.id)) return false; seenIds.add(c.id); return true; });
    const defaultQui = users.length === 1 ? String(users[0]?.id ?? 'shared') : 'shared';
    for (const c of prevCharges) {
      const { id: _id, ...rest } = c;
      const lines = rest.lines?.map(l => ({ ...l, qui: l.qui ?? defaultQui }));
      await saveCharge({ ...rest, qui: rest.qui ?? defaultQui, ...(lines ? { lines } : {}), year, month });
    }
    closeModal();
    emit('charges:updated');
    showToast(`${prevCharges.length} charge(s) importée(s) ✅`, 'success');
    onDone();
  });
}

// ══════════════════════════════════════════════════════════════
// VUE DÉPENSES — 3 onglets : Inattendues | Craquage | Ponctuelles
// ══════════════════════════════════════════════════════════════
async function _renderDepenses(container) {
  const { year, month } = State;
  let _activeDepTab = 'inattendues';

  const _render = async () => {
    const [users, md, achats] = await Promise.all([
      getActiveUsers(),
      getMonthlyData(year, month),
      getAchatsForMonth(year, month),
    ]);

    const imprévusList = md?.imprévusList || [];
    const craquages    = achats.filter(a => a.category === 'craquage' || a.craquage_source);
    const ponctuelles  = achats.filter(a => !a.craquage_source && a.category !== 'craquage');

    const tabs = [
      { key: 'inattendues', label: '🚨 Inattendues', count: imprévusList.length },
      { key: 'craquage',    label: '💥 Craquage',    count: craquages.length },
      { key: 'ponctuelles', label: '💳 Ponctuelles',  count: ponctuelles.length },
    ];

    let listHtml = '';
    let addBtnHtml = '';
    if (_activeDepTab === 'inattendues') {
      listHtml   = imprévusList.length ? imprévusList.map(d => _depItemHtml(d, 'imprevu')).join('') : `<div class="empty-state-inline">Aucune dépense inattendue ce mois-ci</div>`;
      addBtnHtml = `<button class="btn dep-add-btn" id="dep-add-imprevu">+ Ajouter une dépense inattendue</button>`;
    } else if (_activeDepTab === 'craquage') {
      listHtml   = craquages.length ? craquages.map(d => _depItemHtml(d, 'achat')).join('') : `<div class="empty-state-inline">Aucun craquage ce mois-ci</div>`;
      addBtnHtml = `<button class="btn dep-add-btn" id="dep-add-craquage">+ Ajouter un craquage</button>`;
    } else {
      listHtml   = ponctuelles.length ? ponctuelles.map(d => _depItemHtml(d, 'achat')).join('') : `<div class="empty-state-inline">Aucune dépense ponctuelle ce mois-ci</div>`;
      addBtnHtml = `<button class="btn dep-add-btn" id="dep-add-ponctuelle">+ Nouvelle dépense ponctuelle</button>`;
    }

    container.innerHTML = `
      <div class="tabs" style="margin-bottom:14px;">
        ${tabs.map(t => `
          <button class="tab-btn ${_activeDepTab === t.key ? 'active' : ''}" data-tab="${t.key}">
            ${t.label}${t.count > 0 ? ` <span class="dep-tab-count">${t.count}</span>` : ''}
          </button>`).join('')}
      </div>
      <div class="item-list" id="dep-list" style="margin-bottom:14px;">${listHtml}</div>
      <div class="dep-add-wrap">${addBtnHtml}</div>
    `;

    container.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => { _activeDepTab = btn.dataset.tab; _render(); });
    });

    const now = new Date();

    container.querySelector('#dep-add-imprevu')?.addEventListener('click', async () => {
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
        await _render();
      });
    });

    container.querySelector('#dep-add-craquage')?.addEventListener('click', () => {
      saisieModule.showCraquageModal(null, month, year, users, async () => {
        emit('charges:updated');
        await _render();
      });
    });

    container.querySelector('#dep-add-ponctuelle')?.addEventListener('click', () => {
      chargesModule.showAchatModal(null, async () => {
        emit('charges:updated');
        await _render();
      });
    });

    // Suppression des dépenses
    container.querySelectorAll('.dep-del-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const item = btn.closest('[data-dep-type]');
        if (!item) return;
        const depType = item.dataset.depType;
        const depId   = item.dataset.depId;
        item.style.opacity = '0.35';
        item.style.pointerEvents = 'none';
        if (depType === 'imprevu') {
          const freshMd = await getMonthlyData(year, month);
          if (freshMd?.imprévusList) {
            freshMd.imprévusList = freshMd.imprévusList.filter(i => String(i.id) !== String(depId));
            await saveMonthlyData(freshMd);
          }
        } else {
          await deleteAchat(Number(depId));
        }
        emit('charges:updated');
        showToast('Dépense supprimée', 'success');
        await _render();
      });
    });
  };

  await _render();
}

function _depItemHtml(d, type) {
  const label = escHtml(d.label || d.description || '');
  const amt   = Number(d.amount) || 0;
  let icon, sub, iconBg, iconColor;
  if (type === 'imprevu') {
    icon = '🚨'; sub = 'Inattendue'; iconBg = 'var(--danger-bg)'; iconColor = 'var(--danger)';
  } else if (d.category === 'craquage' || d.craquage_source) {
    icon = '💥'; sub = 'Craquage'; iconBg = 'var(--warning-bg)'; iconColor = 'var(--warning)';
  } else {
    icon = '💳'; sub = 'Dépense ponctuelle'; iconBg = 'var(--primary-bg)'; iconColor = 'var(--primary)';
  }
  return `<div class="list-item" data-dep-type="${type}" data-dep-id="${escHtml(String(d.id))}">
    <div class="list-item-icon" style="background:${iconBg};color:${iconColor};">${icon}</div>
    <div class="list-item-body">
      <div class="list-item-title">${label}</div>
      <div class="list-item-sub">${sub}${d.day ? ' · Jour ' + d.day : ''}</div>
    </div>
    <div class="list-item-right">
      <div class="list-item-amount" style="color:var(--danger);">−${eur(amt)}</div>
      <button class="btn-icon dep-del-btn" style="width:26px;height:26px;color:var(--text-3);font-size:0.8rem;margin-top:3px;" title="Supprimer">🗑️</button>
    </div>
  </div>`;
}

