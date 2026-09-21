/**
 * RSVP — Google Apps Script
 *
 * Setup:
 * 1. Crie uma planilha com abas "convidados" e "rsvps"
 * 2. Aba convidados (linha 1 = cabeçalho):
 *    guest_id | invitation_id | full_name | first_name | phone | phone_last4 | can_unlock
 * 3. Aba rsvps:
 *    guest_id | status | updated_at
 * 4. script.google.com > Novo projeto > cole este arquivo
 * 5. Project Settings > Script Properties:
 *    SPREADSHEET_ID = id da planilha (obrigatório)
 *    ADMIN_PASSWORD = sua-senha
 *    TOKEN_SECRET   = string-aleatoria-longa
 * 6. Deploy > New deployment > Web app
 *    Execute as: Me | Who has access: Anyone
 * 7. Copie a URL e configure em js/rsvp.js (CONFIG.API_URL)
 */

var SHEET_GUESTS = "convidados";
var SHEET_RSVPS = "rsvps";
var RSVP_DEADLINE_END = "2027-03-16T02:59:59.999Z"; // fim do dia 15/03/2027 (Brasília)
var RSVP_DEADLINE_LABEL = "15 de março de 2027";
var RATE_LIMIT_WINDOW_SECONDS = 900; // 15 minutos
var RATE_LIMIT_MAX_UNLOCK = 10;
var RATE_LIMIT_MAX_ADMIN = 5;

function isRsvpClosed() {
  var end =
    PropertiesService.getScriptProperties().getProperty("RSVP_DEADLINE_END") ||
    RSVP_DEADLINE_END;
  return Date.now() > new Date(end).getTime();
}

function rsvpClosedMessage() {
  var label =
    PropertiesService.getScriptProperties().getProperty("RSVP_DEADLINE_LABEL") ||
    RSVP_DEADLINE_LABEL;
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
  return ContentService.createTextOutput("RSVP API OK");
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function getSpreadsheet() {
  var id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) {
    throw new Error("SPREADSHEET_ID não configurado nas Script Properties.");
  }
  return SpreadsheetApp.openById(id);
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

function readGuests() {
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
  var secret = PropertiesService.getScriptProperties().getProperty("TOKEN_SECRET");
  var expires = Date.now() + 60 * 60 * 1000;
  var raw = invitationId + "|" + expires;
  var sig = Utilities.computeHmacSha256Signature(raw, secret);
  var sigB64 = Utilities.base64Encode(sig);
  return Utilities.base64Encode(raw + "|" + sigB64);
}

function verifyToken(token) {
  try {
    var secret = PropertiesService.getScriptProperties().getProperty("TOKEN_SECRET");
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

  var guests = readGuests().filter(function (g) {
    return g.invitationId === invitationId;
  });
  var allowedIds = guests.map(function (g) {
    return g.guestId;
  });

  var sheet = getSheet(SHEET_RSVPS);
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var guestCol = headers.indexOf("guest_id");
  var statusCol = headers.indexOf("status");
  var updatedCol = headers.indexOf("updated_at");
  var existing = {};

  for (var i = 1; i < rows.length; i++) {
    existing[String(rows[i][guestCol])] = i + 1;
  }

  var now = new Date().toISOString();
  (payload.responses || []).forEach(function (item) {
    if (allowedIds.indexOf(item.guestId) === -1) return;
    if (item.status !== "confirmed" && item.status !== "declined") return;

    if (existing[item.guestId]) {
      sheet.getRange(existing[item.guestId], statusCol + 1).setValue(item.status);
      sheet.getRange(existing[item.guestId], updatedCol + 1).setValue(now);
    } else {
      sheet.appendRow([item.guestId, item.status, now]);
    }
  });

  return { ok: true };
}

function admin(payload) {
  if (isRateLimited("admin", "global", RATE_LIMIT_MAX_ADMIN)) {
    return { ok: false, message: rateLimitMessage() };
  }

  var password = PropertiesService.getScriptProperties().getProperty("ADMIN_PASSWORD");
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
      sheet.getRange(i + 1, map.first_name + 1).setValue(normalizeName(fullName));
    }
    if (phone) {
      var normalized = normalizePhone(phone);
      sheet.getRange(i + 1, map.phone + 1).setValue(normalized);
      sheet.getRange(i + 1, map.phone_last4 + 1).setValue(phoneLast4(normalized));
    }
  }
}
