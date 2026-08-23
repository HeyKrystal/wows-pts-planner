(() => {
  const Calc = window.PTS_CALCULATOR;
  const rateOptions = [
    { value: 0, label: "Never — 0%" },
    { value: 0.25, label: "Rarely — 25%" },
    { value: 0.5, label: "Sometimes — 50%" },
    { value: 0.75, label: "Usually — 75%" },
    { value: 1, label: "Always — 100%" }
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

    const timeFormatter = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit"
    });
    const weekdayFormatter = new Intl.DateTimeFormat(undefined, {
      weekday: "short"
    });
    const zoneFormatter = new Intl.DateTimeFormat(undefined, {
      timeZoneName: "short"
    });

    function zoneName(date) {
      return zoneFormatter.formatToParts(date)
        .find(part => part.type === "timeZoneName")?.value || "local";
    }

    const startZone = zoneName(start);
    const endZone = zoneName(end);

    return {
      time: `${timeFormatter.format(start)}–${timeFormatter.format(end)}`,
      zone: startZone === endZone ? startZone : `${startZone}–${endZone}`,
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
      if (defaults.days[day.id] === undefined) defaults.days[day.id] = false;
    });

    defaults.windowRates ||= {};
    config.schedule.timedWindowsUtc.forEach(window => {
      if (defaults.windowRates[window.id] === undefined) defaults.windowRates[window.id] = 0;
    });

    defaults.missionGroupRates ||= {};
    config.missions.groups.forEach(group => {
      if (defaults.missionGroupRates[group.id] === undefined) {
        defaults.missionGroupRates[group.id] = 0;
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
              <span>${group.missions.length} mission${group.missions.length === 1 ? "" : "s"} per session</span>
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
      <strong>Mirroring Session 1.</strong> ${timed} timed windows and ${selectedMissions} longer missions will be used. The Session ${sessionIndex + 1} login reward is included automatically. Uncheck <em>Same as Session 1</em> to restore its independent plan.
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
        <div class="advanced-group-title">
          <h4>${group.label}</h4>
          ${group.description ? tooltip(group.description) : ""}
        </div>
        <span>${group.missions.length} mission${group.missions.length === 1 ? "" : "s"}</span>
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

      ${groups}

      <div class="automatic-login">
        <div class="automatic-login-title">
          <strong>${config.missions.login.label}</strong>
          ${tooltip(config.missions.login.description)}
          <span>Included automatically</span>
        </div>
        <div class="automatic-login-reward">
          ${rewardHtml(config.missions.login.reward, { compact: true })}
        </div>
      </div>
    </div>`;
  }

  function renderMissionCheck(sessionIndex, groupId, mission, selected) {
    const attribute = `data-advanced-group="${sessionIndex}|${groupId}|${mission.id}"`;

    return `<label class="mission-check ${selected ? "selected" : ""}">
      <input type="checkbox" ${attribute} ${selected ? "checked" : ""}>
      <span class="mission-check-title">
        <span class="mission-title-with-help">
          <strong>${mission.label}</strong>
          ${mission.description ? tooltip(mission.description) : ""}
        </span>
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
      const resourcePercent = maxValue ? Math.round(percent(value, maxValue)) : 0;
      return `<div class="reward-row">
        <div class="reward-heading">
          <span class="reward-resource-label">
            ${resourceIcon(resource, "summary-resource-icon")}
            <span>${resource.label}</span>
          </span>
          <span class="reward-value-group">
            <strong>${formatResource(resource, value)}<small> / ${formatResource(resource, maxValue)}</small></strong>
            <b>${resourcePercent}%</b>
          </span>
        </div>
        <div class="reward-track" aria-label="${resourcePercent}% of maximum ${resource.label}">
          <span style="width:${resourcePercent}%"></span>
        </div>
      </div>`;
    }).join("");

    const maxTimed = Calc.maximumTimedCompletions(config);
    document.querySelector("#timedCount").textContent = `${formatNumber(result.timedCompletions)} / ${maxTimed}`;

    document.querySelector("#captureRate").textContent = maxTimed
      ? `${Math.round(percent(result.timedCompletions, maxTimed))}%`
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
    const simple = mode === "simple";
    const label = simple ? "Reset Simple plan" : "Reset Advanced plan";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
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
      advancedState = Calc.buildAdvancedDefaults(config);
      renderAdvanced();
    }
    recalculate();
  }

  function getDayLongMissionsByDay(group) {
    const result = new Map(config.schedule.days.map(day => [day.id, []]));

    group.missions.forEach(mission => {
      const availability = mission.availability;
      if (availability?.type !== "day-long") return;
      if (!result.has(availability.dayId)) return;
      result.get(availability.dayId).push(mission);
    });

    return result;
  }

  function sameReward(left, right) {
    const keys = new Set([
      ...Object.keys(left || {}),
      ...Object.keys(right || {})
    ]);

    for (const key of keys) {
      if ((left?.[key] || 0) !== (right?.[key] || 0)) return false;
    }
    return true;
  }

  function sharedGroupReward(group) {
    if (!group.missions.length) return null;

    const first = group.missions[0].reward || {};
    return group.missions.every(mission => sameReward(first, mission.reward || {}))
      ? first
      : null;
  }

  function scheduleSectionLabel(display, reward, fallbackHelp = "") {
    const help = [
      display.help || fallbackHelp,
      reward ? `Reward: ${rewardText(reward)}.` : ""
    ].filter(Boolean).join(" ");

    return `<div class="reference-section-label" style="grid-column:1 / -1">
      <strong>${display.label}</strong>
      <small>${display.subtitle}</small>
      ${help ? tooltip(help) : ""}
    </div>`;
  }

  function referenceTimeCell({
    icon,
    localTime = "",
    localZone = "",
    utcTime = "",
    unavailable = false,
    unavailableLabel = "No Mission"
  }) {
    if (unavailable) {
      return `<div class="reference-window unavailable">
        <b class="reference-unavailable-mark" aria-hidden="true">—</b>
        <span>
          ${unavailableLabel}
        </span>
      </div>`;
    }

    return `<div class="reference-window">
      <b aria-hidden="true">${icon || "⚡"}</b>
      <span>
        <span class="reference-local-time">${localTime}<em>${localZone}</em></span>
        <small>${utcTime}</small>
      </span>
    </div>`;
  }

  function renderWindowedSchedule(days) {
    const display = config.missions.timed.schedule;
    if (!display) return "";

    const windows = Calc.getDisplayWindows(config);

    const rows = windows.map(window =>
      days.map(day => {
        const utcTime = `${window.start}–${window.end} UTC`;

        if (!day.windows.includes(window.id)) {
          return referenceTimeCell({
            unavailable: true,
            unavailableLabel: "No Windowed Mission"
          });
        }

        const local = localSlot(day, window);
        return referenceTimeCell({
          icon: window.icon || "⚡",
          localTime: local.time,
          localZone: local.zone,
          utcTime
        });
      }).join("")
    ).join("");

    return `
      ${scheduleSectionLabel(
        display,
        config.missions.timed.reward,
        config.missions.timed.description || ""
      )}
      ${rows}`;
  }

  function renderDayLongSchedule(group, days) {
    const display = group.schedule;
    if (!display?.enabled) return "";

    const missionsByDay = getDayLongMissionsByDay(group);
    const hasMissions = Array.from(missionsByDay.values()).some(items => items.length);
    if (!hasMissions) return "";

    const representative = group.missions.find(
      mission => mission.availability?.type === "day-long"
    );
    const fallbackUtcTime = representative
      ? `${representative.availability.start}–${representative.availability.end} UTC`
      : "";

    const cells = days.map(day => {
      const missions = missionsByDay.get(day.id) || [];

      if (!missions.length) {
        return referenceTimeCell({
          unavailable: true,
          unavailableLabel: "No Day-Long Mission"
        });
      }

      // Schedule cells intentionally answer only "when". Mission details and
      // the shared reward live on the section tooltip above.
      const mission = missions[0];
      const availability = mission.availability;
      const local = localSlot(day, {
        start: availability.start,
        end: availability.end
      });

      return referenceTimeCell({
        icon: availability.icon || "🗓️",
        localTime: local.time,
        localZone: local.zone,
        utcTime: `${availability.start}–${availability.end} UTC`
      });
    }).join("");

    return `
      ${scheduleSectionLabel(
        display,
        sharedGroupReward(group),
        group.description || ""
      )}
      ${cells}`;
  }

  function renderScheduleReference() {
    document.querySelector("#detectedTimezone").textContent =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "your browser timezone";

    const host = document.querySelector("#scheduleReference");
    const days = config.schedule.days;
    const columns = days.length;

    const headers = days.map(day => `
      <div class="reference-heading">
        <strong>${day.label}</strong>
        <small>PTS / UTC day</small>
      </div>`).join("");

    const configuredGroups = config.missions.groups
      .filter(group => group.schedule?.enabled)
      .map(group => renderDayLongSchedule(group, days))
      .join("");

    host.innerHTML = `
      <div class="reference-days" style="--schedule-columns:${columns}">
        ${headers}
        ${renderWindowedSchedule(days)}
        ${configuredGroups}
      </div>`;
  }

  function init(loadedConfig) {
    if (initialized) return;
    initialized = true;
    config = loadedConfig;

    simpleState = normalizeSimpleDefaults();
    advancedState = Calc.buildAdvancedDefaults(config);

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
