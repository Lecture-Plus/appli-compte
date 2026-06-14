// ============================================================
// js/onboarding.js – Logique d'onboarding (premier démarrage)
// Extrait de index.html pour garder le HTML léger
// ============================================================

import { getActiveUsers, saveUser, importAllData, setSetting, USER_COLORS } from './db.js';
import { pullFromDrive, isValidDriveUrl, DRIVE_URL_KEY, DRIVE_SYNC_KEY }    from './drive.js';
import { navigateTo, reloadUsers, State }                                    from './app.js';

function buildColorPicker(containerId, defaultColor, getOtherColors = () => []) {
  const cont = document.getElementById(containerId);
  if (!cont) return () => defaultColor;
  let selected = defaultColor;

  function render() {
    const others = getOtherColors();
    cont.innerHTML = USER_COLORS.map(c => {
      const taken = others.includes(c);
      return `<button type="button" class="ob-color-btn" data-color="${c}" ${taken ? 'disabled' : ''}
        style="width:40px;height:40px;border-radius:50%;background:${c};border:3px solid ${c === selected ? '#fff' : 'transparent'};box-shadow:${c === selected ? '0 0 0 2px '+c : 'none'};cursor:${taken ? 'not-allowed' : 'pointer'};opacity:${taken ? '0.3' : '1'};flex-shrink:0;"></button>`;
    }).join('');
    cont.querySelectorAll('.ob-color-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        selected = btn.dataset.color;
        render();
        // Rafraîchir les autres pickers pour qu'ils reflètent le nouveau choix
        document.querySelectorAll('.ob-color-btn').forEach(b => {
          const pickerEl = b.closest('[id^="ob-colors"]');
          if (pickerEl && pickerEl.id !== containerId) {
            pickerEl.dispatchEvent(new CustomEvent('ob-rerender'));
          }
        });
      });
    });
  }

  cont.addEventListener('ob-rerender', render);
  render();
  return () => selected;
}

function showStep(name) {
  ['intro','create','drive','whoami'].forEach(s => {
    const el = document.getElementById(`ob-step-${s}`);
    if (el) el.style.display = s === name ? 'flex' : 'none';
  });
}

let _obColorGetters = [];
let _obExtraCount = 0;

(async () => {
  const users = await getActiveUsers();
  if (users.length > 0) return; // Déjà configuré

  document.getElementById('onboarding').classList.remove('hidden');

  _obColorGetters[0] = buildColorPicker('ob-colors-1', USER_COLORS[0], () => {
    const u2vis = document.getElementById('ob-user-2')?.style.display !== 'none';
    return (u2vis && _obColorGetters[1]) ? [_obColorGetters[1]()] : [];
  });
  _obColorGetters[1] = buildColorPicker('ob-colors-2', USER_COLORS[1], () => [
    _obColorGetters[0] ? _obColorGetters[0]() : USER_COLORS[0]
  ]);

  // ── Intro : boutons pitch ──
  document.getElementById('ob-btn-start-intro')?.addEventListener('click', () => { showStep('create'); });
  document.getElementById('ob-existing-intro')?.addEventListener('click', () => { showStep('drive'); });

  // ── Bouton "Ajouter une 2e personne" ──
  document.getElementById('ob-add-second')?.addEventListener('click', () => {
    document.getElementById('ob-user-2').style.display = '';
    document.getElementById('ob-add-second').style.display = 'none';
    document.getElementById('ob-name-2')?.focus();
    document.getElementById('ob-colors-1')?.dispatchEvent(new CustomEvent('ob-rerender'));
  });
  document.getElementById('ob-remove-second')?.addEventListener('click', () => {
    document.getElementById('ob-user-2').style.display = 'none';
    document.getElementById('ob-add-second').style.display = '';
    const inp = document.getElementById('ob-name-2');
    if (inp) inp.value = '';
    document.getElementById('ob-colors-1')?.dispatchEvent(new CustomEvent('ob-rerender'));
  });

  // ── Ajouter une personne supplémentaire (max 6 au total) ──
  document.getElementById('ob-add-person')?.addEventListener('click', () => {
    if (_obExtraCount >= 4) {
      // 2 personnes de base + 4 extras = 6 maximum
      const btn = document.getElementById('ob-add-person');
      if (btn) { btn.textContent = '(6 personnes max)'; btn.disabled = true; }
      return;
    }
    _obExtraCount++;
    const color   = USER_COLORS[_obExtraCount % USER_COLORS.length] || USER_COLORS[0];
    const colorId = `ob-colors-extra-${_obExtraCount}`;
    const card    = document.createElement('div');
    card.className         = 'card';
    card.dataset.obUser    = String(_obExtraCount);
    card.style.cssText     = 'text-align:left;padding:16px;';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div style="font-size:0.78rem;font-weight:700;color:var(--primary);text-transform:uppercase;letter-spacing:.05em;">Personne ${_obExtraCount + 1}</div>
        <button type="button" class="btn btn-sm btn-outline ob-remove-extra" style="padding:2px 8px;font-size:0.72rem;">× Retirer</button>
      </div>
      <div class="form-group" style="margin-bottom:10px;">
        <label class="form-label">Prénom</label>
        <input type="text" class="form-input ob-extra-name" placeholder="Ex: Océane" maxlength="30">
      </div>
      <div class="form-group">
        <label class="form-label">Couleur</label>
        <div id="${colorId}" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;"></div>
      </div>
    `;
    card.querySelector('.ob-remove-extra')?.addEventListener('click', () => card.remove());
    document.getElementById('ob-extra-users')?.appendChild(card);
    _obColorGetters[_obExtraCount] = buildColorPicker(colorId, color);
  });

  // ── Démarrer ──
  document.getElementById('ob-start')?.addEventListener('click', async () => {
    const name1 = document.getElementById('ob-name-1')?.value.trim();
    const nameErrEl = document.getElementById('ob-start-error');
    if (!name1) {
      document.getElementById('ob-name-1').focus();
      document.getElementById('ob-name-1').style.borderColor = 'var(--danger)';
      if (nameErrEl) { nameErrEl.textContent = '⚠️ Veuillez saisir votre prénom.'; nameErrEl.style.display = ''; }
      return;
    }
    // Effacer l'erreur
    document.getElementById('ob-name-1').style.borderColor = '';
    if (nameErrEl) nameErrEl.style.display = 'none';

    const now          = new Date().toISOString();
    const createdUsers = [];
    const u1Id = await saveUser({ name: name1, color: _obColorGetters[0](), active: true, createdAt: now });
    createdUsers.push({ id: u1Id, name: name1, color: _obColorGetters[0]() });

    // User 2 (static card)
    const user2Visible = document.getElementById('ob-user-2')?.style.display !== 'none';
    const name2 = document.getElementById('ob-name-2')?.value.trim();
    if (user2Visible && name2) {
      const u2Id = await saveUser({ name: name2, color: _obColorGetters[1](), active: true, createdAt: now });
      createdUsers.push({ id: u2Id, name: name2, color: _obColorGetters[1]() });
    }

    // Extra users (dynamic cards)
    const extraCards = document.querySelectorAll('#ob-extra-users .card[data-ob-user]');
    for (let i = 0; i < extraCards.length; i++) {
      const card  = extraCards[i];
      const name  = card.querySelector('.ob-extra-name')?.value.trim();
      if (!name) continue;
      const ci    = Number(card.dataset.obUser);
      const color = (_obColorGetters[ci] ? _obColorGetters[ci]() : null) || USER_COLORS[(i + 1) % USER_COLORS.length];
      const uId   = await saveUser({ name, color, active: true, createdAt: now });
      createdUsers.push({ id: uId, name, color });
    }

    await reloadUsers();
    if (createdUsers.length > 1) {
      const titleEl = document.querySelector('#ob-step-whoami > p');
      if (titleEl) titleEl.textContent = 'Profils créés ! Qui êtes-vous sur cet appareil ?';
      _showWhoAmI(createdUsers);
    } else {
      localStorage.setItem('currentDeviceUserId', String(createdUsers[0].id));
      State.currentUserId = String(createdUsers[0].id);
      document.getElementById('onboarding').classList.add('hidden');
      navigateTo('dashboard');
    }
  });

  // ── Bouton "J'ai déjà un espace" ──
  document.getElementById('ob-existing')?.addEventListener('click', () => {
    showStep('drive');
  });
  document.getElementById('ob-back-create')?.addEventListener('click', () => {
    showStep('create');
  });

  // ── Step drive : import ──
  document.getElementById('ob-import')?.addEventListener('click', async () => {
    const url     = document.getElementById('ob-drive-url')?.value.trim();
    const errEl   = document.getElementById('ob-drive-error');
    const importBtn = document.getElementById('ob-import');

    errEl.style.display = 'none';

    if (!url || !isValidDriveUrl(url)) {
      errEl.textContent = 'URL invalide. Vérifiez l\'adresse du Web App Apps Script.';
      errEl.style.display = '';
      return;
    }

    importBtn.disabled = true;
    importBtn.textContent = '⏳ Récupération en cours…';

    try {
      const data = await pullFromDrive(url);
      if (!data) throw new Error('Aucune sauvegarde trouvée sur cet espace Drive.');

      await importAllData(data);
      await setSetting(DRIVE_URL_KEY, url);
      await setSetting(DRIVE_SYNC_KEY, new Date().toISOString());

      // Récupère les utilisateurs importés et affiche le choix
      const importedUsers = await getActiveUsers();
      if (!importedUsers.length) throw new Error('Aucun utilisateur dans la sauvegarde.');

      _showWhoAmI(importedUsers);
    } catch (e) {
      errEl.textContent = 'Erreur : ' + e.message;
      errEl.style.display = '';
      importBtn.disabled = false;
      importBtn.textContent = '⬇️ Récupérer mes données';
    }
  });
})();

function _showWhoAmI(importedUsers) {
  showStep('whoami');
  const list = document.getElementById('ob-whoami-list');
  if (!list) return;

  list.innerHTML = importedUsers.map(u => `
    <button class="btn btn-outline whoami-btn" data-uid="${u.id}"
      style="display:flex;align-items:center;gap:10px;padding:10px 14px;text-align:left;width:100%;">
      <span style="width:32px;height:32px;border-radius:50%;background:${u.color||'#6C63FF'};
        display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;
        font-size:0.9rem;flex-shrink:0;">${(u.name||'?')[0].toUpperCase()}</span>
      <span style="font-weight:600;">${u.name}</span>
    </button>
  `).join('');

  list.querySelectorAll('.whoami-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.uid;
      localStorage.setItem('currentDeviceUserId', uid);
      State.currentUserId = uid;
      await reloadUsers();
      document.getElementById('onboarding').classList.add('hidden');
      navigateTo('dashboard');
    });
  });
}
