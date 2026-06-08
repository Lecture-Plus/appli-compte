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
         downloadBlob, buildCSV, MOIS_COURT, MOIS }        from '../utils.js';

let _charts = [];

export async function render(container) {
  const [s, users, allUsers] = await Promise.all([getAllSettings(), getActiveUsers(), getAllUsers()]);

  const years = await getAvailableYears();
  if (!years.includes(State.year) && years.length) State.year = years[years.length - 1];

  container.innerHTML = `
    <!-- Sélecteur année -->
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
      <select class="form-select" id="year-select" style="flex:1;">
        ${years.map(y => `<option value="${y}" ${y === State.year ? 'selected' : ''}>${y}</option>`).join('')}
        ${!years.length ? '<option value="">Aucune donnée</option>' : ''}
      </select>
      <button class="btn btn-outline btn-sm" id="btn-export-csv">📥 CSV</button>
    </div>

    <!-- KPIs annuels -->
    <div id="kpi-annuel" class="kpi-grid" style="margin-bottom:12px;">
      <div class="loading"><div class="spinner"></div></div>
    </div>

    <!-- Graphique Revenus vs Dépenses -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header"><span class="card-title">📊 Revenus vs Dépenses</span></div>
      <div class="chart-wrap" style="height:200px;"><canvas id="chart-rev-dep"></canvas></div>
    </div>

    <!-- Graphique Épargne mensuelle -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header"><span class="card-title">📈 Épargne mensuelle</span></div>
      <div class="chart-wrap" style="height:180px;"><canvas id="chart-epargne"></canvas></div>
    </div>

    <!-- Graphique Solde épargne (evolution) -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header">
        <span class="card-title">💰 Évolution du solde épargne</span>
        <label style="display:flex;align-items:center;gap:5px;font-size:0.75rem;cursor:pointer;">
          <input type="checkbox" id="toggle-amounts" checked> Montants
        </label>
      </div>
      <div class="chart-wrap" style="height:180px;"><canvas id="chart-savings-balance"></canvas></div>
    </div>

    <!-- Graphique répartition dépenses -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header"><span class="card-title">🥧 Répartition des dépenses</span></div>
      <div class="chart-wrap" style="height:200px;display:flex;align-items:center;justify-content:center;">
        <canvas id="chart-repartition" style="max-width:200px;max-height:200px;"></canvas>
      </div>
    </div>

    <!-- Tableau mensuel détaillé -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header"><span class="card-title">📋 Détail mensuel ${State.year}</span></div>
      <div id="table-mensuel" style="overflow-x:auto;">
        <div class="loading"><div class="spinner"></div></div>
      </div>
    </div>

    <!-- Comparatif par utilisateur -->
    ${users.length >= 2 ? `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header"><span class="card-title">👥 Comparatif par personne</span></div>
      <div id="table-perso"><div class="loading"><div class="spinner"></div></div></div>
    </div>` : ''}

    <div style="height:16px;"></div>
  `;

  await loadAndRender(container, State.year, users, s);

  container.querySelector('#year-select')?.addEventListener('change', async (e) => {
    State.year = Number(e.target.value);
    destroyCharts();
    await loadAndRender(container, State.year, users, s);
  });

  container.querySelector('#btn-export-csv')?.addEventListener('click', () => {
    exportCSV(State.year, users);
  });

  container.querySelector('#toggle-amounts')?.addEventListener('change', (e) => {
    const chart = _charts.find(c => c.canvas?.id === 'chart-savings-balance');
    if (chart) {
      chart.options.plugins.datalabels = { display: e.target.checked };
      chart.update();
    }
  });

  return () => destroyCharts();
}

async function loadAndRender(container, year, users, s) {
  // Charger toutes les données en parallèle (1 seul round-trip par table)
  const [monthsData, allChargesRaw, allAchats, allRepartitions] = await Promise.all([
    getMonthsByYear(year),
    getAllCharges(),
    getAllAchats(),
    getAllRepartitions(),
  ]);

  const monthMap    = Object.fromEntries(monthsData.map(m => [m.month, m]));
  const achatMap    = {};   // m → achats[]
  const repartMap   = {};   // m → repartition
  for (const a of allAchats)      { if (a.year === year) { (achatMap[a.month] ??= []).push(a); } }
  for (const r of allRepartitions){ if (r.year === year) repartMap[r.month] = r; }

  // Helper : expand lines pour un mois donné (miroir de getChargesForMonth dans db.js)
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

  const results = [];
  for (let m = 1; m <= 12; m++) {
    const md  = monthMap[m] ?? null;
    const chg = chargesForMonth(m);
    const ach = achatMap[m]  ?? [];
    const rp  = repartMap[m] ?? { year, month: m, mode: defaultRepartMode, pcts: {} };
    results.push(md ? calcMonth(md, chg, ach, rp, users) : null);
  }

  const yearKPI = calcYear(results.filter(Boolean));

  // Masquer les mois futurs dans les graphiques/tableaux
  const now          = new Date();
  const curYear      = now.getFullYear();
  const curMonth     = now.getMonth() + 1;
  // Pour l'année affichée : set les mois au-delà du mois actuel à null
  const displayResults = results.map((r, i) => {
    if (year < curYear) return r;                     // année passée : tout affiché
    if (year > curYear) return null;                  // année future : rien
    return (i + 1) > curMonth ? null : r;             // mois courant : jusqu'à maintenant
  });

  renderKPIAnnuel(container, yearKPI);
  destroyCharts();
  renderChartRevDep(displayResults);
  renderChartEpargne(displayResults);
  await renderChartSavingsBalance(year, curYear, curMonth);
  renderChartRepartition(yearKPI);
  renderTableMensuel(container, displayResults);
  if (users.length >= 2) renderTablePerso(container, yearKPI, users);
}

function renderKPIAnnuel(container, kpi) {
  const el = container.querySelector('#kpi-annuel');
  if (!el || !kpi) {
    if (el) el.innerHTML = `<div style="grid-column:span 2;text-align:center;color:var(--text-3);padding:20px;">Aucune donnée pour cette année</div>`;
    return;
  }
  el.innerHTML = `
    <div class="kpi-card primary">
      <div class="kpi-label">Revenus annuels</div>
      <div class="kpi-value neutral">${eur(kpi.revenus.total + kpi.primes.total)}</div>
      <div class="kpi-sub">dont primes: ${eur(kpi.primes.total)}</div>
    </div>
    <div class="kpi-card danger">
      <div class="kpi-label">Dépenses annuelles</div>
      <div class="kpi-value neutral">${eur(kpi.depenses.total)}</div>
      <div class="kpi-sub">Imprévus: ${eur(kpi.imprevus.total)}</div>
    </div>
    <div class="kpi-card ${kpi.epargne?.total >= 0 ? 'success' : 'danger'}">
      <div class="kpi-label">Épargne totale</div>
      <div class="kpi-value ${kpi.epargne?.total >= 0 ? 'positive' : 'negative'}">${eur(kpi.epargne?.total ?? 0)}</div>
      <div class="kpi-sub">Taux: ${pct(kpi.txEpargne?.total ?? 0, 0)}</div>
    </div>
    <div class="kpi-card warning">
      <div class="kpi-label">Moy. mensuelle épargnée</div>
      <div class="kpi-value neutral">${eur((kpi.epargne?.total ?? 0) / 12)}</div>
      <div class="kpi-sub">Revenu moy: ${eur((kpi.revenus.total + kpi.primes.total) / 12)}</div>
    </div>
  `;
}

function renderChartRevDep(results) {
  const canvas = document.getElementById('chart-rev-dep');
  if (!canvas) return;
  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: MOIS_COURT,
      datasets: [
        { label: 'Revenus + Primes', data: results.map(r => r ? r.revenus.total + r.primes.total : 0), backgroundColor: 'rgba(108,99,255,0.7)', borderRadius: 4 },
        { label: 'Dépenses',         data: results.map(r => r ? r.depenses.total : 0),                 backgroundColor: 'rgba(255,71,87,0.7)',  borderRadius: 4 },
      ],
    },
    options: chartOptions({}),
  });
  _charts.push(chart);
}

function renderChartEpargne(results) {
  const canvas = document.getElementById('chart-epargne');
  if (!canvas) return;
  const soldes = results.map(r => r ? r.solde.total : null);
  const chart  = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: MOIS_COURT,
      datasets: [{
        label: 'Épargne mensuelle',
        data: soldes,
        backgroundColor: soldes.map(v => v === null ? 'transparent' : v >= 0 ? 'rgba(0,200,150,0.7)' : 'rgba(255,71,87,0.7)'),
        borderRadius: 4,
      }],
    },
    options: chartOptions({}),
  });
  _charts.push(chart);
}

async function renderChartSavingsBalance(year, curYear, curMonth) {
  const canvas = document.getElementById('chart-savings-balance');
  if (!canvas) return;

  const ops = await getAllSavingsOperations();
  const pointsByMonth = [];
  let runningBalance = 0;

  for (let m = 1; m <= 12; m++) {
    // Ne pas afficher les mois futurs
    if (year > curYear || (year === curYear && m > curMonth)) {
      pointsByMonth.push(null);
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
  }

  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: MOIS_COURT,
      datasets: [{
        label: 'Solde épargne',
        data: pointsByMonth,
        borderColor: '#00C896',
        backgroundColor: 'rgba(0,200,150,0.15)',
        fill: true,
        tension: 0.3,
        pointRadius: 5,
        pointBackgroundColor: pointsByMonth.map(v => v !== null ? '#00C896' : 'transparent'),
      }],
    },
    options: {
      ...chartOptions({}),
      plugins: {
        ...chartOptions({}).plugins,
        tooltip: { callbacks: { label: ctx => `Solde: ${eur(ctx.raw)}` } },
      },
    },
  });
  _charts.push(chart);
}

function renderChartRepartition(yearKPI) {
  const canvas = document.getElementById('chart-repartition');
  if (!canvas || !yearKPI) return;
  const chart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Charges fixes', 'Courses', 'Extras', 'Achats exc.', 'Imprévus'],
      datasets: [{
        data: [yearKPI.charges.total, yearKPI.courses.total, yearKPI.extras.total, yearKPI.achats.total, yearKPI.imprevus.total],
        backgroundColor: ['#6C63FF','#00C896','#FFB020','#FF4757','#8B85FF'],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: {
        legend: { position: 'bottom', labels: { padding: 10, font: { size: 11 }, color: getComputedStyle(document.documentElement).getPropertyValue('--text').trim() } },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${eur(ctx.raw)}` } },
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
    ['Extras',   kpi => kpi.extras],
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

async function exportCSV(year, users) {
  try {
    const monthsData = await getMonthsByYear(year);
    const monthMap   = Object.fromEntries(monthsData.map(m => [m.month, m]));

    const userHeaders = users.flatMap(u => [`Revenus ${u.name}`, `Primes ${u.name}`]);
    const headers = ['Mois', ...userHeaders, 'Dépenses', 'Solde', "Taux d'épargne"];

    const rows = [];
    for (let m = 1; m <= 12; m++) {
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
    downloadBlob(blob, `budget-foyer-${year}.csv`);
    showToast('Fichier CSV téléchargé ✅', 'success');
  } catch (e) {
    showToast('Erreur lors de l\'export CSV', 'error');
    console.error(e);
  }
}

function destroyCharts() {
  _charts.forEach(c => { try { c.destroy(); } catch (e) {} });
  _charts = [];
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

