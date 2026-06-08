// ============================================================
// js/drive.js – Synchronisation Google Drive via Apps Script Web App
// ============================================================

export const DRIVE_URL_KEY  = 'driveWebAppUrl';
export const DRIVE_SYNC_KEY = 'driveLastSync';

export function isValidDriveUrl(url) {
  return typeof url === 'string'
    && url.trim().startsWith('https://script.google.com/macros/s/');
}

/** Génère un nom de fichier horodaté */
function _timestampedName() {
  const now  = new Date();
  const pad  = n => String(n).padStart(2, '0');
  return `backup_${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
       + `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.json`;
}

/**
 * Pousse une sauvegarde versionnée (fichier horodaté, max 5 gardés côté Drive).
 */
export async function pushVersionedBackup(webAppUrl, data) {
  const url      = (webAppUrl || '').trim();
  if (!isValidDriveUrl(url)) throw new Error('URL Drive invalide.');

  const filename = _timestampedName();
  const payload  = JSON.stringify({ ...data, backupFilename: filename });

  let resp;
  try {
    resp = await fetch(`${url}?filename=${encodeURIComponent(filename)}`, {
      method:   'POST',
      headers:  { 'Content-Type': 'text/plain;charset=utf-8' },
      body:     payload,
      redirect: 'follow',
    });
  } catch (e) {
    throw new Error('Impossible de contacter le serveur Drive. Vérifiez votre connexion.');
  }

  if (!resp.ok) throw new Error(`Erreur serveur (${resp.status}).`);

  let result;
  try { result = await resp.json(); }
  catch { result = { ok: true }; }

  if (result?.ok === false) throw new Error(result.error || 'Erreur Apps Script.');
  return result;
}

/**
 * Alias : comportement identique à pushVersionedBackup.
 */
export async function pushToDrive(webAppUrl, data) {
  return pushVersionedBackup(webAppUrl, data);
}

/**
 * Liste tous les backups disponibles sur Drive.
 * @returns {Array} [{filename, savedAt, size}] triés du plus récent au plus ancien
 */
export async function listBackups(webAppUrl) {
  const url = (webAppUrl || '').trim();
  if (!isValidDriveUrl(url)) return [];

  try {
    const resp = await fetch(`${url}?action=list`, { redirect: 'follow' });
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data.backups) ? data.backups : [];
  } catch {
    return [];
  }
}

/**
 * Récupère un backup depuis Drive.
 * @param {string}  webAppUrl  - URL du Web App
 * @param {string}  [filename] - Nom de fichier spécifique. Si omis → le plus récent.
 */
export async function pullBackup(webAppUrl, filename = null) {
  const url  = (webAppUrl || '').trim();
  if (!isValidDriveUrl(url)) throw new Error('URL Drive invalide.');

  const qs   = filename ? `?file=${encodeURIComponent(filename)}` : '';

  let resp;
  try {
    resp = await fetch(`${url}${qs}`, { redirect: 'follow' });
  } catch (e) {
    throw new Error('Impossible de contacter le serveur Drive.');
  }

  if (!resp.ok) throw new Error(`Erreur serveur (${resp.status}).`);

  let result;
  try { result = await resp.json(); }
  catch { throw new Error('Réponse Drive invalide.'); }

  if (result?.found === false) return null;
  return result;
}

/**
 * Alias pour rétrocompatibilité.
 */
export async function pullFromDrive(webAppUrl) {
  return pullBackup(webAppUrl, null);
}


