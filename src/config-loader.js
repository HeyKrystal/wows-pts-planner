(() => {
  function validateConfig(config) {
    const problems = [];

    if (!config || typeof config !== "object") problems.push("Config must be an object.");
    if (config?.schemaVersion !== 2) problems.push("Unsupported or missing schemaVersion.");
    if (!Array.isArray(config?.resources) || !config.resources.length) problems.push("resources must be a non-empty array.");
    if (!Number.isInteger(config?.schedule?.sessionCount) || config.schedule.sessionCount < 1) problems.push("schedule.sessionCount must be at least 1.");
    if (!Array.isArray(config?.schedule?.days) || !config.schedule.days.length) problems.push("schedule.days must be a non-empty array.");
    if (!Array.isArray(config?.schedule?.timedWindowsUtc) || !config.schedule.timedWindowsUtc.length) problems.push("schedule.timedWindowsUtc must be a non-empty array.");
    if (!config?.missions?.login?.reward) problems.push("missions.login.reward is required.");
    if (!config?.missions?.timed?.reward) problems.push("missions.timed.reward is required.");
    if (!Array.isArray(config?.missions?.groups)) problems.push("missions.groups must be an array.");

    (config?.resources || []).forEach(resource => {
      if (!resource.id) problems.push("Every resource needs an id.");
      if (!resource.label) problems.push(`Resource ${resource.id || "?"} needs a label.`);
      if (resource.icon !== undefined && typeof resource.icon !== "string") {
        problems.push(`Resource ${resource.id || "?"} icon must be a string path or URL.`);
      }
    });

    const resourceIds = new Set((config?.resources || []).map(resource => resource.id));
    const rewardObjects = [
      config?.missions?.login?.reward,
      config?.missions?.timed?.reward,
      ...(config?.missions?.groups || []).flatMap(group =>
        (group.missions || []).map(mission => mission.reward)
      )
    ].filter(Boolean);

    rewardObjects.forEach(reward => {
      Object.keys(reward).forEach(key => {
        if (!resourceIds.has(key)) problems.push(`Reward references unknown resource: ${key}`);
      });
    });

    const windowIds = new Set((config?.schedule?.timedWindowsUtc || []).map(window => window.id));
    (config?.schedule?.days || []).forEach(day => {
      if (!Array.isArray(day.windows)) problems.push(`Day ${day.id || "?"} must define a windows array.`);
      (day.windows || []).forEach(windowId => {
        if (!windowIds.has(windowId)) problems.push(`Day ${day.id} references unknown window: ${windowId}`);
      });
    });

    const groupIds = new Set();
    (config?.missions?.groups || []).forEach(group => {
      if (!group.id) problems.push("Every mission group needs an id.");
      if (groupIds.has(group.id)) problems.push(`Duplicate mission group id: ${group.id}`);
      groupIds.add(group.id);
      if (!Array.isArray(group.missions)) problems.push(`Mission group ${group.id || "?"} must define a missions array.`);
    });

    const defaults = config?.simpleDefaults;
    if (!defaults || typeof defaults !== "object") problems.push("simpleDefaults is required.");
    if (defaults && !Array.isArray(defaults.sessions)) problems.push("simpleDefaults.sessions must be an array.");
    if (defaults && typeof defaults.days !== "object") problems.push("simpleDefaults.days must be an object.");
    if (defaults && typeof defaults.windowRates !== "object") problems.push("simpleDefaults.windowRates must be an object.");
    if (defaults && typeof defaults.missionGroupRates !== "object") problems.push("simpleDefaults.missionGroupRates must be an object.");

    if (defaults && Array.isArray(defaults.sessions) && defaults.sessions.length !== config.schedule.sessionCount) {
      problems.push("simpleDefaults.sessions must contain one value per configured session.");
    }

    (config?.schedule?.days || []).forEach(day => {
      if (typeof defaults?.days?.[day.id] !== "boolean") {
        problems.push(`simpleDefaults.days is missing a boolean for ${day.id}.`);
      }
    });

    const usedWindowIds = new Set((config?.schedule?.days || []).flatMap(day => day.windows || []));
    usedWindowIds.forEach(windowId => {
      if (typeof defaults?.windowRates?.[windowId] !== "number") {
        problems.push(`simpleDefaults.windowRates is missing a numeric rate for ${windowId}.`);
      }
    });

    (config?.missions?.groups || []).forEach(group => {
      if (group.simple?.enabled === false) return;
      if (typeof defaults?.missionGroupRates?.[group.id] !== "number") {
        problems.push(`simpleDefaults.missionGroupRates is missing a numeric rate for ${group.id}.`);
      }
    });

    if (problems.length) throw new Error(problems.join(" "));
  }

  async function loadConfig() {
    try {
      const response = await fetch("data/pts-config.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const config = await response.json();
      validateConfig(config);
      window.PTS_CONFIG = config;
      window.dispatchEvent(new CustomEvent("pts-config-ready", { detail: config }));
    } catch (error) {
      const message = location.protocol === "file:"
        ? "Could not load data/pts-config.json from file://. Open the draft with VS Code Live Server (or another local HTTP server) so the JSON model can be fetched."
        : `Could not load the PTS configuration: ${error.message}`;
      window.PTS_CONFIG_ERROR = message;
      window.dispatchEvent(new CustomEvent("pts-config-error", { detail: message }));
    }
  }

  loadConfig();
})();
