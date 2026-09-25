/**
 * RSVP — Google Apps Script
 *
 * Setup:
 * 1. Crie uma planilha com abas "convidados" e "rsvps"
 * 2. Aba convidados (linha 1 = cabeçalho):
 *    guest_id | invitation_id | full_name | first_name | phone | phone_last4 | can_unlock
 * 3. Aba rsvps:
 *    guest_id | full_name | status | updated_at
 * 4. script.google.com > Novo projeto > cole este arquivo
 * 5. Project Settings > Script Properties:
 *    SPREADSHEET_ID = id da planilha (obrigatório)
 *    ADMIN_PASSWORD = sua-senha
 *    TOKEN_SECRET   = string-aleatoria-longa
 * 6. Deploy > New deployment > Web app
 *    Execute as: Me | Who has access: Anyone
 * 7. Copie a URL e configure em js/rsvp.js (CONFIG.API_URL)
 * 8. Após editar convidados, rode normalizeGuests() — atualiza a aba
 *    rsvps com full_name e limpa o cache de convidados
 */

var SHEET_GUESTS = "convidados";
var SHEET_RSVPS = "rsvps";
var RSVP_DEADLINE_END = "2027-03-16T02:59:59.999Z"; // fim do dia 15/03/2027 (Brasília)
var RSVP_DEADLINE_LABEL = "15 de março de 2027";
var RATE_LIMIT_WINDOW_SECONDS = 900; // 15 minutos
var RATE_LIMIT_MAX_UNLOCK = 10;
var RATE_LIMIT_MAX_ADMIN = 5;
var CACHE_KEY_GUESTS = "guests_v1";
var CACHE_KEY_RSVPS = "rsvps_v1";
var CACHE_TTL_SECONDS = 21600; // 6 horas: máximo aceito pelo CacheService

function isRsvpClosed() {
  var end = scriptProp("RSVP_DEADLINE_END") || RSVP_DEADLINE_END;
  return Date.now() > new Date(end).getTime();
}

function rsvpClosedMessage() {
  var label = scriptProp("RSVP_DEADLINE_LABEL") || RSVP_DEADLINE_LABEL;
  return "O prazo para confirmação encerrou em " + label + ".";
}

function doPost(e) {
  try {
    var body = parseRequestBody(e);
    var action = body.action;
    var payload = body.payload || {};

    if (action === "unlock") return jsonResponse(unlock(payload));
    if (action === "rsvp") return jsonResponse(saveRsvp(payload));
    if (action === "admin") return jsonResponse(admin(payload));

    return jsonResponse({ ok: false, message: "Ação inválida." });
  } catch (err) {
    return jsonResponse({
      ok: false,
      message: "Erro no servidor: " + (err && err.message ? err.message : String(err)),
    });
  }
}

function parseRequestBody(e) {
  if (!e || !e.postData) {
    throw new Error("POST sem corpo. Use Content-Type text/plain.");
  }

  var raw = e.postData.contents || e.postData.getDataAsString();
  if (!raw) {
    throw new Error("Corpo da requisição vazio.");
  }

  return JSON.parse(raw);
}

function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  if (params.action) {
    try {
      var payload = params.payload ? JSON.parse(params.payload) : {};
      if (params.action === "unlock") return jsonResponse(unlock(payload));
      if (params.action === "rsvp") return jsonResponse(saveRsvp(payload));
      if (params.action === "admin") return jsonResponse(admin(payload));
      return jsonResponse({ ok: false, message: "Ação inválida." });
    } catch (err) {
      return jsonResponse({
        ok: false,
        message: "Erro no servidor: " + (err && err.message ? err.message : String(err)),
      });
    }
  }

  warmCaches();
  return ContentService.createTextOutput("RSVP API OK");
}

function warmCaches() {
  try {
    discardGuestLongCache();
    readGuests();
    readRsvpsMap();
  } catch (e) {
    // best-effort: o GET de aquecimento não deve falhar a página
  }
}

function discardGuestLongCache() {
  var props = PropertiesService.getScriptProperties();
  var metaRaw = props.getProperty("cache_guests_meta");
  if (!metaRaw) return;

  var n = 0;
  try {
    n = Number(JSON.parse(metaRaw).n || 0);
  } catch (e) {
    n = 0;
  }
  props.deleteProperty("cache_guests_meta");
  var i;
  for (i = 0; i < n; i++) {
    props.deleteProperty("cache_guests_" + i);
  }
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON
  );
}

// Guardados enquanto a execução dura: cada chamada a esses serviços vai ao servidor
var cachedProps = null;
var cachedSpreadsheet = null;

function scriptProp(name) {
  if (!cachedProps) {
    cachedProps = PropertiesService.getScriptProperties().getProperties();
  }
  return cachedProps[name];
}

function getSpreadsheet() {
  if (!cachedSpreadsheet) {
    var id = scriptProp("SPREADSHEET_ID");
    if (!id) {
      throw new Error("SPREADSHEET_ID não configurado nas Script Properties.");
    }
    cachedSpreadsheet = SpreadsheetApp.openById(id);
  }
  return cachedSpreadsheet;
}

function getSheet(name) {
  var sheet = getSpreadsheet().getSheetByName(name);
  if (!sheet) {
    throw new Error('Aba "' + name + '" não encontrada na planilha.');
  }
  return sheet;
}

function rateLimitKey(scope, identifier) {
  return "rl_" + scope + "_" + String(identifier || "").slice(0, 80);
}

function isRateLimited(scope, identifier, max) {
  var hits = CacheService.getScriptCache().get(rateLimitKey(scope, identifier));
  return Number(hits || 0) >= max;
}

function registerFailedAttempt(scope, identifier) {
  var cache = CacheService.getScriptCache();
  var key = rateLimitKey(scope, identifier);
  var hits = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(hits), RATE_LIMIT_WINDOW_SECONDS);
}

function clearFailedAttempts(scope, identifier) {
  CacheService.getScriptCache().remove(rateLimitKey(scope, identifier));
}

function rateLimitMessage() {
  return "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
}

function removeAccents(value) {
  var from = "áàãâäéèêëíìîïóòõôöúùûüçñ";
  var to = "aaaaaeeeeiiiiooooouuuucn";
  var out = "";
  var i;
  var j;
  var ch;

  for (i = 0; i < value.length; i++) {
    ch = value.charAt(i).toLowerCase();
    j = from.indexOf(ch);
    out += j >= 0 ? to.charAt(j) : ch;
  }

  return out;
}

function normalizeName(value) {
  return removeAccents(String(value || "").trim().toLowerCase())
    .replace(/[^a-z\s-]/g, "")
    .split(/\s+/)[0];
}

function isTruthy(value) {
  if (value === true) return true;
  var text = String(value || "").trim().toUpperCase();
  return text === "TRUE" || text === "VERDADEIRO" || text === "SIM" || text === "1";
}

function findGuest(guests, predicate) {
  var i;
  for (i = 0; i < guests.length; i++) {
    if (predicate(guests[i])) return guests[i];
  }
  return null;
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function phoneLast4(value) {
  var digits = normalizePhone(value);
  return digits.slice(-4);
}

function readCached(key, loader) {
  var cache = CacheService.getScriptCache();
  var raw = cache.get(key);

  if (raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      // cache corrompido: segue para reler a planilha
    }
  }

  var data = loader();
  cache.put(key, JSON.stringify(data), CACHE_TTL_SECONDS);
  return data;
}

function clearGuestCache() {
  CacheService.getScriptCache().remove(CACHE_KEY_GUESTS);
}

function readGuests() {
  return readCached(CACHE_KEY_GUESTS, loadGuestsFromSheet);
}

function loadGuestsFromSheet() {
  var sheet = getSheet(SHEET_GUESTS);
  var rows = sheet.getDataRange().getValues();
  var headers = rows.shift();
  var map = {};
  headers.forEach(function (h, i) {
    map[String(h).trim()] = i;
  });

  return rows
    .filter(function (row) {
      return row[map.guest_id];
    })
    .map(function (row) {
      return {
        guestId: String(row[map.guest_id]),
        invitationId: String(row[map.invitation_id]),
        fullName: String(row[map.full_name]),
        firstName: normalizeName(row[map.first_name] || row[map.full_name]),
        phone: normalizePhone(row[map.phone]),
        phoneLast4: phoneLast4(row[map.phone_last4] || row[map.phone]),
        canUnlock: isTruthy(row[map.can_unlock]),
      };
    });
}

function readRsvpsMap() {
  return readCached(CACHE_KEY_RSVPS, loadRsvpsFromSheet);
}

function loadRsvpsFromSheet() {
  var sheet = getSheet(SHEET_RSVPS);
  var rows = sheet.getDataRange().getValues();
  var headers = rows.shift();
  var map = {};
  headers.forEach(function (h, i) {
    map[String(h).trim()] = i;
  });

  var result = {};
  rows.forEach(function (row) {
    if (!row[map.guest_id]) return;
    result[String(row[map.guest_id])] = {
      status: String(row[map.status]),
      updatedAt: row[map.updated_at]
        ? new Date(row[map.updated_at]).toISOString()
        : null,
    };
  });
  return result;
}

function unlock(payload) {
  if (isRsvpClosed()) {
    return { ok: false, message: rsvpClosedMessage() };
  }

  var firstName = normalizeName(payload.firstName);
  var last4 = phoneLast4(payload.last4);

  if (!firstName || last4.length !== 4) {
    return { ok: false, message: "Preencha nome e 4 dígitos." };
  }

  if (isRateLimited("unlock", firstName, RATE_LIMIT_MAX_UNLOCK)) {
    return { ok: false, message: rateLimitMessage() };
  }

  var guests = readGuests();
  var matched = findGuest(guests, function (g) {
    return g.canUnlock && g.firstName === firstName && g.phoneLast4 === last4;
  });

  if (!matched) {
    registerFailedAttempt("unlock", firstName);
    return {
      ok: false,
      message: "Não encontramos seu nome na lista.\nEntre em contato com os noivos.",
    };
  }

  clearFailedAttempts("unlock", firstName);

  var rsvps = readRsvpsMap();
  var group = guests
    .filter(function (g) {
      return g.invitationId === matched.invitationId;
    })
    .map(function (g) {
      return {
        guestId: g.guestId,
        fullName: g.fullName,
        status: rsvps[g.guestId] ? rsvps[g.guestId].status : "pending",
      };
    });

  return {
    ok: true,
    token: createToken(matched.invitationId),
    invitationId: matched.invitationId,
    guests: group,
  };
}

function createToken(invitationId) {
  var secret = scriptProp("TOKEN_SECRET");
  var expires = Date.now() + 60 * 60 * 1000;
  var raw = invitationId + "|" + expires;
  var sig = Utilities.computeHmacSha256Signature(raw, secret);
  var sigB64 = Utilities.base64Encode(sig);
  return Utilities.base64Encode(raw + "|" + sigB64);
}

function verifyToken(token) {
  try {
    var secret = scriptProp("TOKEN_SECRET");
    var decoded = Utilities.newBlob(Utilities.base64Decode(token)).getDataAsString();
    var parts = decoded.split("|");
    if (parts.length !== 3) return null;

    var invitationId = parts[0];
    var expires = Number(parts[1]);
    var sigB64 = parts[2];
    var raw = invitationId + "|" + expires;

    if (Date.now() > expires) return null;

    var expected = Utilities.base64Encode(
      Utilities.computeHmacSha256Signature(raw, secret)
    );
    if (sigB64 !== expected) return null;

    return invitationId;
  } catch (e) {
    return null;
  }
}

function saveRsvp(payload) {
  if (isRsvpClosed()) {
    return { ok: false, message: rsvpClosedMessage() };
  }

  var invitationId = verifyToken(payload.token);
  if (!invitationId) {
    return { ok: false, message: "Sessão expirada. Desbloqueie novamente." };
  }

  var namesById = {};
  readGuests().forEach(function (g) {
    if (g.invitationId === invitationId) {
      namesById[g.guestId] = g.fullName;
    }
  });

  var sheet = getSheet(SHEET_RSVPS);
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var nameCol = ensureRsvpNameColumn(sheet, headers, rows);
  var width = headers.length;
  var guestCol = headers.indexOf("guest_id");
  var statusCol = headers.indexOf("status");
  var updatedCol = headers.indexOf("updated_at");
  var rowByGuest = {};

  for (var i = 1; i < rows.length; i++) {
    rowByGuest[String(rows[i][guestCol])] = i;
  }

  var now = new Date().toISOString();
  var updated = [];
  var created = [];

  (payload.responses || []).forEach(function (item) {
    if (!namesById.hasOwnProperty(item.guestId)) return;
    if (item.status !== "confirmed" && item.status !== "declined") return;

    var index = rowByGuest[item.guestId];
    var row;

    if (index === undefined) {
      row = blankRow(width);
      created.push(row);
    } else {
      row = rows[index];
      updated.push(index);
    }

    row[guestCol] = item.guestId;
    row[nameCol] = namesById[item.guestId];
    row[statusCol] = item.status;
    row[updatedCol] = now;
  });

  writeChangedRows(sheet, rows, updated, width);

  if (created.length) {
    sheet.getRange(rows.length + 1, 1, created.length, width).setValues(created);
  }

  if (updated.length || created.length) {
    CacheService.getScriptCache().remove(CACHE_KEY_RSVPS);
  }

  return { ok: true };
}

function ensureRsvpNameColumn(sheet, headers, rows) {
  var nameCol = headers.indexOf("full_name");
  if (nameCol !== -1) return nameCol;

  nameCol = headers.length;
  sheet.getRange(1, nameCol + 1).setValue("full_name");
  headers.push("full_name");
  if (rows) {
    var i;
    for (i = 1; i < rows.length; i++) {
      rows[i][nameCol] = "";
    }
  }
  return nameCol;
}

function blankRow(width) {
  var row = [];
  var i;
  for (i = 0; i < width; i++) {
    row.push("");
  }
  return row;
}

/** Grava só as linhas mexidas, juntando as vizinhas numa escrita só */
function writeChangedRows(sheet, rows, indexes, width) {
  indexes.sort(function (a, b) {
    return a - b;
  });

  var i = 0;
  while (i < indexes.length) {
    var start = i;
    while (i + 1 < indexes.length && indexes[i + 1] === indexes[i] + 1) {
      i++;
    }

    var from = indexes[start];
    var count = indexes[i] - from + 1;
    sheet.getRange(from + 1, 1, count, width).setValues(rows.slice(from, from + count));
    i++;
  }
}

function admin(payload) {
  if (isRateLimited("admin", "global", RATE_LIMIT_MAX_ADMIN)) {
    return { ok: false, message: rateLimitMessage() };
  }

  var password = scriptProp("ADMIN_PASSWORD");
  if (!payload.password || payload.password !== password) {
    registerFailedAttempt("admin", "global");
    return { ok: false, message: "Senha incorreta." };
  }

  clearFailedAttempts("admin", "global");

  var guests = readGuests();
  var rsvps = readRsvpsMap();
  var list = guests.map(function (g) {
    var rsvp = rsvps[g.guestId];
    return {
      fullName: g.fullName,
      invitationId: g.invitationId,
      status: rsvp ? rsvp.status : "pending",
      updatedAt: rsvp ? rsvp.updatedAt : null,
    };
  });

  var summary = { total: list.length, confirmed: 0, declined: 0, pending: 0 };
  list.forEach(function (item) {
    summary[item.status] = (summary[item.status] || 0) + 1;
  });

  return { ok: true, summary: summary, guests: list };
}

/** Rode manualmente após editar convidados na planilha */
function normalizeGuests() {
  var sheet = getSheet(SHEET_GUESTS);
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var map = {};
  headers.forEach(function (h, i) {
    map[String(h).trim()] = i;
  });

  for (var i = 1; i < rows.length; i++) {
    var fullName = rows[i][map.full_name];
    var phone = rows[i][map.phone];
    if (fullName) {
      rows[i][map.first_name] = normalizeName(fullName);
    }
    if (phone) {
      var normalized = normalizePhone(phone);
      rows[i][map.phone] = normalized;
      rows[i][map.phone_last4] = phoneLast4(normalized);
    }
  }

  if (rows.length > 1) {
    sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
  }

  backfillRsvpNames();
  clearGuestCache();
}

/** Completa full_name nas linhas já gravadas da aba rsvps */
function backfillRsvpNames() {
  var namesById = {};
  loadGuestsFromSheet().forEach(function (g) {
    namesById[g.guestId] = g.fullName;
  });

  var sheet = getSheet(SHEET_RSVPS);
  var rows = sheet.getDataRange().getValues();
  if (!rows.length) return;

  var headers = rows[0];
  var nameCol = ensureRsvpNameColumn(sheet, headers, rows);
  var guestCol = headers.indexOf("guest_id");
  if (guestCol === -1) return;

  var changed = false;
  var i;
  for (i = 1; i < rows.length; i++) {
    var guestId = String(rows[i][guestCol] || "");
    var name = namesById[guestId];
    if (!guestId || !name || rows[i][nameCol] === name) continue;
    rows[i][nameCol] = name;
    changed = true;
  }

  if (changed) {
    sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
    CacheService.getScriptCache().remove(CACHE_KEY_RSVPS);
  }
}
