// ============================================================
// js/ui/argent.js – Page "Ce mois" : Saisir + Charges + Budgets
// ============================================================

import * as saisieModule  from './saisie.js';
import * as chargesModule from './charges.js';

// tabs: saisir | recurrentes | budgets
let _arTab = 'saisir';

export async function render(container, params = {}) {
  if (params.tab) _arTab = params.tab;
  // Guard: epargne tab removed — redirect to savings page
  if (_arTab === 'epargne') { _arTab = 'saisir'; }

  container.innerHTML = `
    <div class="tabs" id="argent-tabs" style="margin-bottom:0;">
      <button class="tab-btn ${_arTab === 'saisir'      ? 'active' : ''}" data-artab="saisir">Saisir</button>
      <button class="tab-btn ${_arTab === 'recurrentes' ? 'active' : ''}" data-artab="recurrentes">Charges</button>
      <button class="tab-btn ${_arTab === 'budgets'     ? 'active' : ''}" data-artab="budgets">Budgets</button>
    </div>
    <div id="argent-body" style="margin-top:12px;"></div>
  `;

  const renderTab = () => {
    const body = container.querySelector('#argent-body');
    if (!body) return;
    if (_arTab === 'saisir') saisieModule.render(body);
    else                     chargesModule.renderSection(body, _arTab);
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

