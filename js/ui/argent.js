// ============================================================
// js/ui/argent.js – Page "Ce mois" : Saisie mensuelle + Budgets
// ============================================================

import * as saisieModule  from './saisie.js';
import * as chargesModule from './charges.js';
import { getActiveUsers, getMonthlyData, getChargesForMonth,
         getBudgetOpsForMonth }                               from '../db.js';
import { State }                                              from '../app.js';
import { nomMois }                                            from '../utils.js';

// tabs: saisie | budgets
let _arTab = 'saisie';

// ── Suivi de l'activité revenus (pour la barre de progression) ──
let _lastRevInput  = 0;
let _revDoneTimer  = null;

// ── Auto-avance charges → Budgets ──
let _prevHasChg       = false;
let _chgAutoAdvTimer  = null;

// ── Barre de progression partagée Saisie / Budgets ──
async function _renderSharedProgress(container) {
  const bar = container.querySelector('#argent-shared-progress');
  if (!bar) return;
  const { year, month } = State;
  const [users, md, charges, budgetOps] = await Promise.all([
    getActiveUsers(),
    getMonthlyData(year, month),
    getChargesForMonth(month, year),
    getBudgetOpsForMonth(year, month),
  ]);
  const hasRevData  = users.some(u => (md?.users?.[String(u.id)]?.revenus || 0) > 0);
  const isRevRecent = _lastRevInput > 0 && (Date.now() - _lastRevInput) < 5000;
  // "done" = données enregistrées + 5s d'inactivité ; "active" = en cours de saisie ou données partielles
  const revState  = hasRevData && !isRevRecent ? 'done'
                  : hasRevData || isRevRecent  ? 'active' : '';
  const hasChg  = charges.length > 0;
  const hasBudg = budgetOps.length > 0;
  const isDone  = md?.isComplete;

  // ── Auto-avance : quand charges passent de 0 à ≥1, basculer vers Budgets après 5s ──
  if (hasChg && !_prevHasChg && _arTab === 'saisie') {
    if (_chgAutoAdvTimer) clearTimeout(_chgAutoAdvTimer);
    _chgAutoAdvTimer = setTimeout(() => {
      if (!document.contains(container)) return;
      const tabBudgets = container.querySelector('[data-artab="budgets"]');
      if (tabBudgets && _arTab !== 'budgets') tabBudgets.click();
    }, 5000);
  }
  _prevHasChg = hasChg;
  const states = [
    revState,
    hasChg  ? 'done' : (revState === 'done' ? 'active' : ''),
    hasBudg ? 'done' : (_arTab === 'budgets' ? 'active' : (hasChg ? 'active' : '')),
    isDone  ? 'done' : '',
  ];
  const texts = [states[0] === 'done' ? '✓' : '1', hasChg ? '✓' : '2', hasBudg ? '✓' : '3', isDone ? '✓' : '4'];
  const labels = ['Revenus', 'Charges', 'Budgets', 'Valider'];
  bar.innerHTML = `<div class="saisie-progress" id="saisie-progress-bar">
    ${states.map((s, i) => `
      <button type="button" class="saisie-prog-step ${s} saisie-prog-global-nav" data-prog-idx="${i}" style="background:none;border:none;cursor:pointer;">
        <div class="saisie-prog-dot ${s}">${texts[i]}</div>
        <div class="saisie-prog-label">${labels[i]}${i === 2 ? '<span style="display:block;font-size:0.58rem;color:var(--text-3);font-weight:400;">optionnel</span>' : ''}</div>
      </button>`).join('')}
  </div>`;
  bar.querySelectorAll('.saisie-prog-global-nav').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.progIdx);
      const tabSaisie  = container.querySelector('[data-artab="saisie"]');
      const tabBudgets = container.querySelector('[data-artab="budgets"]');
      if (idx === 0 || idx === 1 || idx === 3) {
        // Basculer sur Saisie mensuelle
        if (tabSaisie) { tabSaisie.click(); }
        // Puis ouvrir le bon accordéon (avec léger délai pour le render)
        const targets = ['accord-revenus', 'accord-charges', null, 'accord-recap'];
        const target = targets[idx];
        if (target) {
          setTimeout(() => {
            const body = container.querySelector('#argent-body');
            ['accord-revenus', 'accord-charges', 'accord-recap'].forEach(id => {
              const el = body?.querySelector(`#${id}`);
              if (el) el.removeAttribute('open');
            });
            const targetEl = body?.querySelector(`#${target}`);
            if (targetEl) { targetEl.setAttribute('open', ''); targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
          }, 80);
        }
      } else {
        // idx === 2 → Budgets
        if (tabBudgets) tabBudgets.click();
      }
    });
  });
}

// ── Observation des champs revenus pour la barre de progression ──
function _watchSaisieInputs(container) {
  const body = container.querySelector('#argent-body');
  if (!body) return;
  body.querySelectorAll('input[id^="rev-"]').forEach(input => {
    if (input.dataset.progressWatched) return; // éviter les doublons
    input.dataset.progressWatched = '1';
    input.addEventListener('input', () => {
      _lastRevInput = Date.now();
      _renderSharedProgress(container); // passage immédiat en 'active'
      if (_revDoneTimer) clearTimeout(_revDoneTimer);
      _revDoneTimer = setTimeout(() => {
        _renderSharedProgress(container); // passage en 'done' après 5s
      }, 5000);
    });
  });
}

export async function render(container, params = {}) {
  if (params.tab) _arTab = params.tab;
  // Guard: anciens noms de tabs
  if (['saisir', 'epargne', 'recurrentes', 'charges'].includes(_arTab)) _arTab = 'saisie';
  if (_arTab === 'depenses') _arTab = 'budgets';

  const { year, month } = State;
  container.innerHTML = `
    <div id="argent-shared-progress"></div>
    <div class="tabs" id="argent-tabs" style="margin-bottom:0;">
      <button class="tab-btn ${_arTab === 'saisie'   ? 'active' : ''}" data-artab="saisie">📝 Saisie mensuelle</button>
      <button class="tab-btn ${_arTab === 'budgets'  ? 'active' : ''}" data-artab="budgets">📊 Budgets</button>
    </div>
    <div id="argent-body" style="margin-top:12px;"></div>
  `;

  _renderSharedProgress(container);

  const renderTab = () => {
    const body = container.querySelector('#argent-body');
    if (!body) return;
    if (_arTab === 'saisie')   saisieModule.render(body);
    else                       chargesModule.renderSection(body, 'budgets');
    // Rafraîchir la barre + attacher les watchers après rendu de l'onglet
    setTimeout(() => {
      _renderSharedProgress(container);
      if (_arTab === 'saisie') _watchSaisieInputs(container);
    }, 200);
  };

  container.querySelectorAll('#argent-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('#argent-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _arTab = btn.dataset.artab;
      renderTab();
    });
  });

  renderTab();
}

