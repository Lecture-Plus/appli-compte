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
         getActiveUsers }                                  from '../db.js';
import { calcMonth, calcPrevisionnel }                    from '../calculs.js';
import { eur, pct, nomMois, addMonth, signClass,
         txEparClass, completenessStatus,
         progressColor, escHtml, showToast,
         openModal, closeModal }                          from '../utils.js';
import * as saisieModule                                  from './saisie.js';

let _activeTab = 'resume';

export async function render(container) {
  const [s, users] = await Promise.all([getAllSettings(), getActiveUsers()]);
  const { year, month } = State;

  container.innerHTML = `
    <!-- Navigation mois (cachée quand onglet Saisir actif) -->
    <div class="month-nav" id="dash-month-nav" style="margin-bottom:12px;${_activeTab === 'saisie' ? 'display:none;' : ''}">
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
      <button class="tab-btn ${_activeTab === 'saisie'       ? 'active' : ''}" data-tab="saisie">✏️ Saisir les budgets</button>
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
      const nav = container.querySelector('#dash-month-nav');
      if (nav) nav.style.display = _activeTab === 'saisie' ? 'none' : '';
      _renderContent(container, s, users);
    });
  });

  await _renderContent(container, s, users);
}

async function _renderContent(container, s, users) {
  if (_activeTab === 'resume')       await _renderResume(container, s, users);
  else if (_activeTab === 'saisie')  await saisieModule.render(container.querySelector('#dash-content'));
  else                               await _renderPrevisionnel(container, s, users);
}

// ══════════════════════════════════════════════════
// ONGLET RÉSUMÉ
// ══════════════════════════════════════════════════
async function _renderResume(container, s, users) {
  const { year, month } = State;
  const [md, charges, achats, repCfg, savInfo, allSavOps] = await Promise.all([
    getMonthlyData(year, month),
    getChargesForMonth(month),
    getAchatsForMonth(year, month),
    getRepartition(year, month),
    computeCurrentSavingsBalance(),
    getAllSavingsOperations(),
  ]);

  const kpi    = calcMonth(md, charges, achats, repCfg, users);
  const status = completenessStatus(md);

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

  // ── KPI sous-texte par utilisateur ──
  const byUserSub = (kpiField) => users.length <= 1 ? '' :
    users.map(u => `${escHtml(u.name)}: ${eur(kpiField.byUser?.[u.id] ?? 0)}`).join('<br>');

  const soldeColor = kpi.solde.total >= 0 ? 'var(--success)' : 'var(--danger)';
  const txColor    = kpi.txEpargne.total >= 0.10 ? 'var(--success)' : kpi.txEpargne.total >= 0 ? 'var(--warning)' : 'var(--danger)';

  const el = container.querySelector('#dash-content');
  el.innerHTML = `
    <!-- ── HERO : Solde du mois ── -->
    <div style="background:var(--bg-card);border:2px solid ${soldeColor};border-radius:var(--radius);padding:18px 16px 14px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div>
          <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-3);font-weight:600;margin-bottom:4px;">Solde de ${nomMois(month)} ${year}</div>
          <div style="font-size:2.4rem;font-weight:900;color:${soldeColor};line-height:1.05;">${eur(kpi.solde.total)}</div>
          <div style="font-size:0.78rem;color:${txColor};margin-top:6px;font-weight:700;">Taux d'épargne : ${pct(kpi.txEpargne.total, 0)}</div>
          ${users.length > 1 ? `<div style="font-size:0.7rem;color:var(--text-3);margin-top:3px;">${users.map(u => `${escHtml(u.name)}: ${eur(kpi.solde.byUser?.[u.id] ?? 0)}`).join(' · ')}</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0;">
          <span class="completeness-badge ${badgeClass}">${badgeIcon} ${badgeText}</span>
          <button class="btn btn-sm btn-primary" id="btn-go-saisie">✏️ Saisir</button>
        </div>
      </div>
      <!-- 3 micro-stats -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
        <div>
          <div style="font-size:0.6rem;color:var(--text-3);font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Revenus</div>
          <div style="font-size:0.95rem;font-weight:800;">${eur(kpi.revenus.total + (kpi.aides?.total ?? 0))}</div>
          ${kpi.primes.total > 0 ? `<div style="font-size:0.65rem;color:var(--warning);">+${eur(kpi.primes.total)} primes</div>` : ''}
        </div>
        <div style="text-align:center;">
          <div style="font-size:0.6rem;color:var(--text-3);font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Dépenses</div>
          <div style="font-size:0.95rem;font-weight:800;color:var(--danger);">${eur(kpi.depenses.total)}</div>
          ${byUserSub(kpi.depenses) ? `<div style="font-size:0.65rem;color:var(--text-3);">${users.map(u=>`${escHtml(u.name[0])}: ${eur(kpi.depenses.byUser?.[u.id]??0)}`).join(' · ')}</div>` : ''}
        </div>
        <div style="text-align:right;">
          <div style="font-size:0.6rem;color:var(--text-3);font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Charges</div>
          <div style="font-size:0.95rem;font-weight:800;">${eur(kpi.charges.total)}</div>
          ${kpi.imprevus.total > 0 ? `<div style="font-size:0.65rem;color:var(--danger);">+${eur(kpi.imprevus.total)} imprévus</div>` : ''}
        </div>
      </div>
    </div>

    <!-- Économies disponibles -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header">
        <span class="card-title">💰 Économies disponibles</span>
        <button class="btn btn-sm btn-secondary" id="btn-go-savings">Gérer</button>
      </div>
      <div style="font-size:1.4rem; font-weight:800; color:${savInfo.balance >= 0 ? 'var(--success)' : 'var(--danger)'};">
        ${eur(savInfo.balance)}
      </div>
      <div style="font-size:0.75rem; color:var(--text-3); margin-top:4px;">
        ${savInfo.latest
          ? `Confirmé le ${new Date(savInfo.latest.confirmedAt).toLocaleDateString('fr-FR')}${savInfo.delta !== 0 ? ` · ${savInfo.delta >= 0 ? '+' : ''}${eur(savInfo.delta)} depuis la confirmation` : ''}`
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
        <div class="progress-track">
          <div class="progress-bar ${pBarColor}" style="width:${Math.min(100, goalPct)}%"></div>
        </div>
      </div>
      <div id="projection-objectif" style="margin-top:8px;font-size:0.75rem;color:var(--text-3);">Calcul projection…</div>
    </div>` : ''}

    <!-- Tableau détail -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header"><span class="card-title">📋 Détail du mois</span></div>
      <div style="overflow-x:auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Catégorie</th>
              ${users.map(u => `<th style="text-align:right">
                <span class="user-color-dot" style="background:${escHtml(u.color||'#6C63FF')};width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:3px;"></span>
                ${escHtml(u.name)}
              </th>`).join('')}
              <th style="text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>
            ${buildRow('Revenus & Aides', kpi.revenus, users)}
            ${kpi.aides?.total > 0 ? buildRow('Aides',       kpi.aides,    users) : ''}
            ${buildRow('Primes',      kpi.primes,   users)}
            ${buildRow('Charges',     kpi.charges,  users)}
            ${buildRow('Courses',     kpi.courses,  users)}
            ${buildRow('Loisirs',      kpi.extras,   users)}
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
              ${users.map(u => {
                const v = kpi.solde.byUser?.[u.id] ?? 0;
                return `<td style="text-align:right;color:${v >= 0 ? 'var(--success)' : 'var(--danger)'};">${eur(v)}</td>`;
              }).join('')}
              <td style="text-align:right;color:${kpi.solde.total >= 0 ? 'var(--success)' : 'var(--danger)'};">${eur(kpi.solde.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <!-- Bilan Épargne du mois -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header" style="margin-bottom:8px;">
        <span class="card-title">💚 Bilan épargne du mois</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
        <div style="background:var(--success-bg);border-radius:var(--radius-sm);padding:12px;">
          <div style="font-size:0.65rem;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:0.03em;margin-bottom:2px;">Possible</div>
          <div style="font-size:0.68rem;color:var(--text-3);margin-bottom:5px;">Sans imprévus ni achats</div>
          <div style="font-size:1.15rem;font-weight:800;color:var(--success);">${eur(Math.max(0, kpi.ecoPossible.total))}</div>
          <div style="font-size:0.68rem;color:var(--text-3);margin-top:2px;">${pct(kpi.txEcoPossible?.total ?? 0, 0)} du revenu</div>
          ${users.length > 1 ? `<div style="font-size:0.7rem;color:var(--text-3);margin-top:4px;">${users.map(u => `${escHtml(u.name)}: ${eur(kpi.ecoPossible.byUser?.[u.id] ?? 0)}`).join(' · ')}</div>` : ''}
        </div>
        <div style="background:${realSavings >= 0 ? 'var(--primary-bg)' : 'var(--danger-bg)'};border-radius:var(--radius-sm);padding:12px;">
          <div style="font-size:0.65rem;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:0.03em;margin-bottom:2px;">Réelle mise de côté</div>
          <div style="font-size:0.68rem;color:var(--text-3);margin-bottom:5px;">Opérations épargne ce mois</div>
          <div style="font-size:1.15rem;font-weight:800;color:${realSavings >= 0 ? 'var(--primary)' : 'var(--danger)'}">${eur(realSavings)}</div>
          <div style="font-size:0.68rem;color:var(--text-3);margin-top:2px;">${monthlySavOps.length} opération(s)</div>
          ${users.length > 1 && savingsByUser.some(([,v]) => v > 0) ? `<div style="font-size:0.7rem;color:var(--text-3);margin-top:4px;">${savingsByUser.filter(([,v]) => v > 0).map(([name, v]) => `${escHtml(name)}: ${eur(v)}`).join(' · ')}</div>` : ''}
        </div>
      </div>
    </div>

    ${md?.notes ? `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title" style="margin-bottom:6px;">📝 Notes</div>
      <p style="font-size:0.875rem;color:var(--text-2);white-space:pre-wrap;">${escHtml(md.notes)}</p>
    </div>` : ''}

    <!-- Vue annuelle rapide -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header"><span class="card-title">🗓️ Année ${year} en un coup d'œil</span></div>
      <div id="annual-quick-view"><div class="loading" style="padding:10px;"><div class="spinner" style="width:20px;height:20px;"></div></div></div>
    </div>

    <div style="height:16px;"></div>
  `;

  el.querySelector('#btn-go-saisie')?.addEventListener('click', () => {
    _activeTab = 'saisie';
    const nav = container.querySelector('#dash-month-nav');
    if (nav) nav.style.display = 'none';
    container.querySelectorAll('#dash-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    container.querySelector('[data-tab="saisie"]')?.classList.add('active');
    _renderContent(container, s, users);
  });
  el.querySelector('#btn-go-savings')?.addEventListener('click', () => navigateTo('savings'));

  // ── Vue annuelle rapide (chargée en arrière-plan) ──
  _renderAnnualQuickView(el.querySelector('#annual-quick-view'), year, users);

  // ── Projection objectif épargne ──
  const projEl = el.querySelector('#projection-objectif');
  if (projEl && goal > 0) _renderProjection(projEl, year, month, goal, savInfo.balance, users);
}

// ══════════════════════════════════════════════════
// ONGLET PRÉVISIONNEL
// ══════════════════════════════════════════════════
async function _renderPrevisionnel(container, s, users) {
  const { year, month } = State;

  const [md, charges, achats] = await Promise.all([
    getMonthlyData(year, month),
    getChargesForMonth(month),
    getAchatsForMonth(year, month),
  ]);

  // ── Revenus totaux ──
  let totalIncome = 0;
  if (md?.users) {
    for (const u of users) {
      const ud = md.users[String(u.id)];
      if (ud) totalIncome += (Number(ud.revenus) || 0) + (Number(ud.primes) || 0);
    }
  }

  // ── Budgets courses & extras & imprévus ──
  const totalCourses  = users.reduce((s, u) => s + (Number(md?.users?.[String(u.id)]?.courses) || 0), 0);
  const totalExtras   = users.reduce((s, u) => s + (Number(md?.users?.[String(u.id)]?.extras) || 0), 0);
  const totalImprévus = (md?.imprévusList || []).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const spentCourses  = achats.filter(a => a.craquage_source === 'courses').reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const spentExtras   = achats.filter(a => a.craquage_source === 'extras').reduce((s, a) => s + (Number(a.amount) || 0), 0);

  // ── Calcul prévisionnel ──
  const now         = new Date();
  const isCurrentM  = now.getFullYear() === year && now.getMonth() + 1 === month;
  const daysInMonth = new Date(year, month, 0).getDate();
  const simDay      = isCurrentM ? now.getDate() : 0;
  // Courses : déduites chaque semaine (tous les 7 jours) plutôt qu'en une fois
  const weeklyGroceries = totalCourses > 0 ? Math.round(totalCourses * 7 / daysInMonth) : 0;
  const totalDeductions = totalExtras + totalImprévus;

  const { days, todayDay } = calcPrevisionnel({ totalIncome, charges, year, month, simDay, deductions: totalDeductions, weeklyGroceries });

  const timedCount = charges.filter(c => c.active && Number(c.dayOfMonth) > 0).length;
  const noTimedMsg = timedCount === 0
    ? `<div style="background:var(--warning-bg);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:0.78rem;color:var(--warning);">
         ⚠️ Aucune charge n'a de <strong>date de prélèvement</strong> définie. Allez dans <strong>Charges</strong> pour les configurer.
       </div>`
    : '';

  const displayDays = simDay > 0 ? days.filter(d => d.day <= simDay) : days;

  const el = container.querySelector('#dash-content');
  el.innerHTML = `
    ${noTimedMsg}

    <!-- Suivi des budgets courses & extras -->
    ${(() => {
      const cibles = s.budgetCibles || {};
      const budgCourses = totalCourses > 0 ? totalCourses : (Number(cibles.courses) || 0);
      const budgExtras  = totalExtras  > 0 ? totalExtras  : (Number(cibles.extras)  || 0);
      const budgImpr    = Number(cibles.imprevus) || 0;
      const totalImprSpent = (md?.imprévusList || []).reduce((s, i) => s + (Number(i.amount) || 0), 0);
      const cards = [
        budgCourses > 0 ? _buildBudgetCard('🛒 Courses',  budgCourses, spentCourses,  totalCourses > 0 ? 'Saisi' : 'Cible') : '',
        budgExtras  > 0 ? _buildBudgetCard('🎮 Loisirs',   budgExtras,  spentExtras,   totalExtras  > 0 ? 'Saisi' : 'Cible') : '',
        budgImpr    > 0 ? _buildBudgetCard('⚡ Imprévus', budgImpr,    totalImprSpent, 'Cible') : '',
      ].filter(Boolean);
      return cards.length > 0
        ? `<div style="display:grid;grid-template-columns:${cards.map(() => '1fr').join(' ')};gap:8px;margin-bottom:12px;">${cards.join('')}</div>`
        : '';
    })()}

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <span class="section-label">Projection jour par jour</span>
      <div style="display:flex;align-items:center;gap:6px;">
        <span class="chip ${totalIncome > 0 ? 'primary' : 'danger'}">Base : ${eur(totalIncome)}</span>
        ${totalDeductions > 0 ? `<span class="chip danger">−${eur(totalDeductions)} loisirs/imprévus</span>` : ''}
        ${weeklyGroceries > 0 ? `<span class="chip warning">🛒 ${eur(weeklyGroceries)}/sem</span>` : ''}
      </div>
    </div>

    ${totalIncome === 0
      ? `<div class="empty-state">
           <div class="empty-state-icon">📋</div>
           <div class="empty-state-title">Revenus non saisis</div>
           <div class="empty-state-text">Saisissez vos revenus du mois pour activer le prévisionnel.</div>
         </div>`
      : `<div class="card" style="padding:0;overflow:hidden;">
           <table class="data-table">
             <thead><tr><th>Jour</th><th>Charges</th><th style="text-align:right">Solde estimé</th></tr></thead>
             <tbody>${displayDays.map(d => _buildPrevDay(d)).join('')}</tbody>
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
    <div class="card" style="padding:12px;height:100%;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;">
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

function _buildPrevDay(d) {
  const todayStyle = d.isToday ? 'background:var(--primary-bg);font-weight:700;' : '';
  const pastStyle  = d.isPast  ? 'opacity:0.4;'  : '';
  const balColor   = d.balance >= 0 ? 'var(--success)' : 'var(--danger)';
  const todayBadge = d.isToday ? `<span class="chip primary" style="font-size:0.6rem;padding:1px 5px;margin-left:4px;">auj.</span>` : '';

  const chargesHtml = d.chargeItems.length > 0
    ? d.chargeItems.map(c => `<span class="chip danger" style="font-size:0.65rem;padding:1px 5px;">${escHtml(c.label)} −${eur(c.amount)}</span>`).join(' ')
    : `<span style="color:var(--text-3);font-size:0.72rem;">—</span>`;

  return `<tr style="${todayStyle}${pastStyle}">
    <td style="white-space:nowrap;"><strong>${d.day}</strong>${todayBadge}</td>
    <td style="font-size:0.78rem;">${chargesHtml}</td>
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
