// ============================================================
// js/ui/argent.js – Page "Argent" : Saisir + Charges + Épargne
// ============================================================

import * as saisieModule  from './saisie.js';
import * as chargesModule from './charges.js';
import * as savingsModule from './savings.js';

// tabs: saisir | recurrentes | achats | budgets | epargne
let _arTab = 'saisir';

export async function render(container, params = {}) {
  if (params.tab) _arTab = params.tab;

  container.innerHTML = `
    <div class="tabs" id="argent-tabs" style="margin-bottom:0;overflow-x:auto;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;">
      <button class="tab-btn ${_arTab === 'saisir'      ? 'active' : ''}" data-artab="saisir"      style="white-space:nowrap;">✏️ Saisir</button>
      <button class="tab-btn ${_arTab === 'recurrentes' ? 'active' : ''}" data-artab="recurrentes" style="white-space:nowrap;">💳 Charges</button>
      <button class="tab-btn ${_arTab === 'achats'      ? 'active' : ''}" data-artab="achats"      style="white-space:nowrap;">💥 Exceptionnel</button>
      <button class="tab-btn ${_arTab === 'budgets'     ? 'active' : ''}" data-artab="budgets"     style="white-space:nowrap;">📊 Budgets</button>
      <button class="tab-btn ${_arTab === 'epargne'     ? 'active' : ''}" data-artab="epargne"     style="white-space:nowrap;">💰 Épargne</button>
    </div>
    <div id="argent-body" style="margin-top:12px;"></div>
  `;

  const renderTab = () => {
    const body = container.querySelector('#argent-body');
    if (!body) return;
    if      (_arTab === 'saisir')      saisieModule.render(body);
    else if (_arTab === 'epargne')     savingsModule.render(body);
    else                               chargesModule.renderSection(body, _arTab);
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

