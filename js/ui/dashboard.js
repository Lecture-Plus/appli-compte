// ============================================================
// js/ui/dashboard.js – Page d'accueil / tableau de bord
// ============================================================

import { State, navigateTo }                          from '../app.js';
import { getMonthlyData, getChargesForMonth,
         getAchatsForMonth, getRepartition,
         getAllSettings, getMonthsByYear }             from '../db.js';
import { calcMonth }                                   from '../calculs.js';
import { eur, pct, nomMois, addMonth, signClass,
         txEparClass, completenessStatus,
         progressColor, escHtml, showToast }           from '../utils.js';

export async function render(container) {
  const s       = await getAllSettings();
  const p1Name  = s.p1Name || 'Personne 1';
  const p2Name  = s.p2Name || 'Personne 2';
  const { year, month } = State;

  // Chargement des données du mois sélectionné
  const [md, charges, achats, repCfg] = await Promise.all([
    getMonthlyData(year, month),
    getChargesForMonth(month),
    getAchatsForMonth(year, month),
    getRepartition(year, month),
  ]);

  const kpi    = calcMonth(md, charges, achats, repCfg);
  const status = completenessStatus(md);

  // Calcul objectif épargne (annuel)
  const goal       = Number(s.savingsGoal) || 0;
  const goalYear   = s.savingsGoalYear ?? year;
  const goalLabel  = escHtml(s.savingsGoalLabel || 'Mon objectif');
  let   epargneYTD = 0;

  if (goal > 0 && goalYear === year) {
    const allMonths = await getMonthsByYear(year);
    for (const m of allMonths) {
      const c  = await getChargesForMonth(m.month);
      const a  = await getAchatsForMonth(year, m.month);
      const rc = await getRepartition(year, m.month);
      const k  = calcMonth(m, c, a, rc);
      epargneYTD += k.solde.total;
    }
  }
  const goalPct    = goal > 0 ? Math.min(200, Math.round((epargneYTD / goal) * 100)) : 0;
  const pBarColor  = progressColor(goalPct);

  // Badge de complétude
  const badgeClass = { done: 'done', partial: 'partial', empty: 'empty' }[status];
  const badgeIcon  = status === 'done'
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>`
    : status === 'partial'
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>`;
  const badgeText  = { done: 'Complet', partial: 'En cours', empty: 'Non rempli' }[status];

  // HTML de la page
  container.innerHTML = `
    <!-- Sélecteur mois / année -->
    <div class="month-nav" id="month-nav">
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

    <!-- Statut du mois -->
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
      <span class="completeness-badge ${badgeClass}">${badgeIcon} ${badgeText}</span>
      <button class="btn btn-sm btn-secondary" id="btn-go-saisie">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
        Saisir
      </button>
    </div>

    <!-- KPI Grid -->
    <div class="kpi-grid" style="margin-bottom:12px;">

      <div class="kpi-card primary">
        <div class="kpi-label">Revenus</div>
        <div class="kpi-value neutral">${eur(kpi.revenus.total + kpi.primes.total)}</div>
        <div class="kpi-sub">${escHtml(p1Name)}: ${eur(kpi.revenus.p1 + kpi.primes.p1)}<br>${escHtml(p2Name)}: ${eur(kpi.revenus.p2 + kpi.primes.p2)}</div>
      </div>

      <div class="kpi-card danger">
        <div class="kpi-label">Dépenses</div>
        <div class="kpi-value neutral">${eur(kpi.depenses.total)}</div>
        <div class="kpi-sub">${escHtml(p1Name)}: ${eur(kpi.depenses.p1)}<br>${escHtml(p2Name)}: ${eur(kpi.depenses.p2)}</div>
      </div>

      <div class="kpi-card ${kpi.solde.total >= 0 ? 'success' : 'danger'}">
        <div class="kpi-label">Solde</div>
        <div class="kpi-value ${signClass(kpi.solde.total)}">${eur(kpi.solde.total)}</div>
        <div class="kpi-sub">${escHtml(p1Name)}: ${eur(kpi.solde.p1)}<br>${escHtml(p2Name)}: ${eur(kpi.solde.p2)}</div>
      </div>

      <div class="kpi-card warning">
        <div class="kpi-label">Taux épargne</div>
        <div class="kpi-value ${txEparClass(kpi.txEpargne.total)}">${pct(kpi.txEpargne.total, 0)}</div>
        <div class="kpi-sub">${escHtml(p1Name)}: ${pct(kpi.txEpargne.p1, 0)}<br>${escHtml(p2Name)}: ${pct(kpi.txEpargne.p2, 0)}</div>
      </div>

    </div>

    <!-- Objectif d'épargne annuel -->
    ${goal > 0 ? `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header">
        <span class="card-title">🎯 ${goalLabel} ${goalYear}</span>
        <span class="chip ${pBarColor === 'success' ? 'success' : pBarColor === 'danger' ? 'danger' : 'primary'}">${goalPct} %</span>
      </div>
      <div class="progress-wrap">
        <div class="progress-labels">
          <span>${eur(epargneYTD)} épargnés</span>
          <span style="color:var(--text-3)">/ ${eur(goal)}</span>
        </div>
        <div class="progress-track">
          <div class="progress-bar ${pBarColor}" style="width:${Math.min(100,goalPct)}%"></div>
        </div>
      </div>
    </div>
    ` : ''}

    <!-- Détail du mois -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header">
        <span class="card-title">📋 Détail du mois</span>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Catégorie</th>
            <th>${escHtml(p1Name)}</th>
            <th>${escHtml(p2Name)}</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${buildRow('Revenus',    kpi.revenus)}
          ${buildRow('Primes',     kpi.primes)}
          ${buildRow('Charges',    kpi.charges)}
          ${buildRow('Courses',    kpi.courses)}
          ${buildRow('Extras',     kpi.extras)}
          ${buildRow('Achats exc.', kpi.achats)}
          ${buildRow('Imprévus',   kpi.imprevus)}
        </tbody>
        <tfoot>
          <tr class="row-total">
            <td>À payer</td>
            <td style="text-align:right">${eur(kpi.aPayer.p1)}</td>
            <td style="text-align:right">${eur(kpi.aPayer.p2)}</td>
            <td style="text-align:right">${eur(kpi.aPayer.total)}</td>
          </tr>
          <tr class="row-total">
            <td>Solde net</td>
            <td style="text-align:right; color:${kpi.solde.p1 >= 0 ? 'var(--success)' : 'var(--danger)'}">${eur(kpi.solde.p1)}</td>
            <td style="text-align:right; color:${kpi.solde.p2 >= 0 ? 'var(--success)' : 'var(--danger)'}">${eur(kpi.solde.p2)}</td>
            <td style="text-align:right; color:${kpi.solde.total >= 0 ? 'var(--success)' : 'var(--danger)'}">${eur(kpi.solde.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- Économie possible -->
    ${kpi.ecoPossible.total !== 0 ? `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header">
        <span class="card-title">💡 Économie possible (théorique)</span>
      </div>
      <div style="display:flex; gap:8px;">
        <div style="flex:1; background:var(--success-bg); border-radius:var(--radius-sm); padding:12px; text-align:center;">
          <div style="font-size:0.72rem; font-weight:600; color:var(--success); margin-bottom:4px;">${escHtml(p1Name)}</div>
          <div style="font-size:1.1rem; font-weight:800; color:var(--success);">${eur(kpi.ecoPossible.p1)}</div>
        </div>
        <div style="flex:1; background:var(--success-bg); border-radius:var(--radius-sm); padding:12px; text-align:center;">
          <div style="font-size:0.72rem; font-weight:600; color:var(--success); margin-bottom:4px;">${escHtml(p2Name)}</div>
          <div style="font-size:1.1rem; font-weight:800; color:var(--success);">${eur(kpi.ecoPossible.p2)}</div>
        </div>
      </div>
      <div style="text-align:center; margin-top:8px; font-size:0.75rem; color:var(--text-3);">
        Sans imprévus ni achats exceptionnels
      </div>
    </div>
    ` : ''}

    <!-- Notes du mois -->
    ${md.notes ? `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title" style="margin-bottom:6px;">📝 Notes</div>
      <p style="font-size:0.875rem; color:var(--text-2); white-space:pre-wrap;">${escHtml(md.notes)}</p>
    </div>
    ` : ''}

    <div style="height:16px;"></div>
  `;

  // ── Événements ──
  container.querySelector('#prev-month')?.addEventListener('click', () => {
    const { year: y, month: m } = addMonth(State.year, State.month, -1);
    State.year  = y;
    State.month = m;
    render(container);
  });

  container.querySelector('#next-month')?.addEventListener('click', () => {
    const { year: y, month: m } = addMonth(State.year, State.month, 1);
    State.year  = y;
    State.month = m;
    render(container);
  });

  container.querySelector('#btn-go-saisie')?.addEventListener('click', () => {
    navigateTo('saisie');
  });
}

function buildRow(label, kpiObj) {
  return `<tr>
    <td>${label}</td>
    <td style="text-align:right">${eur(kpiObj?.p1 ?? 0)}</td>
    <td style="text-align:right">${eur(kpiObj?.p2 ?? 0)}</td>
    <td style="text-align:right">${eur(kpiObj?.total ?? 0)}</td>
  </tr>`;
}
