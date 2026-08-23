(() => {
  const themeKey = "wows-pts-planner-theme";
  const validThemes = new Set(["system", "light", "dark"]);
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  function readTheme() {
    try {
      const value = localStorage.getItem(themeKey);
      return validThemes.has(value) ? value : "system";
    } catch {
      return "system";
    }
  }

  let themePreference = readTheme();

  function applyTheme() {
    const dark = themePreference === "dark" ||
      (themePreference === "system" && media.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.themePreference = themePreference;
    document.querySelectorAll("[data-theme-choice]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.themeChoice === themePreference));
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    applyTheme();

    document.querySelectorAll("[data-theme-choice]").forEach(button => {
      button.addEventListener("click", () => {
        themePreference = button.dataset.themeChoice;
        try { localStorage.setItem(themeKey, themePreference); } catch {}
        applyTheme();
      });
    });

    media.addEventListener("change", () => {
      if (themePreference === "system") applyTheme();
    });
  });
})();
