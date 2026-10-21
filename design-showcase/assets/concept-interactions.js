document.querySelectorAll("[data-listing-search]").forEach((form) => {
  const root = form.closest("[data-concept]");
  const queryInput = form.querySelector("[name='q']");
  const cards = [...root.querySelectorAll("[data-listing-card]")];
  const status = root.querySelector("[data-results-status]");
  const empty = root.querySelector("[data-empty-state]");
  let category = "all";

  const updateResults = () => {
    const query = queryInput.value.trim().toLocaleLowerCase();
    let visible = 0;

    for (const card of cards) {
      const matchesCategory = category === "all" || card.dataset.category === category;
      const matchesQuery = !query || card.textContent.toLocaleLowerCase().includes(query);
      const show = matchesCategory && matchesQuery;
      card.hidden = !show;
      if (show) visible += 1;
    }

    empty.classList.toggle("is-visible", visible === 0);
    status.textContent = `${visible} sample ${visible === 1 ? "listing" : "listings"} shown.`;
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    updateResults();
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    root.querySelector("#browse")?.scrollIntoView({ behavior, block: "start" });
  });

  queryInput.addEventListener("input", updateResults);

  root.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      category = button.dataset.filter;
      root.querySelectorAll("[data-filter]").forEach((candidate) => {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      });
      updateResults();
    });
  });

  root.querySelectorAll("[data-save]").forEach((button) => {
    button.addEventListener("click", () => {
      const saved = button.getAttribute("aria-pressed") !== "true";
      button.setAttribute("aria-pressed", String(saved));
      button.textContent = saved ? "Saved" : "Save";
      status.textContent = saved ? "Sample item saved in this preview." : "Sample item removed from saved items.";
    });
  });

  updateResults();
});
