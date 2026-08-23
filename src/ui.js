(() => {
  const Calc = window.PTS_CALCULATOR;
  const rateOptions = [
    { value: 0, label: "Never - 0%" },
    { value: 0.25, label: "Rarely - 25%" },
    { value: 0.5, label: "Sometimes - 50%" },
    { value: 0.75, label: "Usually - 75%" },
    { value: 1, label: "Always - 100%" }
  ];

  let config = null;
  let mode = "simple";
  let simpleState = null;
  let advancedState = null;
  let initialized = false;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function formatNumber(value) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.round(value));
  }

  function formatCompact(value) {
    if (Math.abs(value) < 10000) return formatNumber(value);
    return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
  }

  function formatResource(resource, value) {
    return resource.format === "compact" ? formatCompact(value) : formatNumber(value);
  }

  function resourceIcon(resource, className = "") {
    if (!resource?.icon) return "";

    const classes = ["resource-icon", className].filter(Boolean).join(" ");
    return `<span class="resource-icon-well" aria-hidden="true">
      <img class="${classes}" src="${resource.icon}" alt="">
    </span>`;
  }

  function rewardText(reward) {
    const bits = [];
    config.resources.forEach(resource => {
      const value = reward?.[resource.id];
      if (!value) return;
      bits.push(`${formatResource(resource, value)} ${resource.label}`);
    });
    return bits.join(" · ");
  }

  function rewardHtml(reward, options = {}) {
    const { labels = true, compact = false } = options;
    const bits = [];

    config.resources.forEach(resource => {
      const value = reward?.[resource.id];
      if (!value) return;

      const label = labels ? `<span class="reward-bit-label">${resource.label}</span>` : "";
      bits.push(`<span class="reward-bit ${compact ? "compact" : ""}">
        ${resourceIcon(resource, "reward-bit-icon")}
        <strong>${formatResource(resource, value)}</strong>
        ${label}
      </span>`);
    });

    return `<span class="reward-inline-list">${bits.join("")}</span>`;
  }

  function groupReward(group) {
    const total = {};
    group.missions.forEach(mission => {
      Object.entries(mission.reward || {}).forEach(([key, value]) => {
        total[key] = (total[key] || 0) + value;
      });
    });
    return total;
  }

  function groupRewardText(group) {
    return rewardText(groupReward(group));
  }

  function groupRewardHtml(group) {
    return rewardHtml(groupReward(group), { compact: true });
  }

  function percent(value, maximum) {
    if (!maximum) return 0;
    return Math.max(0, Math.min(100, (value / maximum) * 100));
  }

  function windowById(id) {
    return config.schedule.timedWindowsUtc.find(window => window.id === id);
  }

  function timeParts(value) {
    const [hour, minute] = value.split(":").map(Number);
    return { hour, minute };
  }

  function nextUtcThursday() {
    const now = new Date();
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const delta = (4 - base.getUTCDay() + 7) % 7;
    base.setUTCDate(base.getUTCDate() + delta);
    return base;
  }

  function localSlot(day, window) {
    const base = nextUtcThursday();
    base.setUTCDate(base.getUTCDate() + day.offset);

    const startParts = timeParts(window.start);
    const endParts = timeParts(window.end);
    const start = new Date(base);
    start.setUTCHours(startParts.hour, startParts.minute, 0, 0);

    const end = new Date(base);
    end.setUTCHours(endParts.hour, endParts.minute, 0, 0);
    if (end <= start) end.setUTCDate(end.getUTCDate() + 1);

    const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
    const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });
    return {
      time: `${timeFormatter.format(start)}–${timeFormatter.format(end)}`,
      localDay: weekdayFormatter.format(start),
      endLocalDay: weekdayFormatter.format(end)
    };
  }

  function tooltip(text) {
    return `<span class="tooltip" tabindex="0">?<span class="tooltip-content" role="tooltip">${text}</span></span>`;
  }

  function rateSelect(current, attribute) {
    return `<select class="select-control" ${attribute}>${rateOptions.map(option =>
      `<option value="${option.value}" ${Number(current) === option.value ? "selected" : ""}>${option.label}</option>`
    ).join("")}</select>`;
  }

  function normalizeSimpleDefaults() {
    const defaults = clone(config.simpleDefaults);

    defaults.sessions = Array.from({ length: config.schedule.sessionCount }, (_, index) =>
      defaults.sessions?.[index] ?? true
    );

    defaults.days ||= {};
    config.schedule.days.forEach(day => {
      if (defaults.days[day.id] === undefined) defaults.days[day.id] = true;
    });

    defaults.windowRates ||= {};
    config.schedule.timedWindowsUtc.forEach(window => {
      if (defaults.windowRates[window.id] === undefined) defaults.windowRates[window.id] = 1;
    });

    defaults.missionGroupRates ||= {};
    config.missions.groups.forEach(group => {
      if (defaults.missionGroupRates[group.id] === undefined) {
        defaults.missionGroupRates[group.id] = 1;
      }
    });

    return defaults;
  }

  function renderSimple() {
    const host = document.querySelector("#simplePlanner");

    const sessionChecks = Array.from({ length: config.schedule.sessionCount }, (_, index) => `
      <label class="pill-check">
        <input type="checkbox" data-simple-session="${index}" ${simpleState.sessions[index] ? "checked" : ""}>
        <span>Session ${index + 1}</span>
      </label>`).join("");

    const dayChecks = config.schedule.days.map(day => `
      <label class="pill-check">
        <input type="checkbox" data-simple-day="${day.id}" ${simpleState.days[day.id] ? "checked" : ""}>
        <span>${day.shortLabel || day.label}</span>
      </label>`).join("");

    const windowRows = Calc.getDisplayWindows(config).map(window => `
      <label class="window-row">
        <span class="window-meta">
          <span>${window.icon || "⚡"}</span>
          <span>
            <strong>${window.label}</strong>
            <small>${window.start}–${window.end} UTC</small>
          </span>
        </span>
        ${rateSelect(simpleState.windowRates[window.id] ?? 0, `data-simple-window="${window.id}"`)}
      </label>`).join("");

    const groupRows = config.missions.groups
      .filter(group => group.simple?.enabled !== false)
      .map(group => `
        <label class="window-row">
          <span class="mission-group-meta">
            <span class="mission-group-title">
              <strong>${group.simple?.label || group.label}</strong>
              ${tooltip(group.simple?.help || group.description || "Exact mission objectives may vary by update.")}
            </span>
            <small class="group-maximum">
              <span>${group.missions.length} reward slot${group.missions.length === 1 ? "" : "s"} per session</span>
              <span class="group-maximum-rewards">${groupRewardHtml(group)} <em>maximum per session</em></span>
            </small>
          </span>
          ${rateSelect(simpleState.missionGroupRates[group.id] ?? 0, `data-simple-group="${group.id}"`)}
        </label>`).join("");

    host.innerHTML = `
      <div class="subpanel">
        <div class="subpanel-heading">
          <h3>PTS Sessions</h3>
          ${tooltip("Selecting a session assumes you will at least log in to it, so the recurring session login reward is included.")}
        </div>
        <div class="round-toggles">${sessionChecks}</div>
      </div>

      <div class="subpanel">
        <div class="subpanel-heading">
          <h3>Days You Expect to Play</h3>
          ${tooltip("These are the PTS / UTC schedule days from the JSON model. Timed windows are converted to your local time in the schedule below.")}
        </div>
        <div class="day-toggles">${dayChecks}</div>
      </div>

      <div class="subpanel">
        <div class="subpanel-heading">
          <h3>Timed Special Tasks</h3>
          ${tooltip(`Each completed timed chain uses the recurring reward package shown throughout the planner: ${rewardText(config.missions.timed.reward)}. Percentages are used only for projection; Advanced mode lets you choose exact windows.`)}
        </div>
        <div class="window-list">${windowRows}</div>
      </div>

      <div class="subpanel">
        <div class="subpanel-heading">
          <h3>Longer Missions</h3>
          ${tooltip("These groups come from the JSON model. Adding or removing a configured mission group automatically changes the Simple planner without an HTML update.")}
        </div>
        <div class="fixed-options">${groupRows}</div>
      </div>`;

    host.querySelectorAll("input, select").forEach(element => {
      element.addEventListener("change", onSimpleChange);
    });
  }

  function onSimpleChange(event) {
    const element = event.currentTarget;

    if (element.dataset.simpleSession !== undefined) {
      simpleState.sessions[Number(element.dataset.simpleSession)] = element.checked;
    }
    if (element.dataset.simpleDay) {
      simpleState.days[element.dataset.simpleDay] = element.checked;
    }
    if (element.dataset.simpleWindow) {
      simpleState.windowRates[element.dataset.simpleWindow] = Number(element.value);
    }
    if (element.dataset.simpleGroup) {
      simpleState.missionGroupRates[element.dataset.simpleGroup] = Number(element.value);
    }

    recalculate();
  }

  function missionSlotKey(dayId, windowId) {
    return `${dayId}:${windowId}`;
  }

  function renderAdvanced() {
    const host = document.querySelector("#advancedSessions");
    host.innerHTML = advancedState.sessions.map((session, sessionIndex) => {
      const mirrored = sessionIndex > 0 && session.mirrorSession1;
      const body = mirrored ? renderMirrorSummary(sessionIndex) : renderSessionBody(session, sessionIndex);

      return `
        <section class="advanced-session ${session.enabled ? "" : "session-disabled"}" data-session-card="${sessionIndex}">
          <div class="advanced-session-heading">
            <div>
              <p class="section-kicker">PTS Session ${sessionIndex + 1}</p>
              <h3>Session ${sessionIndex + 1}</h3>
            </div>
            <div class="session-heading-controls">
              ${sessionIndex > 0 ? `
                <label class="mirror-label">
                  <input type="checkbox" data-advanced-mirror="${sessionIndex}" ${mirrored ? "checked" : ""}>
                  <span>Same as Session 1</span>
                </label>` : ""}
              <label class="switch-label">
                <input type="checkbox" data-advanced-session-enabled="${sessionIndex}" ${session.enabled ? "checked" : ""}>
                <span>Play this session</span>
              </label>
            </div>
          </div>
          ${body}
        </section>`;
    }).join("");

    host.querySelectorAll("input").forEach(element => {
      element.addEventListener("change", onAdvancedChange);
    });
  }

  function renderMirrorSummary(sessionIndex) {
    const source = advancedState.sessions[0];
    const timed = Object.values(source.timed).filter(Boolean).length;
    const selectedMissions = config.missions.groups.reduce((sum, group) => {
      return sum + Object.values(source.groups[group.id] || {}).filter(Boolean).length;
    }, 0);

    return `<div class="mirror-summary">
      <strong>Mirroring Session 1.</strong> ${timed} timed windows, ${selectedMissions} longer mission rewards, and the same login choice will be used. Uncheck <em>Same as Session 1</em> to restore Session ${sessionIndex + 1}'s independent plan.
    </div>`;
  }

  function renderTimedGrid(session, sessionIndex) {
    const days = config.schedule.days;
    const displayWindows = Calc.getDisplayWindows(config);
    const columns = days.length;

    const headers = days.map(day => `
      <div class="timed-grid-cell timed-grid-heading">
        <strong>${day.label}</strong>
        <small>PTS / UTC day</small>
      </div>`).join("");

    const slotRows = displayWindows.map(window =>
      days.map(day => {
        if (!day.windows.includes(window.id)) {
          return `<div class="timed-grid-cell">
            <div class="mission-slot unavailable" aria-label="No ${window.label} timed mission on ${day.label}">
              <span class="slot-check-placeholder" aria-hidden="true"></span>
              <span class="slot-icon">${window.icon || "⚡"}</span>
              <span class="slot-time">Not available<small>${window.label} slot</small></span>
            </div>
          </div>`;
        }

        const key = missionSlotKey(day.id, window.id);
        const selected = Boolean(session.timed[key]);
        const local = localSlot(day, window);
        const localDayNote = local.localDay === local.endLocalDay
          ? `${local.localDay} local`
          : `${local.localDay}–${local.endLocalDay} local`;

        return `<div class="timed-grid-cell">
          <label class="mission-slot ${selected ? "selected" : ""}">
            <input type="checkbox" data-advanced-timed="${sessionIndex}|${key}" ${selected ? "checked" : ""}>
            <span class="slot-icon">${window.icon || "⚡"}</span>
            <span class="slot-time">${local.time}<small>${localDayNote}</small></span>
          </label>
        </div>`;
      }).join("")
    ).join("");

    return `<div class="schedule-grid" style="--schedule-columns:${columns}">${headers}${slotRows}</div>`;
  }

  function renderMissionGroup(sessionIndex, group, session) {
    const choices = session.groups[group.id] || {};
    const checks = group.missions.map(mission => renderMissionCheck(
      sessionIndex,
      group.id,
      mission,
      Boolean(choices[mission.id])
    )).join("");

    return `
      <div class="advanced-section-label advanced-group-label">
        <div>
          <h4>${group.label}</h4>
          <p>${group.description || ""}</p>
        </div>
        <span>${group.missions.length} reward slot${group.missions.length === 1 ? "" : "s"}</span>
      </div>
      <div class="mission-check-grid">${checks}</div>`;
  }

  function renderSessionBody(session, sessionIndex) {
    const groups = config.missions.groups.map(group => renderMissionGroup(sessionIndex, group, session)).join("");

    return `<div class="session-body">
      <div class="advanced-section-label">
        <h4>Timed windows</h4>
        <span class="advanced-reward-summary">${rewardHtml(config.missions.timed.reward, { compact: true })}<em>each</em></span>
      </div>
      ${renderTimedGrid(session, sessionIndex)}

      <div class="advanced-section-label advanced-group-label session-reward-heading">
        <div>
          <h4>Session login</h4>
          <p>The recurring login reward for this PTS session.</p>
        </div>
        <span>Once per session</span>
      </div>
      <div class="mission-check-grid">
        ${renderMissionCheck(sessionIndex, "login", config.missions.login, Boolean(session.login))}
      </div>

      ${groups}
    </div>`;
  }

  function renderMissionCheck(sessionIndex, groupId, mission, selected) {
    const attribute = groupId === "login"
      ? `data-advanced-login="${sessionIndex}"`
      : `data-advanced-group="${sessionIndex}|${groupId}|${mission.id}"`;

    return `<label class="mission-check ${selected ? "selected" : ""}">
      <input type="checkbox" ${attribute} ${selected ? "checked" : ""}>
      <span class="mission-check-title">
        <strong>${mission.label}</strong>
        <small>${mission.description || ""}</small>
      </span>
      <span class="reward-chip">${rewardHtml(mission.reward, { compact: true })}</span>
    </label>`;
  }

  function onAdvancedChange(event) {
    const element = event.currentTarget;

    if (element.dataset.advancedSessionEnabled !== undefined) {
      const index = Number(element.dataset.advancedSessionEnabled);
      advancedState.sessions[index].enabled = element.checked;
      document.querySelector(`[data-session-card="${index}"]`)?.classList.toggle("session-disabled", !element.checked);
      recalculate();
      return;
    }

    if (element.dataset.advancedMirror !== undefined) {
      const index = Number(element.dataset.advancedMirror);
      advancedState.sessions[index].mirrorSession1 = element.checked;
      renderAdvanced();
      recalculate();
      return;
    }

    if (element.dataset.advancedTimed) {
      const [sessionIndex, key] = element.dataset.advancedTimed.split("|");
      advancedState.sessions[Number(sessionIndex)].timed[key] = element.checked;
      element.closest(".mission-slot")?.classList.toggle("selected", element.checked);
      refreshMirrorSummaries();
      recalculate();
      return;
    }

    if (element.dataset.advancedLogin !== undefined) {
      advancedState.sessions[Number(element.dataset.advancedLogin)].login = element.checked;
      element.closest(".mission-check")?.classList.toggle("selected", element.checked);
      refreshMirrorSummaries();
      recalculate();
      return;
    }

    if (element.dataset.advancedGroup) {
      const [sessionIndex, groupId, missionId] = element.dataset.advancedGroup.split("|");
      advancedState.sessions[Number(sessionIndex)].groups[groupId][missionId] = element.checked;
      element.closest(".mission-check")?.classList.toggle("selected", element.checked);
      refreshMirrorSummaries();
      recalculate();
    }
  }

  function refreshMirrorSummaries() {
    advancedState.sessions.forEach((session, sessionIndex) => {
      if (sessionIndex === 0 || !session.mirrorSession1) return;
      const card = document.querySelector(`[data-session-card="${sessionIndex}"] .mirror-summary`);
      if (card) card.outerHTML = renderMirrorSummary(sessionIndex);
    });
  }

  function renderRewards(result) {
    const maximum = Calc.calculateMaximum(config);
    const host = document.querySelector("#rewardRows");

    host.innerHTML = config.resources.map(resource => {
      const value = result[resource.id] || 0;
      const maxValue = maximum[resource.id] || 0;
      return `<div class="reward-row">
        <div class="reward-heading">
          <span class="reward-resource-label">
            ${resourceIcon(resource, "summary-resource-icon")}
            <span>${resource.label}</span>
          </span>
          <strong>${formatResource(resource, value)}<small> / ${formatResource(resource, maxValue)}</small></strong>
        </div>
        <div class="reward-track"><span style="width:${percent(value, maxValue)}%"></span></div>
      </div>`;
    }).join("");

    const maxTimed = Calc.maximumTimedCompletions(config);
    document.querySelector("#timedCount").textContent = `${formatNumber(result.timedCompletions)} / ${maxTimed}`;

    const coalMaximum = maximum.coal || 0;
    const coalValue = result.coal || 0;
    document.querySelector("#captureRate").textContent = coalMaximum
      ? `${Math.round(percent(coalValue, coalMaximum))}%`
      : "—";
  }

  function recalculate() {
    if (!config) return;
    const result = mode === "simple"
      ? Calc.calculateSimple(config, simpleState)
      : Calc.calculateAdvanced(config, advancedState);
    renderRewards(result);
  }

  function updateResetButton() {
    const button = document.querySelector("#resetPlannerButton");
    button.textContent = mode === "simple" ? "Reset Simple" : "Reset Advanced";
    button.setAttribute("aria-label", mode === "simple"
      ? "Reset only the Simple planner"
      : "Reset only the Advanced planner");
  }

  function setMode(nextMode) {
    if (nextMode === mode) return;
    mode = nextMode;

    document.querySelector("#simplePlanner").hidden = mode !== "simple";
    document.querySelector("#advancedPlanner").hidden = mode !== "advanced";
    document.querySelectorAll("[data-mode]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    });

    document.querySelector("#projectionLabel").textContent = mode === "simple" ? "Projected Rewards" : "Planned Rewards";
    updateResetButton();
    recalculate();
  }

  function resetCurrentMode() {
    if (mode === "simple") {
      simpleState = normalizeSimpleDefaults();
      renderSimple();
    } else {
      const defaults = normalizeSimpleDefaults();
      advancedState = Calc.buildAdvancedFromSimple(config, defaults);
      renderAdvanced();
    }
    recalculate();
  }

  function renderScheduleReference() {
    document.querySelector("#detectedTimezone").textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || "your browser timezone";

    const host = document.querySelector("#scheduleReference");
    const days = config.schedule.days;
    const displayWindows = Calc.getDisplayWindows(config);
    const columns = days.length;

    const headers = days.map(day => `
      <div class="reference-heading">
        <strong>${day.label}</strong>
        <small>PTS / UTC day</small>
      </div>`).join("");

    const rows = displayWindows.map(window =>
      days.map(day => {
        if (!day.windows.includes(window.id)) {
          return `<div class="reference-window unavailable">
            <b>${window.icon || "⚡"}</b>
            <span>Not available<small>${window.label} slot</small></span>
          </div>`;
        }

        const local = localSlot(day, window);
        const localDay = local.localDay === local.endLocalDay ? local.localDay : `${local.localDay}–${local.endLocalDay}`;
        return `<div class="reference-window">
          <b>${window.icon || "⚡"}</b>
          <span>${local.time}<small>${localDay} local · ${window.start}–${window.end} UTC</small></span>
        </div>`;
      }).join("")
    ).join("");

    host.innerHTML = `<div class="reference-days" style="--schedule-columns:${columns}">${headers}${rows}</div>`;
  }

  function init(loadedConfig) {
    if (initialized) return;
    initialized = true;
    config = loadedConfig;

    simpleState = normalizeSimpleDefaults();
    advancedState = Calc.buildAdvancedFromSimple(config, normalizeSimpleDefaults());

    document.querySelector("#verifiedAgainst").textContent = `Verified ${config.model.verifiedAgainst}`;
    document.querySelector("#appContent").hidden = false;

    renderSimple();
    renderAdvanced();
    renderScheduleReference();
    updateResetButton();
    recalculate();

    document.querySelectorAll("[data-mode]").forEach(button => {
      button.addEventListener("click", () => setMode(button.dataset.mode));
    });

    document.querySelector("#resetPlannerButton").addEventListener("click", resetCurrentMode);
  }

  function showConfigError(message) {
    const panel = document.querySelector("#configError");
    panel.hidden = false;
    panel.innerHTML = `<strong>Configuration could not be loaded.</strong><br>${message}`;
    document.querySelector("#verifiedAgainst").textContent = "Config unavailable";
  }

  window.addEventListener("pts-config-ready", event => init(event.detail));
  window.addEventListener("pts-config-error", event => showConfigError(event.detail));

  document.addEventListener("DOMContentLoaded", () => {
    if (window.PTS_CONFIG) init(window.PTS_CONFIG);
    if (window.PTS_CONFIG_ERROR) showConfigError(window.PTS_CONFIG_ERROR);
  });
})();
