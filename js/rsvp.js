(function () {
  "use strict";

  var CONFIG = {
    API_URL: "https://script.google.com/macros/s/AKfycbwmA9ndpoK2_9Y0COyy1MScOqBapNeMuGhMWMpe-gfeT4oK-oyFem2-RfnL1R8U1Jc18Q/exec",
    RSVP_DEADLINE_END: "2027-03-16T02:59:59.999Z",
    RSVP_DEADLINE_LABEL: "15 de março de 2027",
  };

  var state = {
    step: "unlock",
    token: null,
    invitationId: null,
    guests: [],
    unlockFirstName: "",
  };

  var modal = document.getElementById("rsvp-modal");
  var dialog = document.querySelector(".rsvp-modal__dialog");
  var rsvpTrigger = null;
  var loadingCount = 0;

  function ensureLoader() {
    if (!dialog || document.getElementById("rsvp-loader")) return;

    var loader = document.createElement("div");
    loader.id = "rsvp-loader";
    loader.className = "rsvp-modal__loader";
    loader.hidden = true;
    loader.setAttribute("role", "status");
    loader.setAttribute("aria-live", "polite");
    loader.setAttribute("aria-label", "Carregando");
    loader.innerHTML = '<span class="rsvp-modal__loader-spinner"></span>';
    dialog.appendChild(loader);
  }

  function setLoading(isLoading) {
    ensureLoader();
    var loader = document.getElementById("rsvp-loader");
    if (!dialog || !loader) return;

    loadingCount = Math.max(0, loadingCount + (isLoading ? 1 : -1));
    var busy = loadingCount > 0;

    loader.hidden = !busy;
    dialog.classList.toggle("is-loading", busy);
    dialog.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function updateDialogSize(step) {
    if (!dialog) return;
    dialog.classList.toggle("is-expanded", step === "rsvp" || step === "admin");
  }

  function normalizeName(value) {
    return value
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z\s-]/g, "")
      .split(/\s+/)[0];
  }

  function isAdminLogin(firstName) {
    return normalizeName(firstName) === "admin";
  }

  function normalizeLast4(value) {
    return value.replace(/\D/g, "").slice(-4);
  }

  function isRsvpClosed() {
    return Date.now() > new Date(CONFIG.RSVP_DEADLINE_END).getTime();
  }

  function rsvpClosedMessage() {
    return (
      "O prazo para confirmação encerrou em " +
      CONFIG.RSVP_DEADLINE_LABEL +
      "."
    );
  }

  function updateSecondFieldMode() {
    var firstNameInput = document.getElementById("rsvp-first-name");
    var secondField = document.getElementById("rsvp-second-field");
    var adminMode = firstNameInput && isAdminLogin(firstNameInput.value);

    if (!secondField) return;

    if (adminMode) {
      secondField.type = "password";
      secondField.autocomplete = "current-password";
      secondField.removeAttribute("maxlength");
      secondField.removeAttribute("inputmode");
      return;
    }

    secondField.type = "text";
    secondField.autocomplete = "off";
    secondField.setAttribute("maxlength", "4");
    secondField.setAttribute("inputmode", "numeric");
    secondField.value = secondField.value.replace(/\D/g, "").slice(0, 4);
  }

  function updateDeadlineUI() {
    var hint = document.getElementById("rsvp-unlock-hint");

    if (!hint) return;

    if (isRsvpClosed()) {
      hint.textContent = rsvpClosedMessage();
      return;
    }

    hint.innerHTML =
      "Informe seu primeiro nome e os últimos 4 dígitos do celular.<br>Por favor, confirmar até " +
      CONFIG.RSVP_DEADLINE_LABEL +
      ".";
  }

  function updateUnlockFormState() {
    updateDeadlineUI();
    updateSecondFieldMode();
  }

  function setStep(step) {
    state.step = step;
    document.querySelectorAll("[data-rsvp-step]").forEach(function (el) {
      el.hidden = el.getAttribute("data-rsvp-step") !== step;
    });

    var titles = {
      unlock: "Confirmar presença",
      rsvp: "Sua confirmação",
      admin: "Confirmar presença",
    };

    var titleEl = document.getElementById("rsvp-modal-title");
    if (titleEl) {
      titleEl.textContent = titles[step] || "RSVP";
    }

    updateDialogSize(step);
  }

  function showMessage(type, text) {
    var box = document.getElementById("rsvp-message");
    if (!box) return;

    box.hidden = !text;
    box.className =
      "rsvp-modal__" + (type === "error" ? "error" : "success");
    box.textContent = text || "";
  }

  function openModal(triggerEl) {
    if (!modal) return;
    rsvpTrigger = triggerEl || null;
    resetModal();
    modal.classList.add("is-open");
    var firstInput = document.getElementById("rsvp-first-name");
    if (firstInput) firstInput.focus();
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove("is-open");
    loadingCount = 0;
    setLoading(false);
    if (rsvpTrigger) {
      rsvpTrigger.focus();
      rsvpTrigger = null;
    }
  }

  function resetModal() {
    state.token = null;
    state.invitationId = null;
    state.guests = [];
    state.unlockFirstName = "";
    showMessage("", "");

    var firstName = document.getElementById("rsvp-first-name");
    var secondField = document.getElementById("rsvp-second-field");

    if (firstName) firstName.value = "";
    if (secondField) secondField.value = "";

    setStep("unlock");
    updateUnlockFormState();
  }

  function apiRequest(action, payload) {
    if (!CONFIG.API_URL) {
      return Promise.reject(new Error("Configure a URL da API do Apps Script."));
    }

    setLoading(true);

    return fetch(CONFIG.API_URL, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: action, payload: payload }),
    })
      .then(function (res) {
        return res.text();
      })
      .then(function (text) {
        var data;
        try {
          data = JSON.parse(text);
        } catch (parseErr) {
          throw new Error(
            "Resposta inválida da API. Confira o deploy (New version) e a URL /exec."
          );
        }
        if (!data.ok) {
          throw new Error(data.message || "Não foi possível completar a ação.");
        }
        return data;
      })
      .finally(function () {
        setLoading(false);
      });
  }

  function renderGuestList(guests) {
    var list = document.getElementById("rsvp-guest-list");
    var greeting = document.getElementById("rsvp-greeting");
    if (!list) return;

    if (greeting) {
      greeting.textContent =
        "Olá, " +
        (state.unlockFirstName || "convidado") +
        "! Confirme a presença de cada pessoa:";
    }

    list.innerHTML = "";

    guests.forEach(function (guest) {
      var row = document.createElement("div");
      row.className = "rsvp-modal__guest";
      row.innerHTML =
        '<span class="rsvp-modal__guest-name">' +
        guest.fullName +
        "</span>" +
        '<div class="rsvp-modal__choices">' +
        choiceHtml(guest.guestId, "confirmed", "Confirmo", guest.status) +
        choiceHtml(guest.guestId, "declined", "Não poderei ir", guest.status) +
        "</div>";
      list.appendChild(row);
    });
  }

  function choiceHtml(guestId, value, label, currentStatus) {
    var checked = currentStatus === value ? " checked" : "";
    var id = "rsvp-" + guestId + "-" + value;
    return (
      '<label class="rsvp-modal__choice">' +
      '<input type="radio" name="guest-' +
      guestId +
      '" id="' +
      id +
      '" value="' +
      value +
      '"' +
      checked +
      " required>" +
      "<span>" +
      label +
      "</span>" +
      "</label>"
    );
  }

  function collectResponses() {
    var responses = [];

    state.guests.forEach(function (guest) {
      var selected = document.querySelector(
        'input[name="guest-' + guest.guestId + '"]:checked'
      );
      if (!selected) {
        throw new Error("Selecione uma opção para " + guest.fullName + ".");
      }
      responses.push({
        guestId: guest.guestId,
        status: selected.value,
      });
    });

    return responses;
  }

  function handleUnlockSubmit(event) {
    event.preventDefault();
    showMessage("", "");

    var firstNameInput = document.getElementById("rsvp-first-name");
    var secondField = document.getElementById("rsvp-second-field");
    var firstName = firstNameInput ? firstNameInput.value : "";
    var secondValue = secondField ? secondField.value : "";

    if (!firstName.trim()) {
      showMessage("error", "Informe seu primeiro nome.");
      if (firstNameInput) firstNameInput.focus();
      return;
    }

    if (isRsvpClosed() && !isAdminLogin(firstName)) {
      showMessage("error", rsvpClosedMessage());
      return;
    }

    if (isAdminLogin(firstName)) {
      if (!secondValue) {
        showMessage("error", "Informe a senha.");
        if (secondField) secondField.focus();
        return;
      }

      apiRequest("admin", { password: secondValue })
        .then(function (data) {
          if (!data.ok) {
            showMessage("error", data.message);
            return;
          }

          renderAdmin(data);
          setStep("admin");
          showMessage("", "");
        })
        .catch(function (err) {
          showMessage("error", err.message);
        });
      return;
    }

    var last4 = normalizeLast4(secondValue);
    if (last4.length !== 4) {
      showMessage("error", "Informe os últimos 4 dígitos do celular.");
      if (secondField) secondField.focus();
      return;
    }

    state.unlockFirstName = firstName.trim().split(/\s+/)[0];

    apiRequest("unlock", { firstName: firstName, last4: last4 })
      .then(function (data) {
        if (!data.ok) {
          showMessage("error", data.message);
          return;
        }

        state.token = data.token;
        state.invitationId = data.invitationId;
        state.guests = data.guests;
        renderGuestList(data.guests);
        setStep("rsvp");
        showMessage("", "");
      })
      .catch(function (err) {
        showMessage("error", err.message);
      });
  }

  function handleRsvpSubmit(event) {
    event.preventDefault();
    showMessage("", "");

    if (isRsvpClosed()) {
      showMessage("error", rsvpClosedMessage());
      return;
    }

    try {
      var responses = collectResponses();
      apiRequest("rsvp", {
        token: state.token,
        invitationId: state.invitationId,
        responses: responses,
      })
        .then(function (data) {
          if (!data.ok) {
            showMessage("error", data.message);
            return;
          }

          responses.forEach(function (item) {
            var guest = state.guests.find(function (g) {
              return g.guestId === item.guestId;
            });
            if (guest) guest.status = item.status;
          });

          showMessage("success", "Confirmação enviada com sucesso!");
        })
        .catch(function (err) {
          showMessage("error", err.message);
        });
    } catch (err) {
      showMessage("error", err.message);
    }
  }

  function statusLabel(status) {
    if (status === "confirmed") return "Confirmado";
    if (status === "declined") return "Recusou";
    return "Pendente";
  }

  function renderAdmin(data) {
    var statsEl = document.getElementById("rsvp-admin-stats");
    var listEl = document.getElementById("rsvp-admin-list");
    if (!statsEl || !listEl) return;

    statsEl.innerHTML =
      statHtml(data.summary.confirmed, "Confirmados") +
      statHtml(data.summary.declined, "Recusaram") +
      statHtml(data.summary.pending, "Pendentes");

    listEl.innerHTML = "";

    data.guests.forEach(function (guest) {
        var row = document.createElement("div");
        row.className = "rsvp-modal__admin-row";
        row.innerHTML =
          '<span class="rsvp-modal__admin-name">' +
          guest.fullName +
          '</span><span class="rsvp-modal__admin-badge rsvp-modal__admin-badge--' +
          guest.status +
          '">' +
          statusLabel(guest.status) +
          "</span>";
        listEl.appendChild(row);
      });
  }

  function statHtml(value, label) {
    return (
      '<div class="rsvp-modal__stat">' +
      '<span class="rsvp-modal__stat-value">' +
      value +
      '</span><span class="rsvp-modal__stat-label">' +
      label +
      "</span></div>"
    );
  }

  document.querySelectorAll("[data-rsvp]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      openModal(btn);
    });
  });

  if (modal) {
    modal.addEventListener("click", function (event) {
      if (event.target === modal) closeModal();
    });
  }

  document.querySelectorAll("[data-rsvp-close]").forEach(function (el) {
    el.addEventListener("click", closeModal);
  });

  document.querySelectorAll("[data-rsvp-back]").forEach(function (el) {
    el.addEventListener("click", function () {
      showMessage("", "");
      setStep("unlock");
      updateUnlockFormState();
    });
  });

  var unlockForm = document.getElementById("rsvp-unlock-form");
  var rsvpForm = document.getElementById("rsvp-confirm-form");

  if (unlockForm) unlockForm.addEventListener("submit", handleUnlockSubmit);
  if (rsvpForm) rsvpForm.addEventListener("submit", handleRsvpSubmit);

  var firstNameInput = document.getElementById("rsvp-first-name");
  var secondFieldInput = document.getElementById("rsvp-second-field");

  if (firstNameInput) {
    firstNameInput.addEventListener("input", updateUnlockFormState);
  }

  if (secondFieldInput) {
    secondFieldInput.addEventListener("input", function () {
      if (!firstNameInput || isAdminLogin(firstNameInput.value)) return;
      secondFieldInput.value = secondFieldInput.value.replace(/\D/g, "").slice(0, 4);
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && modal && modal.classList.contains("is-open")) {
      closeModal();
    }
  });

  ensureLoader();

  window.RSVP_CONFIG = CONFIG;
})();
