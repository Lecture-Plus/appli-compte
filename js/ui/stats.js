// ============================================================
// js/ui/stats.js – Page statistiques & graphiques
// ============================================================

import { State }                                          from '../app.js';
import { getMonthsByYear, getAllCharges,
         getAchatsForMonth, getRepartition,
         getAllSettings, getAvailableYears,
         getActiveUsers, getAllUsers,
         getAllSavingsOperations, getAllRepartitions,
         getAllAchats }                                     from '../db.js';
import { calcMonth, calcYear, calcSavingsBalance }         from '../calculs.js';
import { eur, pct, nomMoisCourt, escHtml, showToast,
         downloadBlob, buildCSV, MOIS_COURT, MOIS,
         getCategoryInfo, CATEGORIES }                      from '../utils.js';

let _charts = [];
let _statsTab  = 'revenus'; // 'revenus' | 'epargne' | 'depenses'
let _statsMonth = 0;        // 0 = toute l'année, 1-12 = mois précis

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
      <button class="btn btn-outline btn-sm" id="btn-export-csv">📥 CSV</button>
    </div>

    <!-- KPIs annuels -->
    <div id="kpi-annuel" class="kpi-grid" style="margin-bottom:12px;">
      <div class="loading"><div class="spinner"></div></div>
    </div>

    <!-- Onglets stats -->
    <div class="tabs" id="stats-tabs" style="margin-bottom:12px;">
      <button class="tab-btn ${_statsTab === 'revenus'  ? 'active' : ''}" data-stab="revenus">📊 Revenus</button>
      <button class="tab-btn ${_statsTab === 'epargne'  ? 'active' : ''}" data-stab="epargne">💰 Épargne</button>
      <button class="tab-btn ${_statsTab === 'depenses' ? 'active' : ''}" data-stab="depenses">💸 Dépenses</button>
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
      ${users.length >= 2 ? `
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header"><span class="card-title">👥 Comparatif par personne</span></div>
        <div id="table-perso"><div class="loading"><div class="spinner"></div></div></div>
      </div>` : ''}
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

  container.querySelector('#btn-export-csv')?.addEventListener('click', () => {
    exportCSV(State.year, _statsMonth, users);
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
      ['revenus', 'epargne', 'depenses'].forEach(t => {
        const el = container.querySelector(`#stab-${t}`);
        if (el) el.style.display = t === _statsTab ? '' : 'none';
      });
    });
  });

  return () => destroyCharts();
}

async function loadAndRender(container, year, month, users, s) {
  // Charger toutes les données en parallèle
  const [monthsData, allChargesRaw, allAchats, allRepartitions] = await Promise.all([
    getMonthsByYear(year),
    getAllCharges(),
    getAllAchats(),
    getAllRepartitions(),
  ]);

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
      const ok = c.months === 'all' || (Array.isArray(c.months) && c.months.includes(m));
      if (!ok) continue;
      if (c.lines?.length) {
        for (const l of c.lines) out.push({ ...c, amount: Number(l.amount)||0, qui: l.qui ?? 'shared', dayOfMonth: l.dayOfMonth ?? null });
      } else {
        out.push(c);
      }
    }
    return out;
  }

  // Calculer tous les mois, puis filtrer si un mois précis est sélectionné
  const results = [];
  for (let m = 1; m <= 12; m++) {
    const md  = monthMap[m] ?? null;
    const chg = chargesForMonth(m);
    const ach = achatMap[m]  ?? [];
    const rp  = repartMap[m] ?? { year, month: m, mode: defaultRepartMode, pcts: {} };
    results.push(md ? calcMonth(md, chg, ach, rp, users) : null);
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

  const kpiSource   = singleMonth ? results.filter((r, i) => (i + 1) === month) : results;
  const yearKPI     = calcYear(kpiSource.filter(Boolean));

  renderKPIAnnuel(container, yearKPI, singleMonth ? MOIS[month - 1] : null);
  destroyCharts();
  renderChartRevDep(displayResults);
  renderChartRevPrimes(displayResults, users);
  renderChartEpargne(displayResults);
  await renderChartSavingsBalance(year, curYear, curMonth, users);
  renderChartRepartition(yearKPI);
  renderChartChargesCat(yearKPI, allChargesRaw);
  renderChartTendances(results, allChargesRaw);
  renderTableMensuel(container, displayResults);
  if (users.length >= 2) renderTablePerso(container, yearKPI, users);
  await renderN1Comparison(container, year, users, s, displayResults);
  await renderProjectionEpargne(container, year, curYear, curMonth);
  await renderMonthCompare(container, year, month > 0 ? month : curMonth, users, s, allChargesRaw, allAchats, allRepartitions, monthMap);
  renderScoreBudgetaire(container, singleMonth ? results[month - 1] : results[curMonth - 1], s);
}

function renderKPIAnnuel(container, kpi, monthLabel = null) {
  const el = container.querySelector('#kpi-annuel');
  if (!el || !kpi) {
    if (el) el.innerHTML = `<div style="grid-column:span 2;text-align:center;color:var(--text-3);padding:20px;">Aucune donnée${monthLabel ? ' pour ' + monthLabel : ' pour cette année'}</div>`;
    return;
  }
  el.innerHTML = `
    <div class="kpi-card primary">
      <div class="kpi-label">Revenus annuels</div>
      <div class="kpi-value neutral">${eur(kpi.revenus.total + (kpi.aides?.total ?? 0) + kpi.primes.total)}</div>
      <div class="kpi-sub">dont aides: ${eur(kpi.aides?.total ?? 0)} · primes: ${eur(kpi.primes.total)}</div>
    </div>
    <div class="kpi-card danger">
      <div class="kpi-label">Dépenses annuelles</div>
      <div class="kpi-value neutral">${eur(kpi.depenses.total)}</div>
      <div class="kpi-sub">Imprévus: ${eur(kpi.imprevus.total)}</div>
    </div>
    <div class="kpi-card danger">
      <div class="kpi-label">Moy. mensuelle dépensés</div>
      <div class="kpi-value neutral">${eur(kpi.depenses.total / 12)}</div>
      <div class="kpi-sub">Total année : ${eur(kpi.depenses.total)}</div>
    </div>
    <div class="kpi-card warning">
      <div class="kpi-label">Moy. mensuelle épargnée</div>
      <div class="kpi-value neutral">${eur((kpi.epargne?.total ?? 0) / 12)}</div>
      <div class="kpi-sub">Revenu moy: ${eur((kpi.revenus.total + (kpi.aides?.total ?? 0) + kpi.primes.total) / 12)}</div>
    </div>
  `;
}

function renderChartRevDep(displayResults) {
  const canvas = document.getElementById('chart-rev-dep');
  if (!canvas) return;
  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: MOIS_COURT,
      datasets: [
        { label: 'Revenus + Aides + Primes', data: displayResults.map(r => r ? r.revenus.total + (r.aides?.total ?? 0) + r.primes.total : 0), backgroundColor: 'rgba(108,99,255,0.7)', borderRadius: 4 },
        { label: 'Dépenses',                  data: displayResults.map(r => r ? r.depenses.total : 0),                                                    backgroundColor: 'rgba(255,71,87,0.7)',  borderRadius: 4 },
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
      data: displayResults.map(r => r ? (r.revenus.byUser?.[u.id] ?? 0) : null),
      borderColor: u.color || '#6C63FF',
      backgroundColor: 'transparent',
      borderWidth: 2, pointRadius: 3, tension: 0.3, spanGaps: false,
    },
  ]) : [];

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

function renderChartEpargne(displayResults) {
  const canvas = document.getElementById('chart-epargne');
  if (!canvas) return;

  // Épargne mensuelle
  const mensuelle = displayResults.map(r => r ? r.solde.total : null);

  // Épargne cumulée (somme glissante des mois non-null)
  let cum = 0;
  const cumulee = displayResults.map(r => {
    if (r === null) return null;
    cum += r.solde.total;
    return cum;
  });

  // Taux d'épargne (0..1 → affiché en %)
  const taux = displayResults.map(r => r ? r.txEpargne.total : null);

  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-2').trim() || '#666';
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || 'rgba(0,0,0,0.1)';

  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: MOIS_COURT,
      datasets: [
        {
          type: 'line',
          label: 'Épargne cumulée',
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
          label: 'Épargne mensuelle',
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

async function renderChartSavingsBalance(year, curYear, curMonth, users = []) {
  const canvas = document.getElementById('chart-savings-balance');
  if (!canvas) return;

  const ops = await getAllSavingsOperations();
  const pointsByMonth = [];
  let runningBalance = 0;

  // Per-user running balances (ops with userId, no confirmed_balance support per user)
  const userRunning = {};
  users.forEach(u => { userRunning[String(u.id)] = 0; });
  const userPoints = {};
  users.forEach(u => { userPoints[String(u.id)] = []; });

  for (let m = 1; m <= 12; m++) {
    if (year > curYear || (year === curYear && m > curMonth)) {
      pointsByMonth.push(null);
      users.forEach(u => userPoints[String(u.id)].push(null));
      continue;
    }
    const monthOps = ops.filter(o => o.year === year && o.month === m);
    const confirmed = monthOps.find(o => o.type === 'confirmed_balance');
    if (confirmed) {
      runningBalance = confirmed.amount;
    } else {
      const delta = monthOps.filter(o => o.type !== 'confirmed_balance').reduce((s, o) => s + (o.amount || 0), 0);
      runningBalance += delta;
    }
    pointsByMonth.push(runningBalance || null);

    users.forEach(u => {
      const uDelta = monthOps
        .filter(o => String(o.userId) === String(u.id))
        .reduce((s, o) => s + (o.amount || 0), 0);
      userRunning[String(u.id)] += uDelta;
      userPoints[String(u.id)].push(userRunning[String(u.id)] || null);
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

function renderChartChargesCat(yearKPI, allCharges = []) {
  const canvas = document.getElementById('chart-charges-cat');
  if (!canvas) return;

  // Calculer le total par catégorie depuis les charges actives
  const byCat = {};
  for (const c of allCharges) {
    if (!c.active) continue;
    const cat = c.category || 'autre';
    const lines = c.lines?.length ? c.lines : [c];
    const amt   = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    byCat[cat] = (byCat[cat] || 0) + amt;
  }

  const entries = Object.entries(byCat).filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  if (!entries.length) return;

  const COLORS = ['#6C63FF','#00C896','#FFB020','#FF4757','#8B85FF','#00D2D3','#FF9F43','#EE5A24','#0652DD','#9980FA'];
  const total  = entries.reduce((s, [, v]) => s + v, 0);
  const labels = entries.map(([id]) => { const i = getCategoryInfo(id); return `${i.emoji} ${i.label}`; });
  const data   = entries.map(([, v]) => v);

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

function renderChartRepartition(yearKPI) {
  const canvas = document.getElementById('chart-repartition');
  if (!canvas || !yearKPI) return;
  const labels = ['Charges fixes', 'Courses', 'Loisirs', 'Achats exc.', 'Imprévus'];
  const data   = [yearKPI.charges.total, yearKPI.courses.total, yearKPI.extras.total, yearKPI.achats.total, yearKPI.imprevus.total];
  const total  = data.reduce((s, v) => s + v, 0);
  const chart  = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: ['#6C63FF','#00C896','#FFB020','#FF4757','#8B85FF'],
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
    if (!r) return `<tr><td>${MOIS_COURT[i]}</td><td colspan="4" style="text-align:center;color:var(--text-3);">—</td></tr>`;
    const s = r.solde.total;
    return `<tr>
      <td><strong>${MOIS_COURT[i]}</strong></td>
      <td style="text-align:right">${eur(r.revenus.total + r.primes.total)}</td>
      <td style="text-align:right">${eur(r.depenses.total)}</td>
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
          <th style="text-align:right">Dépenses</th>
          <th style="text-align:right">Solde</th>
          <th style="text-align:right">Tx ép.</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderTablePerso(container, yearKPI, users) {
  const el = container.querySelector('#table-perso');
  if (!el || !yearKPI) {
    if (el) el.innerHTML = '<p style="color:var(--text-3);text-align:center;padding:20px;">Aucune donnée</p>';
    return;
  }

  const categories = [
    ['Revenus',  kpi => kpi.revenus],
    ['Primes',   kpi => kpi.primes],
    ['Charges',  kpi => kpi.charges],
    ['Courses',  kpi => kpi.courses],
    ['Loisirs',   kpi => kpi.extras],
    ['Imprévus', kpi => kpi.imprevus],
    ['Solde net',kpi => kpi.solde ?? kpi.epargne],
  ];

  el.innerHTML = `
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
          ${categories.map(([label, getter]) => {
            const field = getter(yearKPI);
            return `<tr>
              <td>${label}</td>
              ${users.map(u => `<td style="text-align:right;font-weight:600;">${eur(field?.byUser?.[u.id] ?? 0)}</td>`).join('')}
              <td style="text-align:right;font-weight:700;">${eur(field?.total ?? 0)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function exportCSV(year, month, users) {
  try {
    const monthsData = await getMonthsByYear(year);
    const monthMap   = Object.fromEntries(monthsData.map(m => [m.month, m]));
    const months     = month > 0 ? [month] : Array.from({length: 12}, (_, i) => i + 1);

    const userHeaders = users.flatMap(u => [`Revenus ${u.name}`, `Primes ${u.name}`]);
    const headers = ['Mois', ...userHeaders, 'Dépenses', 'Solde', "Taux d'épargne"];

    const rows = [];
    for (const m of months) {
      const md  = monthMap[m];
      const chg = await getChargesForMonth(m);
      const ach = await getAchatsForMonth(year, m);
      const rp  = await getRepartition(year, m);
      const k   = md ? calcMonth(md, chg, ach, rp, users) : null;

      const userCols = users.flatMap(u => [
        k ? (k.revenus.byUser?.[u.id] ?? 0) : '',
        k ? (k.primes.byUser?.[u.id]  ?? 0) : '',
      ]);

      rows.push([
        MOIS[m - 1],
        ...userCols,
        k ? k.depenses.total  : '',
        k ? k.solde.total     : '',
        k ? (k.txEpargne.total * 100).toFixed(1) + '%' : '',
      ]);
    }

    const csv  = buildCSV(rows, headers);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const fname = month > 0 ? `budget-foyer-${year}-${String(month).padStart(2,'0')}.csv` : `budget-foyer-${year}.csv`;
    downloadBlob(blob, fname);
    showToast('Fichier CSV téléchargé ✅', 'success');
  } catch (e) {
    showToast('Erreur lors de l\'export CSV', 'error');
    console.error(e);
  }
}

// ─────────────────────────────────────────────────
// Tendances : évolution des charges par catégorie
// ─────────────────────────────────────────────────
function renderChartTendances(results, allCharges) {
  const canvas = document.getElementById('chart-tendances');
  if (!canvas) return;

  const COLORS = ['#6C63FF','#00C896','#FFB020','#FF4757','#8B85FF','#00D2D3','#FF9F43','#EE5A24','#0652DD','#9980FA'];
  const cats = [...new Set(allCharges.filter(c => c.active).map(c => c.category || 'autre'))];

  const datasets = cats.map((catId, idx) => {
    const info = getCategoryInfo(catId);
    return {
      label: `${info.emoji} ${info.label}`,
      data: results.map(r => {
        if (!r) return null;
        // Approximer par charges.total * part de cette catégorie dans les charges brutes
        const catTotal = allCharges.filter(c => c.active && (c.category || 'autre') === catId)
          .reduce((s, c) => s + (c.lines?.length ? c.lines.reduce((ss, l) => ss + (Number(l.amount)||0), 0) : (Number(c.amount)||0)), 0);
        return catTotal;
      }),
      borderColor: COLORS[idx % COLORS.length],
      backgroundColor: COLORS[idx % COLORS.length] + '22',
      tension: 0.3, fill: false, pointRadius: 3,
    };
  });

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
async function renderMonthCompare(container, year, month, users, s, allChargesRaw, allAchats, allRepartitions, monthMap) {
  const el = container.querySelector('#stats-month-compare');
  if (!el) return;
  const prevYear = year - 1;
  const mLabel   = MOIS[month - 1];

  try {
    const prevMonthsData = await getMonthsByYear(prevYear);
    const prevMap = Object.fromEntries(prevMonthsData.map(m => [m.month, m]));

    const defaultMode = s.defaultRepartMode ?? 'separe';
    const expandCharges = (m, charges) => {
      const out = [];
      for (const c of charges) {
        if (!c.active) continue;
        const ok = c.months === 'all' || (Array.isArray(c.months) && c.months.includes(m));
        if (!ok) continue;
        if (c.lines?.length) {
          for (const l of c.lines) out.push({ ...c, amount: Number(l.amount)||0, qui: l.qui ?? 'shared', dayOfMonth: l.dayOfMonth ?? null });
        } else out.push(c);
      }
      return out;
    };

    const chg = expandCharges(month, allChargesRaw);
    const ach = allAchats.filter(a => a.year === year && a.month === month);
    const rp  = allRepartitions.find(r => r.year === year && r.month === month) ?? { year, month, mode: defaultMode, pcts: {} };
    const prevAch = allAchats.filter(a => a.year === prevYear && a.month === month);
    const prevRp  = allRepartitions.find(r => r.year === prevYear && r.month === month) ?? { year: prevYear, month, mode: defaultMode, pcts: {} };

    const cur  = monthMap[month]  ? calcMonth(monthMap[month],  chg, ach,    rp,    users) : null;
    const prev = prevMap[month]   ? calcMonth(prevMap[month],   chg, prevAch, prevRp, users) : null;

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
      ['Revenus', 'revenus'], ['Dépenses', 'depenses'], ['Solde', 'solde'],
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

  const cibles    = s.budgetCibles || {};
  const threshold = Number(s.epargneThreshold) || 100;

  // Critères et poids
  const criteria = [];

  // 1. Taux d'épargne (40 pts) : 15%+ = 40, 5-15% = 20, 0-5% = 10, négatif = 0
  const tx = (result.txEpargne?.total ?? 0);
  const txPts = tx >= 0.15 ? 40 : tx >= 0.05 ? 25 : tx > 0 ? 10 : 0;
  criteria.push({ label: "Taux d'épargne", pts: txPts, max: 40, detail: `${(tx * 100).toFixed(1)}%` });

  // 2. Solde positif (20 pts)
  const soldePts = (result.solde?.total ?? 0) >= threshold ? 20 : (result.solde?.total ?? 0) >= 0 ? 10 : 0;
  criteria.push({ label: 'Solde du mois', pts: soldePts, max: 20, detail: eur(result.solde?.total ?? 0) });

  // 3. Budget courses respecté (20 pts)
  const budgC = cibles.courses || 0;
  const spentC = result.courses?.total ?? 0;
  const cPts = budgC > 0 ? (spentC <= budgC ? 20 : Math.max(0, 20 - Math.round((spentC - budgC) / budgC * 20))) : 10;
  criteria.push({ label: 'Budget courses', pts: cPts, max: 20, detail: budgC > 0 ? `${eur(spentC)}/${eur(budgC)}` : 'Pas de cible' });

  // 4. Pas de dépassement extras (20 pts)
  const budgE = cibles.extras || 0;
  const spentE = result.extras?.total ?? 0;
  const ePts = budgE > 0 ? (spentE <= budgE ? 20 : Math.max(0, 20 - Math.round((spentE - budgE) / budgE * 20))) : 10;
  criteria.push({ label: 'Budget loisirs', pts: ePts, max: 20, detail: budgE > 0 ? `${eur(spentE)}/${eur(budgE)}` : 'Pas de cible' });

  const total = criteria.reduce((s, c) => s + c.pts, 0);
  const color = total >= 75 ? 'var(--success)' : total >= 50 ? 'var(--warning)' : 'var(--danger)';
  const emoji = total >= 75 ? '🟢' : total >= 50 ? '🟡' : '🔴';
  const label = total >= 75 ? 'Excellent' : total >= 50 ? 'Correct' : 'À améliorer';

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:16px;padding:8px 0 12px;">
      <div style="text-align:center;min-width:70px;">
        <div style="font-size:2rem;font-weight:900;color:${color};">${total}</div>
        <div style="font-size:0.72rem;color:var(--text-3);">/100</div>
        <div style="font-size:0.8rem;font-weight:700;color:${color};">${emoji} ${label}</div>
      </div>
      <div style="flex:1;">
        ${criteria.map(c => `
          <div style="margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;font-size:0.75rem;margin-bottom:3px;">
              <span>${c.label}</span>
              <span style="color:var(--text-3);">${c.detail} · <strong>${c.pts}/${c.max}</strong></span>
            </div>
            <div class="progress-track" style="height:6px;">
              <div class="progress-bar ${c.pts === c.max ? 'success' : c.pts >= c.max/2 ? 'warning' : 'danger'}"
                style="width:${Math.round(c.pts/c.max*100)}%;"></div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

function destroyCharts() {
  _charts.forEach(c => { try { c.destroy(); } catch (e) {} });
  _charts = [];
}

async function renderN1Comparison(container, year, users, s, currentResults) {
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
    // Use same charge data as current year (simplified N-1)
    const [allChargesRaw, allAchats, allRepartitions] = await Promise.all([
      getAllCharges(), getAllAchats(), getAllRepartitions(),
    ]);
    const defaultRepartMode = s.defaultRepartMode ?? 'separe';
    function chargesForMonth(m) {
      const out = [];
      for (const c of allChargesRaw) {
        if (!c.active) continue;
        const ok = c.months === 'all' || (Array.isArray(c.months) && c.months.includes(m));
        if (!ok) continue;
        if (c.lines?.length) {
          for (const l of c.lines) out.push({ ...c, amount: Number(l.amount)||0, qui: l.qui ?? 'shared' });
        } else out.push(c);
      }
      return out;
    }
    const repartMap = {};
    for (const r of allRepartitions) { if (r.year === prevYear) repartMap[r.month] = r; }
    const achatMap = {};
    for (const a of allAchats) { if (a.year === prevYear) (achatMap[a.month] ??= []).push(a); }

    const prevResults = [];
    for (let m = 1; m <= 12; m++) {
      const md  = prevMap[m] ?? null;
      const chg = chargesForMonth(m);
      const ach = achatMap[m]  ?? [];
      const rp  = repartMap[m] ?? { year: prevYear, month: m, mode: defaultRepartMode, pcts: {} };
      prevResults.push(md ? calcMonth(md, chg, ach, rp, users) : null);
    }

    const metrics = [
      ['Revenus', r => r.revenus.total + (r.aides?.total ?? 0) + r.primes.total],
      ['Dépenses', r => r.depenses.total],
      ['Solde net', r => r.solde.total],
      ["Taux d'épargne", r => r.txEpargne.total],
    ];
    const months = Array.from({ length: 12 }, (_, i) => i);
    const prevTotals   = metrics.map(([, fn]) => months.reduce((s, i) => s + (prevResults[i] ? fn(prevResults[i]) : 0), 0));
    const curTotals    = metrics.map(([, fn]) => months.reduce((s, i) => s + (currentResults[i] ? fn(currentResults[i]) : 0), 0));

    el.innerHTML = `
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
      x: { stacked, grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } } },
      y: { stacked, grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 }, callback: v => eur(v).replace(/\s€/, '') + '€' } },
    },
  };
}

