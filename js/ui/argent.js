// ============================================================
// js/ui/argent.js – Page "Argent" : Charges & Budgets + Épargne
// ============================================================

import * as chargesModule from './charges.js';
import * as savingsModule from './savings.js';

let _arTab = 'charges';

export async function render(container, params = {}) {
  if (params.tab) _arTab = params.tab;

  container.innerHTML = `
    <div class="tabs" id="argent-tabs" style="margin-bottom:0;">
      <button class="tab-btn ${_arTab === 'charges' ? 'active' : ''}" data-artab="charges">💳 Charges & Budgets</button>
      <button class="tab-btn ${_arTab === 'epargne' ? 'active' : ''}" data-artab="epargne">💰 Épargne</button>
    </div>
    <div id="argent-body" style="margin-top:12px;"></div>
  `;

  const renderTab = () => {
    const body = container.querySelector('#argent-body');
    if (!body) return;
    if (_arTab === 'charges') chargesModule.render(body);
    else                      savingsModule.render(body);
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
