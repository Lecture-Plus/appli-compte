// ============================================================
// js/ui/savings.js – Page suivi des économies
// ============================================================

import { getAllSavingsOperations, saveSavingsOperation,
         deleteSavingsOperation, getLatestSavingsConfirmed,
         saveSavingsConfirmed, getAllSettings, setSetting,
         getActiveUsers,
         getAllSalarySavings, saveSalarySaving, deleteSalarySaving,
         getAllSalaryAbondements, saveSalaryAbondement, deleteSalaryAbondement }
                                                             from '../db.js';
import { calcSavingsBalance }                                from '../calculs.js';
import { eur, escHtml, showToast, showToastWithUndo, openModal, closeModal,
         today, nomMois, MOIS }                              from '../utils.js';

export async function render(container) {
  await _renderPage(container);
}

let _savingsHistTab = 'all';
let _savingsMainTab = 'economies'; // 'economies' | 'salariale'

async function _renderPage(container) {
  // Wrapper tabs : Économies | Épargne salariale
  container.innerHTML = `
    <div class="tabs" style="margin-bottom:12px;">
      <button class="tab-btn ${_savingsMainTab === 'economies' ? 'active' : ''}" data-sv-main="economies">💰 Économies</button>
      <button class="tab-btn ${_savingsMainTab === 'salariale' ? 'active' : ''}" data-sv-main="salariale">🏦 Épargne salariale</button>
    </div>
    <div id="sv-main-body"></div>
  `;
  container.querySelectorAll('[data-sv-main]').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('[data-sv-main]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _savingsMainTab = btn.dataset.svMain;
      _renderSvBody(container.querySelector('#sv-main-body'), container);
    });
  });
  _renderSvBody(container.querySelector('#sv-main-body'), container);
}

async function _renderSvBody(body, container) {
  if (!body) return;
  if (_savingsMainTab === 'salariale') {
    await _renderSalariale(body, container);
  } else {
    await _renderEconomies(body, container);
  }
}

async function _renderEconomies(el, container) {
  const [allOps, latest, users, s] = await Promise.all([
    getAllSavingsOperations(),
    getLatestSavingsConfirmed(),
    getActiveUsers(),
    getAllSettings(),
  ]);
  const { balance, base, delta } = calcSavingsBalance(latest, allOps);

  const { year, month } = today();
  const currentMonthConfirmed = latest && latest.year === year && latest.month === month;

  // ── Solde par user : somme des opérations avec userId ──
  const userBalances = users.map(u => {
    const uOps = allOps.filter(op => String(op.userId) === String(u.id));
    const bal  = uOps.reduce((s, op) => s + (Number(op.amount) || 0), 0);
    return { user: u, balance: bal };
  });
  const goalsByUser = s.savingsGoalsByUser || {};
  const hasUserData = userBalances.some(ub => ub.balance !== 0);

  // Tri : plus récent d'abord
  const sortedOps = [...allOps].sort((a, b) => {
    if (b.year  !== a.year)  return b.year  - a.year;
    if (b.month !== a.month) return b.month - a.month;
    return (b.day || 0) - (a.day || 0);
  });

  // Running total for display
  let running = balance;
  const opsWithRunning = [...sortedOps].reverse().reduce((acc, op) => {
    const nb = { ...op, _running: running };
    running -= (Number(op.amount) || 0);
    acc.unshift(nb);
    return acc;
  }, []);

  const balanceClass = balance >= 0 ? 'positive' : 'negative';

  el.innerHTML = `
    <!-- Solde total -->
    <div class="kpi-card success" style="--kpi-color:var(--success); margin-bottom:12px; padding:20px 20px 16px;">
      <div class="kpi-label">💰 Solde total des économies</div>
      <div class="kpi-value ${balanceClass}" style="font-size:2rem; margin:8px 0;">${eur(balance)}</div>
      ${latest
        ? `<div class="kpi-sub">
             Base confirmée : ${eur(base)}
             ${delta !== 0 ? ` · Opérations : <span style="color:${delta >= 0 ? 'var(--success)':'var(--danger)'}">${delta >= 0 ? '+' : ''}${eur(delta)}</span>` : ''}
             <br>Le ${new Date(latest.confirmedAt).toLocaleDateString('fr-FR')} (${nomMois(latest.month)} ${latest.year})
           </div>`
        : `<div class="kpi-sub" style="color:var(--warning);">⚠️ Aucune confirmation – solde basé sur les opérations uniquement</div>`
      }
    </div>

    <!-- Soldes par user -->
    ${users.length > 1 ? `
    <div style="display:grid;grid-template-columns:${users.map(() => '1fr').join(' ')};gap:8px;margin-bottom:12px;">
      ${userBalances.map(ub => {
        const goal = Number(goalsByUser[String(ub.user.id)]) || 0;
        const goalPct = goal > 0 ? Math.min(200, Math.round(ub.balance / goal * 100)) : -1;
        return `
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:12px;text-align:center;">
          <div style="width:10px;height:10px;border-radius:50%;background:${escHtml(ub.user.color||'#6C63FF')};display:inline-block;margin-bottom:4px;"></div>
          <div style="font-size:0.72rem;font-weight:600;color:var(--text-3);">${escHtml(ub.user.name)}</div>
          <div style="font-size:1.05rem;font-weight:800;color:${ub.balance >= 0 ? 'var(--success)' : 'var(--danger)'};">${eur(ub.balance)}</div>
          ${goalPct >= 0 ? `
            <div style="margin-top:6px;">
              <div class="progress-track" style="height:5px;"><div class="progress-bar ${goalPct >= 100 ? 'success' : 'primary'}" style="width:${Math.min(100, goalPct)}%;"></div></div>
              <div style="font-size:0.65rem;color:var(--text-3);margin-top:2px;">${goalPct}% · obj. ${eur(goal)}</div>
            </div>
          ` : ''}
        </div>`;
      }).join('')}
    </div>` : ''}

    <!-- Rappel mensuel -->
    ${!currentMonthConfirmed ? `
    <div style="background:var(--warning-bg); border:1.5px solid var(--warning); border-radius:var(--radius); padding:14px 16px; margin-bottom:12px; display:flex; align-items:center; gap:12px;">
      <span style="font-size:1.4rem;">🔔</span>
      <div style="flex:1;">
        <div style="font-weight:700; font-size:0.9rem;">Vérification mensuelle</div>
        <div style="font-size:0.78rem; color:var(--text-2); margin-top:2px;">${nomMois(month)} ${year} n'est pas encore confirmé.</div>
      </div>
      <button class="btn btn-sm btn-primary" id="btn-quick-confirm">Confirmer</button>
    </div>
    ` : ''}

    <!-- Actions -->
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
      <button class="btn btn-success" style="width:100%;" id="btn-confirm">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><path d="M20 6L9 17l-5-5"/></svg>
        Confirmer le solde
      </button>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-secondary" style="flex:1;" id="btn-add-op">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Versement
        </button>
        <button class="btn btn-outline" style="flex:1;" id="btn-withdraw-op">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Retrait
        </button>
      </div>
    </div>

    <!-- Historique -->
    <div class="section-header" style="margin-bottom:8px;">
      <span class="section-label">📋 Historique des opérations</span>
      <span class="chip">${sortedOps.length}</span>
    </div>

    ${users.length > 1 ? `
    <div class="tabs" style="margin-bottom:10px;">
      <button class="tab-btn ${_savingsHistTab === 'all' ? 'active' : ''}" data-savings-tab="all">Toutes</button>
      ${users.map(u => `<button class="tab-btn ${_savingsHistTab === String(u.id) ? 'active' : ''}" data-savings-tab="${u.id}" style="display:flex;align-items:center;gap:5px;"><span style="width:8px;height:8px;border-radius:50%;background:${escHtml(u.color||'#6C63FF')};display:inline-block;"></span>${escHtml(u.name)}</button>`).join('')}
    </div>` : ''}

    ${(() => {
      const filteredOps = users.length > 1 && _savingsHistTab !== 'all'
        ? opsWithRunning.filter(op => String(op.userId) === _savingsHistTab)
        : opsWithRunning;
      if (filteredOps.length === 0) return `<div class="empty-state">
           <div class="empty-state-icon">💰</div>
           <div class="empty-state-title">Aucune opération</div>
           <div class="empty-state-text">${_savingsHistTab === 'all' ? 'Commencez par confirmer votre solde actuel.' : 'Aucune opération pour cet utilisateur.'}</div>
         </div>`;
      return `<div class="item-list">${filteredOps.map(op => buildOpItem(op, users)).join('')}</div>`;
    })()}

    <div style="height:24px;"></div>

    <!-- Section : Objectif d'épargne -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header"><span class="card-title">🎯 Objectif d'épargne</span></div>
      <div class="form-group" style="margin-bottom:10px;">
        <label class="form-label">Libellé de l'objectif</label>
        <input type="text" class="form-input" id="sv-goal-label" value="${escHtml(s.savingsGoalLabel || '')}" placeholder="Ex: Vacances, Apport…">
      </div>
      <div class="form-grid-2" style="margin-bottom:10px;">
        <div class="form-group">
          <label class="form-label">Montant cible (€)</label>
          <div class="input-wrap">
            <input type="number" class="form-input input-euro" id="sv-goal" min="0" step="100" value="${s.savingsGoal || ''}">
            <span class="input-suffix">€</span>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Année</label>
          <input type="number" class="form-input" id="sv-goal-year" min="2020" max="2099" value="${s.savingsGoalYear || today().year}">
        </div>
      </div>
      ${users.length >= 2 ? `
      <div style="margin-bottom:10px;">
        <label class="form-label" style="margin-bottom:6px;display:block;">Objectifs par utilisateur (€)</label>
        <div class="form-grid-2">
          ${users.map(u => `
            <div class="form-group">
              <label class="form-label" style="display:flex;align-items:center;gap:5px;">
                <span style="width:8px;height:8px;border-radius:50%;background:${escHtml(u.color||'#6C63FF')};display:inline-block;"></span>
                ${escHtml(u.name)}
              </label>
              <div class="input-wrap">
                <input type="number" class="form-input input-euro sv-goal-user"
                  data-uid="${u.id}" min="0" step="100"
                  value="${(s.savingsGoalsByUser || {})[String(u.id)] || ''}">
                <span class="input-suffix">€</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>` : ''}
      <div class="form-group" style="margin-bottom:10px;">
        <label class="form-label">Seuil d'alerte mensuel (€)</label>
        <div class="input-wrap">
          <input type="number" class="form-input input-euro" id="sv-threshold" min="0" step="10" value="${s.epargneThreshold || 100}">
          <span class="input-suffix">€</span>
        </div>
        <p class="form-hint">Sous ce seuil, l'indicateur mensuel passe en rouge.</p>
      </div>
      <button class="btn btn-primary btn-full" id="sv-save-goal">Enregistrer</button>
    </div>

    <!-- Section : Projection épargne 12 mois -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header"><span class="card-title">🔭 Projection épargne</span></div>
      <p style="font-size:0.78rem;color:var(--text-3);margin-bottom:10px;">Simulez l'impact d'un versement mensuel supplémentaire sur votre épargne.</p>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <label class="form-label" style="margin:0;white-space:nowrap;">Versement mensuel</label>
        <div class="input-wrap" style="flex:1;">
          <input type="number" class="form-input input-euro" id="proj-monthly" min="0" step="10" placeholder="Ex: 200">
          <span class="input-suffix">€</span>
        </div>
        <button class="btn btn-outline btn-sm" id="proj-calc">Calculer</button>
      </div>
      <div id="proj-result"></div>
    </div>
  `;

  // ── Événements ──
  el.querySelector('#btn-confirm')?.addEventListener('click', () => showConfirmModal(users, () => _renderPage(container)));
  el.querySelector('#btn-quick-confirm')?.addEventListener('click', () => showConfirmModal(users, () => _renderPage(container)));
  el.querySelector('#btn-add-op')?.addEventListener('click', () => showOpModal('add', users, () => _renderPage(container)));
  el.querySelector('#btn-withdraw-op')?.addEventListener('click', () => showOpModal('withdraw', users, () => _renderPage(container)));

  // ── Objectif épargne ──
  el.querySelector('#sv-save-goal')?.addEventListener('click', async () => {
    const goalsByUserNew = {};
    el.querySelectorAll('.sv-goal-user').forEach(inp => {
      const v = Number(inp.value);
      if (v > 0) goalsByUserNew[inp.dataset.uid] = v;
    });
    await Promise.all([
      setSetting('savingsGoal',        Number(el.querySelector('#sv-goal')?.value) || 0),
      setSetting('savingsGoalLabel',   el.querySelector('#sv-goal-label')?.value.trim() || 'Mon objectif'),
      setSetting('savingsGoalYear',    Number(el.querySelector('#sv-goal-year')?.value) || today().year),
      setSetting('epargneThreshold',   Number(el.querySelector('#sv-threshold')?.value) || 100),
      setSetting('savingsGoalsByUser', goalsByUserNew),
    ]);
    showToast('Objectif enregistré ✅', 'success');
    _renderPage(container);
  });

  // ── Projection épargne ──
  el.querySelector('#proj-calc')?.addEventListener('click', () => {
    const monthly  = Math.max(0, Number(el.querySelector('#proj-monthly')?.value) || 0);
    const current  = balance ?? 0;
    const goal     = Number(s.savingsGoal) || 0;
    const resultEl = el.querySelector('#proj-result');
    if (!resultEl) return;
    if (!monthly && !current && !goal) {
      resultEl.innerHTML = '<p style="color:var(--text-3);font-size:0.82rem;">Saisissez un montant mensuel.</p>';
      return;
    }
    const months = Array.from({ length: 12 }, (_, i) => {
      const bal = current + monthly * (i + 1);
      return bal;
    });
    const goalMonth = goal > 0 ? months.findIndex(b => b >= goal) : -1;
    const rows = months.map((b, i) => {
      const isMilestone = goal > 0 && Math.floor(b / goal) > Math.floor((b - monthly) / goal);
      return `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);${isMilestone ? 'font-weight:700;color:var(--success);' : ''}">
        <span style="font-size:0.82rem;">${MOIS[i] || 'M'+(i+1)}</span>
        <span style="font-size:0.82rem;">${eur(b)}</span>
        ${goal > 0 ? `<div class="progress-track" style="width:80px;height:5px;margin:auto 0;"><div class="progress-bar ${b >= goal ? 'success' : 'primary'}" style="width:${Math.min(100, Math.round(b / goal * 100))}%;"></div></div>` : ''}
      </div>`;
    }).join('');
    resultEl.innerHTML = `
      ${goalMonth >= 0
        ? `<p style="font-size:0.82rem;font-weight:700;color:var(--success);margin-bottom:8px;">🎯 Objectif atteint en ${goalMonth + 1} mois (${MOIS[goalMonth]}) !</p>`
        : goal > 0 ? `<p style="font-size:0.78rem;color:var(--text-3);margin-bottom:8px;">Objectif ${eur(goal)} non atteint en 12 mois (${eur(months[11])} atteint).</p>` : ''}
      <div>${rows}</div>
    `;
  });

  el.querySelectorAll('[data-savings-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      _savingsHistTab = btn.dataset.savingsTab;
      _renderPage(container);
    });
  });

  el.querySelectorAll('.op-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      showToastWithUndo('Opération supprimée',
        async () => { await deleteSavingsOperation(id); _renderPage(container); },
        6000, 'warning');
    });
  });
}

// ── Item d'opération ──
function buildOpItem(op, users = []) {
  const amount    = Number(op.amount) || 0;
  const isPos     = amount >= 0;
  const typeLabel = {
    add:             '💰 Versement',
    withdraw:        '🏧 Retrait',
    craquage_cover:  '💥 Craquage couvert',
    monthly_savings: '📅 Épargne mensuelle',
    confirm:         '✅ Confirmation',
  }[op.type] || '📌 Opération';

  const dateStr = `${nomMois(op.month)} ${op.year}`;
  const userLabel = op.userId
    ? (users.find(u => String(u.id) === String(op.userId))?.name ?? `User ${op.userId}`)
    : null;

  return `
    <div class="list-item" style="position:relative;">
      <div class="list-item-icon" style="background:${isPos ? 'var(--success-bg)' : 'var(--danger-bg)'};">
        ${isPos ? '📈' : '📉'}
      </div>
      <div class="list-item-body">
        <div class="list-item-title">${escHtml(op.label || typeLabel)}</div>
        <div class="list-item-sub">${typeLabel} · ${dateStr}${userLabel ? ` · <span style="font-weight:600;">${escHtml(userLabel)}</span>` : ''}</div>
      </div>
      <div class="list-item-right">
        <div class="list-item-amount" style="color:${isPos ? 'var(--success)' : 'var(--danger)'};">
          ${isPos ? '+' : ''}${eur(amount)}
        </div>
        <div style="font-size:0.7rem; color:var(--text-3);">Solde : ${eur(op._running)}</div>
      </div>
      <button class="btn-icon op-delete" data-id="${op.id}"
        style="position:absolute; top:4px; right:4px; width:28px; height:28px; color:var(--text-3);"
        title="Supprimer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  `;
}

// ── Modal : confirmer le solde mensuel ──
async function showConfirmModal(users, onSave) {
  const [allOps, latest] = await Promise.all([
    getAllSavingsOperations(),
    getLatestSavingsConfirmed(),
  ]);
  const { balance } = calcSavingsBalance(latest, allOps);
  const { year, month } = today();
  const moisLabel      = nomMois(month);
  const lastDayOfMonth = new Date(year, month, 0).getDate();
  const N = users.length;

  // Soldes calculés par user
  const userBalances = users.map(u => {
    const uOps = allOps.filter(op => String(op.userId) === String(u.id));
    const bal  = uOps.reduce((s, op) => s + (Number(op.amount) || 0), 0);
    return { user: u, balance: bal };
  });

  const perUserForm = N > 1 ? `
    <div class="form-group" style="margin-bottom:12px;">
      <label class="form-label">Solde réel par personne</label>
      <p style="font-size:0.72rem;color:var(--text-3);margin-bottom:8px;">Le bouton affiche le solde logique calculé. Corrigez si nécessaire.</p>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${userBalances.map(ub => `
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="width:10px;height:10px;border-radius:50%;background:${escHtml(ub.user.color||'#6C63FF')};display:inline-block;flex-shrink:0;"></span>
            <span style="font-size:0.82rem;font-weight:600;flex:1;">${escHtml(ub.user.name)}</span>
            <button type="button" class="btn btn-outline btn-sm conf-use-user" data-uid="${ub.user.id}" data-calc="${ub.balance}"
              style="font-size:0.72rem;padding:4px 8px;white-space:nowrap;">≈ ${eur(ub.balance)}</button>
            <div class="input-wrap" style="width:120px;">
              <input type="number" class="form-input input-euro conf-user-amount" data-uid="${ub.user.id}"
                min="0" step="0.01" placeholder="0.00" style="padding-right:22px;">
              <span class="input-suffix">€</span>
            </div>
          </div>
        `).join('')}
      </div>
      <div id="conf-total-display" style="text-align:right;font-size:0.82rem;font-weight:700;color:var(--primary);margin-top:8px;"></div>
    </div>` : `
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Solde logique (calculé)</label>
      <button class="btn btn-outline trf-preset" id="conf-use-calc"
        style="width:100%;justify-content:flex-start;font-size:0.85rem;padding:8px 12px;text-align:left;">
        ✅ Utiliser : <strong>${eur(balance)}</strong>
      </button>
      <div style="font-size:0.72rem;color:var(--text-3);margin-top:4px;">Basé sur la dernière confirmation + toutes les opérations</div>
    </div>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Ou saisir manuellement (€)</label>
      <div class="input-wrap">
        <input type="number" class="form-input input-euro" id="conf-amount" min="0" step="0.01" placeholder="0.00">
        <span class="input-suffix">€</span>
      </div>
      <div style="font-size:0.72rem;color:var(--text-3);margin-top:4px;">Si supérieur au solde logique, la différence sera enregistrée comme ajustement de ${moisLabel}</div>
    </div>`;

  openModal('✅ Confirmer le solde épargne', `
    <p style="color:var(--text-2); font-size:0.875rem; margin-bottom:12px;">
      Indiquez le solde <strong>réel actuel</strong> de votre épargne (livret, compte, cash…).
    </p>
    ${perUserForm}
    <div class="form-group">
      <label class="form-label">Note (optionnel)</label>
      <input type="text" class="form-input" id="conf-note" placeholder="Ex: Vérification début de mois">
    </div>
    <div style="margin-top:10px; font-size:0.75rem; color:var(--text-3);">Mois : ${moisLabel} ${year}</div>
  `, `
    <button class="btn btn-outline" id="conf-cancel">Annuler</button>
    <button class="btn btn-primary" id="conf-save">Confirmer</button>
  `);

  document.getElementById('conf-cancel')?.addEventListener('click', closeModal);

  if (N > 1) {
    const updateTotal = () => {
      const t = [...document.querySelectorAll('.conf-user-amount')]
        .reduce((s, inp) => s + (Number(inp.value) || 0), 0);
      const el = document.getElementById('conf-total-display');
      if (el) el.textContent = t > 0 ? `Total : ${eur(t)}` : '';
    };
    document.querySelectorAll('.conf-user-amount').forEach(inp => inp.addEventListener('input', updateTotal));
    document.querySelectorAll('.conf-use-user').forEach(btn => {
      btn.addEventListener('click', () => {
        const inp = document.querySelector(`.conf-user-amount[data-uid="${btn.dataset.uid}"]`);
        if (inp) { inp.value = Math.max(0, Number(btn.dataset.calc)).toFixed(2); updateTotal(); }
      });
    });
  } else {
    document.getElementById('conf-use-calc')?.addEventListener('click', () => {
      const inp = document.getElementById('conf-amount');
      if (inp) inp.value = balance.toFixed(2);
    });
  }

  document.getElementById('conf-save')?.addEventListener('click', async () => {
    const note = document.getElementById('conf-note')?.value.trim() || '';
    const now  = new Date();
    let totalAmount;

    if (N > 1) {
      const userAmts = [...document.querySelectorAll('.conf-user-amount')]
        .map(inp => ({ uid: inp.dataset.uid, amt: Number(inp.value) || 0 }));
      if (userAmts.every(x => x.amt === 0)) {
        showToast('Saisissez au moins un montant', 'error'); return;
      }
      totalAmount = userAmts.reduce((s, x) => s + x.amt, 0);
      // Ajustements par user si le montant saisi dépasse le solde calculé
      for (const { uid, amt } of userAmts) {
        if (amt === 0) continue;
        const ub = userBalances.find(x => String(x.user.id) === String(uid));
        const calcBal = ub?.balance ?? 0;
        if (amt > calcBal + 0.01) {
          const diff = Math.round((amt - calcBal) * 100) / 100;
          await saveSavingsOperation({
            amount: diff, label: `Ajustement ${moisLabel} ${year}`,
            type: 'add', userId: uid, year, month,
            day: lastDayOfMonth, createdAt: now.toISOString(),
          });
        }
      }
    } else {
      const amountStr = document.getElementById('conf-amount')?.value?.trim();
      totalAmount = amountStr ? Number(amountStr) : balance;
      if (isNaN(totalAmount) || totalAmount < 0) { showToast('Montant invalide', 'error'); return; }
      if (totalAmount > balance + 0.01) {
        const diff = Math.round((totalAmount - balance) * 100) / 100;
        await saveSavingsOperation({
          amount: diff, label: `Ajustement ${moisLabel} ${year}`,
          type: 'add', year, month,
          day: lastDayOfMonth, createdAt: now.toISOString(),
        });
      }
    }

    await saveSavingsConfirmed({ year, month, amount: totalAmount,
      confirmedAt: now.toISOString(), confirmedDay: now.getDate(), note });
    closeModal();
    showToast(`Solde confirmé : ${eur(totalAmount)} ✅`, 'success');
    onSave();
  });
}

// ── Modal : ajouter ou retirer une opération ──
function showOpModal(type, users, onSave) {
  const isAdd    = type === 'add';
  const title    = isAdd ? '💰 Nouveau versement' : '🏧 Nouveau retrait';
  const { year, month } = today();
  const now      = new Date();
  const N        = users.length;

  // Pour craquage partagé (passé en paramètre) : total à distribuer

  const userSection = N > 1 ? `
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Répartition par personne</label>
      <p style="font-size:0.72rem;color:var(--text-3);margin-bottom:8px;">Attribuez le montant total à au moins une personne</p>
      <div style="display:flex;flex-direction:column;gap:6px;" id="op-user-rows">
        ${users.map(u => `
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="width:10px;height:10px;border-radius:50%;background:${escHtml(u.color||'#6C63FF')};display:inline-block;flex-shrink:0;"></span>
            <span style="font-size:0.82rem;font-weight:600;flex:1;">${escHtml(u.name)}</span>
            <div class="input-wrap" style="width:110px;">
              <input type="number" class="form-input input-euro op-user-amount" data-uid="${u.id}"
                min="0" step="0.01" placeholder="0.00" style="padding-right:22px;">
              <span class="input-suffix">€</span>
            </div>
            <button type="button" class="btn btn-outline btn-sm op-fill-rest" data-uid="${u.id}" style="white-space:nowrap;padding:6px 10px;font-size:0.75rem;">← Reste</button>
          </div>
        `).join('')}
      </div>
      <div id="op-user-total" style="text-align:right;font-size:0.78rem;color:var(--text-3);margin-top:6px;"></div>
    </div>
  ` : '';

  openModal(title, `
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Montant total (€)</label>
      <div class="input-wrap">
        <input type="number" class="form-input input-euro" id="op-amount"
          min="0" step="0.01" placeholder="0.00">
        <span class="input-suffix">€</span>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Libellé</label>
      <input type="text" class="form-input" id="op-label"
        placeholder="${isAdd ? 'Ex: Virement Livret A, Salaire épargné…' : 'Ex: Achat voiture, Vacances…'}">
    </div>
    <div class="form-grid-2" style="margin-bottom:10px;">
      <div class="form-group">
        <label class="form-label">Jour</label>
        <input type="number" class="form-input" id="op-day" min="1" max="31" value="${now.getDate()}">
      </div>
      <div class="form-group">
        <label class="form-label">Mois</label>
        <input type="number" class="form-input" id="op-month" min="1" max="12" value="${month}">
      </div>
    </div>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Année</label>
      <input type="number" class="form-input" id="op-year" min="2020" max="2099" value="${year}">
    </div>
    ${userSection}
  `, `
    <button class="btn btn-outline" id="op-cancel">Annuler</button>
    <button class="btn ${isAdd ? 'btn-success' : 'btn-danger'}" id="op-save">
      ${isAdd ? '+ Ajouter' : '- Retirer'}
    </button>
  `);

  // ── Logique fill-rest ──
  if (N > 1) {
    function updateUserTotal() {
      const total = [...document.querySelectorAll('.op-user-amount')]
        .reduce((s, inp) => s + (Number(inp.value) || 0), 0);
      const mainAmt = Number(document.getElementById('op-amount')?.value) || 0;
      const el = document.getElementById('op-user-total');
      if (el) el.textContent = total > 0 ? `Alloué : ${eur(total)}${mainAmt > 0 ? ` / ${eur(mainAmt)}` : ''}` : '';
    }

    document.querySelectorAll('.op-user-amount').forEach(inp => {
      inp.addEventListener('input', updateUserTotal);
    });

    document.getElementById('op-amount')?.addEventListener('input', updateUserTotal);

    document.querySelectorAll('.op-fill-rest').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid  = btn.dataset.uid;
        const mainAmt = Number(document.getElementById('op-amount')?.value) || 0;
        const allocated = [...document.querySelectorAll('.op-user-amount')]
          .filter(inp => inp.dataset.uid !== uid)
          .reduce((s, inp) => s + (Number(inp.value) || 0), 0);
        const rest = Math.max(0, Math.round((mainAmt - allocated) * 100) / 100);
        const target = document.querySelector(`.op-user-amount[data-uid="${uid}"]`);
        if (target) { target.value = rest; updateUserTotal(); }
      });
    });
  }

  document.getElementById('op-cancel')?.addEventListener('click', closeModal);

  document.getElementById('op-save')?.addEventListener('click', async () => {
    const amount = Number(document.getElementById('op-amount')?.value);
    if (!amount || amount <= 0) { showToast('Montant invalide', 'error'); return; }
    const label = document.getElementById('op-label')?.value.trim() || (isAdd ? 'Versement' : 'Retrait');
    const m     = Number(document.getElementById('op-month')?.value) || month;
    const y     = Number(document.getElementById('op-year')?.value) || year;
    const d     = Number(document.getElementById('op-day')?.value)   || now.getDate();

    const userAmounts = N > 1
      ? [...document.querySelectorAll('.op-user-amount')]
          .map(inp => ({ uid: inp.dataset.uid, amt: Number(inp.value) || 0 }))
          .filter(u => u.amt > 0)
      : [];

    if (N > 1 && userAmounts.length === 0) {
      showToast('Attribuez le montant à au moins une personne', 'error');
      return;
    }

    if (userAmounts.length > 0) {
      // Enregistrer une op par user
      for (const { uid, amt } of userAmounts) {
        await saveSavingsOperation({
          amount:  isAdd ? amt : -amt,
          label,
          type:    isAdd ? 'add' : 'withdraw',
          userId:  uid,
          year:    y,
          month:   m,
          day:     d,
          createdAt: now.toISOString(),
        });
      }
    } else {
      // Op globale sans user (N === 1)
      await saveSavingsOperation({
        amount:  isAdd ? amount : -amount,
        label,
        type:    isAdd ? 'add' : 'withdraw',
        year:    y,
        month:   m,
        day:     d,
        createdAt: now.toISOString(),
      });
    }

    closeModal();
    showToast(isAdd ? `+${eur(amount)} ajouté ✅` : `-${eur(amount)} retiré`, 'success');
    onSave();
  });
}

// ══════════════════════════════════════════════════
// ÉPARGNE SALARIALE
// ══════════════════════════════════════════════════

// Constantes d'abondement
const ABON_RATIO         = 22.58 / 50;            // 45.16% — l'employeur abonde 22.58€ par 50€ versés
const ABON_MAX_YEAR      = 1000;                   // max 1 000€ d'abondement par AN (total des 2 périodes)
// Versements nécessaires pour atteindre les 1 000€ d'abondement sur l'année
const ABON_CONTRIB_FOR_YEAR_MAX = ABON_MAX_YEAR / ABON_RATIO; // ≈ 2 215€/an

// Périodes : mai 28 (période déc-mai) et nov 28 (période juin-nov)
function _abon_period(year, month) {
  // Returns { period, periodStart, periodEnd } for a given year/month
  if (month >= 6 && month <= 11) return { period: 'novembre', periodStart: { year, month: 6 }, periodEnd: { year, month: 11 } };
  if (month === 12)              return { period: 'mai',       periodStart: { year, month: 12 }, periodEnd: { year: year + 1, month: 5 } };
  /* month 1-5 */                return { period: 'mai',       periodStart: { year: year - 1, month: 12 }, periodEnd: { year, month: 5 } };
}

function _inPeriod(ym_year, ym_month, start, end) {
  const ym  = ym_year * 100 + ym_month;
  const s   = start.year * 100 + start.month;
  const e   = end.year * 100 + end.month;
  return ym >= s && ym <= e;
}

function _abon_label(period, year) {
  return period === 'mai' ? `28 mai ${year}` : `28 novembre ${year}`;
}

async function _renderSalariale(el, container) {
  const [allOps, allAbons, users] = await Promise.all([
    getAllSalarySavings(),
    getAllSalaryAbondements(),
    getActiveUsers(),
  ]);

  const { year, month, day } = today();

  // ── Totaux globaux ──
  const totalNet  = allOps.reduce((s, op) => s + (Number(op.amount) || 0), 0);
  const totalAbon = allAbons.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const totalBrut = totalNet + totalAbon;

  // ── Abondement annuel (année civile courante) ──
  const yearAbons         = allAbons.filter(a => a.year === year);
  const yearAbonTotal     = yearAbons.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const yearAbonRemaining = Math.max(0, ABON_MAX_YEAR - yearAbonTotal);

  // ── Versements de l'année courante ──
  const yearOps    = allOps.filter(op => op.year === year);
  const yearContrib = yearOps.reduce((s, op) => s + (Number(op.amount) || 0), 0);

  // ── Période courante ──
  const curPeriod     = _abon_period(year, month);
  const periodOps     = allOps.filter(op => _inPeriod(op.year, op.month, curPeriod.periodStart, curPeriod.periodEnd));
  const periodContrib = periodOps.reduce((s, op) => s + (Number(op.amount) || 0), 0);
  // Abondement de cette période : plafonné au reste disponible sur l'année
  const estimatedAbonPeriod = Math.min(periodContrib * ABON_RATIO, yearAbonRemaining);
  // Versements manquants pour épuiser la capacité restante annuelle
  const abonMissing   = yearAbonRemaining <= 0 ? 0 : Math.max(0, (yearAbonRemaining / ABON_RATIO) - periodContrib);
  const pctPeriod     = yearAbonRemaining <= 0 ? 100 : Math.min(100, Math.round((periodContrib / (yearAbonRemaining / ABON_RATIO)) * 100));

  // Prochain abondement
  const nextAbonDate  = curPeriod.period === 'mai' ? `28 mai ${curPeriod.periodEnd.year}` : `28 novembre ${curPeriod.periodEnd.year}`;

  // ── Mois courant ──
  const monthlyOps = allOps.filter(op => op.year === year && op.month === month);
  const monthlyTotal = monthlyOps.reduce((s, op) => s + (Number(op.amount) || 0), 0);

  // ── Tri historique ──
  const sortedOps = [...allOps].sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    if (b.month !== a.month) return b.month - a.month;
    return (b.day || 0) - (a.day || 0);
  });

  el.innerHTML = `
    <!-- KPI net / abondé -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
      <div class="kpi-card" style="--kpi-color:var(--primary);padding:16px;text-align:center;">
        <div class="kpi-label" style="font-size:0.67rem;">💶 Montant net versé</div>
        <div class="kpi-value" style="font-size:1.5rem;color:var(--primary);">${eur(totalNet)}</div>
        <div style="font-size:0.68rem;color:var(--text-3);margin-top:2px;">de notre poche</div>
      </div>
      <div class="kpi-card" style="--kpi-color:var(--success);padding:16px;text-align:center;">
        <div class="kpi-label" style="font-size:0.67rem;">🏦 Montant abondé total</div>
        <div class="kpi-value" style="font-size:1.5rem;color:var(--success);">${eur(totalBrut)}</div>
        <div style="font-size:0.68rem;color:var(--text-3);margin-top:2px;">net + ${eur(totalAbon)} d'abondement</div>
      </div>
    </div>

    <!-- Période courante + progrès vers abondement -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header">
        <span class="card-title">🎯 Progression vers l'abondement</span>
        <span class="chip primary">${nextAbonDate}</span>
      </div>
      <div style="margin-bottom:10px;">
        <div class="progress-wrap" style="margin-bottom:4px;">
          <div class="progress-labels">
            <span>Versé cette période : ${eur(periodContrib)}</span>
            <span style="color:var(--text-3);">${yearAbonRemaining <= 0 ? '✅ Plafond annuel atteint' : `capacité restante ${eur(yearAbonRemaining)} d'abond.`}</span>
          </div>
          <div class="progress-track"><div class="progress-bar ${pctPeriod >= 100 || yearAbonRemaining <= 0 ? 'success' : 'primary'}" style="width:${pctPeriod}%;"></div></div>
        </div>
        <div style="font-size:0.75rem;color:var(--text-3);">${yearAbonRemaining <= 0
          ? '✅ Le plafond de 1 000€ d\'abondement annuel est atteint !'
          : pctPeriod >= 100
            ? `✅ Vous avez versé assez pour épuiser la capacité restante (${eur(yearAbonRemaining)} d'abond. disponible)`
            : `Il manque ${eur(abonMissing)} de versements pour utiliser toute la capacité restante`}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
        <div style="background:var(--success-bg);border-radius:var(--radius-sm);padding:10px;text-align:center;">
          <div style="font-size:0.62rem;color:var(--text-3);font-weight:700;text-transform:uppercase;">Abond. période</div>
          <div style="font-size:1rem;font-weight:800;color:var(--success);margin-top:2px;">${eur(estimatedAbonPeriod)}</div>
          <div style="font-size:0.62rem;color:var(--text-3);">sur ${eur(yearAbonRemaining)} dispo</div>
        </div>
        <div style="background:var(--bg-secondary);border-radius:var(--radius-sm);padding:10px;text-align:center;">
          <div style="font-size:0.62rem;color:var(--text-3);font-weight:700;text-transform:uppercase;">Abond. année ${year}</div>
          <div style="font-size:1rem;font-weight:800;color:var(--primary);margin-top:2px;">${eur(yearAbonTotal)}</div>
          <div style="font-size:0.62rem;color:var(--text-3);">/ ${eur(ABON_MAX_YEAR)} max</div>
        </div>
        <div style="background:var(--bg-secondary);border-radius:var(--radius-sm);padding:10px;text-align:center;">
          <div style="font-size:0.62rem;color:var(--text-3);font-weight:700;text-transform:uppercase;">Ce mois</div>
          <div style="font-size:1rem;font-weight:800;color:var(--primary);margin-top:2px;">${eur(monthlyTotal)}</div>
          <div style="font-size:0.62rem;color:var(--text-3);">${monthlyOps.length} versement(s)</div>
        </div>
      </div>
      <div style="margin-top:10px;font-size:0.72rem;color:var(--text-3);padding:8px 10px;background:var(--bg-secondary);border-radius:var(--radius-sm);">
        <strong>Règle :</strong> taux d'abondement <strong>${(ABON_RATIO * 100).toFixed(2)}%</strong>
        (${eur(22.58)} pour ${eur(50)} versés) — plafond <strong>${eur(ABON_MAX_YEAR)}/an</strong> sur 2 périodes (28 mai · 28 novembre).
        Pour maximiser les 1 000€ sur l'année, il faut verser ${eur(ABON_CONTRIB_FOR_YEAR_MAX)} au total.
      </div>
    </div>

    <!-- Abondements confirmés -->
    <div class="card" style="margin-bottom:12px;">
      <div class="card-header">
        <span class="card-title">✅ Abondements confirmés</span>
        <span class="chip">${allAbons.length}</span>
      </div>
      ${allAbons.length === 0
        ? '<p style="font-size:0.82rem;color:var(--text-3);">Aucun abondement enregistré.</p>'
        : `<div class="item-list">${
            [...allAbons].sort((a,b) => b.year - a.year || (b.period === 'mai' ? -1 : 1)).map(ab => `
              <div class="list-item">
                <div class="list-item-icon" style="background:var(--success-bg);">🏦</div>
                <div class="list-item-body">
                  <div class="list-item-title">${escHtml(_abon_label(ab.period, ab.year))}</div>
                  <div class="list-item-sub">${ab.note ? escHtml(ab.note) : 'Abondement employeur'} · Versé : ${eur(ab.contributions ?? 0)}</div>
                </div>
                <div class="list-item-right">
                  <div class="list-item-amount" style="color:var(--success);">+${eur(ab.amount)}</div>
                  <button class="btn btn-sm btn-outline abon-delete" data-id="${ab.id}" style="margin-top:4px;font-size:0.65rem;padding:2px 6px;color:var(--danger);">✕</button>
                </div>
              </div>
            `).join('')}
          </div>`
      }
    </div>

    <!-- Actions -->
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
      <button class="btn btn-primary" id="sal-btn-add">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Ajouter un versement
      </button>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button class="btn btn-success" id="sal-btn-abon">🏦 Valider un abondement</button>
        <button class="btn btn-secondary" id="sal-btn-transfer">💸 Transférer vers économies</button>
      </div>
      <button class="btn btn-outline btn-full" id="sal-btn-abon-recu" style="margin-top:8px;">✅ Abondement déjà perçu</button>
    </div>

    <!-- Historique versements -->
    <div class="section-header" style="margin-bottom:8px;">
      <span class="section-label">📋 Historique des versements</span>
      <span class="chip">${sortedOps.length}</span>
    </div>
    ${sortedOps.length === 0
      ? `<div class="empty-state"><div class="empty-state-icon">🏦</div><div class="empty-state-title">Aucun versement</div><div class="empty-state-text">Ajoutez vos versements mensuels pour suivre votre épargne salariale.</div></div>`
      : `<div class="item-list">${sortedOps.map(op => `
          <div class="list-item">
            <div class="list-item-icon" style="background:var(--primary-bg);">💶</div>
            <div class="list-item-body">
              <div class="list-item-title">${escHtml(op.label || 'Versement')}</div>
              <div class="list-item-sub">${nomMois(op.month)} ${op.year}${op.day ? ' · j.' + op.day : ''}${op.type === 'extra' ? ' · ponctuel' : ''}</div>
            </div>
            <div class="list-item-right">
              <div class="list-item-amount" style="color:var(--primary);">+${eur(op.amount)}</div>
              <button class="btn btn-sm btn-outline sal-op-delete" data-id="${op.id}" style="margin-top:4px;font-size:0.65rem;padding:2px 6px;color:var(--danger);">✕</button>
            </div>
          </div>
        `).join('')}</div>`
    }
    <div style="height:24px;"></div>
  `;

  // ── Événements ──
  el.querySelector('#sal-btn-add')?.addEventListener('click', () => _showSalAddModal(users, () => _renderPage(container)));
  el.querySelector('#sal-btn-abon')?.addEventListener('click', () => _showSalAbonModal(allOps, allAbons, users, () => _renderPage(container)));
  el.querySelector('#sal-btn-abon-recu')?.addEventListener('click', () => _showSalAbonRecuModal(allAbons, () => _renderPage(container)));
  el.querySelector('#sal-btn-transfer')?.addEventListener('click', () => _showSalTransferModal(totalBrut, users, () => _renderPage(container)));

  el.querySelectorAll('.sal-op-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      showToastWithUndo('Versement supprimé',
        async () => { await deleteSalarySaving(id); _renderPage(container); },
        6000, 'warning');
    });
  });

  el.querySelectorAll('.abon-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      showToastWithUndo('Abondement supprimé',
        async () => { await deleteSalaryAbondement(id); _renderPage(container); },
        6000, 'warning');
    });
  });
}

// ── Modal : ajouter un versement salarial ──
function _showSalAddModal(users, onSave) {
  const { year, month } = today();
  const now = new Date();
  openModal('💶 Ajouter un versement', `
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Montant (€) *</label>
      <div class="input-wrap">
        <input type="number" class="form-input input-euro" id="sal-amount" min="0.01" step="0.01" placeholder="50.00">
        <span class="input-suffix">€</span>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Libellé</label>
      <input type="text" class="form-input" id="sal-label" placeholder="Ex: Versement mensuel, Versement exceptionnel…">
    </div>
    <div class="form-grid-2" style="margin-bottom:10px;">
      <div class="form-group">
        <label class="form-label">Mois</label>
        <input type="number" class="form-input" id="sal-month" min="1" max="12" value="${month}">
      </div>
      <div class="form-group">
        <label class="form-label">Année</label>
        <input type="number" class="form-input" id="sal-year" min="2020" max="2099" value="${year}">
      </div>
    </div>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Jour</label>
      <input type="number" class="form-input" id="sal-day" min="1" max="31" value="${now.getDate()}">
    </div>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Type</label>
      <select class="form-select" id="sal-type">
        <option value="monthly">📅 Versement mensuel régulier</option>
        <option value="extra">⚡ Versement ponctuel (extra)</option>
      </select>
    </div>
  `, `
    <button class="btn btn-outline" id="sal-cancel">Annuler</button>
    <button class="btn btn-primary" id="sal-save">+ Ajouter</button>
  `);

  document.getElementById('sal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('sal-save')?.addEventListener('click', async () => {
    const amount = Number(document.getElementById('sal-amount')?.value);
    if (!amount || amount <= 0) { showToast('Montant invalide', 'error'); return; }
    const label = document.getElementById('sal-label')?.value.trim() || 'Versement';
    const m     = Number(document.getElementById('sal-month')?.value) || month;
    const y     = Number(document.getElementById('sal-year')?.value)  || year;
    const d     = Number(document.getElementById('sal-day')?.value)   || now.getDate();
    const type  = document.getElementById('sal-type')?.value || 'monthly';
    await saveSalarySaving({ amount, label, type, year: y, month: m, day: d, createdAt: now.toISOString() });
    closeModal();
    showToast(`+${eur(amount)} enregistré ✅`, 'success');
    onSave();
  });
}

// ── Modal : valider un abondement ──
function _showSalAbonModal(allOps, allAbons, users, onSave) {
  const { year, month } = today();
  // Proposer mai ou novembre selon la période courante
  const period = _abon_period(year, month);
  const abonYear = period.period === 'mai' ? period.periodEnd.year : period.periodEnd.year;
  const periodOps = allOps.filter(op => _inPeriod(op.year, op.month, period.periodStart, period.periodEnd));
  const periodContrib = periodOps.reduce((s, op) => s + (Number(op.amount) || 0), 0);
  // Capacité annuelle restante (abondements déjà confirmés cette année)
  const yearAbonsConfirmed = allAbons.filter(a => a.year === year).reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const yearCapLeft = Math.max(0, ABON_MAX_YEAR - yearAbonsConfirmed);
  const estimated = Math.round(Math.min(periodContrib * ABON_RATIO, yearCapLeft) * 100) / 100;

  openModal('🏦 Valider un abondement', `
    <p style="font-size:0.82rem;color:var(--text-2);margin-bottom:12px;">
      Renseignez le montant réel de l'abondement reçu. Il sera ajouté à votre total abondé.
    </p>
    <div class="form-grid-2" style="margin-bottom:10px;">
      <div class="form-group">
        <label class="form-label">Période</label>
        <select class="form-select" id="abon-period">
          <option value="mai" ${period.period === 'mai' ? 'selected' : ''}>28 mai</option>
          <option value="novembre" ${period.period === 'novembre' ? 'selected' : ''}>28 novembre</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Année</label>
        <input type="number" class="form-input" id="abon-year" min="2020" max="2099" value="${abonYear}">
      </div>
    </div>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Montant de l'abondement reçu (€) *</label>
      <div class="input-wrap">
        <input type="number" class="form-input input-euro" id="abon-amount" min="0" step="0.01" value="${estimated}" placeholder="${estimated}">
        <span class="input-suffix">€</span>
      </div>
      <p class="form-hint">Estimé : ${eur(estimated)} (${(ABON_RATIO*100).toFixed(2)}% × ${eur(periodContrib)}, plafonné à la capacité restante ${eur(yearCapLeft)}) — modifiez si nécessaire.</p>
    </div>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Versements de la période (€)</label>
      <div class="input-wrap">
        <input type="number" class="form-input input-euro" id="abon-contribs" min="0" step="0.01" value="${periodContrib}">
        <span class="input-suffix">€</span>
      </div>
      <p class="form-hint">Versements que vous avez effectués sur la période (calculé : ${eur(periodContrib)}).</p>
    </div>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Note</label>
      <input type="text" class="form-input" id="abon-note" placeholder="Ex: Abondement mai 2026…">
    </div>
  `, `
    <button class="btn btn-outline" id="abon-cancel">Annuler</button>
    <button class="btn btn-success" id="abon-save">✅ Valider l'abondement</button>
  `);

  document.getElementById('abon-cancel')?.addEventListener('click', closeModal);
  document.getElementById('abon-save')?.addEventListener('click', async () => {
    const amount      = Number(document.getElementById('abon-amount')?.value);
    if (!amount || amount <= 0) { showToast('Montant invalide', 'error'); return; }
    const abon_period = document.getElementById('abon-period')?.value || 'mai';
    const abon_year   = Number(document.getElementById('abon-year')?.value) || year;
    const contributions = Number(document.getElementById('abon-contribs')?.value) || 0;
    const note        = document.getElementById('abon-note')?.value.trim() || '';
    await saveSalaryAbondement({
      period: abon_period, year: abon_year, amount, contributions,
      note, confirmedAt: new Date().toISOString(),
    });
    closeModal();
    showToast(`Abondement de ${eur(amount)} validé ✅`, 'success');
    onSave();
  });
}

// ── Modal : abondement déjà perçu (saisie directe) ──
function _showSalAbonRecuModal(allAbons, onSave) {
  const { year } = today();
  const yearAbonsConfirmed = allAbons.filter(a => a.year === year).reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const yearCapLeft = Math.max(0, ABON_MAX_YEAR - yearAbonsConfirmed);

  openModal('✅ Abondement déjà perçu', `
    <p style="font-size:0.82rem;color:var(--text-2);margin-bottom:12px;">
      Enregistrez un abondement que vous avez déjà reçu. Il s'ajoutera directement au montant abondé total.
    </p>
    <div class="form-grid-2" style="margin-bottom:10px;">
      <div class="form-group">
        <label class="form-label">Période</label>
        <select class="form-select" id="abon-recu-period">
          <option value="mai">28 mai</option>
          <option value="novembre">28 novembre</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Année</label>
        <input type="number" class="form-input" id="abon-recu-year" min="2020" max="2099" value="${year}">
      </div>
    </div>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Montant perçu (€) *</label>
      <div class="input-wrap">
        <input type="number" class="form-input input-euro" id="abon-recu-amount" min="0" step="0.01" placeholder="0.00" autofocus>
        <span class="input-suffix">€</span>
      </div>
      ${yearCapLeft > 0 ? `<p class="form-hint">Capacité restante cette année : ${eur(yearCapLeft)}</p>` : `<p class="form-hint" style="color:var(--warning);">⚠️ Le plafond annuel de ${eur(ABON_MAX_YEAR)} est déjà atteint pour ${year}.</p>`}
    </div>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Note (optionnel)</label>
      <input type="text" class="form-input" id="abon-recu-note" placeholder="Ex: Abondement PEE mai 2026…">
    </div>
  `, `
    <button class="btn btn-outline" id="abon-recu-cancel">Annuler</button>
    <button class="btn btn-success" id="abon-recu-save">✅ Enregistrer</button>
  `);

  document.getElementById('abon-recu-cancel')?.addEventListener('click', closeModal);
  document.getElementById('abon-recu-save')?.addEventListener('click', async () => {
    const amount = Number(document.getElementById('abon-recu-amount')?.value);
    if (!amount || amount <= 0) { showToast('Montant invalide', 'error'); return; }
    const period = document.getElementById('abon-recu-period')?.value || 'mai';
    const abonYear = Number(document.getElementById('abon-recu-year')?.value) || year;
    const note = document.getElementById('abon-recu-note')?.value.trim() || '';
    await saveSalaryAbondement({
      period, year: abonYear, amount, contributions: 0,
      note: note || `Abondement perçu — ${period} ${abonYear}`,
      confirmedAt: new Date().toISOString(),
    });
    closeModal();
    showToast(`Abondement de ${eur(amount)} enregistré ✅`, 'success');
    onSave();
  });
}

// ── Modal : transférer vers les économies ──
function _showSalTransferModal(totalBrut, users, onSave) {
  const { year, month } = today();
  const now = new Date();
  const N = users.length;
  const userSection = N > 1 ? `
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Transférer au compte de</label>
      <select class="form-select" id="sal-trf-user">
        ${users.map(u => `<option value="${u.id}">${escHtml(u.name)}</option>`).join('')}
      </select>
    </div>
  ` : `<input type="hidden" id="sal-trf-user" value="${users[0]?.id ?? ''}">`;

  openModal('💸 Transférer vers les économies', `
    <p style="font-size:0.82rem;color:var(--text-2);margin-bottom:12px;">
      Ce transfert enregistre un versement dans vos économies (sortie de l'épargne salariale).
    </p>
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Montant à transférer (€) *</label>
      <div class="input-wrap">
        <input type="number" class="form-input input-euro" id="sal-trf-amount" min="0.01" step="0.01" value="${totalBrut.toFixed(2)}">
        <span class="input-suffix">€</span>
      </div>
      <p class="form-hint">Total disponible (abondé) : ${eur(totalBrut)}</p>
    </div>
    ${userSection}
    <div class="form-group" style="margin-bottom:10px;">
      <label class="form-label">Libellé</label>
      <input type="text" class="form-input" id="sal-trf-label" value="Transfert épargne salariale" placeholder="Ex: Déblocage PEE…">
    </div>
  `, `
    <button class="btn btn-outline" id="sal-trf-cancel">Annuler</button>
    <button class="btn btn-primary" id="sal-trf-save">Transférer</button>
  `);

  document.getElementById('sal-trf-cancel')?.addEventListener('click', closeModal);
  document.getElementById('sal-trf-save')?.addEventListener('click', async () => {
    const amount = Number(document.getElementById('sal-trf-amount')?.value);
    if (!amount || amount <= 0) { showToast('Montant invalide', 'error'); return; }
    const userId = document.getElementById('sal-trf-user')?.value || null;
    const label  = document.getElementById('sal-trf-label')?.value.trim() || 'Transfert épargne salariale';
    await saveSavingsOperation({
      amount, label, type: 'add', userId: userId || undefined,
      year, month, day: now.getDate(), createdAt: now.toISOString(),
    });
    closeModal();
    showToast(`${eur(amount)} transféré vers les économies ✅`, 'success');
    onSave();
  });
}

