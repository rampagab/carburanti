/**
 * «Come ti muovi?» — raccolta risposte e vocali
 * ------------------------------------------------------------
 * Riceve:
 *  1. le risposte del questionario (con eventuali vocali registrati nella pagina)
 *  2. i vocali e i messaggi mandati al bot Telegram (controllo ogni 5 minuti)
 * Salva tutto nel foglio Google e i file audio in una cartella di Drive.
 * Trascrive i vocali in automatico se imposti GEMINI_API_KEY (facoltativo).
 *
 * Impostazioni: scheda «Config» del foglio (colonna A chiave, colonna B valore)
 * oppure Proprietà dello script. Nessuna chiave va scritta in questo file.
 *   TELEGRAM_TOKEN   token del bot creato con @BotFather   (facoltativo)
 *   GEMINI_API_KEY   chiave gratuita da aistudio.google.com (facoltativo)
 *   GEMINI_MODEL     modello per la trascrizione (predefinito: gemini-flash-latest)
 *   SETUP_KEY        codice per attivare Telegram aprendo …/exec?setup=CODICE
 */
const SHEET_ID = '1LycPXHvVcB1Hygr3dpn44sAmtaECSoXU00MjMmswA-A';

const SHEET_RISPOSTE = 'Risposte';
const SHEET_VOCALI   = 'Vocali';
const FOLDER_NAME    = 'Come ti muovi – vocali';

/* ====================== QUESTIONARIO ====================== */

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const data = JSON.parse(e.postData.contents);
    const audio = data._audio || [];
    delete data._audio;

    const sh = sheet_(SHEET_RISPOSTE);
    if (giaRicevuto_(sh, data.id)) return json_({ ok: true, dup: true });

    // Vocali registrati nella pagina → Drive (+ trascrizione)
    audio.forEach(a => {
      const blob = Utilities.newBlob(Utilities.base64Decode(a.b64), a.mime || 'audio/webm',
        `questionario_${a.q}_${data.id}.${estensione_(a.mime)}`);
      const file = cartella_().createFile(blob);
      data[a.q + '_vocale'] = file.getUrl();
      data[a.q + '_vocale_sec'] = a.sec || '';
      data[a.q + '_trascrizione'] = trascrivi_(blob);
    });

    appendObj_(sh, Object.assign({ ricevuto: new Date() }, data));
    return json_({ ok: true });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.setup && p.setup === prop_('SETUP_KEY')) {
    try { attivaTelegram(); return ContentService.createTextOutput('Telegram attivo ✅'); }
    catch (err) { return ContentService.createTextOutput('Errore: ' + err); }
  }
  return ContentService.createTextOutput('Questionario attivo ✅');
}

/* ====================== TELEGRAM ====================== */

/** Esegui UNA volta dopo aver impostato TELEGRAM_TOKEN: attiva il controllo ogni 5 minuti. */
function attivaTelegram() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'controllaTelegram')
    .forEach(t => ScriptApp.deleteTrigger(t));
  tg_('deleteWebhook', {});            // usiamo il controllo periodico, non il webhook
  ScriptApp.newTrigger('controllaTelegram').timeBased().everyMinutes(5).create();
  controllaTelegram();
  console.log('Telegram attivo ✅');
}

function controllaTelegram() {
  const token = prop_('TELEGRAM_TOKEN');
  if (!token) return;
  const props = PropertiesService.getScriptProperties();
  const offset = Number(props.getProperty('TG_OFFSET') || 0);
  const res = tg_('getUpdates', { offset: offset, timeout: 0, allowed_updates: ['message'] });
  if (!res.ok) { console.error(res); return; }

  const sh = sheet_(SHEET_VOCALI);
  res.result.forEach(u => {
    props.setProperty('TG_OFFSET', String(u.update_id + 1));
    const m = u.message;
    if (!m) return;
    const chi = anonimo_(m.chat.id);

    if (m.text && m.text.indexOf('/start') === 0) {
      rispondi_(m.chat.id,
        'Ciao! 👋 Grazie per l\'aiuto.\n\n' +
        'Mandami pure un vocale (o scrivimi) su cosa ti servirebbe quando ti sposti: ' +
        'in auto, in moto, in treno, per lavoro o in vacanza.\n\n' +
        'Qualche spunto:\n• l\'ultima volta che un viaggio ti ha fatto perdere tempo o soldi\n' +
        '• cosa vorresti avere sul telefono, in macchina o sull\'orologio\n' +
        '• un\'idea anche strana, vale tutto 🙂');
      return;
    }

    const media = m.voice || m.audio || m.video_note ||
      (m.document && /^audio\//.test(m.document.mime_type || '') ? m.document : null);

    const riga = { ricevuto: new Date(), fonte: 'Telegram', persona: chi, tipo: '', testo: '', durata_sec: '', file: '', trascrizione: '' };

    if (media) {
      const blob = scaricaTg_(media.file_id);
      blob.setName(`telegram_${chi}_${u.update_id}.${estensione_(blob.getContentType())}`);
      const file = cartella_().createFile(blob);
      riga.tipo = m.voice ? 'vocale' : m.video_note ? 'video' : 'audio';
      riga.durata_sec = media.duration || '';
      riga.file = file.getUrl();
      riga.testo = m.caption || '';
      riga.trascrizione = trascrivi_(blob);
      rispondi_(m.chat.id, 'Ricevuto, grazie! 🙌 Se ti viene in mente altro, mandamelo pure.');
    } else if (m.text) {
      riga.tipo = 'testo';
      riga.testo = m.text;
      rispondi_(m.chat.id, 'Segnato, grazie! ✍️');
    } else {
      return;
    }
    appendObj_(sh, riga);
  });
}

function tg_(method, payload) {
  const token = prop_('TELEGRAM_TOKEN');
  const r = UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  return JSON.parse(r.getContentText());
}

function scaricaTg_(fileId) {
  const token = prop_('TELEGRAM_TOKEN');
  const info = tg_('getFile', { file_id: fileId });
  return UrlFetchApp.fetch(`https://api.telegram.org/file/bot${token}/${info.result.file_path}`).getBlob();
}

function rispondi_(chatId, text) { tg_('sendMessage', { chat_id: chatId, text: text }); }

/* ====================== TRASCRIZIONE (facoltativa) ====================== */

function trascrivi_(blob) {
  const key = prop_('GEMINI_API_KEY');
  if (!key) return '';
  try {
    const model = prop_('GEMINI_MODEL') || 'gemini-flash-latest';
    const mime = (blob.getContentType() || 'audio/ogg').split(';')[0];
    const body = {
      contents: [{ parts: [
        { text: 'Trascrivi fedelmente in italiano questo messaggio vocale. Restituisci solo il testo trascritto, senza commenti.' },
        { inline_data: { mime_type: mime === 'application/octet-stream' ? 'audio/ogg' : mime, data: Utilities.base64Encode(blob.getBytes()) } }
      ] }]
    };
    const r = UrlFetchApp.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-goog-api-key': key }, payload: JSON.stringify(body)
    });
    const j = JSON.parse(r.getContentText());
    if (j.error) return '(trascrizione non riuscita: ' + j.error.message + ')';
    return j.candidates[0].content.parts.map(p => p.text || '').join('').trim();
  } catch (err) {
    return '(trascrizione non riuscita)';
  }
}

/* ====================== UTILITÀ ====================== */

function sheet_(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/** Aggiunge una riga; crea da sola le colonne nuove. */
function appendObj_(sh, obj) {
  let headers = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].filter(String) : [];
  Object.keys(obj).forEach(k => {
    if (headers.indexOf(k) === -1) { headers.push(k); sh.getRange(1, headers.length).setValue(k).setFontWeight('bold'); }
  });
  sh.appendRow(headers.map(h => obj[h] === undefined ? '' : obj[h]));
  sh.setFrozenRows(1);
}

function giaRicevuto_(sh, id) {
  if (!id || sh.getLastRow() < 2) return false;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const col = headers.indexOf('id') + 1;
  if (!col) return false;
  return sh.getRange(2, col, sh.getLastRow() - 1, 1).getValues().flat().indexOf(id) !== -1;
}

function cartella_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function estensione_(mime) {
  mime = String(mime || '');
  if (mime.indexOf('mp4') !== -1 || mime.indexOf('m4a') !== -1 || mime.indexOf('aac') !== -1) return 'm4a';
  if (mime.indexOf('webm') !== -1) return 'webm';
  if (mime.indexOf('mpeg') !== -1 || mime.indexOf('mp3') !== -1) return 'mp3';
  return 'ogg';
}

/** Codice breve e stabile al posto del nome Telegram: le risposte restano anonime. */
function anonimo_(chatId) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(chatId) + ScriptApp.getScriptId());
  return 'P-' + d.slice(0, 3).map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('').toUpperCase();
}

function prop_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (v) return v;
  const cfg = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Config');
  if (!cfg || cfg.getLastRow() < 1) return '';
  const row = cfg.getRange(1, 1, cfg.getLastRow(), 2).getValues().find(r => String(r[0]).trim() === k);
  return row ? String(row[1]).trim() : '';
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
