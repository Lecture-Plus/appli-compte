/**
 * ================================================================
 *  Budget Foyer – Sync Google Drive
 *  Script Apps Script à déployer en tant que Web App
 *
 *  ▶ INSTRUCTIONS D'INSTALLATION (à faire UNE seule fois) :
 *
 *  1. Aller sur https://script.google.com
 *  2. Créer un nouveau projet : "Nouveau projet"
 *  3. Nommer le projet : "Budget Foyer Sync"
 *  4. Remplacer tout le contenu par CE fichier
 *  5. Cliquer sur "Déployer" → "Nouveau déploiement"
 *  6. Type : "Application Web"
 *  7. Exécuter en tant que : "Moi"
 *  8. Accès autorisé à : "Tout le monde"
 *  9. Cliquer "Déployer" → Autoriser les permissions
 * 10. Copier l'URL du Web App (commence par https://script.google.com/macros/s/...)
 * 11. Coller cette URL dans l'application → Réglages → Sync Google Drive
 *
 *  ▶ PARTAGE ENTRE APPAREILS :
 *  Toutes les personnes qui ont l'URL peuvent lire/écrire les données.
 *  Partagez simplement l'URL avec votre partenaire (via message, mail…).
 *  Chacun la colle dans ses Réglages → Sync Google Drive.
 *
 *  ▶ OÙ SONT STOCKÉES LES DONNÉES ?
 *  Dans votre Google Drive → dossier "Budget Foyer" → fichier "backup.json"
 * ================================================================
 */

const FOLDER_NAME = 'Budget Foyer';
const FILE_NAME   = 'backup.json';

// ── Utilitaires Drive ──

function getFolder_() {
  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(FOLDER_NAME);
}

function getFile_() {
  const folder = getFolder_();
  const files  = folder.getFilesByName(FILE_NAME);
  return files.hasNext() ? files.next() : null;
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── GET → Récupérer la sauvegarde ──

function doGet(e) {
  try {
    const file = getFile_();

    if (!file) {
      return jsonOut_({ found: false, message: 'Aucune sauvegarde trouvée.' });
    }

    const content = file.getBlob().getDataAsString('UTF-8');

    // Validation rapide
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch(err) {
      return jsonOut_({ found: false, error: 'Fichier de sauvegarde corrompu.' });
    }

    // On retourne directement le contenu parsé
    return jsonOut_(parsed);

  } catch(err) {
    return jsonOut_({ ok: false, error: err.toString() });
  }
}

// ── POST → Sauvegarder les données ──

function doPost(e) {
  try {
    const body = e.postData ? e.postData.contents : '';

    if (!body) {
      return jsonOut_({ ok: false, error: 'Corps de la requête vide.' });
    }

    // Validation JSON
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch(err) {
      return jsonOut_({ ok: false, error: 'Données JSON invalides.' });
    }

    // Vérification minimale du format Budget Foyer
    if (!parsed.version || !parsed.appName) {
      return jsonOut_({ ok: false, error: 'Format de sauvegarde non reconnu. Assurez-vous d\'exporter depuis l\'application Budget Foyer.' });
    }

    const folder = getFolder_();
    const file   = getFile_();

    if (file) {
      // Mise à jour du fichier existant
      file.setContent(body);
    } else {
      // Création du fichier
      folder.createFile(FILE_NAME, body, MimeType.PLAIN_TEXT);
    }

    return jsonOut_({
      ok:      true,
      savedAt: new Date().toISOString(),
      size:    body.length,
    });

  } catch(err) {
    return jsonOut_({ ok: false, error: err.toString() });
  }
}
