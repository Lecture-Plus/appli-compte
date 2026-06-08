// ============================================================
// js/ui/dashboard.js – Tableau de bord : Résumé + Prévisionnel
// ============================================================

import { State, navigateTo }                              from '../app.js';
import { getMonthlyData, getChargesForMonth,
         getAchatsForMonth, getRepartition,
         getAllSettings, getMonthsByYear,
         computeCurrentSavingsBalance,
         getAllSavingsOperations, saveSavingsOperation,
         deleteSavingsOperation,
         getBudgetOpsForMonth, saveBudgetOp,
         getActiveUsers }                                  from '../db.js';
import { calcMonth, calcPrevisionnel }                    from '../calculs.js';
import { eur, pct, nomMois, addMonth, signClass,
         txEparClass, completenessStatus,
         progressColor, escHtml, showToast,
         openModal, closeModal }                          from '../utils.js';
import { showCraquageModal }                              from './saisie.js';

let _activeTab = 'resume';

export async function render(container) {
  const [s, users] = await Promise.all([getAllSettings(), getActiveUsers()]);
  const { year, month } = State;

  container.innerHTML = `
    <!-- Navigation mois -->
    <div class="month-nav" id="dash-month-nav" style="margin-bottom:12px;">
      <button class="month-btn" id="prev-month" aria-label="Mois précédent">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <div style="text-align:center;">
        <div class="month-nav-label">${nomMois(month)}</div>
        <div class="month-nav-year">${year}</div>
      </div>
      <button class="month-btn" id="next-month" aria-label="Mois suivant">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
      </button>
    </div>

    <!-- Onglets -->
    <div class="tabs" id="dash-tabs" style="margin-bottom:12px;">
      <button class="tab-btn ${_activeTab === 'resume'       ? 'active' : ''}" data-tab="resume">📊 Résumé</button>
      <button class="tab-btn ${_activeTab === 'previsionnel' ? 'active' : ''}" data-tab="previsionnel">📅 Prévisionnel</button>
    </div>

    <div id="dash-content"></div>
  `;

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

  container.querySelectorAll('#dash-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('#dash-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _activeTab = btn.dataset.tab;
      _renderContent(container, s, users);
    });
  });

  await _renderContent(container, s, users);
}

async function _renderContent(container, s, users) {
  if (_activeTab === 'resume') await _renderResume(container, s, users);
  else                         await _renderPrevisionnel(container, s, users);
}

// ══════════════════════════════════════════════════
// ONGLET RÉSUMÉ
// ══════════════════════════════════════════════════
async function _renderResume(container, s, users) {
  const { year, month } = State;

  const customBudgets = s.customBudgets || [];
  const pinnedBudgets = s.pinnedBudgets || ['courses', 'extras'];

  const [md, charges, achats, repCfg, savInfo, allSavOps, allBudgetOps] = await Promise.all([
    getMonthlyData(year, month),
    getChargesForMonth(month),
    getAchatsForMonth(year, month),
    getRepartition(year, month),
    computeCurrentSavingsBalance(),
    getAllSavingsOperations(),
    getBudgetOpsForMonth(year, month),
  ]);

  const kpi    = calcMonth(md, charges, achats, repCfg, users);
  const status = completenessStatus(md);

  // Pinned budget cards data
  const budgCourses  = users.reduce((acc, u) => acc + (Number(md?.users?.[String(u.id)]?.courses) || 0), 0) || (Number(s.budgetCibles?.courses) || 0);
  const budgExtras   = users.reduce((acc, u) => acc + (Number(md?.users?.[String(u.id)]?.extras)  || 0), 0) || (Number(s.budgetCibles?.extras)  || 0);
  const spentCourses = allBudgetOps.filter(o => o.category === 'courses').reduce((a, o) => a + (Number(o.amount)||0), 0);
  const spentExtras  = allBudgetOps.filter(o => o.category === 'extras').reduce((a, o) => a + (Number(o.amount)||0), 0);

  const pinnedCards = pinnedBudgets.map(pid => {
    if (pid === 'courses') return { id:'courses', icon:'🛒', label:'Courses', budget:budgCourses, spent:spentCourses };
    if (pid === 'extras')  return { id:'extras',  icon:'🎮', label:'Loisirs',  budget:budgExtras,  spent:spentExtras  };
    const cb = customBudgets.find(b => b.id === pid);
    if (!cb) return null;
    const spentCustom = allBudgetOps.filter(o => o.category === pid).reduce((a, o) => a + (Number(o.amount)||0), 0);
    return { id:pid, icon:cb.icon||'📌', label:cb.name, budget:Number(cb.amount)||0, spent:spentCustom };
  }).filter(Boolean);

  const goal     = Number(s.savingsGoal) || 0;
  const goalYear = s.savingsGoalYear ?? year;
  let epargneYTD = 0;

  if (goal > 0 && goalYear === year) {
    const allMonths = await getMonthsByYear(year);
    const ytdValues = await Promise.all(allMonths.map(m =>
      Promise.all([
        getChargesForMonth(m.month),
        getAchatsForMonth(year, m.month),
        getRepartition(year, m.month),
      ]).then(([c, a, rc]) => calcMonth(m, c, a, rc, users).solde.total)
    ));
    epargneYTD = ytdValues.reduce((s, v) => s + v, 0);
  }
  const goalPct   = goal > 0 ? Math.min(200, Math.round((epargneYTD / goal) * 100)) : 0;
  const pBarColor = progressColor(goalPct);

  // ── Épargne réelle = ops du mois en cours (versements/retraits) ──
  const monthlySavOps = allSavOps.filter(op => op.year === year && op.month === month);
  const realSavings   = monthlySavOps.reduce((s, op) => s + (Number(op.amount) || 0), 0);
  const savingsByUser = users.map(u => {
    const uOps = monthlySavOps.filter(op => String(op.userId) === String(u.id));
    return [u.name, uOps.reduce((s, op) => s + (Number(op.amount) || 0), 0)];
  });

  const badgeClass = { done: 'done', partial: 'partial', empty: 'empty' }[status];
  const badgeIcon  = status === 'done'
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="12" height="12"><path d="M20 6L9 17l-5-5"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>`;
  const badgeText  = { done: 'Complet', partial: 'En cours', empty: 'Non rempli' }[status];

  const soldeColor = kpi.solde.total >= 0 ? 'var(--success)' : 'var(--danger)';
  const txColor    = kpi.txEpargne.total >= 0.10 ? 'var(--success)' : kpi.txEpargne.total >= 0 ? 'var(--warning)' : 'var(--danger)';

  // ── Score budgétaire (mini ring) ──
  const cibles    = s.budgetCibles || {};
  const threshold = Number(s.epargneThreshold) || 100;
  const _tx       = kpi.txEpargne?.total ?? 0;
  const _txPts    = _tx >= 0.15 ? 40 : _tx >= 0.05 ? 25 : _tx > 0 ? 10 : 0;
  const _soldePts = kpi.solde.total >= threshold ? 20 : kpi.solde.total >= 0 ? 10 : 0;
  const _budgC    = Number(cibles.courses) || 0;
  const _cPts     = _budgC > 0 ? (_budgC >= kpi.courses.total ? 20 : Math.max(0, 20 - Math.round((kpi.courses.total - _budgC) / _budgC * 20))) : 10;
  const _budgE    = Number(cibles.extras)  || 0;
  const _ePts     = _budgE > 0 ? (_budgE >= kpi.extras.total  ? 20 : Math.max(0, 20 - Math.round((kpi.extras.total  - _budgE) / _budgE * 20))) : 10;
  const score     = _txPts + _soldePts + _cPts + _ePts;
  const scoreHex  = score >= 75 ? '#00D4A0' : score >= 50 ? '#FFB020' : '#FF5E57';
  const sR = 22, sCirc = 2 * Math.PI * sR;
  const sOffset   = sCirc - (score / 100) * sCirc;

  const el = container.querySelector('#dash-content');
  el.innerHTML = `
    <!-- ── HERO compact + score ring ── -->
    <div class="hero-card" style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div style="flex:1;min-width:0;">
          <div class="hero-label">Solde de ${nomMois(month)} ${year}</div>
          <div class="hero-amount" style="color:${soldeColor};">${eur(kpi.solde.total)}</div>
          <div class="hero-meta">
            <span>${eur(kpi.revenus.total + (kpi.aides?.total ?? 0))} revenus</span>
            <span style="color:var(--text-3);"> · </span>
            <span style="color:var(--danger);">${eur(kpi.depenses.total)} dépensés</span>
          </div>
          ${users.length > 1 ? `<div style="font-size:0.67rem;color:var(--text-3);margin-top:3px;">${users.map(u => `${escHtml(u.name)}: ${eur(kpi.solde.byUser?.[u.id] ?? 0)}`).join(' · ')}</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex-shrink:0;">
          <svg width="58" height="58" viewBox="0 0 56 56" style="overflow:visible;">
            <circle cx="28" cy="28" r="${sR}" stroke-width="5" fill="none" stroke="var(--bg-2)"/>
            <circle cx="28" cy="28" r="${sR}" stroke-width="5" fill="none"
              stroke="${scoreHex}" stroke-dasharray="${sCirc.toFixed(2)}" stroke-dashoffset="${sCirc.toFixed(2)}"
              stroke-linecap="round" transform="rotate(-90 28 28)" id="mini-score-arc"/>
            <text x="28" y="33" text-anchor="middle" fill="${scoreHex}"
              style="font-family:Inter,sans-serif;font-size:13px;font-weight:900;">${score}</text>
          </svg>
          <div style="font-size:0.55rem;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em;">Score</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;gap:8px;">
        <span class="completeness-badge ${badgeClass}">${badgeIcon} ${badgeText}</span>
        ${kpi.primes.total > 0 ? `<span class="chip warning" style="font-size:0.62rem;">+${eur(kpi.primes.total)} primes</span>` : ''}
      </div>
    </div>

    <!-- ── Actions rapides ── -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px;">
      <button class="btn btn-primary" id="btn-go-saisie" style="font-size:0.8rem;padding:10px 4px;">✏️ Saisir</button>
      <button class="btn btn-secondary" id="btn-go-savings" style="font-size:0.8rem;padding:10px 4px;">💰 Épargne</button>
      <button class="btn btn-danger" id="btn-go-craquage" style="font-size:0.8rem;padding:10px 4px;">💥 Craquage</button>
    </div>

    <!-- ── Suivi budgets épinglés ── -->
    ${pinnedCards.length > 0 ? `<div style="display:grid;grid-template-columns:${pinnedCards.map(() => '1fr').join(' ')};gap:8px;margin-top:12px;margin-bottom:12px;align-items:stretch;">
      ${pinnedCards.map(c => `<div class="card" style="padding:12px;box-sizing:border-box;position:relative;" data-quickadd-cat="${escHtml(c.id)}" data-quickadd-label="${escHtml(c.label)}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <div style="font-size:0.72rem;font-weight:600;color:var(--text-3);">${c.icon} ${escHtml(c.label)}</div>
          <button class="btn btn-sm btn-primary btn-quickadd" data-qcat="${escHtml(c.id)}" data-qlabel="${escHtml(c.icon+' '+c.label)}" style="padding:2px 8px;font-size:0.7rem;line-height:1.4;">+</button>
        </div>
        <div class="progress-track" style="height:6px;margin-bottom:6px;">
          <div class="progress-bar ${c.budget > 0 ? (c.spent/c.budget >= 1 ? 'danger' : c.spent/c.budget >= 0.8 ? 'warning' : 'success') : 'success'}" style="width:${c.budget > 0 ? Math.min(100, Math.round(c.spent/c.budget*100)) : 0}%;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:0.75rem;">
          <span style="color:var(--${c.budget > 0 ? (c.spent/c.budget >= 1 ? 'danger' : c.spent/c.budget >= 0.8 ? 'warning' : 'success') : 'text-2'});">${eur(c.spent)} dépensé</span>
          <span style="color:var(--text-3);">/ ${eur(c.budget)}</span>
        </div>
        ${(c.budget > 0 && c.spent > c.budget) ? `<div style="font-size:0.7rem;color:var(--danger);margin-top:3px;">⚠️ +${eur(c.spent - c.budget)}</div>` : ''}
      </div>`).join('')}
    </div>` : '<div style="margin-bottom:12px;"></div>'}

    <!-- ── Détail collapsible ── -->
    <button id="btn-toggle-detail" style="display:flex;align-items:center;justify-content:space-between;width:100%;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:11px 14px;margin-bottom:12px;font-size:0.82rem;font-weight:600;color:var(--text-2);cursor:pointer;transition:all var(--transition);">
      <span id="detail-toggle-label">Voir le détail du mois</span>
      <svg id="chevron-detail" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16" style="transition:transform 0.22s;flex-shrink:0;"><path d="M6 9l6 6 6-6"/></svg>
    </button>

    <div id="detail-section" style="display:none;">
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header">
          <span class="card-title">💰 Économies disponibles</span>
        </div>
        <div style="font-size:1.3rem;font-weight:800;color:${savInfo.balance >= 0 ? 'var(--success)' : 'var(--danger)'};">${eur(savInfo.balance)}</div>
        <div style="font-size:0.73rem;color:var(--text-3);margin-top:4px;">
          ${savInfo.latest
            ? `Confirmé le ${new Date(savInfo.latest.confirmedAt).toLocaleDateString('fr-FR')}${savInfo.delta !== 0 ? ` · ${savInfo.delta >= 0 ? '+' : ''}${eur(savInfo.delta)} depuis` : ''}`
            : 'Aucune confirmation enregistrée'}
        </div>
      </div>

      ${goal > 0 ? `
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header">
          <span class="card-title">🎯 ${escHtml(s.savingsGoalLabel || 'Objectif')} ${goalYear}</span>
          <span class="chip ${pBarColor === 'success' ? 'success' : pBarColor === 'danger' ? 'danger' : 'primary'}">${goalPct}%</span>
        </div>
        <div class="progress-wrap">
          <div class="progress-labels">
            <span>${eur(epargneYTD)} épargnés</span>
            <span style="color:var(--text-3)">/ ${eur(goal)}</span>
          </div>
          <div class="progress-track"><div class="progress-bar ${pBarColor}" style="width:${Math.min(100, goalPct)}%"></div></div>
        </div>
        <div id="projection-objectif" style="margin-top:8px;font-size:0.75rem;color:var(--text-3);">Calcul…</div>
      </div>` : ''}

      <div class="card" style="margin-bottom:12px;">
        <div class="card-header"><span class="card-title">📋 Détail du mois</span></div>
        <div style="overflow-x:auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Catégorie</th>
                ${users.map(u => `<th style="text-align:right"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${escHtml(u.color||'#7C5CFC')};margin-right:3px;"></span>${escHtml(u.name)}</th>`).join('')}
                <th style="text-align:right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${buildRow('Revenus & Aides', kpi.revenus, users)}
              ${kpi.aides?.total > 0 ? buildRow('Aides',       kpi.aides,    users) : ''}
              ${buildRow('Primes',      kpi.primes,   users)}
              ${buildRow('Charges',     kpi.charges,  users)}
              ${buildRow('Courses',     kpi.courses,  users)}
              ${buildRow('Loisirs',     kpi.extras,   users)}
              ${buildRow('Achats exc.', kpi.achats,   users)}
              ${buildRow('Imprévus',    kpi.imprevus, users)}
            </tbody>
            <tfoot>
              <tr class="row-total">
                <td>À payer</td>
                ${users.map(u => `<td style="text-align:right">${eur(kpi.aPayer.byUser?.[u.id] ?? 0)}</td>`).join('')}
                <td style="text-align:right">${eur(kpi.aPayer.total)}</td>
              </tr>
              <tr class="row-total">
                <td>Solde net</td>
                ${users.map(u => { const v = kpi.solde.byUser?.[u.id] ?? 0; return `<td style="text-align:right;color:${v >= 0 ? 'var(--success)' : 'var(--danger)'};">${eur(v)}</td>`; }).join('')}
                <td style="text-align:right;color:${kpi.solde.total >= 0 ? 'var(--success)' : 'var(--danger)'};">${eur(kpi.solde.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div class="card" style="margin-bottom:12px;">
        <div class="card-header"><span class="card-title">💚 Bilan épargne</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div style="background:var(--success-bg);border-radius:var(--radius-sm);padding:12px;">
            <div style="font-size:0.62rem;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Possible</div>
            <div style="font-size:1.1rem;font-weight:800;color:var(--success);">${eur(Math.max(0, kpi.ecoPossible.total))}</div>
            <div style="font-size:0.68rem;color:var(--text-3);margin-top:2px;">${pct(kpi.txEcoPossible?.total ?? 0, 0)} du revenu</div>
          </div>
          <div style="background:${realSavings >= 0 ? 'var(--primary-bg)' : 'var(--danger-bg)'};border-radius:var(--radius-sm);padding:12px;">
            <div style="font-size:0.62rem;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Mise de côté</div>
            <div style="font-size:1.1rem;font-weight:800;color:${realSavings >= 0 ? 'var(--primary)' : 'var(--danger)'};">${eur(realSavings)}</div>
            <div style="font-size:0.68rem;color:var(--text-3);margin-top:2px;">${monthlySavOps.length} opération(s)</div>
          </div>
        </div>
      </div>

      ${md?.notes ? `<div class="card" style="margin-bottom:12px;"><div class="card-title" style="margin-bottom:6px;">📝 Notes</div><p style="font-size:0.875rem;color:var(--text-2);white-space:pre-wrap;">${escHtml(md.notes)}</p></div>` : ''}

      <div class="card" style="margin-bottom:12px;">
        <div class="card-header"><span class="card-title">🗓️ ${year} en un coup d'œil</span></div>
        <div id="annual-quick-view"><div class="loading" style="padding:10px;"><div class="spinner" style="width:20px;height:20px;"></div></div></div>
      </div>
    </div><!-- /detail-section -->

    <div style="height:16px;"></div>
  `;

  // ── Animate score ring ──
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const arc = el.querySelector('#mini-score-arc');
    if (arc) arc.style.strokeDashoffset = sOffset.toFixed(2);
  }));

  // ── Toggle détail ──
  let _detailOpen = false;
  el.querySelector('#btn-toggle-detail')?.addEventListener('click', () => {
    const det = el.querySelector('#detail-section');
    const chv = el.querySelector('#chevron-detail');
    const lbl = el.querySelector('#detail-toggle-label');
    _detailOpen = !_detailOpen;
    det.style.display = _detailOpen ? '' : 'none';
    chv.style.transform = _detailOpen ? 'rotate(180deg)' : '';
    lbl.textContent = _detailOpen ? 'Masquer le détail' : 'Voir le détail du mois';
    if (_detailOpen) {
      _renderAnnualQuickView(el.querySelector('#annual-quick-view'), year, users);
      const projEl = el.querySelector('#projection-objectif');
      if (projEl && goal > 0) _renderProjection(projEl, year, month, goal, savInfo.balance, users);
    }
  });

  el.querySelector('#btn-go-saisie')?.addEventListener('click', () => navigateTo('argent', { tab: 'saisir' }));
  el.querySelector('#btn-go-savings')?.addEventListener('click', () => navigateTo('argent', { tab: 'epargne' }));
  el.querySelector('#btn-go-craquage')?.addEventListener('click', () => {
    showCraquageModal(null, month, year, users, async () => {
      await _renderResume(container, s, users);
    });
  });

  // ── Quick-add sur cartes budgets épinglées ──
  el.querySelectorAll('.btn-quickadd').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      _showQuickAddBudgetOp(
        btn.dataset.qcat, btn.dataset.qlabel, year, month, users,
        async () => { await _renderResume(container, s, users); }
      );
    });
  });
}
// ══════════════════════════════════════════════════
// ONGLET PRÉVISIONNEL
// ══════════════════════════════════════════════════
async function _renderPrevisionnel(container, s, users) {
  const { year, month } = State;

  const [md, charges, achats, budgetOps] = await Promise.all([
    getMonthlyData(year, month),
    getChargesForMonth(month),
    getAchatsForMonth(year, month),
    getBudgetOpsForMonth(year, month),
  ]);

  // ── Revenus totaux ──
  let totalIncome = 0;
  if (md?.users) {
    for (const u of users) {
      const ud = md.users[String(u.id)];
      if (ud) totalIncome += (Number(ud.revenus) || 0) + (Number(ud.primes) || 0);
    }
  }

  // ── Budgets saisis ──
  const totalCourses  = users.reduce((s, u) => s + (Number(md?.users?.[String(u.id)]?.courses) || 0), 0);
  const totalExtras   = users.reduce((s, u) => s + (Number(md?.users?.[String(u.id)]?.extras) || 0), 0);

  // ── Dépenses réelles par jour (achats + budgetOps + imprévus) ──
  const spentByDay = {};
  const _addSpent = (day, label, amount) => {
    const d = Number(day) || 0;
    if (!spentByDay[d]) spentByDay[d] = [];
    spentByDay[d].push({ label, amount: Number(amount) || 0 });
  };
  for (const a of achats) {
    if (a.year === year && a.month === month)
      _addSpent(a.day, '💥 ' + (a.label || a.category), Number(a.amount) || 0);
  }
  for (const op of budgetOps) {
    _addSpent(op.day, op.label || op.category, Number(op.amount) || 0);
  }
  for (const imp of (md?.imprévusList || [])) {
    _addSpent(imp.day || 0, '⚡ ' + (imp.label || 'Imprévu'), Number(imp.amount) || 0);
  }

  // ── Totaux pour les cards suivi ──
  const spentCourses    = budgetOps.filter(o => o.category === 'courses').reduce((s, o) => s + (Number(o.amount)||0), 0);
  const spentExtras     = budgetOps.filter(o => o.category === 'extras').reduce((s, o) => s + (Number(o.amount)||0), 0);
  const totalImprSpent  = (md?.imprévusList || []).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const totalAchatSpent = achats.filter(a => a.year === year && a.month === month)
                                .reduce((s, a) => s + (Number(a.amount)||0), 0);

  // ── Calcul prévisionnel (charges récurrentes seulement) ──
  const now        = new Date();
  const isCurrentM = now.getFullYear() === year && now.getMonth() + 1 === month;
  const simDay     = isCurrentM ? now.getDate() : 0;

  const { days: baseDays } = calcPrevisionnel({ totalIncome, charges, year, month, simDay, deductions: 0, weeklyGroceries: 0 });

  // Re-calculer le solde en intégrant toutes les dépenses réelles par jour
  let _prevBalance = Number(totalIncome) || 0;
  const adjustedDays = baseDays.map(d => {
    const chargesAmt = d.chargeItems.reduce((s, c) => s + c.amount, 0);
    const extraItems = spentByDay[d.day] || [];
    const extraAmt   = extraItems.reduce((s, i) => s + i.amount, 0);
    _prevBalance -= chargesAmt + extraAmt;
    return { ...d, extraItems, balance: Math.round(_prevBalance * 100) / 100 };
  });

  const timedCount = charges.filter(c => c.active && Number(c.dayOfMonth) > 0).length;
  const noTimedMsg = timedCount === 0
    ? `<div style="background:var(--warning-bg);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:0.78rem;color:var(--warning);">
         ⚠️ Aucune charge n'a de <strong>date de prélèvement</strong> définie. Allez dans <strong>Charges</strong> pour les configurer.
       </div>`
    : '';

  const el = container.querySelector('#dash-content');
  el.innerHTML = `
    ${noTimedMsg}

    <!-- Suivi des budgets -->
    ${(() => {
      const cibles = s.budgetCibles || {};
      const budgCourses = totalCourses > 0 ? totalCourses : (Number(cibles.courses) || 0);
      const budgExtras  = totalExtras  > 0 ? totalExtras  : (Number(cibles.extras)  || 0);
      const budgImpr    = Number(cibles.imprevus) || 0;
      const cards = [
        budgCourses > 0 ? _buildBudgetCard('🛒 Courses',      budgCourses, spentCourses,   totalCourses > 0 ? 'Saisi' : 'Cible') : '',
        budgExtras  > 0 ? _buildBudgetCard('🎮 Loisirs',       budgExtras,  spentExtras,    totalExtras  > 0 ? 'Saisi' : 'Cible') : '',
        budgImpr    > 0 ? _buildBudgetCard('⚡ Imprévus',     budgImpr,    totalImprSpent, 'Cible') : '',
        totalAchatSpent > 0 ? _buildBudgetCard('💥 Exceptionnels', 0, totalAchatSpent, 'Réalisé') : '',
      ].filter(Boolean);
      return cards.length > 0
        ? `<div style="display:grid;grid-template-columns:repeat(${Math.min(cards.length, 2)},1fr);gap:8px;margin-bottom:12px;align-items:stretch;">${cards.join('')}</div>`
        : '';
    })()}

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <span class="section-label">Projection jour par jour</span>
      <span class="chip ${totalIncome > 0 ? 'primary' : 'danger'}">Base : ${eur(totalIncome)}</span>
    </div>

    ${totalIncome === 0
      ? `<div class="empty-state">
           <div class="empty-state-icon">📋</div>
           <div class="empty-state-title">Revenus non saisis</div>
           <div class="empty-state-text">Saisissez vos revenus du mois pour activer le prévisionnel.</div>
         </div>`
      : `<div class="card" style="padding:0;overflow:hidden;">
           <table class="data-table">
             <thead><tr><th>Jour</th><th>Charges &amp; dépenses</th><th style="text-align:right">Solde estimé</th></tr></thead>
             <tbody>${adjustedDays.map(d => _buildPrevDay(d)).join('')}</tbody>
           </table>
         </div>`
    }
    <div style="height:16px;"></div>
  `;

}

// ── Projection "dans X mois l'objectif sera atteint" ──
async function _renderProjection(el, year, month, goal, currentBalance, users) {
  if (!el) return;
  try {
    const remaining = goal - currentBalance;
    if (remaining <= 0) {
      el.innerHTML = `<span style="color:var(--success);font-weight:700;">✅ Objectif déjà atteint !</span>`;
      return;
    }
    // Calculer la moyenne des 3 derniers mois de solde
    const months = [];
    let y = year, m = month;
    for (let i = 0; i < 3; i++) {
      const prev = addMonth(y, m, -1);
      y = prev.year; m = prev.month;
      months.push({ year: y, month: m });
    }
    const soldes = await Promise.all(months.map(async ({ year: yr, month: mo }) => {
      const [md, charges, achats, repCfg] = await Promise.all([
        getMonthlyData(yr, mo),
        getChargesForMonth(mo),
        getAchatsForMonth(yr, mo),
        getRepartition(yr, mo),
      ]);
      if (!md) return null;
      return calcMonth(md, charges, achats, repCfg, users).solde.total;
    }));
    const validSoldes = soldes.filter(s => s !== null && s > 0);
    if (!validSoldes.length) {
      el.innerHTML = `<span style="color:var(--text-3);">Pas assez d'historique pour projeter.</span>`;
      return;
    }
    const avgMonthly = validSoldes.reduce((s, v) => s + v, 0) / validSoldes.length;
    const monthsNeeded = Math.ceil(remaining / avgMonthly);
    const targetDate = new Date(year, month - 1 + monthsNeeded, 1);
    const dateStr = targetDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    el.innerHTML = `📈 À ce rythme (<strong>+${eur(Math.round(avgMonthly))}/mois</strong>), objectif atteint dans <strong>${monthsNeeded} mois</strong> (${dateStr})`;
  } catch (e) {
    el.innerHTML = '';
  }
}

// ── Vue annuelle rapide ──
async function _renderAnnualQuickView(el, year, users) {
  if (!el) return;
  try {
    const allMonths = await getMonthsByYear(year);
    const monthMap  = {};
    for (const m of allMonths) monthMap[m.month] = m;

    const MONTH_LABELS = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
    const now          = new Date();
    const curYear      = now.getFullYear();
    const curMonth     = now.getMonth() + 1;

    const boxes = await Promise.all(Array.from({ length: 12 }, async (_, i) => {
      const m   = i + 1;
      const md  = monthMap[m];
      const isFuture  = year > curYear || (year === curYear && m > curMonth);
      const isCurrent = year === curYear && m === curMonth;

      if (!md || isFuture) {
        const cls = isCurrent ? 'ym-box ym-current' : 'ym-box ym-empty';
        return `<div class="${cls}" title="${MONTH_LABELS[i]}"><span class="ym-label">${MONTH_LABELS[i]}</span><span class="ym-val">&mdash;</span></div>`;
      }

      const [charges, achats, repCfg] = await Promise.all([
        getChargesForMonth(m),
        getAchatsForMonth(year, m),
        getRepartition(year, m),
      ]);
      const kpi   = calcMonth(md, charges, achats, repCfg, users);
      const solde = kpi.solde.total;
      const cls   = 'ym-box ' + (solde > 0 ? 'ym-ok' : solde < 0 ? 'ym-bad' : 'ym-neutral');
      return `<div class="${cls}" title="${MONTH_LABELS[i]}: ${eur(solde)}"><span class="ym-label">${MONTH_LABELS[i]}</span><span class="ym-val">${solde >= 0 ? '+' : ''}${eur(solde)}</span></div>`;
    }));

    el.innerHTML = `<div class="ym-grid">${boxes.join('')}</div>`;
  } catch (e) {
    el.innerHTML = `<p style="font-size:0.78rem;color:var(--text-3);padding:4px 0;">Impossible de charger la vue annuelle.</p>`;
  }
}

function _buildBudgetCard(title, budget, spent, budgetLabel = 'Budget') {
  const pctUsed   = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  const color     = pctUsed >= 90 ? 'danger' : pctUsed >= 70 ? 'warning' : 'success';
  return `
    <div class="card" style="padding:12px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;">
      <div style="font-size:0.72rem;font-weight:600;color:var(--text-3);margin-bottom:6px;">${title}</div>
      <div class="progress-track" style="height:6px;margin-bottom:6px;">
        <div class="progress-bar ${color}" style="width:${pctUsed}%;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:0.75rem;">
        <span style="color:var(--${color});">${eur(spent)} dépensé</span>
        <span style="color:var(--text-3);">${budgetLabel} ${eur(budget)}</span>
      </div>
      ${(budget - spent) < 0 ? `<div style="font-size:0.7rem;color:var(--danger);margin-top:3px;">⚠️ Dépassement ${eur(Math.abs(budget - spent))}</div>` : ''}
    </div>
  `;
}

// ── Quick-add budget op depuis l'accueil ──
function _showQuickAddBudgetOp(catId, catLabel, year, month, users, onSave) {
  const now = new Date();
  const daysInMonth = new Date(year, month, 0).getDate();
  const userSelect = users.length > 1
    ? `<div class="form-group" style="margin-bottom:10px;">
        <label class="form-label">Personne</label>
        <select class="form-input" id="qbop-user">
          <option value="">— Sans attribution —</option>
          <option value="tous">👥 Tous (diviser en parts égales)</option>
          ${users.map(u => `<option value="${u.id}">${escHtml(u.name)}</option>`).join('')}
        </select>
       </div>`
    : '';
  openModal(`+ ${catLabel}`, `
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Description *</label>
      <input type="text" class="form-input" id="qbop-label" placeholder="Ex: Carrefour…" autofocus>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      <div class="form-group"><label class="form-label">Jour</label><input type="number" class="form-input" id="qbop-day" min="1" max="${daysInMonth}" value="${now.getDate()}"></div>
      <div class="form-group"><label class="form-label">Montant (€) *</label><div class="input-wrap"><input type="number" class="form-input" id="qbop-amount" min="0.01" step="0.01" placeholder="0.00"><span class="input-suffix">€</span></div></div>
    </div>
    ${userSelect}
  `, `<button class="btn btn-primary btn-full" id="qbop-save">Enregistrer</button>`);
  document.getElementById('qbop-save')?.addEventListener('click', async () => {
    const label  = document.getElementById('qbop-label')?.value.trim();
    const amount = parseFloat(document.getElementById('qbop-amount')?.value);
    const day    = parseInt(document.getElementById('qbop-day')?.value, 10) || null;
    if (!label)            { showToast('Saisissez une description', 'error'); return; }
    if (!amount || amount <= 0) { showToast('Montant invalide', 'error'); return; }
    const userVal = document.getElementById('qbop-user')?.value || null;
    if (userVal === 'tous' && users.length > 1) {
      const share = amount / users.length;
      for (const u of users) {
        await saveBudgetOp({ category: catId, year, month, day, label, amount: share, userId: u.id });
      }
    } else {
      await saveBudgetOp({ category: catId, year, month, day, label, amount, userId: userVal });
    }
    closeModal();
    showToast('Ajouté ✅', 'success');
    if (onSave) await onSave();
  });
}

function _buildPrevDay(d) {
  const todayStyle = d.isToday ? 'background:var(--primary-bg);font-weight:700;' : '';
  const pastStyle  = d.isPast  ? 'opacity:0.4;'  : '';
  const balColor   = d.balance >= 0 ? 'var(--success)' : 'var(--danger)';
  const todayBadge = d.isToday ? `<span class="chip primary" style="font-size:0.6rem;padding:1px 5px;margin-left:4px;">auj.</span>` : '';

  const chargesHtml = d.chargeItems.map(c => `<span class="chip danger" style="font-size:0.65rem;padding:1px 5px;">${escHtml(c.label)} −${eur(c.amount)}</span>`).join(' ');
  const extraHtml   = (d.extraItems || []).map(e => `<span class="chip warning" style="font-size:0.65rem;padding:1px 5px;">${escHtml(e.label)} −${eur(e.amount)}</span>`).join(' ');
  const allHtml     = [chargesHtml, extraHtml].filter(Boolean).join(' ') || `<span style="color:var(--text-3);font-size:0.72rem;">—</span>`;

  return `<tr style="${todayStyle}${pastStyle}">
    <td style="white-space:nowrap;"><strong>${d.day}</strong>${todayBadge}</td>
    <td style="font-size:0.78rem;">${allHtml}</td>
    <td style="text-align:right;font-weight:700;color:${balColor};">${eur(d.balance)}</td>
  </tr>`;
}

function buildRow(label, kpiField, users) {
  return `<tr>
    <td>${label}</td>
    ${users.map(u => `<td style="text-align:right">${eur(kpiField?.byUser?.[u.id] ?? 0)}</td>`).join('')}
    <td style="text-align:right">${eur(kpiField?.total ?? 0)}</td>
  </tr>`;
}

// Fusionne deux byUser maps (addition)
function mergeByUser(a, b, users) {
  const out = {};
  for (const u of users) {
    out[u.id] = (a?.[u.id] ?? 0) + (b?.[u.id] ?? 0);
  }
  return out;
}

// ══════════════════════════════════════════════════
// MODAL : VIRER VERS L'ÉPARGNE
// ══════════════════════════════════════════════════
function showTransferSavingsModal(year, month, ecoPossible, existingOp, onSave) {
  const isEdit = !!existingOp;
  const suggested = isEdit ? Math.abs(existingOp.amount) : Math.max(0, Math.round(ecoPossible));

  openModal(
    isEdit ? '💰 Modifier le virement épargne' : '💰 Virer vers l\'épargne',
    `
    <p style="font-size:0.82rem;color:var(--text-2);margin-bottom:14px;">
      Indiquez le montant que vous souhaitez mettre de côté pour <strong>${nomMois(month)} ${year}</strong>.<br>
      Une opération sera créée dans votre suivi d'épargne.
    </p>
    <div style="margin-bottom:14px;">
      <button type="button" class="btn btn-outline trf-preset" data-val="${Math.max(0, Math.round(ecoPossible))}" style="width:100%;">
        <div style="font-size:0.68rem;color:var(--text-3);margin-bottom:2px;">Utiliser le montant possible</div>
        <div style="font-weight:700;font-size:0.95rem;color:var(--success);">${eur(Math.max(0, ecoPossible))}</div>
      </button>
    </div>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Montant à virer (€)</label>
      <div class="input-wrap">
        <input type="number" class="form-input input-euro" id="trf-amount" min="0" step="1" value="${suggested}">
        <span class="input-suffix">€</span>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Libellé</label>
      <input type="text" class="form-input" id="trf-label" value="${isEdit ? existingOp.label || '' : `Épargne ${nomMois(month)} ${year}`}" placeholder="Ex: Virement Livret A">
    </div>
    `,
    `
    ${isEdit ? `<button class="btn btn-danger btn-sm" id="trf-delete">Supprimer</button>` : ''}
    <button class="btn btn-outline" id="trf-cancel">Annuler</button>
    <button class="btn btn-success" id="trf-save" style="margin-left:auto;">Confirmer</button>
    `
  );

  // Presets
  document.querySelectorAll('.trf-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('trf-amount');
      if (input) input.value = btn.dataset.val;
    });
  });

  document.getElementById('trf-cancel')?.addEventListener('click', closeModal);

  document.getElementById('trf-delete')?.addEventListener('click', async () => {
    if (!confirm('Supprimer ce virement ?')) return;
    await deleteSavingsOperation(existingOp.id);
    closeModal();
    showToast('Virement supprimé', 'success');
    onSave();
  });

  document.getElementById('trf-save')?.addEventListener('click', async () => {
    const amount = Number(document.getElementById('trf-amount')?.value);
    if (!amount || amount <= 0) { showToast('Montant invalide', 'error'); return; }
    const label = document.getElementById('trf-label')?.value.trim() || `Épargne ${nomMois(month)} ${year}`;
    const now   = new Date();

    if (isEdit) await deleteSavingsOperation(existingOp.id);

    await saveSavingsOperation({
      amount,
      label,
      type:      'monthly_savings',
      year,
      month,
      day:       now.getDate(),
      createdAt: now.toISOString(),
    });

    closeModal();
    showToast(`${eur(amount)} mis de côté ✅`, 'success');
    onSave();
  });
}
