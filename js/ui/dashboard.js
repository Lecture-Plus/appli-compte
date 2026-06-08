// ============================================================
// js/ui/dashboard.js – Tableau de bord : Résumé + Prévisionnel
// ============================================================

import { State, navigateTo }                              from '../app.js';
import { getMonthlyData, getChargesForMonth,
         getAchatsForMonth, getRepartition,
         getAllSettings, getMonthsByYear,
         computeCurrentSavingsBalance, setSetting,
         getActiveUsers }                                  from '../db.js';
import { calcMonth, calcPrevisionnel }                    from '../calculs.js';
import { eur, pct, nomMois, addMonth, signClass,
         txEparClass, completenessStatus,
         progressColor, escHtml, showToast }              from '../utils.js';

let _activeTab = 'resume';

export async function render(container) {
  const [s, users] = await Promise.all([getAllSettings(), getActiveUsers()]);
  const { year, month } = State;

  container.innerHTML = `
    <!-- Navigation mois -->
    <div class="month-nav" style="margin-bottom:12px;">
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
  const [md, charges, achats, repCfg, savInfo] = await Promise.all([
    getMonthlyData(year, month),
    getChargesForMonth(month),
    getAchatsForMonth(year, month),
    getRepartition(year, month),
    computeCurrentSavingsBalance(),
  ]);

  const kpi    = calcMonth(md, charges, achats, repCfg, users);
  const status = completenessStatus(md);

  const goal     = Number(s.savingsGoal) || 0;
  const goalYear = s.savingsGoalYear ?? year;
  let epargneYTD = 0;

  if (goal > 0 && goalYear === year) {
    const allMonths = await getMonthsByYear(year);
    for (const m of allMonths) {
      const c  = await getChargesForMonth(m.month);
      const a  = await getAchatsForMonth(year, m.month);
      const rc = await getRepartition(year, m.month);
      epargneYTD += calcMonth(m, c, a, rc, users).solde.total;
    }
  }
  const goalPct   = goal > 0 ? Math.min(200, Math.round((epargneYTD / goal) * 100)) : 0;
  const pBarColor = progressColor(goalPct);

  const badgeClass = { done: 'done', partial: 'partial', empty: 'empty' }[status];
  const badgeIcon  = status === 'done'
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="12" height="12"><path d="M20 6L9 17l-5-5"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>`;
  const badgeText  = { done: 'Complet', partial: 'En cours', empty: 'Non rempli' }[status];

  // ── KPI sous-texte par utilisateur ──
  const byUserSub = (kpiField) => users.length <= 1 ? '' :
    users.map(u => `${escHtml(u.name)}: ${eur(kpiField.byUser?.[u.id] ?? 0)}`).join('<br>');

  const el = container.querySelector('#dash-content');
  el.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
      <span class="completeness-badge ${badgeClass}">${badgeIcon} ${badgeText}</span>
      <button class="btn btn-sm btn-secondary" id="btn-go-saisie">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
        Saisir
      </button>
    </div>

    <div class="kpi-grid" style="margin-bottom:12px;">
      <div class="kpi-card primary">
        <div class="kpi-label">Revenus</div>
        <div class="kpi-value neutral">${eur(kpi.revenus.total + kpi.primes.total)}</div>
        <div class="kpi-sub">${byUserSub({ byUser: mergeByUser(kpi.revenus.byUser, kpi.primes.byUser, users) })}</div>
      </div>
      <div class="kpi-card danger">
        <div class="kpi-label">Dépenses</div>
        <div class="kpi-value neutral">${eur(kpi.depenses.total)}</div>
        <div class="kpi-sub">${byUserSub(kpi.depenses)}</div>
      </div>
      <div class="kpi-card ${kpi.solde.total >= 0 ? 'success' : 'danger'}">
        <div class="kpi-label">Solde net</div>
        <div class="kpi-value ${signClass(kpi.solde.total)}">${eur(kpi.solde.total)}</div>
        <div class="kpi-sub">${byUserSub(kpi.solde)}</div>
      </div>
      <div class="kpi-card warning">
        <div class="kpi-label">Taux épargne</div>
        <div class="kpi-value ${txEparClass(kpi.txEpargne.total)}">${pct(kpi.txEpargne.total, 0)}</div>
        <div class="kpi-sub">${users.length <= 1 ? '' : users.map(u => `${escHtml(u.name)}: ${pct(kpi.txEpargne.byUser?.[u.id] ?? 0, 0)}`).join('<br>')}</div>
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
          ? `Confirmé ${new Date(savInfo.latest.confirmedAt).toLocaleDateString('fr-FR')}${savInfo.delta !== 0 ? ` · ${savInfo.delta >= 0 ? '+' : ''}${eur(savInfo.delta)} depuis` : ''}`
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
            ${buildRow('Revenus',     kpi.revenus,  users)}
            ${buildRow('Primes',      kpi.primes,   users)}
            ${buildRow('Charges',     kpi.charges,  users)}
            ${buildRow('Courses',     kpi.courses,  users)}
            ${buildRow('Extras',      kpi.extras,   users)}
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

    ${kpi.ecoPossible.total > 0 ? `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header"><span class="card-title">💡 Économie possible (sans imprévus)</span></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${users.map(u => `
          <div style="flex:1;min-width:80px;background:var(--success-bg);border-radius:var(--radius-sm);padding:12px;text-align:center;">
            <div style="font-size:0.72rem;font-weight:700;color:var(--success);margin-bottom:4px;">${escHtml(u.name)}</div>
            <div style="font-size:1.1rem;font-weight:800;color:var(--success);">${eur(kpi.ecoPossible.byUser?.[u.id] ?? 0)}</div>
          </div>`).join('')}
      </div>
    </div>` : ''}

    ${md?.notes ? `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title" style="margin-bottom:6px;">📝 Notes</div>
      <p style="font-size:0.875rem;color:var(--text-2);white-space:pre-wrap;">${escHtml(md.notes)}</p>
    </div>` : ''}
    <div style="height:16px;"></div>
  `;

  el.querySelector('#btn-go-saisie')?.addEventListener('click', () => navigateTo('saisie'));
  el.querySelector('#btn-go-savings')?.addEventListener('click', () => navigateTo('savings'));
}

// ══════════════════════════════════════════════════
// ONGLET PRÉVISIONNEL
// ══════════════════════════════════════════════════
async function _renderPrevisionnel(container, s, users) {
  const { year, month } = State;
  const weeklyEst = Number(s.weeklyCoursesEstimate) || 85;

  const [md, charges] = await Promise.all([
    getMonthlyData(year, month),
    getChargesForMonth(month),
  ]);

  // Somme des revenus de tous les utilisateurs
  let totalIncome = 0;
  if (md?.users) {
    for (const u of users) {
      const ud = md.users[String(u.id)];
      if (ud) totalIncome += (Number(ud.revenus) || 0) + (Number(ud.primes) || 0);
    }
  }

  const { days, todayDay } = calcPrevisionnel({ totalIncome, charges, weeklyCoursesEstimate: weeklyEst, year, month });

  const timedCount = charges.filter(c => c.active && Number(c.dayOfMonth) > 0).length;
  const noTimedMsg = timedCount === 0
    ? `<div style="background:var(--warning-bg);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:0.78rem;color:var(--warning);">
         ⚠️ Aucune charge n'a de <strong>date de prélèvement</strong> définie. Allez dans <strong>Charges</strong> pour ajouter le jour du mois de chaque charge.
       </div>`
    : '';

  const displayDays = todayDay > 0 ? days.filter(d => !d.isPast || d.isToday) : days;

  const el = container.querySelector('#dash-content');
  el.innerHTML = `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header"><span class="card-title">⚙️ Budget courses hebdomadaire</span></div>
      <div class="form-group">
        <div style="display:flex;gap:8px;">
          <div class="input-wrap" style="flex:1;">
            <input type="number" class="form-input input-euro" id="weekly-est" min="0" step="5" value="${weeklyEst}">
            <span class="input-suffix">€/sem</span>
          </div>
          <button class="btn btn-secondary btn-sm" id="btn-save-weekly">OK</button>
        </div>
        <p class="form-hint">≈ ${eur(Math.round(weeklyEst/7*100)/100)}/jour déduites de chaque journée</p>
      </div>
    </div>

    ${noTimedMsg}

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <span class="section-label">📅 Projection jour par jour</span>
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
             <thead><tr><th>Jour</th><th>Charges / Courses</th><th style="text-align:right">Solde estimé</th></tr></thead>
             <tbody>${displayDays.map(d => _buildPrevDay(d)).join('')}</tbody>
           </table>
         </div>`
    }
    <div style="height:16px;"></div>
  `;

  el.querySelector('#btn-save-weekly')?.addEventListener('click', async () => {
    const val = Number(el.querySelector('#weekly-est')?.value) || 85;
    await setSetting('weeklyCoursesEstimate', val);
    showToast('Budget courses enregistré ✅', 'success');
    await _renderPrevisionnel(container, { ...s, weeklyCoursesEstimate: val }, users);
  });
}

function _buildPrevDay(d) {
  const todayStyle = d.isToday ? 'background:var(--primary-bg);font-weight:700;' : '';
  const pastStyle  = d.isPast  ? 'opacity:0.4;'  : '';
  const balColor   = d.balance >= 0 ? 'var(--success)' : 'var(--danger)';
  const todayBadge = d.isToday ? `<span class="chip primary" style="font-size:0.6rem;padding:1px 5px;margin-left:4px;">auj.</span>` : '';

  const chargesHtml = d.chargeItems.length > 0
    ? d.chargeItems.map(c => `<span class="chip danger" style="font-size:0.65rem;padding:1px 5px;">${escHtml(c.label)} −${eur(c.amount)}</span>`).join(' ')
      + ` <span style="color:var(--text-3);font-size:0.72rem;">+courses ${eur(d.coursesAmt)}</span>`
    : `<span style="color:var(--text-3);font-size:0.72rem;">courses ${eur(d.coursesAmt)}</span>`;

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

