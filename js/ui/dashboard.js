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

  // Transfert épargne déjà effectué ce mois ?
  const monthlySavOp = allSavOps.find(op =>
    op.type === 'monthly_savings' && op.year === year && op.month === month
  );

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

    <!-- Bilan Épargne du mois -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header" style="margin-bottom:8px;">
        <span class="card-title">💚 Bilan épargne du mois</span>
        ${monthlySavOp
          ? `<span class="chip success" style="font-size:0.68rem;padding:3px 8px;">✅ ${eur(monthlySavOp.amount)} mis de côté</span>`
          : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
        <div style="background:var(--success-bg);border-radius:var(--radius-sm);padding:12px;">
          <div style="font-size:0.65rem;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:0.03em;margin-bottom:3px;">Possible</div>
          <div style="font-size:0.7rem;color:var(--text-3);margin-bottom:5px;">Sans imprévus ni achats</div>
          <div style="font-size:1.25rem;font-weight:800;color:var(--success);">${eur(Math.max(0, kpi.ecoPossible.total))}</div>
          ${users.length > 1 ? `<div style="font-size:0.7rem;color:var(--text-3);margin-top:4px;">${users.map(u => `${escHtml(u.name)}: ${eur(kpi.ecoPossible.byUser?.[u.id] ?? 0)}`).join(' · ')}</div>` : ''}
        </div>
        <div style="background:${kpi.solde.total >= 0 ? 'var(--success-bg)' : 'var(--danger-bg)'};border-radius:var(--radius-sm);padding:12px;">
          <div style="font-size:0.65rem;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:0.03em;margin-bottom:3px;">Réelle estimée</div>
          <div style="font-size:0.7rem;color:var(--text-3);margin-bottom:5px;">Tout inclus</div>
          <div style="font-size:1.25rem;font-weight:800;color:${kpi.solde.total >= 0 ? 'var(--success)' : 'var(--danger)'};">${eur(kpi.solde.total)}</div>
          ${users.length > 1 ? `<div style="font-size:0.7rem;color:var(--text-3);margin-top:4px;">${users.map(u => `${escHtml(u.name)}: ${eur(kpi.solde.byUser?.[u.id] ?? 0)}`).join(' · ')}</div>` : ''}
        </div>
      </div>
      ${!monthlySavOp
        ? `<button class="btn btn-success" style="width:100%;font-weight:700;" id="btn-transfer-savings">
             💰 Virer vers l'épargne ce mois
           </button>`
        : `<div style="display:flex;align-items:center;justify-content:space-between;font-size:0.78rem;color:var(--text-3);">
             <span>Effectué le ${new Date(monthlySavOp.createdAt).toLocaleDateString('fr-FR')}</span>
             <button class="btn btn-outline btn-sm" id="btn-transfer-savings">Modifier</button>
           </div>`
      }
    </div>

    ${md?.notes ? `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-title" style="margin-bottom:6px;">📝 Notes</div>
      <p style="font-size:0.875rem;color:var(--text-2);white-space:pre-wrap;">${escHtml(md.notes)}</p>
    </div>` : ''}
    <div style="height:16px;"></div>
  `;

  el.querySelector('#btn-go-saisie')?.addEventListener('click', () => navigateTo('saisie'));
  el.querySelector('#btn-go-savings')?.addEventListener('click', () => navigateTo('savings'));
  el.querySelector('#btn-transfer-savings')?.addEventListener('click', () => {
    showTransferSavingsModal(year, month, kpi.ecoPossible.total, kpi.solde.total, monthlySavOp, () => render(container));
  });
}

// ══════════════════════════════════════════════════
// ONGLET PRÉVISIONNEL
// ══════════════════════════════════════════════════
async function _renderPrevisionnel(container, s, users) {
  const { year, month } = State;

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

  const { days, todayDay } = calcPrevisionnel({ totalIncome, charges, year, month });

  const timedCount = charges.filter(c => c.active && Number(c.dayOfMonth) > 0).length;
  const noTimedMsg = timedCount === 0
    ? `<div style="background:var(--warning-bg);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:0.78rem;color:var(--warning);">
         ⚠️ Aucune charge n'a de <strong>date de prélèvement</strong> définie. Allez dans <strong>Charges</strong> pour ajouter le jour du mois de chaque charge.
       </div>`
    : '';

  const displayDays = todayDay > 0 ? days.filter(d => !d.isPast || d.isToday) : days;

  const el = container.querySelector('#dash-content');
  el.innerHTML = `
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
             <thead><tr><th>Jour</th><th>Charges</th><th style="text-align:right">Solde estimé</th></tr></thead>
             <tbody>${displayDays.map(d => _buildPrevDay(d)).join('')}</tbody>
           </table>
         </div>`
    }
    <div style="height:16px;"></div>
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
function showTransferSavingsModal(year, month, ecoPossible, soldeTotal, existingOp, onSave) {
  const isEdit = !!existingOp;
  const suggested = isEdit ? Math.abs(existingOp.amount) : Math.max(0, Math.round(ecoPossible));

  openModal(
    isEdit ? '💰 Modifier le virement épargne' : '💰 Virer vers l\'épargne',
    `
    <p style="font-size:0.82rem;color:var(--text-2);margin-bottom:14px;">
      Indiquez le montant que vous souhaitez mettre de côté pour <strong>${nomMois(month)} ${year}</strong>.<br>
      Une opération sera créée dans votre suivi d'épargne.
    </p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
      <button type="button" class="btn btn-outline trf-preset" data-val="${Math.max(0, Math.round(ecoPossible))}">
        <div style="font-size:0.68rem;color:var(--text-3);margin-bottom:2px;">Possible</div>
        <div style="font-weight:700;font-size:0.95rem;color:var(--success);">${eur(Math.max(0, ecoPossible))}</div>
      </button>
      <button type="button" class="btn btn-outline trf-preset" data-val="${Math.max(0, Math.round(soldeTotal))}">
        <div style="font-size:0.68rem;color:var(--text-3);margin-bottom:2px;">Réelle</div>
        <div style="font-weight:700;font-size:0.95rem;color:${soldeTotal >= 0 ? 'var(--success)' : 'var(--danger)'};">${eur(soldeTotal)}</div>
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
      <input type="text" class="form-input" id="trf-label" value="Épargne ${nomMois(month)} ${year}" placeholder="Ex: Virement Livret A">
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
