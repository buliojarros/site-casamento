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
    updateHeaderTone();
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

  var rsvpModal = document.getElementById("rsvp-modal");
  var rsvpInput = document.getElementById("rsvp-name");
  var rsvpForm = document.getElementById("rsvp-form");
  var rsvpTrigger = null;

  function openRsvpModal(trigger) {
    if (!rsvpModal || !rsvpInput) return;

    rsvpTrigger = trigger || null;
    rsvpModal.classList.add("is-open");
    rsvpInput.value = "";
    rsvpInput.focus();
  }

  function closeRsvpModal() {
    if (!rsvpModal) return;

    rsvpModal.classList.remove("is-open");

    if (rsvpTrigger) {
      rsvpTrigger.focus();
      rsvpTrigger = null;
    }
  }

  if (rsvpModal) {
    rsvpModal.addEventListener("click", function (event) {
      if (event.target === rsvpModal) {
        closeRsvpModal();
      }
    });
  }

  if (rsvpForm) {
    rsvpForm.addEventListener("submit", function (event) {
      event.preventDefault();
      submitRsvp();
    });
  }

  document.querySelectorAll("[data-rsvp-close]").forEach(function (el) {
    el.addEventListener("click", closeRsvpModal);
  });

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

  // Header: light hamburger over hero + colored sections (olive / sage)
  var header = document.querySelector(".site-header");
  var darkBgSections = document.querySelectorAll(".hero, .dress-code--gold, .presentes");

  function updateHeaderTone() {
    if (!header) return;

    if (menuBtn && menuBtn.classList.contains("is-open")) {
      header.classList.add("site-header--on-light");
      return;
    }

    var headerBottom = header.offsetHeight || 56;
    var overDark = false;

    darkBgSections.forEach(function (section) {
      var rect = section.getBoundingClientRect();
      if (rect.top < headerBottom && rect.bottom > 0) {
        overDark = true;
      }
    });

    header.classList.toggle("site-header--on-light", !overDark);
  }

  if (header) {
    window.addEventListener("scroll", updateHeaderTone, { passive: true });
    window.addEventListener("resize", updateHeaderTone, { passive: true });
    updateHeaderTone();
  }

  document.querySelectorAll("[data-carousel]").forEach(initCarousel);

  document.querySelectorAll("[data-tips-tabs]").forEach(function (root) {
    var tabs = root.querySelectorAll(".tips__tab");
    var panels = root.querySelectorAll(".tips__panel");

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var targetId = tab.getAttribute("aria-controls");

        tabs.forEach(function (item) {
          var selected = item === tab;
          item.classList.toggle("is-active", selected);
          item.setAttribute("aria-selected", String(selected));
        });

        panels.forEach(function (panel) {
          var active = panel.id === targetId;
          panel.classList.toggle("is-active", active);
          if (active) {
            panel.removeAttribute("hidden");
          } else {
            panel.setAttribute("hidden", "");
          }
        });
      });
    });
  });

  // Scroll reveal animation
  if ("IntersectionObserver" in window) {
    var revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );

    document.querySelectorAll(".reveal").forEach(function (el) {
      revealObserver.observe(el);
    });
  } else {
    // Fallback: show all immediately
    document.querySelectorAll(".reveal").forEach(function (el) {
      el.classList.add("is-visible");
    });
  }
})();
