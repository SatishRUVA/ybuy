const app = document.querySelector("[data-journey-app]");

if (app) {
  const directionLabels = new Map([
    ["quiet-luxury", "quiet-luxury"],
    ["modern-minimal", "contemporary-commerce"],
    ["contemporary-commerce", "contemporary-commerce"],
    ["neighborhood-marketplace", "fresh-neighborhood"],
    ["fresh-neighborhood", "fresh-neighborhood"],
    ["bold-contemporary", "bold-creative"],
    ["bold-creative", "bold-creative"],
    ["editorial-premium", "editorial-lifestyle"],
    ["editorial-lifestyle", "editorial-lifestyle"],
    ["sophisticated-dark", "sophisticated-dark"],
    ["colorful-luxury", "colorful-premium"],
    ["colorful-premium", "colorful-premium"],
    ["experimental", "experimental-objects"],
    ["experimental-objects", "experimental-objects"],
  ]);
  const query = new URLSearchParams(window.location.search);
  const directionSelect = app.querySelector("[data-direction-select]");
  const screenLinks = [...app.querySelectorAll("[data-screen-link]")];
  const screens = [...app.querySelectorAll("[data-screen]")];
  let currentDirection = directionLabels.get(query.get("direction")) ?? "fresh-neighborhood";
  const validScreens = new Set(screens.map((screen) => screen.dataset.screen));

  function syncRouteLinks() {
    app.querySelectorAll('a[href*="screen="]').forEach((link) => {
      const target = new URL(link.href, window.location.href);
      target.searchParams.set("direction", currentDirection);
      link.href = `${target.pathname}?${target.searchParams}`;
    });
  }

  function setScreen(name, updateHistory = true) {
    const screenName = validScreens.has(name) ? name : "search";
    screens.forEach((screen) => {
      screen.hidden = screen.dataset.screen !== screenName;
    });
    screenLinks.forEach((link) => {
      if (link.dataset.screenLink === screenName) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
    syncRouteLinks();

    if (updateHistory) {
      const next = new URL(window.location.href);
      next.searchParams.set("direction", currentDirection);
      next.searchParams.set("screen", screenName);
      window.history.pushState({ screen: screenName }, "", next);
    }
    document.title = `${screenName[0].toUpperCase()}${screenName.slice(1)} · YBuy prototype`;
    if (updateHistory) app.querySelector("#journey-main").focus({ preventScroll: true });
  }

  app.dataset.direction = currentDirection;
  directionSelect.value = currentDirection;
  const firstScreen = query.get("screen");
  setScreen(firstScreen && validScreens.has(firstScreen) ? firstScreen : "search", false);

  app.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href*="screen="]') : null;
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = new URL(link.href, window.location.href);
    const screenName = target.searchParams.get("screen");
    if (!screenName || !validScreens.has(screenName)) return;
    event.preventDefault();
    setScreen(screenName);
  });

  window.addEventListener("popstate", () => {
    const state = new URLSearchParams(window.location.search);
    currentDirection = directionLabels.get(state.get("direction")) ?? "fresh-neighborhood";
    directionSelect.value = currentDirection;
    app.dataset.direction = currentDirection;
    setScreen(state.get("screen"), false);
  });

  directionSelect.addEventListener("change", () => {
    currentDirection = directionSelect.value;
    app.dataset.direction = directionSelect.value;
    const currentScreen = app.querySelector(".journey-screen:not([hidden])")?.dataset.screen ?? "search";
    const next = new URL(window.location.href);
    next.searchParams.set("direction", currentDirection);
    next.searchParams.set("screen", currentScreen);
    window.history.replaceState({ screen: currentScreen }, "", next);
    syncRouteLinks();
  });

  const searchForm = app.querySelector("[data-search-form]");
  const searchInput = searchForm.querySelector("[name='query']");
  const categoryInput = searchForm.querySelector("[name='category']");
  const listingCards = [...app.querySelectorAll("[data-listing]")];
  const resultCount = app.querySelector("[data-search-count]");
  const noResults = app.querySelector("[data-search-empty]");

  function filterListings() {
    const text = searchInput.value.trim().toLocaleLowerCase();
    const category = categoryInput.value;
    let visible = 0;
    listingCards.forEach((card) => {
      const matchesCategory = category === "all" || card.dataset.category === category;
      const matchesText = !text || card.textContent.toLocaleLowerCase().includes(text);
      card.hidden = !matchesCategory || !matchesText;
      if (!card.hidden) visible += 1;
    });
    resultCount.textContent = `${visible} sample ${visible === 1 ? "item" : "items"}`;
    noResults.hidden = visible > 0;
  }

  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    filterListings();
  });
  searchInput.addEventListener("input", filterListings);
  categoryInput.addEventListener("change", filterListings);

  app.querySelectorAll("[data-save-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const saved = button.getAttribute("aria-pressed") !== "true";
      button.setAttribute("aria-pressed", String(saved));
      button.textContent = saved ? "Saved" : "Save item";
    });
  });

  const dateForm = app.querySelector("[data-date-form]");
  dateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const start = dateForm.elements.start.value;
    const end = dateForm.elements.end.value;
    if (!start || !end || end <= start) {
      dateForm.querySelector(".form-hint").textContent = "Choose an end date after the start date.";
      dateForm.elements.end.focus();
      return;
    }
    dateForm.querySelector(".form-hint").textContent = "Dates shown are a preview. Live availability must be checked before any booking.";
    app.querySelector("[data-checkout-form] [name='start']").value = start;
    app.querySelector("[data-checkout-form] [name='end']").value = end;
    setScreen("checkout");
  });

  const checkoutForm = app.querySelector("[data-checkout-form]");
  checkoutForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const start = new Date(`${checkoutForm.elements.start.value}T00:00:00`);
    const end = new Date(`${checkoutForm.elements.end.value}T00:00:00`);
    const status = app.querySelector("[data-checkout-status]");
    if (!checkoutForm.reportValidity()) return;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      status.textContent = "Choose a return date after pick-up.";
      checkoutForm.elements.end.focus();
      return;
    }
    status.textContent = "Sample request preview ready. No booking was created and no payment was taken.";
  });

  app.querySelectorAll("[data-booking-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      app.querySelectorAll("[data-booking-filter]").forEach((candidate) => candidate.classList.toggle("is-active", candidate === button));
      app.querySelectorAll("[data-booking-filter]").forEach((candidate) => {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      });
      app.querySelectorAll("[data-booking-row]").forEach((row) => {
        row.hidden = button.dataset.bookingFilter !== "all" && row.dataset.status !== button.dataset.bookingFilter;
      });
    });
  });

  const requestPanel = app.querySelector("[data-request-panel]");
  requestPanel.querySelectorAll("[data-request-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const state = button.dataset.requestAction;
      app.querySelector("[data-request-status]").textContent = state === "approved"
        ? "Sample request approved in this preview. No renter has been notified."
        : "Sample request declined in this preview. No booking was changed.";
      requestPanel.querySelectorAll("[data-request-action]").forEach((action) => {
        action.disabled = true;
      });
    });
  });

  const wizard = app.querySelector("[data-listing-wizard]");
  const wizardPages = [...wizard.querySelectorAll("[data-wizard-page]")];
  const wizardSteps = [...app.querySelectorAll("[data-wizard-step]")];
  let currentWizardStep = 0;

  function showWizardStep(index) {
    currentWizardStep = index;
    wizardPages.forEach((page) => {
      page.hidden = Number(page.dataset.wizardPage) !== index;
    });
    wizardSteps.forEach((step) => {
      const stepNumber = Number(step.dataset.wizardStep);
      step.classList.toggle("is-current", stepNumber === index);
      step.classList.toggle("is-done", stepNumber < index);
    });
    wizard.querySelector("[data-wizard-back]").hidden = index === 0;
    wizard.querySelector("[data-wizard-next]").hidden = index === wizardPages.length - 1;
    wizard.querySelector("[data-wizard-publish]").hidden = index !== wizardPages.length - 1;
    wizard.querySelector("[data-wizard-status]").textContent = "";
  }

  wizard.querySelector("[data-wizard-next]").addEventListener("click", () => {
    const fields = [...wizardPages[currentWizardStep].querySelectorAll("input, select, textarea")];
    const invalid = fields.find((field) => !field.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      invalid.focus();
      return;
    }
    showWizardStep(Math.min(currentWizardStep + 1, wizardPages.length - 1));
    wizardPages[currentWizardStep].querySelector("input, select, textarea")?.focus();
  });
  wizard.querySelector("[data-wizard-back]").addEventListener("click", () => {
    showWizardStep(Math.max(currentWizardStep - 1, 0));
  });
  wizard.addEventListener("submit", (event) => {
    event.preventDefault();
    const invalid = [...wizard.querySelectorAll("input, select, textarea")].find((field) => !field.checkValidity());
    if (invalid) {
      showWizardStep(Number(invalid.closest("[data-wizard-page]").dataset.wizardPage));
      invalid.reportValidity();
      invalid.focus();
      return;
    }
    app.querySelector("[data-wizard-status]").textContent = "Sample draft preview saved in this page only. Nothing was published.";
  });

  const returnButton = app.querySelector('[data-booking-action="return"]');
  const reviewLink = app.querySelector("[data-review-link]");
  const reviewSubmit = app.querySelector("[data-review-submit]");
  app.querySelectorAll("[data-booking-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const step = button.dataset.bookingAction;
      const timelineStep = button.closest("li");
      timelineStep.classList.add("is-complete");
      button.disabled = true;
      button.textContent = step === "pickup" ? "Sample pickup recorded" : "Sample return recorded";
      app.querySelector("[data-booking-status]").textContent = step === "pickup"
        ? "Pickup recorded in this local preview."
        : "Return recorded in this local preview. Review is now available.";
      app.querySelector("[data-current-booking-status]").textContent = step === "pickup" ? "Active · sample" : "Return pending review · sample";
      if (step === "pickup") returnButton.disabled = false;
      if (step === "return") {
        reviewLink.hidden = false;
        reviewSubmit.disabled = false;
        app.querySelector('[data-timeline-step="review"]').classList.add("is-complete");
      }
    });
  });

  const messageForm = app.querySelector("[data-message-form]");
  messageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!messageForm.reportValidity()) return;
    const input = messageForm.elements.message;
    const bubble = document.createElement("p");
    bubble.className = "message-bubble from-me";
    bubble.textContent = input.value.trim();
    if (!bubble.textContent) return;
    app.querySelector("[data-message-log]").append(bubble);
    input.value = "";
    input.focus();
  });

  const reviewForm = app.querySelector("[data-review-form]");
  reviewForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!reviewForm.reportValidity()) return;
    app.querySelector("[data-review-status]").textContent = "Sample review preview complete. It has not been published.";
  });

  syncRouteLinks();
}
