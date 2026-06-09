// ============================================================
// js/ui/argent.js – Page "Ce mois" : Saisir + Dépenses + Charges fixes
// ============================================================

import * as saisieModule  from './saisie.js';
import * as chargesModule from './charges.js';

// tabs: saisir | depenses | charges
let _arTab = 'saisir';

export async function render(container, params = {}) {
  if (params.tab) _arTab = params.tab;
  // Guard: anciens noms de tabs
  if (['epargne', 'recurrentes', 'budgets'].includes(_arTab)) _arTab = 'saisir';

  container.innerHTML = `
    <div class="tabs" id="argent-tabs" style="margin-bottom:0;">
      <button class="tab-btn ${_arTab === 'saisir'   ? 'active' : ''}" data-artab="saisir">Saisir</button>
      <button class="tab-btn ${_arTab === 'depenses' ? 'active' : ''}" data-artab="depenses">Dépenses</button>
      <button class="tab-btn ${_arTab === 'charges'  ? 'active' : ''}" data-artab="charges">Charges fixes</button>
    </div>
    <div id="argent-body" style="margin-top:12px;"></div>
  `;

  const renderTab = () => {
    const body = container.querySelector('#argent-body');
    if (!body) return;
    if (_arTab === 'saisir')        saisieModule.render(body);
    else if (_arTab === 'depenses') chargesModule.renderSection(body, 'budgets');
    else                            chargesModule.renderSection(body, 'recurrentes');
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

