// ============================================================
// js/sync.js – Synchronisation Drive automatique
// ============================================================

import { exportAllData, importAllData, setSetting, getSetting } from './db.js';
import { pushVersionedBackup, pullBackup, listBackups,
         isValidDriveUrl, DRIVE_URL_KEY, DRIVE_SYNC_KEY }       from './drive.js';
import { showToast }                                             from './utils.js';

// ── Tracking d'activité ──
let _lastActivity = Date.now();
let _autoSaveTimer = null;

// ── Mutex : évite l'auto-save pendant un import en cours ──
let _isSyncing = false;

// ── Dirty flag : ne syncer que si des modifications ont eu lieu ──
let _isDirty = false;

// ── Retry avec backoff exponentiel en cas d'erreur Drive ──
let _retryCount  = 0;
let _nextRetryAt = 0;
const _RETRY_DELAYS = [30_000, 120_000, 600_000]; // 30s, 2min, 10min

/** Marquer les données comme modifiées (appelé après toute écriture IDB) */
export function markDirty() { _isDirty = true; }

// ── Indicateur de sync ──
let _syncStatus = 'none'; // 'none' | 'ok' | 'syncing' | 'error'

/**
 * Met à jour l'indicateur de sync dans la nav.
 * statuses: 'none' | 'ok' | 'syncing' | 'error'
 */
export function setSyncStatus(status) {
  _syncStatus = status;
  const dot = document.getElementById('sync-dot');
  if (!dot) return;
  dot.dataset.status = status;
  dot.title = {
    none:    'Drive non configuré',
    ok:      'Synchronisé avec Drive',
    syncing: 'Synchronisation en cours…',
    error:   'Erreur de synchronisation',
  }[status] ?? '';
}

export function getSyncStatus() { return _syncStatus; }

const INACTIVITY_LIMIT_MS = 10 * 60 * 1000;  // 10 minutes
const AUTO_SAVE_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

/** Remet à jour le timestamp d'activité. Appelé sur chaque interaction utilisateur. */
export function markActivity() {
  _lastActivity = Date.now();
}

function isActive() {
  return (Date.now() - _lastActivity) < INACTIVITY_LIMIT_MS;
}

/** Enregistre les event listeners d'activité sur le document. */
export function initActivityTracking() {
  ['click', 'keydown', 'touchstart', 'mousemove', 'scroll'].forEach(evt => {
    document.addEventListener(evt, markActivity, { passive: true });
  });
}

/**
 * Pull du Drive au lancement, avec overlay de chargement.
 * Retourne true si une synchro a été effectuée.
 */
export async function initDriveSync() {
  const url = await getSetting(DRIVE_URL_KEY);
  if (!isValidDriveUrl(url)) { setSyncStatus('none'); return false; }

  const overlay = document.getElementById('sync-overlay');
  if (overlay) overlay.classList.remove('hidden');
  setSyncStatus('syncing');
  _isSyncing = true;

  try {
    const backups = await listBackups(url);
    if (!backups || !backups.length) {
      if (overlay) overlay.classList.add('hidden');
      setSyncStatus('ok');
      return false;
    }

    const latest = backups[0]; // déjà triés du plus récent au plus ancien
    const data   = await pullBackup(url, latest.filename);

    if (data && data.appName) {
      await importAllData(data);
      await setSetting(DRIVE_SYNC_KEY, new Date().toISOString());
      console.log('[Sync] Drive synchronisé :', latest.filename);
    }
    setSyncStatus('ok');
  } catch (err) {
    console.warn('[Sync] Impossible de synchroniser avec Drive :', err.message);
    setSyncStatus('error');
    // Silencieux — l'app peut fonctionner hors-ligne
  } finally {
    _isSyncing = false;
  }

  if (overlay) overlay.classList.add('hidden');
  return true;
}

/**
 * Démarre l'auto-save toutes les 2 minutes si l'utilisateur est actif.
 * Vérifie si Drive a une version plus récente avant de pousser.
 */
export function startAutoSave() {
  if (_autoSaveTimer) clearInterval(_autoSaveTimer);

  _autoSaveTimer = setInterval(async () => {
    if (!isActive()) return;
    if (_isSyncing) return;  // import en cours, ne pas écraser
    if (!_isDirty) return;   // rien de nouveau, économiser bande passante et batterie
    if (_nextRetryAt > 0 && Date.now() < _nextRetryAt) return; // attendre le backoff

    const url = await getSetting(DRIVE_URL_KEY);
    if (!isValidDriveUrl(url)) return;

    try {
      // Vérifier si Drive est plus récent
      const backups = await listBackups(url);
      if (backups && backups.length) {
        const driveLatest   = new Date(backups[0].savedAt).getTime();
        const lastSyncStr   = await getSetting(DRIVE_SYNC_KEY);
        const lastSync      = lastSyncStr ? new Date(lastSyncStr).getTime() : 0;

        if (driveLatest > lastSync + 5000) {
          // Drive est plus récent → on avertit mais on ne pousse pas
          setSyncStatus('error');
          showToast(
            '⚠️ Une version plus récente existe sur Drive. Allez dans Réglages → Sync pour importer.',
            'warning',
            6000
          );
          return;
        }
      }

      // Pousser
      setSyncStatus('syncing');
      const data = await exportAllData();
      await pushVersionedBackup(url, data);
      await setSetting(DRIVE_SYNC_KEY, new Date().toISOString());
      _isDirty = false;  // reset dirty flag après push réussi
      setSyncStatus('ok');
      console.log('[Sync] Auto-save Drive OK');
      _retryCount  = 0;
      _nextRetryAt = 0;
    } catch (err) {
      setSyncStatus('error');
      const delay = _RETRY_DELAYS[Math.min(_retryCount, _RETRY_DELAYS.length - 1)];
      _nextRetryAt = Date.now() + delay;
      _retryCount++;
      // Ne pas remettre _isDirty à false → sera retenté au prochain check
      console.warn(`[Sync] Auto-save échoué (retry #${_retryCount} dans ${delay/1000}s) :`, err.message);
    }
  }, AUTO_SAVE_INTERVAL_MS);
}

export function stopAutoSave() {
  if (_autoSaveTimer) clearInterval(_autoSaveTimer);
  _autoSaveTimer = null;
}

/**
 * Teste la connexion Drive sans modifier les données.
 * Retourne { ok, count, latest, error }.
 */
export async function testDriveConnection() {
  const url = await getSetting(DRIVE_URL_KEY);
  if (!isValidDriveUrl(url)) {
    return { ok: false, error: 'URL non configurée ou invalide.' };
  }
  setSyncStatus('syncing');
  try {
    const backups = await listBackups(url);
    setSyncStatus('ok');
    const count  = backups?.length ?? 0;
    const latest = count > 0 ? backups[0] : null;
    return { ok: true, count, latest };
  } catch (err) {
    setSyncStatus('error');
    // Fournir un message explicite selon le type d'erreur
    let error = err.message || 'Erreur inconnue';
    if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
      error = 'Impossible de joindre le serveur. Vérifiez votre connexion et que l\'URL est correcte.';
    } else if (err.message?.includes('CORS') || err.message?.includes('403') || err.message?.includes('401')) {
      error = 'Accès refusé. Le script Apps Script doit être déployé en accès "Tout le monde".';
    } else if (err.message?.includes('404')) {
      error = 'URL introuvable. Vérifiez que le script est bien déployé et que l\'URL est à jour.';
    }
    return { ok: false, error };
  }
}
