// ============================================================
// js/ui/stats.js – Page statistiques & graphiques
// ============================================================

import { State }                                          from '../app.js';
import { getMonthsByYear, getAllCharges,
         getMonthlyData, getChargesForMonth,
         getAchatsForMonth, getRepartition, getBudgetOpsForMonth,
         getAllSettings, getAvailableYears,
         getActiveUsers, getAllUsers,
         getAllSavingsOperations, getLatestSavingsConfirmed, getAllSavingsConfirmed, getAllRepartitions,
         getAllAchats, getAllBudgetOps }                     from '../db.js';
import { calcMonth, calcYear, calcSavingsBalance, calcBudgetScore } from '../calculs.js';
import { resolveLineAmount, resolveChargeAmount }           from '../db.js';
import { eur, pct, nomMoisCourt, escHtml, showToast,
         downloadBlob, buildCSV, MOIS_COURT, MOIS,
         getCategoryInfo, CATEGORIES }                      from '../utils.js';

let _charts = [];
let _statsTab  = 'revenus'; // 'revenus' | 'epargne' | 'depenses' | 'evolution'
let _statsMonth = 0;        // 0 = toute l'année, 1-12 = mois précis
let _lastDisplayResults = null; // FM-3 : cache pour export CSV

export async function render(container) {
  const [s, users, allUsers] = await Promise.all([getAllSettings(), getActiveUsers(), getAllUsers()]);

  const years = await getAvailableYears();
  if (!years.includes(State.year) && years.length) State.year = years[years.length - 1];

  container.innerHTML = `
    <!-- Sélecteur année + mois -->
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
      <select class="form-select" id="year-select" style="flex:1.2;">
        ${years.map(y => `<option value="${y}" ${y === State.year ? 'selected' : ''}>${y}</option>`).join('')}
        ${!years.length ? '<option value="">Aucune donnée</option>' : ''}
      </select>
      <select class="form-select" id="month-select" style="flex:1;">
        <option value="0" ${_statsMonth === 0 ? 'selected' : ''}>Année entière</option>
        ${['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'].map((m,i) =>
          `<option value="${i+1}" ${_statsMonth === i+1 ? 'selected' : ''}>${m}</option>`).join('')}
      </select>
      <button class="btn btn-outline btn-sm" id="btn-export-pdf">📄 PDF</button>
      <button class="btn btn-outline btn-sm" id="btn-export-csv">📊 CSV</button>
    </div>

    <!-- Auto-insights -->
    <div id="insights-panel" style="margin-bottom:12px;"></div>

    <!-- KPIs annuels -->
    <div id="kpi-annuel" class="kpi-grid" style="margin-bottom:12px;">
      <div class="loading"><div class="spinner"></div></div>
    </div>

    <!-- Onglets stats -->
    <div class="tabs" id="stats-tabs" style="margin-bottom:12px;">
      <button class="tab-btn ${_statsTab === 'revenus'    ? 'active' : ''}" data-stab="revenus">📊 Revenus</button>
      <button class="tab-btn ${_statsTab === 'epargne'    ? 'active' : ''}" data-stab="epargne">💰 Épargne</button>
      <button class="tab-btn ${_statsTab === 'depenses'   ? 'active' : ''}" data-stab="depenses">💸 Dépenses</button>
      <button class="tab-btn ${_statsTab === 'evolution'  ? 'active' : ''}" data-stab="evolution">📈 Évolution</button>
    </div>

    <!-- Onglet Revenus -->
    <div id="stab-revenus" style="${_statsTab !== 'revenus' ? 'display:none;' : ''}">
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header"><span class="card-title">📊 Revenus vs Dépenses</span></div>
        <div class="chart-wrap" style="height:200px;"><canvas id="chart-rev-dep"></canvas></div>
      </div>
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header"><span class="card-title">💰 Revenus, Aides & Primes</span></div>
        <div class="chart-wrap" style="height:200px;"><canvas id="chart-rev-primes"></canvas></div>
      </div>
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header">
          <span class="card-title">🔄 Comparaison N-1</span>
          <span class="chip" style="font-size:0.7rem;">${State.year - 1} vs ${State.year}</span>
        </div>
        <div id="n1-content"><div class="loading"><div class="spinner"></div></div></div>
      </div>
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header">
          <span class="card-title">📋 Détail mensuel ${State.year}</span>
        </div>
        <div id="table-mensuel" style="overflow-x:auto;">
          <div class="loading"><div class="spinner"></div></div>
        </div>
      </div>
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header"><span class="card-title">📈 Tendances charges</span></div>
        <div class="chart-wrap" style="height:220px;"><canvas id="chart-tendances"></canvas></div>
      </div>
    </div>

    <!-- Onglet Épargne -->
    <div id="stab-epargne" style="${_statsTab !== 'epargne' ? 'display:none;' : ''}">
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header"><span class="card-title">📈 Épargne mensuelle, cumulée & taux</span></div>
        <div class="chart-wrap" style="height:220px;"><canvas id="chart-epargne"></canvas></div>
      </div>
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header">
          <span class="card-title">💰 Évolution du solde épargne</span>
          <label style="display:flex;align-items:center;gap:5px;font-size:0.75rem;cursor:pointer;">
            <input type="checkbox" id="toggle-amounts" checked> Montants
          </label>
        </div>
        <div class="chart-wrap" style="height:180px;"><canvas id="chart-savings-balance"></canvas></div>
      </div>
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header"><span class="card-title">📈 Projection épargne</span></div>
        <div id="stats-projection"><div class="loading"><div class="spinner"></div></div></div>
      </div>
    </div>

    <!-- Onglet Dépenses -->
    <div id="stab-depenses" style="${_statsTab !== 'depenses' ? 'display:none;' : ''}">
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header"><span class="card-title">🥧 Répartition des dépenses</span></div>
        <div class="chart-wrap" style="height:220px;display:flex;align-items:center;justify-content:center;">
          <canvas id="chart-repartition" style="max-width:220px;max-height:220px;"></canvas>
        </div>
      </div>
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header"><span class="card-title">🏷️ Répartition des charges fixes</span></div>
        <div class="chart-wrap" style="height:220px;display:flex;align-items:center;justify-content:center;">
          <canvas id="chart-charges-cat" style="max-width:220px;max-height:220px;"></canvas>
        </div>
      </div>
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header"><span class="card-title">📅 Comparaison mois similaires</span></div>
        <div id="stats-month-compare"><div class="loading"><div class="spinner"></div></div></div>
      </div>
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header"><span class="card-title">🎯 Score budgétaire mensuel</span></div>
        <div id="stats-score"><div class="loading"><div class="spinner"></div></div></div>
      </div>
    </div>

    <div id="stab-evolution" style="${_statsTab !== 'evolution' ? 'display:none;' : ''}">
      <div id="evolution-content"><div class="loading"><div class="spinner"></div></div></div>
    </div>



    <div style="height:16px;"></div>
  `;

  await loadAndRender(container, State.year, _statsMonth, users, s);

  container.querySelector('#year-select')?.addEventListener('change', async (e) => {
    State.year = Number(e.target.value);
    destroyCharts();
    await loadAndRender(container, State.year, _statsMonth, users, s);
  });

  container.querySelector('#month-select')?.addEventListener('change', async (e) => {
    _statsMonth = Number(e.target.value);
    destroyCharts();
    await loadAndRender(container, State.year, _statsMonth, users, s);
  });

  container.querySelector('#btn-export-pdf')?.addEventListener('click', () => {
    exportPDF(State.year, _statsMonth, users, s);
  });

  container.querySelector('#btn-export-csv')?.addEventListener('click', () => {
    exportTableCSV(State.year, _statsMonth, users);
  });

  container.querySelector('#toggle-amounts')?.addEventListener('change', (e) => {
    const chart = _charts.find(c => c.canvas?.id === 'chart-savings-balance');
    if (chart) {
      chart.options.plugins.datalabels = { display: e.target.checked };
      chart.update();
    }
  });

  // Onglets
  container.querySelectorAll('#stats-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('#stats-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _statsTab = btn.dataset.stab;
      ['revenus', 'epargne', 'depenses', 'evolution'].forEach(t => {
        const el = container.querySelector(`#stab-${t}`);
        if (el) el.style.display = t === _statsTab ? '' : 'none';
      });
      if (_statsTab === 'evolution') {
        _renderEvolution(container, State.year, users);
      }
    });
  });

  return () => destroyCharts();
}

async function loadAndRender(container, year, month, users, s) {
  // Charger toutes les données en parallèle
  const [monthsData, allChargesRaw, allAchats, allRepartitions, allBudgetOpsYear, allSavingsOps, allSavingsConfirmed] = await Promise.all([
    getMonthsByYear(year),
    getAllCharges(),
    getAllAchats(),
    getAllRepartitions(),
    getAllBudgetOps(),
    getAllSavingsOperations(),
    getAllSavingsConfirmed(),
  ]);
  const bopsMap = {};
  for (const op of allBudgetOpsYear) { if (op.year === year) { (bopsMap[op.month] ??= []).push(op); } }

  const monthMap  = Object.fromEntries(monthsData.map(m => [m.month, m]));
  const achatMap  = {};
  const repartMap = {};
  for (const a of allAchats)      { if (a.year === year) { (achatMap[a.month] ??= []).push(a); } }
  for (const r of allRepartitions){ if (r.year === year) repartMap[r.month] = r; }

  const defaultRepartMode = s.defaultRepartMode ?? 'separe';
  function chargesForMonth(m) {
    const out = [];
    for (const c of allChargesRaw) {
      if (!c.active) continue;
      // Nouveau modèle : charge liée à une année+mois précis
      if (c.year != null && c.month != null) {
        if (c.year !== year || c.month !== m) continue;
      } else {
        // Modèle legacy : filtrage par liste de mois
        const ok = c.months === 'all' || (Array.isArray(c.months) && c.months.includes(m));
        if (!ok) continue;
      }
      if (c.lines?.length) {
        for (const l of c.lines) {
          const amt = resolveLineAmount(l, c, year, m);
          out.push({ ...c, amount: amt, qui: l.qui ?? 'shared', dayOfMonth: l.dayOfMonth ?? null });
        }
      } else {
        const amt = resolveChargeAmount(c, year, m);
        out.push({ ...c, amount: amt, qui: c.qui ?? 'shared' });
      }
    }
    return out;
  }

  // Calculer tous les mois, puis filtrer si un mois précis est sélectionné
  const results = [];
  const chargesByMonth = []; // charges expanded par mois (index 0 = mois 1)
  for (let m = 1; m <= 12; m++) {
    const md  = monthMap[m] ?? null;
    const chg = chargesForMonth(m);
    chargesByMonth.push(chg);
    const ach = achatMap[m]  ?? [];
    const rp  = repartMap[m] ?? { year, month: m, mode: defaultRepartMode, pcts: {} };
    results.push(md ? calcMonth(md, chg, ach, rp, users, bopsMap[m] ?? []) : null);
  }

  const now      = new Date();
  const curYear  = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  // Mode mois unique
  const singleMonth = month > 0;
  const displayResults = singleMonth
    ? results.map((r, i) => (i + 1) === month ? r : null)
    : results.map((r, i) => {
        if (year < curYear) return r;
        if (year > curYear) return null;
        return (i + 1) > curMonth ? null : r;
      });

  const kpiMonths    = (singleMonth ? results.filter((r, i) => (i + 1) === month) : results).filter(Boolean);
  const yearKPI     = calcYear(kpiMonths);
  const nMonths     = kpiMonths.length || 1;

  // Épargne réelle = somme signée des savings_operations de l'année
  // On exclut les 'initial_balance' (solde de départ, pas une épargne de la période)
  const yearSavingsOps   = allSavingsOps.filter(op =>
    op.year === year &&
    (!singleMonth || op.month === month) &&
    op.type !== 'initial_balance'
  );
  const realSavingsTotal = yearSavingsOps.reduce((s, op) => s + (Number(op.amount) || 0), 0);

  // ── Taux d'épargne réel par mois (savings_ops / revenus) ──
  // Si aucune donnée savings, on garde le taux de reste-à-vivre (solde/revenus) comme fallback.
  const mSavingsMap = {};
  for (const op of allSavingsOps) {
    if (op.year === year && op.type !== 'initial_balance') {
      mSavingsMap[op.month] = (mSavingsMap[op.month] || 0) + (Number(op.amount) || 0);
    }
  }
  const hasSavingsData = Object.keys(mSavingsMap).length > 0;

  // Résultats augmentés : txEpargne.total patché mois par mois
  // Si savings_ops existent pour ce mois → taux réel (versements/revenus)
  // Sinon → fallback reste-à-vivre (solde/revenus) inchangé
  const augResults = results.map((r, i) => {
    if (!r) return null;
    const m = i + 1;
    if (mSavingsMap[m] !== undefined) {
      const rev = (r.revenus?.total ?? 0) + (r.primes?.total ?? 0) + (r.aides?.total ?? 0);
      const realTx = rev > 0 ? mSavingsMap[m] / rev : 0;
      return { ...r, txEpargne: { ...r.txEpargne, total: realTx } };
    }
    return r; // pas de données épargne ce mois → garde le taux de reste-à-vivre
  });

  // displayResults dérivé des augResults
  const augDisplayResults = singleMonth
    ? augResults.map((r, i) => (i + 1) === month ? r : null)
    : augResults.map((r, i) => {
        if (year < curYear) return r;
        if (year > curYear) return null;
        return (i + 1) > curMonth ? null : r;
      });

  renderKPIAnnuel(container, yearKPI, singleMonth ? MOIS[month - 1] : null, nMonths, realSavingsTotal);
  destroyCharts();
  renderChartRevDep(displayResults);
  renderChartRevPrimes(displayResults, users);
  await renderChartEpargne(augDisplayResults, year, allSavingsOps, allSavingsConfirmed, curYear, curMonth);
  await renderChartSavingsBalance(year, curYear, curMonth, users, allSavingsConfirmed);
  const yearBudgetOps = singleMonth ? (bopsMap[month] ?? []) : Object.values(bopsMap).flat();
  renderChartRepartition(yearKPI, yearBudgetOps, s);
  renderChartChargesCat(chargesByMonth);
  renderChartTendances(results, chargesByMonth);
  renderTableMensuel(container, augDisplayResults);
  await renderN1Comparison(container, year, users, s, displayResults, allBudgetOpsYear);
  await renderProjectionEpargne(container, year, curYear, curMonth);
  await renderMonthCompare(container, year, month > 0 ? month : curMonth, users, s, allChargesRaw, allAchats, allRepartitions, monthMap, allBudgetOpsYear);
  renderScoreBudgetaire(container, singleMonth ? augResults[month - 1] : augResults[curMonth - 1], s);
  _lastDisplayResults = augDisplayResults; // FM-3: cache pour export CSV
  renderInsights(container, augResults, singleMonth ? month : curMonth, year, s);
}

async function _renderDetailTab(container, year, month, users) {
  const wrap = container.querySelector('#detail-month-content');
  if (!wrap) return;
  if (month === 0) {
    wrap.innerHTML = `<div style="padding:32px 0;text-align:center;"><div style="font-size:2rem;margin-bottom:8px;">🗓️</div><div style="font-weight:700;font-size:0.92rem;margin-bottom:6px;">Sélectionnez un mois</div><div style="font-size:0.78rem;color:var(--text-3);">Choisissez un mois dans le sélecteur ci-dessus pour voir le détail.</div></div>`;
    return;
  }
  wrap.innerHTML = `<div class="loading" style="padding:32px;text-align:center;"><div class="spinner"></div></div>`;
  const [md, charges, achats, repCfg, budgetOps, settings] = await Promise.all([
    getMonthlyData(year, month),
    getChargesForMonth(month, year),
    getAchatsForMonth(year, month),
    getRepartition(year, month),
    getBudgetOpsForMonth(year, month),
    getAllSettings(),
  ]);
  if (!md) {
    wrap.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-3);font-size:0.85rem;">Aucune donnée pour ${MOIS[month - 1]} ${year}.</div>`;
    return;
  }
  const kpiPrev = calcMonth(md, charges, achats, repCfg, users);
  const today = new Date();
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;
  const chargesReel = isCurrentMonth ? charges.filter(c => (c.dayOfMonth || 1) <= today.getDate()) : charges;
  const kpiReel = calcMonth(md, chargesReel, achats, repCfg, users, budgetOps);
  const realCourses = budgetOps.filter(o => o.category === 'courses').reduce((s, o) => s + (Number(o.amount) || 0), 0);
  const realExtras  = budgetOps.filter(o => o.category === 'extras').reduce((s, o) => s + (Number(o.amount) || 0), 0);
  let detailMode = 'previsionnel';

  function buildRow(label, cat) {
    if (!cat) return '';
    return `<tr><td>${escHtml(label)}</td>${users.map(u => `<td style="text-align:right">${eur(cat.byUser?.[String(u.id)] ?? 0)}</td>`).join('')}<td style="text-align:right">${eur(cat.total)}</td></tr>`;
  }

  function renderTable() {
    const isReel = detailMode === 'reel';
    const dk = isReel ? kpiReel : kpiPrev;
    const courses = isReel ? realCourses : kpiPrev.courses.total;
    const extras  = isReel ? realExtras  : kpiPrev.extras.total;
    return `<div style="overflow-x:auto;"><table class="data-table">
      <thead><tr>
        <th>Catégorie</th>
        ${users.map(u => `<th style="text-align:right"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${escHtml(u.color || '#7C5CFC')};margin-right:3px;"></span>${escHtml(u.name)}</th>`).join('')}
        <th style="text-align:right">Total</th>
      </tr></thead>
      <tbody>
        ${buildRow('Revenus & Aides', dk.revenus)}
        ${(dk.aides?.total ?? 0) > 0 ? buildRow('Aides', dk.aides) : ''}
        ${buildRow('Primes', dk.primes)}
        ${buildRow('Charges', dk.charges)}
        ${courses > 0 ? `<tr><td>${isReel ? 'Courses (confirmé)' : 'Budget courses'}</td>${users.map(u => `<td style="text-align:right">${eur(dk.courses.byUser?.[String(u.id)] ?? 0)}</td>`).join('')}<td style="text-align:right">${eur(courses)}</td></tr>` : ''}
        ${extras > 0 ? `<tr><td>${isReel ? 'Loisirs (confirmé)' : 'Budget loisirs'}</td>${users.map(u => `<td style="text-align:right">${eur(dk.extras.byUser?.[String(u.id)] ?? 0)}</td>`).join('')}<td style="text-align:right">${eur(extras)}</td></tr>` : ''}
        ${buildRow('Dép. ponctuelles', dk.achats ?? {total:0,byUser:{}})}
        ${buildRow('Imprévus', dk.imprevus ?? {total:0,byUser:{}})}
        ${(settings.customBudgets || []).map(b => {
          const spent = budgetOps.filter(o => o.category === b.id).reduce((s, o) => s + (Number(o.amount) || 0), 0);
          const label = `${b.icon || '📌'} ${b.name}`;
          return `<tr><td>${escHtml(label)}</td>${users.map(() => '<td></td>').join('')}<td style="text-align:right">${eur(spent)}</td></tr>`;
        }).join('')}
      </tbody>
      <tfoot>
        <tr class="row-total"><td>${isReel ? 'À payer' : 'À envoyer (prév.)'}</td>${users.map(u => `<td style="text-align:right">${eur(dk.aPayer.byUser?.[String(u.id)] ?? 0)}</td>`).join('')}<td style="text-align:right">${eur(dk.aPayer.total)}</td></tr>
        <tr class="row-total"><td>Solde ${isReel ? 'net' : 'prévisionnel'}</td>${users.map(u => { const v = dk.solde.byUser?.[String(u.id)] ?? 0; return `<td style="text-align:right;color:${v >= 0 ? 'var(--success)' : 'var(--danger)'}">${eur(v)}</td>`; }).join('')}<td style="text-align:right;color:${dk.solde.total >= 0 ? 'var(--success)' : 'var(--danger)'}">${eur(dk.solde.total)}</td></tr>
      </tfoot>
    </table></div>
    ${!isReel ? `<p style="font-size:0.72rem;color:var(--text-3);margin-top:8px;padding:0 2px;">💡 Ce calcul utilise les plafonds de budget et la répartition configurée. Il représente le maximum à envoyer sur le compte joint.</p>` : ''}`;
  }

  wrap.innerHTML = `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header" style="flex-wrap:wrap;gap:6px;">
        <span class="card-title">📋 Détail ${escHtml(MOIS[month - 1])} ${year}</span>
        <div style="margin-left:auto;display:flex;gap:4px;">
          <button class="btn btn-sm detail-dmode ${detailMode === 'reel' ? 'btn-primary' : 'btn-outline'}" data-dmode="reel" style="font-size:0.68rem;padding:2px 8px;">✅ Réel</button>
          <button class="btn btn-sm detail-dmode ${detailMode === 'previsionnel' ? 'btn-primary' : 'btn-outline'}" data-dmode="previsionnel" style="font-size:0.68rem;padding:2px 8px;">📅 Prévisionnel</button>
        </div>
      </div>
      <p id="detail-hint" style="font-size:0.72rem;color:var(--text-3);margin-bottom:8px;">📅 Simulation avec tous les budgets et charges du mois configurés</p>
      <div id="stats-detail-table">${renderTable()}</div>
    </div>
    ${users.length >= 2 ? `<div class="card" style="margin-bottom:12px;">
      <div class="card-header"><span class="card-title">⚖️ Répartition prévue</span></div>
      <div style="display:grid;gap:8px;margin-top:4px;">
        ${users.map(u => `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--bg-2);border-radius:var(--radius-sm);"><div style="display:flex;align-items:center;gap:8px;"><span style="width:9px;height:9px;border-radius:50%;background:${escHtml(u.color || '#6C63FF')};display:inline-block;"></span><span style="font-size:0.88rem;font-weight:600;">${escHtml(u.name)}</span></div><div style="text-align:right;"><div style="font-size:1rem;font-weight:800;color:var(--primary);">${eur(kpiPrev.aPayer.byUser?.[String(u.id)] ?? 0)}</div><div style="font-size:0.62rem;color:var(--text-3);">\u00e0 envoyer</div></div></div>`).join('')}
      </div>
    </div>` : ''}
  `;

  wrap.onclick = e => {
    const btn = e.target.closest('.detail-dmode');
    if (!btn) return;
    detailMode = btn.dataset.dmode;
    wrap.querySelectorAll('.detail-dmode').forEach(b => {
      b.classList.toggle('btn-primary', b.dataset.dmode === detailMode);
      b.classList.toggle('btn-outline',  b.dataset.dmode !== detailMode);
    });
    const hint = wrap.querySelector('#detail-hint');
    if (hint) hint.textContent = detailMode === 'reel'
      ? '✅ Opérations confirmées + charges dont la date de prélèvement est passée'
      : '📅 Simulation avec tous les budgets et charges du mois configurés';
    wrap.querySelector('#stats-detail-table').innerHTML = renderTable();
  };
}

function renderKPIAnnuel(container, kpi, monthLabel = null, nMonths = 12, realSavingsTotal = null) {
  const el = container.querySelector('#kpi-annuel');
  if (!el || !kpi) {
    if (el) el.innerHTML = `<div style="grid-column:span 2;text-align:center;color:var(--text-3);padding:20px;">Aucune donnée${monthLabel ? ' pour ' + monthLabel : ' pour cette année'}</div>`;
    return;
  }
  const n = nMonths || 1;
  const epargneAffiche = realSavingsTotal !== null ? realSavingsTotal : (kpi.epargne?.total ?? 0);
  el.innerHTML = `
    <div class="kpi-card primary">
      <div class="kpi-label">Revenus annuels</div>
      <div class="kpi-value neutral">${eur(kpi.revenus.total + (kpi.aides?.total ?? 0) + kpi.primes.total)}</div>
      <div class="kpi-sub">dont aides: ${eur(kpi.aides?.total ?? 0)} · primes: ${eur(kpi.primes.total)}</div>
    </div>
    <div class="kpi-card danger">
      <div class="kpi-label">Dépenses totales</div>
      <div class="kpi-value neutral">${eur(kpi.depensesReelles?.total ?? kpi.depenses.total)}</div>
      <div class="kpi-sub">dont charges : ${eur(kpi.charges.total)} · achats : ${eur(kpi.achats?.total ?? 0)}</div>
    </div>
    <div class="kpi-card danger">
      <div class="kpi-label">Moy. mensuelle dépensés</div>
      <div class="kpi-value neutral">${eur((kpi.depensesReelles?.total ?? kpi.depenses.total) / n)}</div>
      <div class="kpi-sub">sur ${n} mois · total : ${eur(kpi.depensesReelles?.total ?? kpi.depenses.total)}</div>
    </div>
    <div class="kpi-card warning">
      <div class="kpi-label">Moy. mensuelle épargnée</div>
      <div class="kpi-value neutral">${eur(epargneAffiche / n)}</div>
      <div class="kpi-sub">sur ${n} mois · total épargné : ${eur(epargneAffiche)}</div>
    </div>
  `;
}

function renderChartRevDep(displayResults) {
  const canvas = document.getElementById('chart-rev-dep');
  if (!canvas) return;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Graphique barres : revenus et dépenses mensuels');
  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: MOIS_COURT,
      datasets: [
        { label: 'Revenus + Aides + Primes', data: displayResults.map(r => r ? r.revenus.total + (r.aides?.total ?? 0) + r.primes.total : 0), backgroundColor: 'rgba(108,99,255,0.7)', borderRadius: 4 },
        { label: 'Dépenses',                  data: displayResults.map(r => r ? (r.depensesReelles?.total ?? r.depenses.total) : 0),                                                    backgroundColor: 'rgba(255,71,87,0.7)',  borderRadius: 4 },
      ],
    },
    options: chartOptions({}),
  });
  _charts.push(chart);
}

function renderChartRevPrimes(displayResults, users = []) {
  const canvas = document.getElementById('chart-rev-primes');
  if (!canvas) return;

  const userDatasets = users.length > 1 ? users.flatMap(u => [
    {
      type: 'line',
      label: `Revenus ${escHtml(u.name)}`,
      data: displayResults.map(r => r ? (r.revenus.byUser?.[String(u.id)] ?? 0) : null),
      borderColor: u.color || '#6C63FF',
      backgroundColor: 'transparent',
      borderWidth: 2, pointRadius: 3, tension: 0.3, spanGaps: false,
    },
  ]) : [];

  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Graphique barres : revenus et primes mensuels');
  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: MOIS_COURT,
      datasets: [
        { label: 'Revenus total',   data: displayResults.map(r => r ? r.revenus.total : 0),             backgroundColor: 'rgba(108,99,255,0.7)', borderRadius: 4 },
        { label: 'Aides total',     data: displayResults.map(r => r ? (r.aides?.total ?? 0) : 0),       backgroundColor: 'rgba(0,200,200,0.6)',   borderRadius: 4 },
        { label: 'Primes total',    data: displayResults.map(r => r ? r.primes.total  : 0),             backgroundColor: 'rgba(0,200,150,0.65)', borderRadius: 4 },
        ...userDatasets,
      ],
    },
    options: chartOptions({ stacked: false }),
  });
  _charts.push(chart);
}

async function renderChartEpargne(displayResults, year, allOpsParam = null, allConfirmedParam = null, curYear = 0, curMonth = 12) {
  const canvas = document.getElementById('chart-epargne');
  if (!canvas) return;

  const allOps  = allOpsParam  ?? await getAllSavingsOperations();
  const allConf = allConfirmedParam ?? [];

  // Trier les confirmations par (année, mois) croissant
  const sortedConf = [...allConf].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month
  );

  // Construction des deltas de confirmation :
  // Pour chaque paire consécutive (curr → next) :
  //   delta = next.amount − curr.amount, attribué au mois de CURR (le mois source)
  // Exemple : Jan=2100, Fév=2850 → delta 750 affiché dans la barre de Janvier.
  // Le mois NEXT devient un mois "destination" : sa barre reste null (déjà compté).
  const confDeltaMap = {};       // clé "YYYY-M" → delta (affiché dans la barre de ce mois)
  const confDestSet  = new Set();// mois destination → barre null pour éviter le double-comptage
  for (let i = 0; i < sortedConf.length - 1; i++) {
    const curr = sortedConf[i];
    const next = sortedConf[i + 1];
    confDeltaMap[`${curr.year}-${curr.month}`] = next.amount - curr.amount;
    confDestSet.add(`${next.year}-${next.month}`);
  }

  // Flux réels hors initial_balance — fallback pour les mois sans confirmation
  const yearOpsFlow = allOps.filter(op => op.year === year && op.type !== 'initial_balance');

  // ── Barres mensuelles : indépendant du budget (données rétroactives) ──
  // Priorité : delta de confirmation (mois source)
  // Exclusion : mois destination (couvert par le delta du mois source)
  // Fallback  : ops directes (versements/retraits sans confirmation)
  const isFuture = (m) => curYear > 0 && (year > curYear || (year === curYear && m > curMonth));

  const mensuelle = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    if (isFuture(m)) return null;
    const key = `${year}-${m}`;
    if (key in confDeltaMap)  return confDeltaMap[key];
    if (confDestSet.has(key)) return null;
    const mOps = yearOpsFlow.filter(op => op.month === m);
    if (!mOps.length) return null;
    return mOps.reduce((s, op) => s + (Number(op.amount) || 0), 0);
  });

  // ── Courbe cumulée = solde CONFIRMÉ par mois (source de vérité) ──
  // Les ops rétroactives (adjustment) ne sont PAS fiables pour reconstruire l'historique.
  // savings_confirmed[year][month].amount = montant exact confirmé par l'utilisateur.
  const confByMonth = {};
  for (const c of allConf) {
    if (c.year === year) confByMonth[c.month] = c.amount;
  }
  const cumulee = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    if (isFuture(m)) return null;
    return m in confByMonth ? (confByMonth[m] || null) : null;
  });

  // ── Taux d'épargne (0..1 → affiché en %) ──
  // Si un mois n'a pas de revenu de référence → revenus mensuels moyens comme base
  const avgRevenu = (() => {
    const withRev = displayResults.filter(r => r && (r.revenus.total + r.primes.total + r.aides.total) > 0);
    if (!withRev.length) return 0;
    return withRev.reduce((s, r) => s + r.revenus.total + r.primes.total + r.aides.total, 0) / withRev.length;
  })();

  const taux = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    if (isFuture(m)) return null;
    const r   = displayResults[i];
    const rev = r ? (r.revenus.total + r.primes.total + r.aides.total) : 0;
    if (r && rev > 0) return r.txEpargne.total;
    // Fallback : versement du mois / revenus moyens
    const v = mensuelle[i];
    if (v !== null && v !== undefined && avgRevenu > 0) return v / avgRevenu;
    return null;
  });

  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-2').trim() || '#666';
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || 'rgba(0,0,0,0.1)';

  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', "Évolution de l'épargne mensuelle");
  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: MOIS_COURT,
      datasets: [
        {
          type: 'line',
          label: 'Solde épargne',
          data: cumulee,
          borderColor: '#6C63FF',
          backgroundColor: 'rgba(108,99,255,0.15)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          borderWidth: 2,
          yAxisID: 'y',
          spanGaps: false,
          order: 3,
        },
        {
          type: 'bar',
          label: 'Versements mensuels',
          data: mensuelle,
          backgroundColor: mensuelle.map(v => v === null ? 'transparent' : v >= 0 ? 'rgba(0,200,150,0.7)' : 'rgba(255,71,87,0.7)'),
          borderRadius: 4,
          yAxisID: 'y',
          order: 2,
        },
        {
          type: 'line',
          label: "Taux d'épargne",
          data: taux,
          borderColor: '#FFB020',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.3,
          yAxisID: 'y1',
          spanGaps: false,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { padding: 8, font: { size: 10 }, color: textColor } },
        tooltip: {
          callbacks: {
            label: ctx => {
              if (ctx.dataset.yAxisID === 'y1') return `${ctx.dataset.label}: ${pct(ctx.raw, 1)}`;
              return `${ctx.dataset.label}: ${eur(ctx.raw)}`;
            }
          }
        },
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } } },
        y: {
          position: 'left',
          grid: { color: gridColor },
          ticks: { color: textColor, font: { size: 10 }, callback: v => eur(v).replace(/\s€/, '') + '€' },
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: '#FFB020', font: { size: 10 }, callback: v => `${Math.round(v * 100)}%` },
          min: 0,
        },
      },
    },
  });
  _charts.push(chart);
}

async function renderChartSavingsBalance(year, curYear, curMonth, users = [], allConfirmedParam = null) {
  const canvas = document.getElementById('chart-savings-balance');
  if (!canvas) return;

  // Source de vérité : savings_confirmed (immunisé aux biais des ops rétroactives)
  // Un cumsum de savings_operations est faux dès qu'une confirmation rétroactive crée
  // un adjustment dans le passé APRES qu'une initial_balance ait été posée dans le futur.
  const allConf = allConfirmedParam ?? await getAllSavingsConfirmed();
  const confMap = {};
  for (const c of allConf) {
    if (c.year === year) confMap[c.month] = c;
  }

  const pointsByMonth = [];
  const userPoints = {};
  users.forEach(u => { userPoints[String(u.id)] = []; });

  for (let m = 1; m <= 12; m++) {
    if (year > curYear || (year === curYear && m > curMonth)) {
      pointsByMonth.push(null);
      users.forEach(u => userPoints[String(u.id)].push(null));
      continue;
    }
    const conf = confMap[m];
    pointsByMonth.push(conf ? (conf.amount || null) : null);
    users.forEach(u => {
      const perUser = conf?.perUserAmounts ?? {};
      const uBal = perUser[String(u.id)];
      userPoints[String(u.id)].push(uBal != null ? (uBal || null) : null);
    });
  }

  const userDatasets = users.length > 1 ? users.map(u => ({
    label: escHtml(u.name),
    data: userPoints[String(u.id)],
    borderColor: u.color || '#6C63FF',
    backgroundColor: 'transparent',
    borderWidth: 2,
    fill: false,
    tension: 0.3,
    pointRadius: 4,
    pointBackgroundColor: u.color || '#6C63FF',
    spanGaps: false,
  })) : [];

  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Évolution du solde d\'épargne cumulé');
  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: MOIS_COURT,
      datasets: [
        {
          label: 'Total',
          data: pointsByMonth,
          borderColor: '#00C896',
          backgroundColor: 'rgba(0,200,150,0.15)',
          fill: true,
          tension: 0.3,
          pointRadius: 5,
          pointBackgroundColor: pointsByMonth.map(v => v !== null ? '#00C896' : 'transparent'),
          spanGaps: false,
        },
        ...userDatasets,
      ],
    },
    options: {
      ...chartOptions({}),
      plugins: {
        ...chartOptions({}).plugins,
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${eur(ctx.raw)}` } },
      },
    },
  });
  _charts.push(chart);
}

function renderChartChargesCat(chargesByMonth = []) {
  const canvas = document.getElementById('chart-charges-cat');
  if (!canvas) return;

  // Calculer le total par catégorie depuis les charges déjà expandées (filtrées par année)
  const byCat = {};
  for (const monthCharges of chargesByMonth) {
    for (const c of monthCharges) {
      const cat = c.category || 'autre';
      byCat[cat] = (byCat[cat] || 0) + (Number(c.amount) || 0);
    }
  }

  const entries = Object.entries(byCat).filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  if (!entries.length) return;

  const COLORS = ['#6C63FF','#00C896','#FFB020','#FF4757','#8B85FF','#00D2D3','#FF9F43','#EE5A24','#0652DD','#9980FA'];
  const total  = entries.reduce((s, [, v]) => s + v, 0);
  const labels = entries.map(([id]) => { const i = getCategoryInfo(id); return `${i.emoji} ${i.label}`; });
  const data   = entries.map(([, v]) => v);

  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Graphique répartition des charges par catégorie');
  const chart  = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: COLORS.slice(0, entries.length), borderWidth: 0 }],
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: {
        legend: { position: 'bottom', labels: { padding: 10, font: { size: 11 }, color: getComputedStyle(document.documentElement).getPropertyValue('--text').trim() } },
        tooltip: { callbacks: {
          label: ctx => {
            const v = ctx.raw;
            const p = total > 0 ? ((v / total) * 100).toFixed(1) : 0;
            return `${ctx.label}: ${eur(v)} (${p}%)`;
          }
        }},
      },
      cutout: '60%',
    },
  });
  _charts.push(chart);
}

function renderChartRepartition(yearKPI, budgetOps = [], settings = {}) {
  const canvas = document.getElementById('chart-repartition');
  if (!canvas || !yearKPI) return;

  const PALETTE = ['#6C63FF','#00C896','#FFB020','#FF4757','#8B85FF','#00D2D3','#FF9F43','#EE5A24','#0652DD','#9980FA'];
  const segments = [];

  // Charges fixes
  if (yearKPI.charges.total > 0)
    segments.push({ label: 'Charges fixes', value: yearKPI.charges.total });

  // Budgets personnalisés (depuis les ops réelles)
  const customBudgets = settings.customBudgets || [];
  for (const b of customBudgets) {
    const total = budgetOps.filter(op => op.category === b.id).reduce((s, op) => s + (Number(op.amount) || 0), 0);
    if (total > 0) segments.push({ label: b.name || b.id, value: total });
  }

  // Dépenses ponctuelles
  if (yearKPI.achats.total > 0)
    segments.push({ label: 'Dép. ponctuelles', value: yearKPI.achats.total });

  // Imprévus
  if (yearKPI.imprevus.total > 0)
    segments.push({ label: 'Imprévus', value: yearKPI.imprevus.total });

  if (!segments.length) return;

  const labels = segments.map(s => s.label);
  const data   = segments.map(s => s.value);
  const total  = data.reduce((s, v) => s + v, 0);
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Graphique répartition des dépenses annuelles');
  const chart  = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: PALETTE.slice(0, segments.length),
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: {
        legend: { position: 'bottom', labels: { padding: 10, font: { size: 11 }, color: getComputedStyle(document.documentElement).getPropertyValue('--text').trim() } },
        tooltip: { callbacks: {
          label: ctx => {
            const v    = ctx.raw;
            const p    = total > 0 ? ((v / total) * 100).toFixed(1) : 0;
            return `${ctx.label}: ${eur(v)} (${p}%)`;
          }
        }},
      },
      cutout: '60%',
    },
  });
  _charts.push(chart);
}

function renderTableMensuel(container, results) {
  const el = container.querySelector('#table-mensuel');
  if (!el) return;

  const rows = results.map((r, i) => {
    if (!r) return `<tr><td>${MOIS_COURT[i]}</td><td colspan="5" style="text-align:center;color:var(--text-3);">—</td></tr>`;
    const s = r.solde.total;
    return `<tr>
      <td><strong>${MOIS_COURT[i]}</strong></td>
      <td style="text-align:right">${eur(r.revenus.total + r.primes.total)}</td>
      <td style="text-align:right;color:var(--text-2);">${eur(r.charges.total)}</td>
      <td style="text-align:right">${eur(r.depensesReelles?.total ?? r.depenses.total)}</td>
      <td style="text-align:right;color:${s >= 0 ? 'var(--success)' : 'var(--danger)'};font-weight:700;">${eur(s)}</td>
      <td style="text-align:right">${pct(r.txEpargne.total, 0)}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Mois</th>
          <th style="text-align:right">Revenus</th>
          <th style="text-align:right">Charges</th>
          <th style="text-align:right">Dépenses</th>
          <th style="text-align:right">Solde</th>
          <th style="text-align:right">Tx ép.</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}


async function exportPDF(year, month, users, s) {
  showToast('Génération du PDF…', 'success');
  try {
    const monthsData  = await getMonthsByYear(year);
    const monthMap    = Object.fromEntries(monthsData.map(m => [m.month, m]));
    const allAchats   = await getAllAchats();
    const allChargesR = await getAllCharges();
    const allRep      = await getAllRepartitions();
    const defaultMode = s?.defaultRepartMode ?? 'separe';
    const achatMap = {}, repartMap = {};
    for (const a of allAchats)  { if (a.year === year) { (achatMap[a.month] ??= []).push(a); } }
    for (const r of allRep)     { if (r.year === year) repartMap[r.month] = r; }
    // Charger les budget_ops de l'année pour les calculs PDF
    const allBudgetOpsPDF = await getAllBudgetOps();
    const bopsMapPDF = {};
    for (const op of allBudgetOpsPDF) { if (op.year === year) { (bopsMapPDF[op.month] ??= []).push(op); } }

    function chgForMonth(m) {
      const out = [];
      for (const c of allChargesR) {
        if (!c.active) continue;
        // BC-4 : nouveau modèle charge liée à une année+mois précis
        if (c.year != null && c.month != null) {
          if (c.year !== year || c.month !== m) continue;
        } else {
          // Modèle legacy : filtrage par liste de mois
          const ok = c.months === 'all' || (Array.isArray(c.months) && c.months.includes(m));
          if (!ok) continue;
        }
        if (c.lines?.length) { for (const l of c.lines) out.push({ ...c, amount: Number(l.amount)||0, qui: l.qui??'shared', dayOfMonth: l.dayOfMonth ?? null }); }
        else { out.push({ ...c, qui: c.qui ?? 'shared' }); }
      }
      return out;
    }

    const allResults = [];
    for (let m = 1; m <= 12; m++) {
      const md  = monthMap[m] ?? null;
      const chg = chgForMonth(m);
      const ach = achatMap[m] ?? [];
      const rp  = repartMap[m] ?? { year, month: m, mode: defaultMode, pcts: {} };
      allResults.push(md ? calcMonth(md, chg, ach, rp, users, bopsMapPDF[m] ?? []) : null);
    }

    const singleMonth = month > 0;
    const months      = singleMonth ? [month] : Array.from({length:12},(_,i)=>i+1);
    const kpiSource   = singleMonth ? [allResults[month-1]].filter(Boolean) : allResults.filter(Boolean);
    const yearKPI     = calcYear(kpiSource);

    const MOIS_FULL  = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
    const MOIS_SHORT = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
    const periodLabel = singleMonth ? MOIS_FULL[month-1] + ' ' + year : 'Année ' + year;

    const fmt    = v => { const n=Number(v)||0; return (n<0?'−':'')+Math.abs(n).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})+' €'; };
    const fmtPct = v => (Number(v)*100).toFixed(1)+' %';
    const clr    = v => Number(v)>=0?'#10B981':'#EF4444';
    const esc    = escHtml;
    const genDate = new Date().toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'});

    // Score budgétaire
    const refR = singleMonth ? allResults[month-1] : (allResults[new Date().getMonth()] ?? allResults.filter(Boolean).pop());
    let scoreVal=0, scoreColor='#EF4444', scoreLabel='À améliorer';
    if (refR) {
      const tx=refR.txEpargne?.total??0, thr=Number(s?.epargneThreshold)||100;
      const pts=(tx>=0.35?40:tx>=0.05?25:tx>0?10:0)+(refR.solde.total>=thr?20:refR.solde.total>=0?10:0);
      scoreVal=Math.min(100,pts+20);
      scoreColor=scoreVal>=75?'#10B981':scoreVal>=50?'#F59E0B':'#EF4444';
      scoreLabel=scoreVal>=75?'Excellent':scoreVal>=50?'Satisfaisant':'À améliorer';
    }
    const circ=(2*Math.PI*26), dashOff=(circ-(scoreVal/100)*circ).toFixed(2);

    // Sparklines SVG
    const sparkData = allResults.map(r=>r?.solde?.total??null);
    const nonNull   = sparkData.filter(v=>v!==null);
    let sparkSVG='', txSparkSVG='';
    if (!singleMonth && nonNull.length>1) {
      const W=300,H=56,pad=6;
      const sMin=Math.min(...nonNull,0), sMax=Math.max(...nonNull,1);
      const toX=i=>pad+i*((W-2*pad)/11);
      const toY=v=>H-pad-((v-sMin)/(sMax-sMin||1))*(H-2*pad);
      const pts=sparkData.map((v,i)=>v!==null?`${toX(i).toFixed(1)},${toY(v).toFixed(1)}`:null).filter(Boolean);
      const zerY=toY(0).toFixed(1);
      const fi=sparkData.findIndex(v=>v!==null), li=sparkData.map((v,i)=>v!==null?i:-1).filter(i=>i>=0).pop();
      const area=`M${toX(fi).toFixed(1)},${zerY} `+pts.map((p,i)=>(i===0?'L':'')+p).join(' ')+` L${toX(li).toFixed(1)},${zerY} Z`;
      sparkSVG=`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6C63FF" stop-opacity=".25"/><stop offset="100%" stop-color="#6C63FF" stop-opacity=".02"/></linearGradient></defs><path d="${area}" fill="url(#sg)"/><polyline points="${pts.join(' ')}" fill="none" stroke="#6C63FF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${sparkData.map((v,i)=>v!==null?`<circle cx="${toX(i).toFixed(1)}" cy="${toY(v).toFixed(1)}" r="3" fill="#6C63FF"/>`:'').filter(Boolean).join('')}</svg>`;
      const txData=allResults.map(r=>r?.txEpargne?.total??null), txNN=txData.filter(v=>v!==null);
      if (txNN.length>1) {
        const tMin=Math.min(...txNN,0), tMax=Math.max(...txNN,0.4);
        const tyY=v=>H-pad-((v-tMin)/(tMax-tMin||0.01))*(H-2*pad);
        const tpts=txData.map((v,i)=>v!==null?`${toX(i).toFixed(1)},${tyY(v).toFixed(1)}`:null).filter(Boolean);
        const tfi=txData.findIndex(v=>v!==null), tli=txData.map((v,i)=>v!==null?i:-1).filter(i=>i>=0).pop();
        const tzerY=tyY(0).toFixed(1), tarea=`M${toX(tfi).toFixed(1)},${tzerY} `+tpts.map((p,i)=>(i===0?'L':'')+p).join(' ')+` L${toX(tli).toFixed(1)},${tzerY} Z`;
        const obj35Y=tyY(0.35).toFixed(1);
        txSparkSVG=`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#10B981" stop-opacity=".25"/><stop offset="100%" stop-color="#10B981" stop-opacity=".02"/></linearGradient></defs><line x1="${pad}" y1="${obj35Y}" x2="${(W-pad).toFixed(1)}" y2="${obj35Y}" stroke="#F59E0B" stroke-width="1" stroke-dasharray="4,3"/><path d="${tarea}" fill="url(#tg)"/><polyline points="${tpts.join(' ')}" fill="none" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${txData.map((v,i)=>v!==null?`<circle cx="${toX(i).toFixed(1)}" cy="${tyY(v).toFixed(1)}" r="3" fill="${v>=0.35?'#10B981':'#F59E0B'}"/>`:'').filter(Boolean).join('')}</svg>`;
      }
    }

    // Barres revenus vs dépenses
    const barRows=months.map(m=>{ const r=allResults[m-1]; if(!r) return null; return { lbl:MOIS_SHORT[m-1], rev:r.revenus.total+(r.aides?.total??0)+r.primes.total, dep:r.depensesReelles?.total??r.depenses.total, solde:r.solde.total }; }).filter(Boolean);
    const maxBarVal=Math.max(...barRows.map(b=>Math.max(b.rev,b.dep)),1);
    const barChartRows=barRows.map(b=>{ const rw=Math.round((b.rev/maxBarVal)*260), dw=Math.round((b.dep/maxBarVal)*260); return `<tr><td style="font-size:9.5px;font-weight:600;color:#64748B;width:30px;padding:2px 6px 2px 0;">${b.lbl}</td><td style="padding:2px 0;"><div style="height:9px;background:#EEF2FF;border-radius:5px;overflow:hidden;margin-bottom:2px;"><div style="height:9px;width:${rw}px;background:linear-gradient(90deg,#4F46E5,#8B85FF);border-radius:5px;"></div></div><div style="height:9px;background:#FEF2F2;border-radius:5px;overflow:hidden;"><div style="height:9px;width:${dw}px;background:linear-gradient(90deg,#DC2626,#F87171);border-radius:5px;"></div></div></td><td style="font-size:9px;text-align:right;padding:2px 0 2px 8px;white-space:nowrap;"><div style="color:#4F46E5;font-weight:700;">${fmt(b.rev)}</div><div style="color:#DC2626;">${fmt(b.dep)}</div></td><td style="font-size:9px;text-align:right;padding:2px 0 2px 8px;white-space:nowrap;font-weight:700;color:${clr(b.solde)};">${fmt(b.solde)}</td></tr>`; }).join('');

    // Charges fixes détail
    const chargesByCat={};
    for (const m of months) { const chg=chgForMonth(m); for (const c of chg) { const cat=c.category||'autre'; chargesByCat[cat]=chargesByCat[cat]||{label:c.category||'Autre',total:0}; chargesByCat[cat].total+=Number(c.amount)||0; } }
    const chargesRows=Object.values(chargesByCat).sort((a,b)=>b.total-a.total).map((c,i)=>{ const bg=i%2?'background:#F8FAFC;':''; const info=getCategoryInfo(c.label); const monthly=months.length>1?(c.total/months.length):c.total; return `<tr style="${bg}"><td>${info.emoji} ${esc(info.label||c.label)}</td><td style="text-align:right;color:#64748B;">${fmt(monthly)}</td><td style="text-align:right;font-weight:700;color:#4F46E5;">${fmt(c.total)}</td></tr>`; }).join('');

    // Objectif épargne
    const epObjectif=Number(s?.savingsGoal)||0, epTxObjectif=0.35;
    const epActualTotal=yearKPI?.solde?.total??0, epActualTx=yearKPI?.txEpargne?.total??0;
    const epProgress=epObjectif>0?Math.min(100,Math.round((epActualTotal/epObjectif)*100)):0;
    const epProgressBar=epObjectif>0?`<div style="background:#E2E8F0;border-radius:8px;overflow:hidden;height:12px;margin:8px 0;"><div style="height:12px;width:${epProgress}%;background:linear-gradient(90deg,#10B981,#34D399);border-radius:8px;min-width:4px;"></div></div><div style="font-size:9px;color:#64748B;">${epProgress}% de l'objectif annuel de ${fmt(epObjectif)}</div>`:'';

    // Tableau mensuel
    const tableRows=months.map(m=>{ const r=allResults[m-1]; if(!r) return `<tr><td style="color:#CBD5E1;font-style:italic;">${MOIS_FULL[m-1]}</td>${users.map(()=>'<td style="color:#CBD5E1">—</td>').join('')}<td style="color:#CBD5E1">—</td><td style="color:#CBD5E1">—</td><td style="color:#CBD5E1">—</td><td style="color:#CBD5E1">—</td></tr>`; const txC=r.txEpargne.total>=0.1?'#10B981':r.txEpargne.total>=0?'#F59E0B':'#EF4444'; return `<tr><td>${MOIS_FULL[m-1]}</td>${users.map(u=>`<td>${fmt(r.revenus.byUser?.[String(u.id)]??0)}</td>`).join('')}<td>${fmt(r.charges.total)}</td><td>${fmt(r.depensesReelles?.total??r.depenses.total)}</td><td style="color:${clr(r.solde.total)};font-weight:800;">${fmt(r.solde.total)}</td><td style="color:${txC};font-weight:700;">${fmtPct(r.txEpargne.total)}</td></tr>`; }).join('');

    // Imprévus (depuis monthlyData.imprévusList)
    const imprévusForPDF = [];
    for (const m of months) {
      const md = monthMap[m];
      if (!md) continue;
      for (const item of (md.imprévusList || [])) {
        imprévusForPDF.push({ ...item, _month: m });
      }
    }
    imprévusForPDF.sort((a,b) => (b._month*100+(b.day||0)) - (a._month*100+(a.day||0)));
    const getUserName = uid => { if (uid==='shared') return '🤝 Partagé'; const u=users.find(u=>String(u.id)===String(uid)); return u ? u.name : uid; };
    const imprévusRows = imprévusForPDF.slice(0,40).map((a,i) => {
      const d = a.day ? `${a.day} ${MOIS_SHORT[a._month-1]}` : MOIS_SHORT[a._month-1];
      const qui = getUserName(a.qui ?? 'shared');
      return `<tr style="${i%2?'background:#FFFBEB;':''}"><td><strong>${esc(a.label||'')}</strong><br><span style="font-size:9px;color:#94A3B8;">${qui}</span></td><td style="color:#94A3B8;text-align:right;">${d}</td><td style="color:#D97706;font-weight:700;text-align:right;">${fmt(a.amount)}</td></tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Compta+ — ${esc(periodLabel)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700;800;900&display=swap');
  *,*::before,*::after{margin:0;padding:0;box-sizing:border-box;}
  html{width:210mm;}
  body{font-family:'Inter',system-ui,sans-serif;background:#fff;color:#1E293B;font-size:12px;line-height:1.55;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  @page{size:A4 portrait;margin:0;}
  @media print{
    .pb{page-break-before:always;}
    .kpi-grid,.ss-row,.ug,.bar-box,.ch-wrap,.obj-box,.tx-box,.score-box,.spark-box,.mt-wrap,.ac-wrap{break-inside:avoid;page-break-inside:avoid;margin-top:14mm;}
    .kc,.uc{break-inside:avoid;page-break-inside:avoid;}
    .mt tbody tr,.cht tbody tr,.ac tbody tr{break-inside:avoid;page-break-inside:avoid;}
    .st{break-after:avoid;page-break-after:avoid;margin-top:12mm;}
    #ph{position:fixed;top:0;left:0;right:0;height:14mm;background:#fff;z-index:500;}
    .cover{position:relative;z-index:600;}
  }
  .cover{background:linear-gradient(135deg,#1E1B4B 0%,#312E81 50%,#4C1D95 100%);color:#fff;padding:36px 40px 30px;position:relative;overflow:hidden;margin:0;}
  .cover::before{content:'';position:absolute;top:-80px;right:-80px;width:280px;height:280px;border-radius:50%;background:rgba(167,139,250,.15);}
  .cover::after{content:'';position:absolute;bottom:-50px;left:60px;width:160px;height:160px;border-radius:50%;background:rgba(99,102,241,.12);}
  .ci{position:relative;z-index:1;display:flex;justify-content:space-between;align-items:flex-start;}
  .cl-logo{font-size:32px;font-weight:900;letter-spacing:-.05em;line-height:1;}
  .cl-logo em{color:#A78BFA;font-style:normal;}
  .cl-sub{font-size:11px;color:rgba(255,255,255,.5);margin-top:5px;text-transform:uppercase;letter-spacing:.14em;font-weight:500;}
  .cr{text-align:right;}.cr-period{font-size:24px;font-weight:900;line-height:1.2;}
  .cr-date{font-size:10px;color:rgba(255,255,255,.45);margin-top:6px;}
  .cr-chips{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap;}
  .chip{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:20px;padding:4px 12px;font-size:10px;font-weight:600;color:rgba(255,255,255,.9);}
  .ct{padding:15mm 14mm 14mm;}
  .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px;}
  .kc{border-radius:12px;padding:14px 12px;position:relative;overflow:hidden;}
  .kc::after{content:'';position:absolute;top:-20px;right:-20px;width:70px;height:70px;border-radius:50%;background:var(--kc);opacity:.1;}
  .kc-ico{font-size:17px;display:block;margin-bottom:6px;}
  .kc-lbl{font-size:8.5px;text-transform:uppercase;letter-spacing:.1em;font-weight:700;color:var(--kc);opacity:.75;margin-bottom:4px;}
  .kc-val{font-size:14.5px;font-weight:900;color:var(--kc);font-feature-settings:"tnum";line-height:1;}
  .kc-sub{font-size:8.5px;margin-top:5px;color:#94A3B8;}
  .kr{background:#EEF2FF;--kc:#4F46E5;}.kd{background:#FEF2F2;--kc:#DC2626;}
  .ks{background:var(--bg);--kc:var(--fc);}.ke{background:#ECFDF5;--kc:#059669;}
  .st{font-size:8.5px;font-weight:800;text-transform:uppercase;letter-spacing:.16em;color:#6C63FF;margin-bottom:10px;padding-bottom:7px;border-bottom:2px solid #EEF2FF;display:flex;align-items:center;gap:8px;}
  .ss-row{display:grid;grid-template-columns:180px 1fr;gap:12px;margin-bottom:20px;}
  .score-box{background:#FAFAFE;border-radius:12px;padding:14px 16px;border:1px solid #EEF2FF;display:flex;align-items:center;gap:14px;}
  .score-txt h3{font-size:14px;font-weight:800;margin-bottom:2px;}.score-txt p{font-size:9px;color:#94A3B8;line-height:1.4;}
  .spark-box{background:#FAFAFE;border-radius:12px;padding:14px 16px;border:1px solid #EEF2FF;}
  .spark-box h4{font-size:8.5px;text-transform:uppercase;letter-spacing:.1em;color:#94A3B8;font-weight:700;margin-bottom:4px;}
  .spark-val{font-size:18px;font-weight:900;font-feature-settings:"tnum";}
  .spark-sub{font-size:9px;color:#94A3B8;margin-top:2px;}
  .tx-box{background:#F0FDF4;border-radius:12px;padding:14px 16px;border:1px solid #BBF7D0;margin-bottom:20px;}
  .tx-box h4{font-size:8.5px;text-transform:uppercase;letter-spacing:.1em;color:#059669;font-weight:700;margin-bottom:6px;}
  .tx-row{display:flex;align-items:center;gap:20px;}
  .tx-val{font-size:18px;font-weight:900;font-feature-settings:"tnum";white-space:nowrap;}
  .tx-leg{font-size:8.5px;color:#64748B;margin-top:6px;}
  .ug{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:20px;}
  .uc{border-radius:12px;padding:14px;border:1.5px solid #EEF2FF;background:#FAFAFE;}
  .un{font-size:12px;font-weight:800;color:#312E81;margin-bottom:8px;display:flex;align-items:center;gap:7px;}
  .ud{width:10px;height:10px;border-radius:50%;flex-shrink:0;}
  .ur{display:flex;justify-content:space-between;padding:3.5px 0;border-bottom:1px solid #F0F0FA;font-size:10.5px;}
  .ur:last-child{border:none;}.ul{color:#64748B;}.uv{font-weight:700;font-feature-settings:"tnum";}
  .bar-box{background:#FAFAFE;border-radius:12px;padding:14px 16px;border:1px solid #EEF2FF;margin-bottom:20px;}
  .bt{width:100%;border-collapse:collapse;}
  .bleg{display:flex;gap:14px;margin-top:8px;font-size:8.5px;font-weight:600;}
  .bld{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:3px;vertical-align:middle;}
  .ch-wrap{border-radius:12px;overflow:hidden;border:1px solid #E2E8F0;margin-bottom:20px;}
  .cht{width:100%;border-collapse:collapse;font-size:10.5px;}
  .cht thead tr{background:linear-gradient(90deg,#1E293B,#334155);}
  .cht thead th{padding:8px 10px;color:#fff;font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;text-align:right;}
  .cht thead th:first-child{text-align:left;}
  .cht tbody tr:nth-child(even){background:#F8FAFC;}
  .cht tbody td{padding:6px 10px;border-bottom:1px solid #F1F5F9;}
  .obj-box{background:#F0FDF4;border-radius:12px;padding:14px 16px;border:1px solid #BBF7D0;margin-bottom:20px;}
  .obj-box h4{font-size:8.5px;text-transform:uppercase;letter-spacing:.1em;color:#059669;font-weight:700;margin-bottom:8px;}
  .obj-kv{display:flex;justify-content:space-between;font-size:10.5px;margin-bottom:5px;}
  .ok{color:#64748B;}.ov{font-weight:700;}
  .mt-wrap{border-radius:12px;overflow:hidden;border:1px solid #EEF2FF;margin-bottom:20px;}
  .mt{width:100%;border-collapse:collapse;font-size:10.5px;}
  .mt thead tr{background:linear-gradient(90deg,#312E81,#4F46E5);}
  .mt thead th{padding:8px 10px;color:#fff;font-weight:700;font-size:8.5px;text-transform:uppercase;letter-spacing:.06em;text-align:right;}
  .mt thead th:first-child{text-align:left;}
  .mt tbody tr:nth-child(even){background:#F8F7FF;}
  .mt tbody td{padding:6.5px 10px;text-align:right;border-bottom:1px solid #EEF2FF;font-feature-settings:"tnum";}
  .mt tbody td:first-child{text-align:left;font-weight:600;color:#334155;}
  .mt tfoot tr{background:#1E1B4B;}
  .mt tfoot td{padding:8px 10px;color:#E0DFFF;font-weight:800;text-align:right;font-feature-settings:"tnum";font-size:11px;}
  .mt tfoot td:first-child{text-align:left;color:#fff;}
  .ac-wrap{border-radius:12px;overflow:hidden;border:1px solid #FEF3C7;margin-bottom:20px;}
  .ac{width:100%;border-collapse:collapse;font-size:10.5px;}
  .ac thead tr{background:linear-gradient(90deg,#92400E,#D97706);}
  .ac thead th{padding:8px 10px;color:#fff;font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;}
  .ac thead th:first-child{text-align:left;}.ac thead th:nth-child(2),.ac thead th:nth-child(3){text-align:right;}
  .ac tbody tr:nth-child(even){background:#FFFBEB;}
  .ac tbody td{padding:6px 10px;border-bottom:1px solid #FEF3C7;}
  .pf{margin-top:14px;padding-top:8px;border-top:1px solid #E2E8F0;display:flex;justify-content:space-between;font-size:8.5px;color:#CBD5E1;}
  .pf strong{color:#A78BFA;font-weight:700;}
</style>
</head>
<body>
<div id="ph"></div>
<div class="cover"><div class="ci">
  <div><div class="cl-logo">Compta<em>+</em></div><div class="cl-sub">Bilan Financier Personnel</div></div>
  <div class="cr"><div class="cr-period">${esc(periodLabel)}</div><div class="cr-date">Généré le ${genDate}</div><div class="cr-chips">${users.map(u=>`<span class="chip">${esc(u.name)}</span>`).join('')}</div></div>
</div></div>

<div class="ct">

${yearKPI ? `
<div class="kpi-grid">
  <div class="kc kr"><span class="kc-ico">💰</span><div class="kc-lbl">Revenus nets</div><div class="kc-val">${fmt(yearKPI.revenus.total+(yearKPI.aides?.total??0))}</div><div class="kc-sub">Primes : ${fmt(yearKPI.primes.total)}</div></div>
  <div class="kc kd"><span class="kc-ico">💸</span><div class="kc-lbl">Dépenses</div><div class="kc-val">${fmt(yearKPI.depensesReelles?.total??yearKPI.depenses.total)}</div><div class="kc-sub">Charges : ${fmt(yearKPI.charges.total)}</div></div>
  <div class="kc ks" style="--bg:${Number(yearKPI.solde.total)>=0?'#ECFDF5':'#FEF2F2'};--fc:${clr(yearKPI.solde.total)};"><span class="kc-ico">⚖️</span><div class="kc-lbl">Solde cumulé</div><div class="kc-val">${fmt(yearKPI.solde.total)}</div><div class="kc-sub">${Number(yearKPI.solde.total)>=0?'Positif ✓':'Négatif !'}</div></div>
  <div class="kc ke"><span class="kc-ico">📈</span><div class="kc-lbl">Taux d'épargne</div><div class="kc-val">${fmtPct(yearKPI.txEpargne.total)}</div><div class="kc-sub">${yearKPI.txEpargne.total>=0.15?'Excellent ✓':yearKPI.txEpargne.total>=0.35?'Bon ✓':'Objectif : 35 %'}</div></div>
</div>
<div class="ss-row">
  <div class="score-box">
    <svg width="68" height="68" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
      <circle cx="30" cy="30" r="26" fill="none" stroke="#EEF2FF" stroke-width="6"/>
      <circle cx="30" cy="30" r="26" fill="none" stroke="${scoreColor}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${dashOff}" transform="rotate(-90 30 30)"/>
      <text x="30" y="35" text-anchor="middle" font-family="Inter,sans-serif" font-size="13" font-weight="900" fill="${scoreColor}">${scoreVal}</text>
    </svg>
    <div class="score-txt"><h3 style="color:${scoreColor};">${scoreLabel}</h3><p>Score budgétaire<br>sur 100 pts</p></div>
  </div>
  ${sparkSVG ? `<div class="spark-box"><h4>Évolution du solde mensuel</h4><div style="display:flex;align-items:center;gap:16px;"><div><div class="spark-val" style="color:${clr(yearKPI.solde.total)};">${fmt(yearKPI.solde.total)}</div><div class="spark-sub">cumul ${year}</div></div>${sparkSVG}</div></div>` : '<div></div>'}
</div>
${txSparkSVG ? `<div class="st">📉 Évolution du taux d'épargne</div>
<div class="tx-box"><h4>Taux d'épargne — ${periodLabel}</h4>
  <div class="tx-row"><div><div class="tx-val" style="color:${yearKPI.txEpargne.total>=0.1?'#10B981':'#F59E0B'};">${fmtPct(yearKPI.txEpargne.total)}</div><div style="font-size:9px;color:#64748B;margin-top:2px;">Moyenne période</div></div>${txSparkSVG}</div>
  <div class="tx-leg"><span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;"><span style="display:inline-block;width:16px;height:1.5px;background:#F59E0B;border-radius:2px;margin-right:4px;"></span>Objectif 35 %</span><span style="display:inline-flex;align-items:center;gap:4px;"><span style="display:inline-block;width:16px;height:2.5px;background:#10B981;border-radius:2px;margin-right:4px;"></span>Taux réel</span></div>
</div>` : ''}
${(epObjectif > 0 || epTxObjectif > 0) ? `<div class="st">🎯 Objectifs &amp; progression</div>
<div class="obj-box"><h4>Objectifs épargne ${year}</h4>
  ${epObjectif>0 ? `<div class="obj-kv"><span class="ok">Objectif annuel</span><span class="ov" style="color:#059669;">${fmt(epObjectif)}</span></div><div class="obj-kv"><span class="ok">Réalisé</span><span class="ov" style="color:${clr(epActualTotal)};">${fmt(epActualTotal)}</span></div>${epProgressBar}` : ''}
  ${epTxObjectif > 0 ? `<div class="obj-kv" style="margin-top:8px;"><span class="ok">Objectif taux d'épargne</span><span class="ov">${fmtPct(epTxObjectif)}</span></div><div class="obj-kv"><span class="ok">Taux actuel</span><span class="ov" style="color:${epActualTx>=epTxObjectif?'#10B981':'#F59E0B'};">${fmtPct(epActualTx)} ${epActualTx>=epTxObjectif?'✓':'— en dessous'}</span></div>` : ''}
</div>` : ''}
` : '<p style="color:#94A3B8;text-align:center;padding:24px 0;">Aucune donnée pour cette période.</p>'}

${users.length > 1 && yearKPI ? `<div class="st">👤 Bilan par personne</div>
<div class="ug">${users.map(u => { const uc=u.color||'#6C63FF'; return `<div class="uc"><div class="un"><span class="ud" style="background:${uc};"></span>${esc(u.name)}</div><div class="ur"><span class="ul">Revenus</span><span class="uv" style="color:#4F46E5;">${fmt(yearKPI.revenus.byUser?.[String(u.id)]??0)}</span></div><div class="ur"><span class="ul">Primes</span><span class="uv" style="color:#7C3AED;">${fmt(yearKPI.primes.byUser?.[String(u.id)]??0)}</span></div><div class="ur"><span class="ul">Dépenses</span><span class="uv" style="color:#DC2626;">${fmt(yearKPI.depensesReelles?.byUser?.[String(u.id)]??yearKPI.depenses.byUser?.[String(u.id)]??0)}</span></div><div class="ur"><span class="ul">Solde</span><span class="uv" style="color:${clr(yearKPI.solde.byUser?.[String(u.id)]??0)};">${fmt(yearKPI.solde.byUser?.[String(u.id)]??0)}</span></div><div class="ur"><span class="ul">Taux épargne</span><span class="uv">${fmtPct(yearKPI.txEpargne.byUser?.[String(u.id)]??0)}</span></div></div>`; }).join('')}
</div>` : ''}

${!singleMonth && barRows.length > 1 ? `<div class="st">📊 Revenus vs Dépenses par mois</div>
<div class="bar-box"><table class="bt">${barChartRows}</table><div class="bleg"><span><span class="bld" style="background:linear-gradient(90deg,#4F46E5,#8B85FF);"></span>Revenus</span><span><span class="bld" style="background:linear-gradient(90deg,#DC2626,#F87171);"></span>Dépenses</span></div></div>` : ''}

${Object.keys(chargesByCat).length > 0 ? `<div class="st">🏠 Charges fixes</div>
<div class="ch-wrap"><table class="cht"><thead><tr><th>Catégorie</th><th>Moy. mensuelle</th><th>Total période</th></tr></thead><tbody>${chargesRows}</tbody></table></div>` : ''}

<div class="pb"></div>
<div class="st">📋 ${singleMonth ? 'Détail du mois' : 'Récapitulatif mensuel'}</div>
<div class="mt-wrap"><table class="mt">
  <thead><tr><th>Mois</th>${users.map(u=>`<th>Revenus ${esc(u.name)}</th>`).join('')}<th>Charges</th><th>Dépenses</th><th>Solde</th><th>Taux ép.</th></tr></thead>
  <tbody>${tableRows}</tbody>
  ${yearKPI ? `<tfoot><tr><td>TOTAL / CUMUL</td>${users.map(u=>`<td>${fmt(yearKPI.revenus.byUser?.[String(u.id)]??0)}</td>`).join('')}<td>${fmt(yearKPI.charges.total)}</td><td>${fmt(yearKPI.depensesReelles?.total??yearKPI.depenses.total)}</td><td style="color:#A5F3C4;">${fmt(yearKPI.solde.total)}</td><td style="color:#A5F3C4;">${fmtPct(yearKPI.txEpargne.total)}</td></tr></tfoot>` : ''}
</table></div>

${imprévusForPDF.length > 0 ? `<div class="st">⚡ Imprévus${imprévusForPDF.length>40?' (40 premiers)':''}</div>
<div class="ac-wrap"><table class="ac"><thead><tr><th>Description</th><th>Date</th><th>Montant</th></tr></thead><tbody>${imprévusRows}</tbody></table></div>` : ''}

<div class="pf"><span><strong>Compta+</strong> — Bilan Financier Personnel</span><span>${esc(periodLabel)} · Généré le ${genDate}</span></div>
</div>
</body></html>`;

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:0;visibility:hidden;';
    document.body.appendChild(iframe);
    const iDoc = iframe.contentWindow.document;
    iDoc.open(); iDoc.write(html); iDoc.close();
    iframe.contentWindow.focus();
    setTimeout(() => {
      iframe.contentWindow.print();
      setTimeout(() => iframe.remove(), 4000);
    }, 800);
  } catch(e) {
    showToast('Erreur lors de la génération PDF', 'error');
    console.error(e);
  }
}

// ─────────────────────────────────────────────────
// FM-3 : Export CSV du tableau mensuel
// ─────────────────────────────────────────────────
function exportTableCSV(year, month, users = []) {
  const results = _lastDisplayResults;
  if (!results) { showToast('Aucune donnée à exporter', 'error'); return; }

  const MOIS_FULL = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const headers   = ['Mois', ...users.map(u => `Revenus ${u.name}`), 'Charges', 'Dépenses', 'Solde', 'Taux épargne'];
  const rows = results.map((r, i) => {
    if (!r) return [MOIS_FULL[i], ...users.map(() => ''), '', '', '', ''];
    return [
      MOIS_FULL[i],
      ...users.map(u => (r.revenus.byUser?.[String(u.id)] ?? 0).toFixed(2)),
      r.charges.total.toFixed(2),
      (r.depensesReelles?.total ?? r.depenses.total).toFixed(2),
      r.solde.total.toFixed(2),
      ((r.txEpargne?.total ?? 0) * 100).toFixed(1) + '%',
    ];
  });

  const periodLabel = month > 0 ? `${MOIS_FULL[month - 1]}-${year}` : String(year);
  const csv  = buildCSV(rows, headers);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `compta-plus-${periodLabel}.csv`);
  showToast('CSV exporté ✅', 'success');
}

// ─────────────────────────────────────────────────
// Tendances : évolution des charges par catégorie
// ─────────────────────────────────────────────────
function renderChartTendances(results, chargesByMonth) {
  const canvas = document.getElementById('chart-tendances');
  if (!canvas) return;

  const COLORS = ['#6C63FF','#00C896','#FFB020','#FF4757','#8B85FF','#00D2D3','#FF9F43','#EE5A24','#0652DD','#9980FA'];
  // Collecter toutes les catégories présentes sur l'année
  const allMonthCharges = chargesByMonth.flat();
  const cats = [...new Set(allMonthCharges.map(c => c.category || 'autre'))];

  const datasets = cats.map((catId, idx) => {
    const info = getCategoryInfo(catId);
    return {
      label: `${info.emoji} ${info.label}`,
      data: results.map((r, i) => {
        if (!r) return null;
        // Total réel de cette catégorie pour ce mois
        const catTotal = (chargesByMonth[i] ?? []).filter(c => (c.category || 'autre') === catId)
          .reduce((s, c) => s + (Number(c.amount) || 0), 0);
        return catTotal;
      }),
      borderColor: COLORS[idx % COLORS.length],
      backgroundColor: COLORS[idx % COLORS.length] + '22',
      tension: 0.3, fill: false, pointRadius: 3,
    };
  });

  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Graphique tendances mensuelle des catégories de dépenses');
  const chart = new Chart(canvas, {
    type: 'line',
    data: { labels: MOIS_COURT, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { padding: 8, font: { size: 10 }, color: getComputedStyle(document.documentElement).getPropertyValue('--text').trim() } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${eur(ctx.raw ?? 0)}` } },
      },
      scales: {
        y: { ticks: { callback: v => eur(v) }, grid: { color: 'rgba(128,128,128,0.1)' } },
        x: { grid: { display: false } },
      },
    },
  });
  _charts.push(chart);
}

// ─────────────────────────────────────────────────
// Projection épargne 6/12/24 mois
// ─────────────────────────────────────────────────
async function renderProjectionEpargne(container, year, curYear, curMonth) {
  const el = container.querySelector('#stats-projection');
  if (!el) return;
  try {
    const [allOps, latest] = await Promise.all([
      getAllSavingsOperations(), import('../db.js').then(db => db.getLatestSavingsConfirmed()),
    ]);
    const { balance } = calcSavingsBalance(latest, allOps);

    // Moyenne des 3 derniers mois de versements/épargne
    const recentOps = allOps.filter(op => op.type !== 'confirm' && op.type !== 'craquage_cover');
    const now3 = [];
    for (let i = 1; i <= 3; i++) {
      let m = curMonth - i, y = curYear;
      if (m < 1) { m += 12; y--; }
      const mo = recentOps.filter(op => op.year === y && op.month === m);
      now3.push(mo.reduce((s, op) => s + (Number(op.amount) || 0), 0));
    }
    const avgMonth = now3.reduce((s, v) => s + v, 0) / 3;

    const scenarios = [6, 12, 24];
    const rows = scenarios.map(n => {
      const proj = balance + avgMonth * n;
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);">
        <div>
          <div style="font-weight:700;font-size:0.9rem;">Dans ${n} mois</div>
          <div style="font-size:0.72rem;color:var(--text-3);">+${eur(avgMonth)}/mois en moyenne</div>
        </div>
        <div style="font-size:1.1rem;font-weight:800;color:${proj >= 0 ? 'var(--success)' : 'var(--danger)'};">${eur(proj)}</div>
      </div>`;
    }).join('');

    el.innerHTML = `
      <div style="padding:4px 0;">
        <div style="font-size:0.78rem;color:var(--text-3);margin-bottom:8px;">Basé sur votre solde actuel (${eur(balance)}) et la moyenne des 3 derniers mois.</div>
        ${rows}
      </div>`;
  } catch (e) {
    el.innerHTML = `<p style="color:var(--text-3);font-size:0.82rem;padding:8px 0;">Données insuffisantes pour la projection.</p>`;
  }
}

// ─────────────────────────────────────────────────
// Comparaison mois similaires N vs N-1
// ─────────────────────────────────────────────────
async function renderMonthCompare(container, year, month, users, s, allChargesRaw, allAchats, allRepartitions, monthMap, allBudgetOps = []) {
  const el = container.querySelector('#stats-month-compare');
  if (!el) return;
  const prevYear = year - 1;
  const mLabel   = MOIS_COURT[month - 1];

  try {
    const prevMonthsData = await getMonthsByYear(prevYear);
    const prevMap = Object.fromEntries(prevMonthsData.map(m => [m.month, m]));

    const defaultMode = s.defaultRepartMode ?? 'separe';
    const expandCharges = (m, yr, charges) => {
      const out = [];
      for (const c of charges) {
        if (!c.active) continue;
        // Nouveau modèle : charge liée à une année+mois précis
        if (c.year != null && c.month != null) {
          if (c.year !== yr || c.month !== m) continue;
        } else {
          // Modèle legacy : filtrage par liste de mois
          const ok = c.months === 'all' || (Array.isArray(c.months) && c.months.includes(m));
          if (!ok) continue;
        }
        if (c.lines?.length) {
          for (const l of c.lines) out.push({ ...c, amount: Number(l.amount)||0, qui: l.qui ?? 'shared', dayOfMonth: l.dayOfMonth ?? null });
        } else out.push({ ...c, qui: c.qui ?? 'shared' });
      }
      return out;
    };

    const chg     = expandCharges(month, year,     allChargesRaw);
    const prevChg = expandCharges(month, prevYear, allChargesRaw);
    const ach = allAchats.filter(a => a.year === year && a.month === month);
    const rp  = allRepartitions.find(r => r.year === year && r.month === month) ?? { year, month, mode: defaultMode, pcts: {} };
    const prevAch = allAchats.filter(a => a.year === prevYear && a.month === month);
    const prevRp  = allRepartitions.find(r => r.year === prevYear && r.month === month) ?? { year: prevYear, month, mode: defaultMode, pcts: {} };

    const curBops  = allBudgetOps.filter(op => op.year === year     && op.month === month);
    const prevBops = allBudgetOps.filter(op => op.year === prevYear && op.month === month);
    const cur  = monthMap[month]  ? calcMonth(monthMap[month],  chg,     ach,    rp,    users, curBops) : null;
    const prev = prevMap[month]   ? calcMonth(prevMap[month],   prevChg, prevAch, prevRp, users, prevBops) : null;

    if (!cur && !prev) {
      el.innerHTML = `<p style="color:var(--text-3);font-size:0.82rem;padding:8px 0;">Aucune donnée pour ${mLabel} ni en ${year} ni en ${prevYear}.</p>`;
      return;
    }

    const delta = (cur, prev, key) => {
      if (!cur || !prev) return '—';
      const d = (cur[key]?.total ?? 0) - (prev[key]?.total ?? 0);
      const color = d > 0 ? 'var(--success)' : d < 0 ? 'var(--danger)' : 'var(--text-3)';
      return `<span style="color:${color};font-size:0.78rem;">${d > 0 ? '+' : ''}${eur(d)}</span>`;
    };

    const rows = [
      ['Revenus', 'revenus'], ['Dépenses', 'depensesReelles'], ['Solde', 'solde'],
    ].map(([label, key]) => `<tr>
      <td>${label}</td>
      <td style="text-align:right">${prev ? eur(prev[key]?.total ?? 0) : '—'}</td>
      <td style="text-align:right">${cur ? eur(cur[key]?.total ?? 0) : '—'}</td>
      <td style="text-align:right">${delta(cur, prev, key)}</td>
    </tr>`).join('');

    el.innerHTML = `
      <div style="overflow-x:auto;">
        <table class="data-table">
          <thead><tr>
            <th></th>
            <th style="text-align:right">${mLabel} ${prevYear}</th>
            <th style="text-align:right">${mLabel} ${year}</th>
            <th style="text-align:right">Δ</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  } catch (e) {
    el.innerHTML = `<p style="color:var(--text-3);font-size:0.82rem;padding:8px 0;">Erreur de comparaison.</p>`;
  }
}

// ─────────────────────────────────────────────────
// Score budgétaire mensuel (0-100)
// ─────────────────────────────────────────────────
function renderScoreBudgetaire(container, result, s) {
  const el = container.querySelector('#stats-score');
  if (!el) return;

  if (!result) {
    el.innerHTML = `<p style="color:var(--text-3);font-size:0.82rem;padding:8px 0;">Aucune donnée pour calculer le score.</p>`;
    return;
  }

  // BM-1 + IL-2 : score via calcBudgetScore (source de vérité unique, 0 pts si budget non configuré)
  const { total, scoreHex: dashColor, scoreLabel, criteria } = calcBudgetScore(result, s);
  criteria[1].detail = eur(result.solde?.total ?? 0); // enrichir le solde avec la valeur formatée
  const scoreColor = total >= 75 ? 'var(--success)' : total >= 50 ? 'var(--warning)' : 'var(--danger)';

  // SVG ring: r=46 → circumference ≈ 289
  const R = 46;
  const C = 2 * Math.PI * R;
  const offset = C - (total / 100) * C;

  el.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:14px;padding:6px 0 10px;flex-wrap:wrap;">
      <div class="score-ring-wrap">
        <svg width="90" height="90" viewBox="0 0 110 110">
          <circle class="score-ring-bg" cx="55" cy="55" r="${R}" stroke-width="9"/>
          <circle class="score-ring-arc"
            cx="55" cy="55" r="${R}" stroke-width="9"
            stroke="${dashColor}"
            stroke-dasharray="${C.toFixed(2)}"
            stroke-dashoffset="${C.toFixed(2)}"
            transform="rotate(-90 55 55)"
            id="score-arc-anim"
          />
          <text x="55" y="51" text-anchor="middle" fill="${dashColor}"
            style="font-family:Inter,sans-serif;font-size:22px;font-weight:900;">${total}</text>
          <text x="55" y="67" text-anchor="middle" fill="var(--text-3)"
            style="font-family:Inter,sans-serif;font-size:10px;font-weight:600;">/100</text>
        </svg>
        <div style="font-size:0.72rem;font-weight:800;color:${dashColor};margin-top:-4px;">${scoreLabel}</div>
      </div>
      <div style="flex:1;min-width:175px;display:flex;flex-direction:column;gap:9px;">
        ${criteria.map(c => {
          const pct = Math.round(c.pts / c.max * 100);
          const barCls = c.pts === c.max ? 'success' : c.pts >= c.max / 2 ? 'warning' : 'danger';
          return `<div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span style="font-size:0.74rem;font-weight:600;color:var(--text-2);">${c.label}</span>
              <span style="font-size:0.68rem;color:var(--text-3);">${c.detail} <strong style="color:var(--text);">${c.pts}/${c.max}</strong></span>
            </div>
            <div class="progress-track"><div class="progress-bar ${barCls}" style="width:${pct}%;"></div></div>
          </div>`;
        }).join('')}
      </div>
    </div>`;

  // Animate arc after render
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const arc = el.querySelector('#score-arc-anim');
      if (arc) arc.style.strokeDashoffset = offset.toFixed(2);
    });
  });
}

function destroyCharts() {
  _charts.forEach(c => { try { c.destroy(); } catch (e) {} });
  _charts = [];
}

async function renderN1Comparison(container, year, users, s, currentResults, allBudgetOps = []) {
  const el = container.querySelector('#n1-content');
  if (!el) return;
  const prevYear = year - 1;
  try {
    const prevMonths = await getMonthsByYear(prevYear);
    if (!prevMonths.length) {
      el.innerHTML = `<p style="font-size:0.8rem;color:var(--text-3);padding:8px 0;">Aucune donnée pour ${prevYear}.</p>`;
      return;
    }
    const prevMap = Object.fromEntries(prevMonths.map(m => [m.month, m]));
    const [allChargesRaw, allAchats, allRepartitions] = await Promise.all([
      getAllCharges(), getAllAchats(), getAllRepartitions(),
    ]);
    const defaultRepartMode = s.defaultRepartMode ?? 'separe';
    function chargesForMonthYear(m, y) {
      const out = [];
      for (const c of allChargesRaw) {
        if (!c.active) continue;
        if (c.year != null && c.month != null) {
          if (c.year !== y || c.month !== m) continue;
        } else {
          const ok = c.months === 'all' || (Array.isArray(c.months) && c.months.includes(m));
          if (!ok) continue;
        }
        if (c.lines?.length) {
          for (const l of c.lines) out.push({ ...c, amount: Number(l.amount)||0, qui: l.qui ?? 'shared' });
        } else out.push({ ...c, qui: c.qui ?? 'shared' });
      }
      return out;
    }
    const repartMap = {};
    for (const r of allRepartitions) { if (r.year === prevYear) repartMap[r.month] = r; }
    const achatMap = {};
    for (const a of allAchats) { if (a.year === prevYear) (achatMap[a.month] ??= []).push(a); }
    const prevBopsMap = {};
    for (const op of allBudgetOps) { if (op.year === prevYear) (prevBopsMap[op.month] ??= []).push(op); }

    const prevResults = [];
    for (let m = 1; m <= 12; m++) {
      const md  = prevMap[m] ?? null;
      const chg = chargesForMonthYear(m, prevYear);
      const ach = achatMap[m]  ?? [];
      const rp  = repartMap[m] ?? { year: prevYear, month: m, mode: defaultRepartMode, pcts: {} };
      prevResults.push(md ? calcMonth(md, chg, ach, rp, users, prevBopsMap[m] ?? []) : null);
    }

    const metrics = [
      ['Revenus', r => r.revenus.total + (r.aides?.total ?? 0) + r.primes.total],
      ['Dépenses', r => r.depensesReelles?.total ?? r.depenses.total],
      ['Solde net', r => r.solde.total],
      ["Taux d'épargne", r => r.txEpargne.total],
    ];
    const months = Array.from({ length: 12 }, (_, i) => i);
    const prevTotals   = metrics.map(([, fn]) => months.reduce((s, i) => s + (prevResults[i] ? fn(prevResults[i]) : 0), 0));
    const curTotals    = metrics.map(([, fn]) => months.reduce((s, i) => s + (currentResults[i] ? fn(currentResults[i]) : 0), 0));

    el.innerHTML = `
      <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
      <table class="data-table">
        <thead><tr><th>Catégorie</th><th style="text-align:right">${prevYear}</th><th style="text-align:right">${year}</th><th style="text-align:right">Évolution</th></tr></thead>
        <tbody>
          ${metrics.map(([label], i) => {
            const prev = prevTotals[i];
            const cur  = curTotals[i];
            const delta = cur - prev;
            const isRate = label.includes('Taux');
            const fmtPrev  = isRate ? pct(prev / 12, 1) : eur(prev);
            const fmtCur   = isRate ? pct(cur  / 12, 1) : eur(cur);
            const fmtDelta = isRate ? pct((cur - prev) / 12, 1) : eur(delta);
            const color = delta >= 0 ? 'var(--success)' : 'var(--danger)';
            return `<tr>
              <td>${label}</td>
              <td style="text-align:right;color:var(--text-3);">${fmtPrev}</td>
              <td style="text-align:right;font-weight:600;">${fmtCur}</td>
              <td style="text-align:right;font-weight:700;color:${color};">${delta >= 0 ? '+' : ''}${fmtDelta}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>
    `;
  } catch (e) {
    el.innerHTML = `<p style="font-size:0.78rem;color:var(--text-3);">Impossible de charger les données ${prevYear}.</p>`;
  }
}

function chartOptions({ stacked = false } = {}) {
  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-2').trim() || '#666';
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || 'rgba(0,0,0,0.1)';
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend:  { position: 'bottom', labels: { padding: 8, font: { size: 10 }, color: textColor } },
      tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${eur(ctx.raw)}` } },
    },
    scales: {
      x: { stacked, grid: { color: gridColor }, ticks: { color: textColor, font: { size: 9 }, maxRotation: 0, autoSkip: true, autoSkipPadding: 4 } },
      y: { stacked, grid: { color: gridColor }, ticks: { color: textColor, font: { size: 9 }, callback: v => eur(v).replace(/\s€/, '') + '€' } },
    },
  };
}

// ════════════════════════════════════════════════════
// AUTO-INSIGHTS
// ════════════════════════════════════════════════════
function renderInsights(container, results, curMonth, year, s) {
  const panel = container.querySelector('#insights-panel');
  if (!panel) return;
  const validMonths = results.filter(r => r && r.revenus.total > 0);
  if (!validMonths.length) { panel.innerHTML = ''; return; }

  const insights = [];

  // 1. Dépenses vs moyenne des mois précédents
  const curResult = results[curMonth - 1];
  if (curResult && validMonths.length >= 2) {
    const past = validMonths.filter(r => r !== curResult);
    if (past.length) {
      const avgDep  = past.reduce((acc, r) => acc + (r.depensesReelles?.total ?? r.depenses.total), 0) / past.length;
      const curDep  = curResult.depensesReelles?.total ?? curResult.depenses.total;
      const diffPct = avgDep > 0 ? Math.round((curDep - avgDep) / avgDep * 100) : 0;
      if (Math.abs(diffPct) >= 8) {
        const better = curDep < avgDep;
        const mLabel = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'][curMonth - 1];
        insights.push({ type: better ? 'positive' : 'negative', icon: better ? '📉' : '📈',
          text: `Dépenses de ${mLabel}\u202f: <strong>${better ? '-' : '+'}${Math.abs(diffPct)}%</strong> par rapport à la moyenne des mois précédents.` });
      }
    }
  }

  // 2. Taux d'épargne moyen
  const avgTx = validMonths.reduce((acc, r) => acc + (r.txEpargne?.total ?? 0), 0) / validMonths.length;
  if (avgTx < 0.05) {
    insights.push({ type: 'warning', icon: '⚠️',
      text: `Taux d'épargne moyen\u202f: <strong>${Math.round(avgTx * 100)}%</strong>. Essayez de viser au moins <strong>10%</strong>.` });
  } else if (avgTx >= 0.15) {
    insights.push({ type: 'positive', icon: '🎯',
      text: `Excellent taux d'épargne moyen\u202f: <strong>${Math.round(avgTx * 100)}%</strong>. Continuez ainsi&nbsp;!` });
  }

  // 3. Budget courses dépassé ce mois
  const cibles = s.budgetCibles || {};
  const budgC  = Number(cibles.courses) || 0;
  if (budgC > 0 && curResult) {
    const curC = curResult.courses.total;
    if (curC > budgC * 1.1) {
      insights.push({ type: 'negative', icon: '🛒',
        text: `Courses ce mois\u202f: <strong>${eur(curC)}</strong> — dépasse le budget de <strong>${Math.round((curC / budgC - 1) * 100)}%</strong>.` });
    }
  }

  if (!insights.length) { panel.innerHTML = ''; return; }

  panel.innerHTML = insights.map(i =>
    `<div class="insight-card ${i.type}" style="margin-bottom:8px;">
       <span class="insight-icon">${i.icon}</span>
       <span class="insight-text">${i.text}</span>
     </div>`
  ).join('');
}

// ── Comparaison N vs N-1 ──
async function _renderEvolution(container, year, users) {
  const el = container.querySelector('#evolution-content');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  const [allCharges, allAchats, allRepts, allBudgetOps] = await Promise.all([
    getAllCharges(), getAllAchats(), getAllRepartitions(), getAllBudgetOps(),
  ]);
  const prevYear = year - 1;

  const getYearData = async (y) => {
    const months = await getMonthsByYear(y);
    const bopsMap = {};
    for (const op of allBudgetOps) { if (op.year === y) (bopsMap[op.month] ??= []).push(op); }
    const results = [];
    for (let m = 1; m <= 12; m++) {
      const md  = months.find(x => x.month === m);
      const chg = [];
      for (const c of allCharges) {
        if (!c.active) continue;
        if (c.year != null && c.month != null) {
          if (c.year !== y || c.month !== m) continue;
        } else {
          const ok = c.months === 'all' || (Array.isArray(c.months) && c.months.includes(m));
          if (!ok) continue;
        }
        if (c.lines?.length) {
          for (const l of c.lines) chg.push({ ...c, amount: Number(l.amount)||0, qui: l.qui ?? 'shared' });
        } else chg.push({ ...c, qui: c.qui ?? 'shared' });
      }
      const ach = allAchats.filter(a => a.year === y && a.month === m);
      const rep = allRepts.find(r => r.year === y && r.month === m);
      if (!md) { results.push(null); continue; }
      results.push(calcMonth(md, chg, ach, rep, users, bopsMap[m] ?? []));
    }
    return results;
  };

  const [curData, prevData] = await Promise.all([getYearData(year), getYearData(prevYear)]);

  // Métriques annuelles agrégées
  const agg = (data) => {
    const rows = data.filter(Boolean);
    if (!rows.length) return null;
    const revTotal = rows.reduce((s, r) => s + r.revenus.total, 0);
    const depTotal = rows.reduce((s, r) => s + (r.depensesReelles?.total ?? r.depenses.total), 0);
    const solTotal = rows.reduce((s, r) => s + r.solde.total, 0);
    const txAvg    = rows.reduce((s, r) => s + (r.txEpargne?.total ?? 0), 0) / rows.length;
    const chgTotal = rows.reduce((s, r) => s + r.charges.total, 0);
    return { revTotal, depTotal, solTotal, txAvg, chgTotal, count: rows.length };
  };
  const cur  = agg(curData);
  const prev = agg(prevData);

  // métriques calculées ci-dessus

  const txtDiff = (label, a, b, getter, isRate = false, higherIsBetter = true) => {
    if (!a || !b) return '';
    const va = getter(a), vb = getter(b);
    const d = va - vb;
    const sign = d >= 0 ? '+' : '';
    const fmt = isRate ? `${(d * 100).toFixed(1)} pts` : eur(d);
    const color = (d >= 0) === higherIsBetter ? 'var(--success)' : 'var(--danger)';
    const curVal = getter(cur);
    return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:0.85rem;color:var(--text-2);">${label}</span>
      <div style="text-align:right;">
        <div style="font-size:0.85rem;">${isRate ? pct(curVal ?? 0) : eur(curVal ?? 0)} <span style="color:var(--text-3);font-size:0.72rem;">(${year})</span></div>
        <div style="font-size:0.72rem;color:${color};">${sign}${fmt} vs ${prevYear}</div>
      </div>
    </div>`;
  };

  // Chart comparatif
  const canvasId = 'chart-evolution-comparison';
  el.innerHTML = `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header">
        <span class="card-title">📈 ${year} vs ${prevYear}</span>
        ${!prev ? `<span class="chip" style="font-size:0.72rem;">Pas de données ${prevYear}</span>` : ''}
      </div>
      ${prev ? `
      <div style="padding:4px 0;">
        ${txtDiff('💰 Revenus totaux', cur, prev, x => x.revTotal)}
        ${txtDiff('💸 Dépenses totales', cur, prev, x => x.depTotal, false, false)}
        ${txtDiff('✅ Solde cumulé', cur, prev, x => x.solTotal)}
        ${txtDiff('📈 Taux d\'épargne moyen', cur, prev, x => x.txAvg, true)}
        ${txtDiff('🏠 Charges fixes totales', cur, prev, x => x.chgTotal, false, false)}
      </div>` : '<p style="color:var(--text-3);font-size:0.82rem;">Aucune donnée pour ' + prevYear + '.</p>'}
    </div>
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header"><span class="card-title">📊 Solde mensuel : ${year} vs ${prevYear}</span></div>
      <div class="chart-wrap" style="height:220px;">
        <canvas id="${canvasId}" role="img" aria-label="Comparaison solde mensuel ${year} vs ${prevYear}"></canvas>
      </div>
    </div>
  `;

  const canvas = document.getElementById(canvasId);
  if (canvas && (cur || prev)) {
    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: MOIS_COURT,
        datasets: [
          {
            label: String(year),
            data: curData.map(r => r ? r.solde.total : null),
            backgroundColor: 'rgba(108,99,255,0.7)',
            borderRadius: 4,
          },
          ...(prev ? [{
            label: String(prevYear),
            data: prevData.map(r => r ? r.solde.total : null),
            backgroundColor: 'rgba(156,163,175,0.5)',
            borderRadius: 4,
          }] : []),
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 8 } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${eur(ctx.raw ?? 0)}` } },
        },
        scales: {
          x: { ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: true } },
          y: { ticks: { callback: v => eur(v) } },
        },
      },
    });
    _charts.push(chart);
  }
}
