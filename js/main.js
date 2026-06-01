(function () {
  "use strict";

  var menuBtn = document.querySelector(".site-header__menu-btn");
  var navOverlay = document.querySelector(".nav-overlay");
  var navDrawer = document.querySelector(".nav-drawer");

  function setMenuOpen(isOpen) {
    if (!menuBtn) return;

    menuBtn.classList.toggle("is-open", isOpen);
    menuBtn.setAttribute("aria-expanded", String(isOpen));
    menuBtn.setAttribute("aria-label", isOpen ? "Fechar menu" : "Abrir menu");

    if (navOverlay) {
      navOverlay.classList.toggle("is-open", isOpen);
      navOverlay.setAttribute("aria-hidden", String(!isOpen));
    }

    if (navDrawer) {
      navDrawer.classList.toggle("is-open", isOpen);
    }

    document.body.style.overflow = isOpen ? "hidden" : "";
  }

  if (menuBtn) {
    menuBtn.addEventListener("click", function () {
      setMenuOpen(!menuBtn.classList.contains("is-open"));
    });
  }

  if (navOverlay) {
    navOverlay.addEventListener("click", function () {
      setMenuOpen(false);
    });
  }

  document.querySelectorAll(".nav-drawer__link").forEach(function (link) {
    link.addEventListener("click", function () {
      setMenuOpen(false);
    });
  });

  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener("click", function (event) {
      var targetId = anchor.getAttribute("href");
      if (!targetId || targetId === "#") return;

      var target = document.querySelector(targetId);
      if (!target) return;

      event.preventDefault();
      target.scrollIntoView({ behavior: "smooth" });
    });
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      if (rsvpModal && rsvpModal.classList.contains("is-open")) {
        closeRsvpModal();
      } else {
        setMenuOpen(false);
      }
    }
  });

  var RSVP_PHONE = "5512996263115";
  var RSVP_MESSAGE =
    "Olá! Sou {nome} e confirmo presença no casamento de Beatriz e Julio (12/06/2027).";

  var rsvpModal = null;
  var rsvpInput = null;
  var rsvpTrigger = null;

  function buildRsvpModal() {
    var modal = document.createElement("div");
    modal.className = "rsvp-modal";
    modal.id = "rsvp-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML =
      '<button type="button" class="rsvp-modal__backdrop" data-rsvp-close aria-label="Fechar"></button>' +
      '<div class="rsvp-modal__dialog" role="dialog" aria-labelledby="rsvp-modal-title" aria-modal="true">' +
      '<h2 id="rsvp-modal-title" class="rsvp-modal__title">Confirmar presença</h2>' +
      '<p class="rsvp-modal__text">Como podemos te chamar?</p>' +
      '<form class="rsvp-modal__form">' +
      '<label for="rsvp-name" class="visually-hidden">Seu nome</label>' +
      '<input type="text" id="rsvp-name" class="rsvp-modal__input" placeholder="Seu nome" required autocomplete="name">' +
      '<div class="rsvp-modal__actions">' +
      '<button type="button" class="btn" data-rsvp-close>Cancelar</button>' +
      '<button type="submit" class="btn btn--olive">Enviar</button>' +
      "</div></form></div>";

    document.body.appendChild(modal);

    modal.querySelector(".rsvp-modal__form").addEventListener("submit", function (event) {
      event.preventDefault();
      submitRsvp();
    });

    modal.querySelectorAll("[data-rsvp-close]").forEach(function (el) {
      el.addEventListener("click", closeRsvpModal);
    });

    return modal;
  }

  function openRsvpModal(trigger) {
    if (!rsvpModal) {
      rsvpModal = buildRsvpModal();
      rsvpInput = rsvpModal.querySelector("#rsvp-name");
    }

    rsvpTrigger = trigger || null;
    rsvpModal.classList.add("is-open");
    rsvpModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    rsvpInput.value = "";
    window.setTimeout(function () {
      rsvpInput.focus();
    }, 50);
  }

  function closeRsvpModal() {
    if (!rsvpModal) return;

    rsvpModal.classList.remove("is-open");
    rsvpModal.setAttribute("aria-hidden", "true");

    if (!menuBtn || !menuBtn.classList.contains("is-open")) {
      document.body.style.overflow = "";
    }

    if (rsvpTrigger) {
      rsvpTrigger.focus();
      rsvpTrigger = null;
    }
  }

  function submitRsvp() {
    var nome = rsvpInput.value.trim();
    if (!nome) {
      rsvpInput.focus();
      return;
    }

    var text = RSVP_MESSAGE.replace("{nome}", nome);
    var url =
      "https://wa.me/" + RSVP_PHONE + "?text=" + encodeURIComponent(text);

    window.open(url, "_blank", "noopener,noreferrer");
    closeRsvpModal();
  }

  document.querySelectorAll("[data-rsvp]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      openRsvpModal(btn);
    });
  });

  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var selector = btn.getAttribute("data-copy");
      var el = document.querySelector(selector);
      var feedback = document.querySelector("[data-copy-feedback]");
      if (!el) return;

      var text = el.textContent.trim();

      function showFeedback(message) {
        if (feedback) {
          feedback.textContent = message;
          window.setTimeout(function () {
            feedback.textContent = "";
          }, 2500);
        }
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          showFeedback("Chave copiada!");
        }).catch(function () {
          showFeedback("Não foi possível copiar.");
        });
      } else {
        var range = document.createRange();
        range.selectNodeContents(el);
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        try {
          document.execCommand("copy");
          showFeedback("Chave copiada!");
        } catch (err) {
          showFeedback("Não foi possível copiar.");
        }
        selection.removeAllRanges();
      }
    });
  });

  function initCarousel(root) {
    var track = root.querySelector(".carousel__slides");
    var slides = root.querySelectorAll(".carousel__slide");
    var prevBtn = root.querySelector(".carousel__btn--prev");
    var nextBtn = root.querySelector(".carousel__btn--next");
    var index = 0;
    var total = slides.length;

    if (!track || total <= 1) {
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      return;
    }

    function update() {
      track.style.transform = "translateX(-" + index * 100 + "%)";
      if (prevBtn) prevBtn.disabled = index === 0;
      if (nextBtn) nextBtn.disabled = index === total - 1;
    }

    if (prevBtn) {
      prevBtn.addEventListener("click", function () {
        if (index > 0) {
          index -= 1;
          update();
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", function () {
        if (index < total - 1) {
          index += 1;
          update();
        }
      });
    }

    update();
  }

  // Scroll behavior for the site header
  var lastScrollY = window.scrollY;
  var header = document.querySelector(".site-header");

  if (header) {
    window.addEventListener("scroll", function () {
      var currentScrollY = window.scrollY;
      
      // Never hide the header if the menu drawer is open
      var isMenuOpen = menuBtn && menuBtn.classList.contains("is-open");
      
      if (!isMenuOpen) {
        if (currentScrollY > 50 && currentScrollY > lastScrollY) {
          // Scrolling down — hide the header
          header.classList.add("site-header--hidden");
        } else if (currentScrollY < lastScrollY || currentScrollY <= 50) {
          // Scrolling up OR near the top — show the header
          header.classList.remove("site-header--hidden");
        }
      }
      
      lastScrollY = currentScrollY;
    }, { passive: true });
  }

  document.querySelectorAll("[data-carousel]").forEach(initCarousel);
})();
