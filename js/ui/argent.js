// ============================================================
// js/ui/argent.js – Page "Ce mois" : Saisie mensuelle + Budgets
// ============================================================

import * as saisieModule  from './saisie.js';
import * as chargesModule from './charges.js';

// tabs: saisie | budgets
let _arTab = 'saisie';

export async function render(container, params = {}) {
  if (params.tab) _arTab = params.tab;
  // Guard: anciens noms de tabs
  if (['saisir', 'epargne', 'recurrentes', 'charges'].includes(_arTab)) _arTab = 'saisie';
  if (_arTab === 'depenses') _arTab = 'budgets';

  container.innerHTML = `
    <div class="tabs" id="argent-tabs" style="margin-bottom:0;">
      <button class="tab-btn ${_arTab === 'saisie'   ? 'active' : ''}" data-artab="saisie">Saisie mensuelle</button>
      <button class="tab-btn ${_arTab === 'budgets'  ? 'active' : ''}" data-artab="budgets">Budgets</button>
    </div>
    <div id="argent-body" style="margin-top:12px;"></div>
  `;

  const renderTab = () => {
    const body = container.querySelector('#argent-body');
    if (!body) return;
    if (_arTab === 'saisie')   saisieModule.render(body);
    else                       chargesModule.renderSection(body, 'budgets');
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

