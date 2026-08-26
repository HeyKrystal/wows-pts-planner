(() => {
  const Calc = window.PTS_CALCULATOR;
  const windowRateOptions = [
    { value: 0, label: "Never — 0%" },
    { value: 0.25, label: "Occasionally — 25%" },
    { value: 0.5, label: "About Half — 50%" },
    { value: 0.75, label: "Most Days — 75%" },
    { value: 1, label: "Every Selected Day — 100%" }
  ];

  const completionRateOptions = [
    { value: 0, label: "None — 0%" },
    { value: 0.25, label: "About 25%" },
    { value: 0.5, label: "About Half — 50%" },
    { value: 0.75, label: "About 75%" },
    { value: 1, label: "All — 100%" }
  ];

  const STORAGE_KEY = "wows-pts-reward-planner.state";
  const STORAGE_VERSION = 1;

  let config = null;
  let mode = "simple";
  let simpleState = null;
  let advancedState = null;
  let initialized = false;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function readSavedState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;

      const saved = JSON.parse(raw);
      if (
        saved?.version !== STORAGE_VERSION ||
        saved?.configSchemaVersion !== config.schemaVersion
      ) {
        return null;
      }

      return saved;
    } catch (error) {
      console.warn("Could not restore saved planner state.", error);
      return null;
    }
  }

  function writeSavedState() {
    if (!config || !simpleState || !advancedState) return;

    try {
      const schedulePanel = document.querySelector("#schedulePanel");

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: STORAGE_VERSION,
          configSchemaVersion: config.schemaVersion,
          mode,
          scheduleOpen: schedulePanel?.open ?? true,
          simpleState,
          advancedState
        })
      );
    } catch (error) {
      console.warn("Could not save planner state.", error);
    }
  }

  function validRate(value) {
    const numeric = Number(value);
    return windowRateOptions.some(option => option.value === numeric)
      ? numeric
      : null;
  }

  function restoreSimpleState(savedState) {
    const restored = normalizeSimpleDefaults();

    if (!savedState || typeof savedState !== "object") {
      return restored;
    }

    restored.sessions = restored.sessions.map((defaultValue, index) =>
      typeof savedState.sessions?.[index] === "boolean"
        ? savedState.sessions[index]
        : defaultValue
    );

    // Draft 15 and earlier stored day selections under the Windowed mission
    // type. Prefer the new top-level location, but migrate the old shape when
    // restoring an existing browser save.
    const savedDays =
      savedState.days ||
      savedState.missionTypes?.windowed?.days ||
      {};

    Object.keys(restored.days).forEach(dayId => {
      if (typeof savedDays[dayId] === "boolean") {
        restored.days[dayId] = savedDays[dayId];
      }
    });

    config.missionTypes.forEach(type => {
      const savedType = savedState.missionTypes?.[type.id];
      const restoredType = restored.missionTypes[type.id];

      if (!savedType || !restoredType) return;

      if (type.controls?.simple === "window-frequency") {
        Object.keys(restoredType.rates).forEach(windowId => {
          const rate = validRate(savedType.rates?.[windowId]);
          if (rate !== null) {
            restoredType.rates[windowId] = rate;
          }
        });
      }

      if (type.controls?.simple === "day-mission-checkboxes") {
        Object.keys(restoredType.selections).forEach(missionId => {
          if (typeof savedType.selections?.[missionId] === "boolean") {
            restoredType.selections[missionId] =
              savedType.selections[missionId];
          }
        });
      }

      if (type.controls?.simple === "mission-count") {
        const missionTotal = (type.missions || []).length;

        if (Number.isInteger(savedType.count)) {
          restoredType.count = Math.max(
            0,
            Math.min(savedType.count, missionTotal)
          );
        } else {
          // Draft 18 and earlier used a percentage for this mission type.
          // Migrate conservatively by flooring the equivalent mission count.
          const oldRate = validRate(savedType.rate);
          if (oldRate !== null) {
            restoredType.count = Math.floor(oldRate * missionTotal);
          }
        }
      }

      if (type.controls?.simple === "completion-frequency") {
        const rate = validRate(savedType.rate);
        if (rate !== null) {
          restoredType.rate = rate;
        }
      }
    });

    return restored;
  }

  function restoreAdvancedState(savedState) {
    const restored = Calc.buildAdvancedDefaults(config);

    if (!savedState || typeof savedState !== "object") {
      return restored;
    }

    restored.sessions.forEach((session, sessionIndex) => {
      const savedSession = savedState.sessions?.[sessionIndex];
      if (!savedSession) return;

      if (typeof savedSession.enabled === "boolean") {
        session.enabled = savedSession.enabled;
      }

      if (
        sessionIndex > 0 &&
        typeof savedSession.mirrorSession1 === "boolean"
      ) {
        session.mirrorSession1 = savedSession.mirrorSession1;
      }

      config.missionTypes.forEach(type => {
        const restoredSelections = session.selections[type.id];
        const savedSelections = savedSession.selections?.[type.id];

        if (!restoredSelections || !savedSelections) return;

        Object.keys(restoredSelections).forEach(key => {
          if (typeof savedSelections[key] === "boolean") {
            restoredSelections[key] = savedSelections[key];
          }
        });
      });
    });

    return restored;
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

  function percent(value, maximum) {
    if (!maximum) return 0;
    return Math.min(100, Math.max(0, (value / maximum) * 100));
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

  function typeMaximumReward(type) {
    const total = {};

    (type.missions || []).forEach(mission => {
      const reward = Calc.rewardForMission(type, mission) || {};
      Object.entries(reward).forEach(([key, value]) => {
        total[key] = (total[key] || 0) + value;
      });
    });

    return total;
  }

  function typeMaximumRewardHtml(type) {
    return rewardHtml(typeMaximumReward(type), { compact: true });
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
    base.setUTCDate(base.getUTCDate() + day.offsetDays);

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
      endLocalDay: weekdayFormatter.format(end),
      ptsWeekday: base.getUTCDay(),
      localStartWeekday: start.getDay(),
      localEndWeekday: end.getDay()
    };
  }

  function localDayShift(local) {
    const startsOnPtsDay =
      local.localStartWeekday === local.ptsWeekday;
    const endsOnPtsDay =
      local.localEndWeekday === local.ptsWeekday;

    if (startsOnPtsDay && endsOnPtsDay) {
      return "";
    }

    if (local.localStartWeekday === local.localEndWeekday) {
      return local.localDay;
    }

    return `${local.localDay}→${local.endLocalDay}`;
  }

  function localWindowSchedule(type, window) {
    const representativeDay = config.pts.days.find(day =>
      (type.schedule?.windowsByDay?.[day.id] || []).includes(window.id)
    );

    if (!representativeDay) {
      return null;
    }

    return localSlot(representativeDay, window);
  }

  function localMissionSchedule(mission) {
    const schedule = mission?.schedule;
    if (!schedule?.dayId || !schedule.start || !schedule.end) {
      return null;
    }

    const day = config.pts.days.find(
      candidate => candidate.id === schedule.dayId
    );

    if (!day) {
      return null;
    }

    const local = localSlot(day, {
      start: schedule.start,
      end: schedule.end
    });

    return {
      ...local,
      dayShift: localDayShift(local)
    };
  }

  function sharedDayScheduleRange(type) {
    if (type.schedule?.layout !== "days") {
      return null;
    }

    const ranges = new Set(
      (type.missions || [])
        .map(mission => {
          const schedule = mission.schedule;
          if (!schedule?.start || !schedule?.end) {
            return null;
          }
          return `${schedule.start}|${schedule.end}`;
        })
        .filter(Boolean)
    );

    if (ranges.size !== 1) {
      return null;
    }

    const [range] = ranges;
    const [start, end] = range.split("|");

    return { start, end };
  }

  function escapeAttribute(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function tooltip(text) {
    const escaped = escapeAttribute(text);
    return `<span
      class="tooltip"
      tabindex="0"
      data-tooltip="${escaped}"
      aria-label="${escaped}"
    >?</span>`;
  }

  let floatingTooltip = null;
  let activeTooltipTrigger = null;

  function positionFloatingTooltip(trigger) {
    if (!floatingTooltip || floatingTooltip.hidden || !trigger) return;

    const gap = 8;
    const viewportPadding = 10;
    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = floatingTooltip.getBoundingClientRect();

    let left =
      triggerRect.left +
      triggerRect.width / 2 -
      tooltipRect.width / 2;

    left = Math.max(
      viewportPadding,
      Math.min(left, window.innerWidth - tooltipRect.width - viewportPadding)
    );

    let top = triggerRect.top - tooltipRect.height - gap;
    let placement = "top";

    if (top < viewportPadding) {
      top = triggerRect.bottom + gap;
      placement = "bottom";
    }

    floatingTooltip.style.left = `${Math.round(left)}px`;
    floatingTooltip.style.top = `${Math.round(top)}px`;
    floatingTooltip.dataset.placement = placement;
  }

  function showFloatingTooltip(trigger) {
    if (!trigger?.dataset.tooltip || !floatingTooltip) return;

    activeTooltipTrigger = trigger;
    floatingTooltip.textContent = trigger.dataset.tooltip;
    floatingTooltip.hidden = false;
    floatingTooltip.classList.add("visible");
    positionFloatingTooltip(trigger);
  }

  function hideFloatingTooltip() {
    if (!floatingTooltip) return;
    activeTooltipTrigger = null;
    floatingTooltip.classList.remove("visible");
    floatingTooltip.hidden = true;
  }

  function initFloatingTooltips() {
    floatingTooltip = document.createElement("div");
    floatingTooltip.id = "floatingTooltip";
    floatingTooltip.className = "floating-tooltip";
    floatingTooltip.setAttribute("role", "tooltip");
    floatingTooltip.hidden = true;
    document.body.append(floatingTooltip);

    document.addEventListener("pointerover", event => {
      const trigger = event.target.closest?.(
        ".tooltip, [data-tooltip-trigger]"
      );
      if (trigger) showFloatingTooltip(trigger);
    });

    document.addEventListener("pointerout", event => {
      const trigger = event.target.closest?.(
        ".tooltip, [data-tooltip-trigger]"
      );
      if (
        trigger &&
        trigger === activeTooltipTrigger &&
        !trigger.contains(event.relatedTarget)
      ) {
        hideFloatingTooltip();
      }
    });

    document.addEventListener("focusin", event => {
      const trigger = event.target.closest?.(
        ".tooltip, [data-tooltip-trigger]"
      );
      if (trigger) showFloatingTooltip(trigger);
    });

    document.addEventListener("focusout", event => {
      const trigger = event.target.closest?.(
        ".tooltip, [data-tooltip-trigger]"
      );
      if (trigger && trigger === activeTooltipTrigger) {
        hideFloatingTooltip();
      }
    });

    document.addEventListener("click", event => {
      const trigger = event.target.closest?.(".tooltip");
      if (!trigger) return;

      event.preventDefault();
      event.stopPropagation();

      if (trigger === activeTooltipTrigger) {
        hideFloatingTooltip();
      } else {
        showFloatingTooltip(trigger);
      }
    });

    document.addEventListener("pointerdown", event => {
      if (
        activeTooltipTrigger &&
        !event.target.closest?.(
          ".tooltip, [data-tooltip-trigger]"
        )
      ) {
        hideFloatingTooltip();
      }
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") hideFloatingTooltip();
    });

    window.addEventListener(
      "scroll",
      () => {
        if (activeTooltipTrigger) {
          positionFloatingTooltip(activeTooltipTrigger);
        }
      },
      true
    );

    window.addEventListener("resize", () => {
      if (activeTooltipTrigger) {
        positionFloatingTooltip(activeTooltipTrigger);
      }
    });
  }

  function rateSelect(current, attribute, options = windowRateOptions) {
    return `<select class="select-control" ${attribute}>${options.map(option =>
      `<option value="${option.value}" ${Number(current) === option.value ? "selected" : ""}>${option.label}</option>`
    ).join("")}</select>`;
  }

  function missionCountSelect(type, current) {
    const missionTotal = (type.missions || []).length;

    const options = Array.from(
      { length: missionTotal + 1 },
      (_, count) => {
        let label;

        if (count === 0) {
          label = "None";
        } else if (count === missionTotal) {
          label = `All ${missionTotal}`;
        } else {
          label = `${count} mission${count === 1 ? "" : "s"}`;
        }

        return `<option
          value="${count}"
          ${Number(current) === count ? "selected" : ""}
        >${label}</option>`;
      }
    ).join("");

    return `<select
      class="select-control"
      data-simple-type-count="${type.id}"
    >${options}</select>`;
  }

  function normalizeSimpleDefaults() {
    const defaults = clone(config.simpleDefaults || {});

    defaults.sessions = Array.from(
      { length: config.pts.sessionCount },
      (_, index) => defaults.sessions?.[index] ?? false
    );

    defaults.days ||= {};
    config.pts.days.forEach(day => {
      if (defaults.days[day.id] === undefined) {
        defaults.days[day.id] = false;
      }
    });

    defaults.missionTypes ||= {};

    config.missionTypes.forEach(type => {
      const current = defaults.missionTypes[type.id] || {};

      if (type.controls?.simple === "window-frequency") {
        current.rates ||= {};
        (type.schedule?.windows || []).forEach(window => {
          if (current.rates[window.id] === undefined) {
            current.rates[window.id] = 0;
          }
        });
      }

      if (type.controls?.simple === "day-mission-checkboxes") {
        current.selections ||= {};
        (type.missions || []).forEach(mission => {
          if (current.selections[mission.id] === undefined) {
            current.selections[mission.id] = false;
          }
        });
      }

      if (type.controls?.simple === "mission-count") {
        const missionTotal = (type.missions || []).length;

        if (!Number.isInteger(current.count)) {
          current.count = 0;
        }

        current.count = Math.max(
          0,
          Math.min(current.count, missionTotal)
        );
      }

      if (type.controls?.simple === "completion-frequency") {
        if (current.rate === undefined) current.rate = 0;
      }

      defaults.missionTypes[type.id] = current;
    });

    return defaults;
  }

  function missionTypeHeadingContent(
    type,
    {
      headingTag = "h4",
      help = type.help || ""
    } = {}
  ) {
    const showSharedReward = Boolean(type.reward);

    return `
      <div class="mission-type-heading-content">
        <div class="mission-type-title">
          <${headingTag}>${type.label}</${headingTag}>
          ${help ? tooltip(help) : ""}
        </div>

        ${showSharedReward ? `
          <div class="type-shared-reward">
            ${rewardHtml(type.reward, { compact: true })}
            <em>each</em>
          </div>` : ""}
      </div>`;
  }

  function renderSimpleWindowType(type) {
    const state = simpleState.missionTypes[type.id];

    const windowRows = Calc.getDisplayWindows(config, type).map(window => {
      const localSchedule = localWindowSchedule(type, window);

      return `
        <label class="window-row">
          <span class="window-meta">
            <span>${window.icon || "⚡"}</span>
            <span>
              <strong>${window.label}</strong>
              <small>
                ${localSchedule
                  ? `${localSchedule.time} ${localSchedule.zone}`
                  : `${window.start}–${window.end} UTC`}
              </small>
            </span>
          </span>
          ${rateSelect(
            state.rates[window.id] ?? 0,
            `data-simple-type-window="${type.id}|${window.id}"`
          )}
        </label>`;
    }).join("");

    return `
      <div class="subpanel">
        <div class="subpanel-heading mission-type-subpanel-heading">
          ${missionTypeHeadingContent(type, {
            headingTag: "h3",
            help:
              type.simple?.help ||
              type.help ||
              "Choose how often you expect to complete this mission type."
          })}
        </div>

        <p class="basic-window-prompt">On the days you selected, how often do you expect to have enough focused playtime to complete a mission during each window?</p>

        <div class="window-list">${windowRows}</div>
      </div>`;
  }

  function renderSimpleDays() {
    const dayChecks = config.pts.days.map(day => `
      <label class="pill-check">
        <input
          type="checkbox"
          data-simple-day="${day.id}"
          ${simpleState.days[day.id] ? "checked" : ""}
        >
        <span>${day.shortLabel || day.label}</span>
      </label>`).join("");

    return `
      <div class="subpanel">
        <div class="subpanel-heading">
          <h3>Days You Expect to Play</h3>
          ${tooltip(
            "These days are used throughout Basic mode. They determine which Windowed Mission opportunities count and which Day-Long Missions are available."
          )}
        </div>

        <div class="day-toggles">${dayChecks}</div>
      </div>`;
  }

  function renderSimpleDayMissionType(type) {
    const state = simpleState.missionTypes[type.id];

    const dayById = new Map(
      config.pts.days.map(day => [day.id, day])
    );

    const cards = (type.missions || []).map(mission => {
      const schedule = mission.schedule;
      const day = dayById.get(schedule?.dayId);
      const daySelected = Boolean(
        schedule?.dayId && simpleState.days[schedule.dayId]
      );
      const selected = Boolean(state.selections[mission.id]);
      const localSchedule = localMissionSchedule(mission);

      const unavailableHelp = daySelected
        ? ""
        : `Select ${day?.label || schedule?.dayId || "the required day"} under Days You Expect to Play to include this mission.`;

      return `
        <label
          class="basic-mission-check ${selected ? "selected" : ""} ${daySelected ? "" : "unavailable"}"
          ${unavailableHelp ? `
            data-tooltip-trigger
            data-tooltip="${escapeAttribute(unavailableHelp)}"
            tabindex="0"
          ` : ""}
        >
          <span class="basic-mission-check-copy">
            <span class="mission-title-with-help">
              <strong>${mission.label}</strong>
              ${mission.help ? tooltip(mission.help) : ""}
            </span>

            <small>
              Available ${day?.label || schedule?.dayId}
              ${localSchedule ? `
                · ${localSchedule.time}
                ${localSchedule.zone}
                ${localSchedule.dayShift ? `· ${localSchedule.dayShift}` : ""}
              ` : ""}
            </small>
          </span>

          <input
            type="checkbox"
            data-simple-type-mission="${type.id}|${mission.id}"
            ${selected ? "checked" : ""}
            ${daySelected ? "" : "disabled"}
            aria-label="I expect to complete ${mission.label}"
          >
        </label>`;
    }).join("");

    return `
      <div class="subpanel basic-day-missions">
        <div class="subpanel-heading mission-type-subpanel-heading">
          ${missionTypeHeadingContent(type, {
            headingTag: "h3",
            help:
              type.simple?.help ||
              type.help ||
              "Choose the missions you expect to complete."
          })}
        </div>

        <p class="basic-window-prompt">
          Check the missions you expect to have enough focused playtime to complete.
        </p>

        <div class="basic-mission-check-list">${cards}</div>
      </div>`;
  }

  function renderSimpleLongerMissionTypes(types) {
    if (!types.length) return "";

    const rows = types.map(type => {
      const state = simpleState.missionTypes[type.id];
      const maximum = typeMaximumReward(type);
      const control = type.controls?.simple;

      const input = control === "mission-count"
        ? missionCountSelect(type, state.count ?? 0)
        : rateSelect(
            state.rate ?? 0,
            `data-simple-type-rate="${type.id}"`,
            completionRateOptions
          );

      return `
        <label class="window-row">
          <span class="mission-group-meta">
            <span class="mission-group-title">
              <strong>${type.label}</strong>
              ${tooltip(
                type.simple?.help ||
                type.help ||
                "Exact mission objectives may vary by update."
              )}
            </span>
            <small class="group-maximum">
              <span>
                ${(type.missions || []).length}
                mission${(type.missions || []).length === 1 ? "" : "s"}
                per session
              </span>
              <span class="group-maximum-rewards">
                ${rewardHtml(maximum, { compact: true })}
                <em>maximum per session</em>
              </span>
            </small>
          </span>

          ${input}
        </label>`;
    }).join("");

    return `
      <div class="subpanel">
        <div class="subpanel-heading">
          <h3>Longer Missions</h3>
          ${tooltip(
            "These missions stay available longer, but they still require specific objectives and focused progress rather than simply playing normally."
          )}
        </div>

        <div class="fixed-options">${rows}</div>
      </div>`;
  }

  function renderSimple() {
    const host = document.querySelector("#simplePlanner");

    const sessionChecks = Array.from(
      { length: config.pts.sessionCount },
      (_, index) => `
        <label class="pill-check">
          <input
            type="checkbox"
            data-simple-session="${index}"
            ${simpleState.sessions[index] ? "checked" : ""}
          >
          <span>Session ${index + 1}</span>
        </label>`
    ).join("");

    const windowTypes = config.missionTypes.filter(
      type => type.controls?.simple === "window-frequency"
    );

    const dayMissionTypes = config.missionTypes.filter(
      type => type.controls?.simple === "day-mission-checkboxes"
    );

    const longerMissionTypes = config.missionTypes.filter(
      type =>
        type.controls?.simple === "mission-count" ||
        type.controls?.simple === "completion-frequency"
    );

    host.innerHTML = `
      <div class="basic-note">
        <strong>Plan for focused mission time.</strong> PTS missions require specific objectives. Count time you expect to actively work toward those objectives—not just time you expect to be playing.
      </div>

      <div class="subpanel">
        <div class="subpanel-heading">
          <h3>PTS Sessions</h3>
          ${tooltip(
            "Selecting a session assumes you will at least log in to it, so the recurring session login reward is included."
          )}
        </div>
        <div class="round-toggles">${sessionChecks}</div>
      </div>

      ${renderSimpleDays()}
      ${windowTypes.map(renderSimpleWindowType).join("")}
      ${dayMissionTypes.map(renderSimpleDayMissionType).join("")}
      ${renderSimpleLongerMissionTypes(longerMissionTypes)}
    `;

    host.querySelectorAll("input, select").forEach(element => {
      element.addEventListener("change", onSimpleChange);
    });
  }

  function onSimpleChange(event) {
    const element = event.currentTarget;

    if (element.dataset.simpleSession !== undefined) {
      simpleState.sessions[Number(element.dataset.simpleSession)] =
        element.checked;
    }

    if (element.dataset.simpleDay) {
      simpleState.days[element.dataset.simpleDay] =
        element.checked;

      // Day-Long controls are conditional on the shared Basic day selection.
      // Re-rendering hides/reveals them without discarding their saved state.
      renderSimple();
    }

    if (element.dataset.simpleTypeMission) {
      const [typeId, missionId] =
        element.dataset.simpleTypeMission.split("|");

      simpleState.missionTypes[typeId].selections[missionId] =
        element.checked;

      element
        .closest(".basic-mission-check")
        ?.classList.toggle("selected", element.checked);
    }

    if (element.dataset.simpleTypeWindow) {
      const [typeId, windowId] =
        element.dataset.simpleTypeWindow.split("|");
      simpleState.missionTypes[typeId].rates[windowId] =
        Number(element.value);
    }

    if (element.dataset.simpleTypeCount) {
      simpleState.missionTypes[element.dataset.simpleTypeCount].count =
        Number(element.value);
    }

    if (element.dataset.simpleTypeRate) {
      simpleState.missionTypes[element.dataset.simpleTypeRate].rate =
        Number(element.value);
    }

    recalculate();
  }

  function missionSlotKey(dayId, windowId) {
    return `${dayId}:${windowId}`;
  }

  function renderAdvanced() {
    const host = document.querySelector("#advancedSessions");

    host.innerHTML = advancedState.sessions.map(
      (session, sessionIndex) => {
        const mirrored =
          sessionIndex > 0 && session.mirrorSession1;

        const body = mirrored
          ? renderMirrorSummary(sessionIndex)
          : renderSessionBody(session, sessionIndex);

        return `
          <section
            class="advanced-session ${session.enabled ? "" : "session-disabled"}"
            data-session-card="${sessionIndex}"
          >
            <div class="advanced-session-heading">
              <div>
                <p class="section-kicker">PTS Session ${sessionIndex + 1}</p>
                <h3>Session ${sessionIndex + 1}</h3>
              </div>

              <div class="session-heading-controls">
                ${sessionIndex > 0 ? `
                  <label class="mirror-label">
                    <input
                      type="checkbox"
                      data-advanced-mirror="${sessionIndex}"
                      ${mirrored ? "checked" : ""}
                    >
                    <span>Same as Session 1</span>
                  </label>` : ""}

                <label class="switch-label">
                  <input
                    type="checkbox"
                    data-advanced-session-enabled="${sessionIndex}"
                    ${session.enabled ? "checked" : ""}
                  >
                  <span>Play this session</span>
                </label>
              </div>
            </div>

            ${body}
          </section>`;
      }
    ).join("");

    host.querySelectorAll("input").forEach(element => {
      element.addEventListener("change", onAdvancedChange);
    });
  }

  function selectedAdvancedCount(session) {
    return config.missionTypes.reduce((sum, type) => {
      const selections = session.selections?.[type.id] || {};
      return sum + Object.values(selections).filter(Boolean).length;
    }, 0);
  }

  function renderMirrorSummary(sessionIndex) {
    const source = advancedState.sessions[0];
    const selected = selectedAdvancedCount(source);

    return `<div class="mirror-summary">
      <strong>Session ${sessionIndex + 1} will mirror Session 1’s mission selections (${selected} selected).</strong>
      The Session ${sessionIndex + 1} login reward is included automatically.
      Uncheck <em>Same as Session 1</em> to restore its independent plan.
    </div>`;
  }

  function missionTypeHeader(type, count) {
    return `
      <div class="advanced-section-label advanced-group-label mission-type-label">
        ${missionTypeHeadingContent(type)}

        <span>${count} mission${count === 1 ? "" : "s"}</span>
      </div>`;
  }

  function renderCalendarType(type, session, sessionIndex) {
    const days = config.pts.days;
    const windows = Calc.getDisplayWindows(config, type);
    const selections = session.selections[type.id] || {};
    const columns = days.length;

    const headers = days.map(day => `
      <div class="timed-grid-cell timed-grid-heading">
        <strong>${day.label}</strong>
        <small>WG mission day</small>
      </div>`).join("");

    const slotRows = windows.map(window =>
      days.map(day => {
        const dayWindows =
          type.schedule.windowsByDay?.[day.id] || [];

        if (!dayWindows.includes(window.id)) {
          return `<div class="timed-grid-cell">
            <div
              class="mission-slot unavailable"
              aria-label="${type.schedule.unavailableLabel || "No mission"} on ${day.label}"
            >
              <span class="slot-check-placeholder" aria-hidden="true"></span>
              <span class="slot-icon">${window.icon || "⚡"}</span>
              <span class="slot-time">
                Not available
                <small>${window.label} slot</small>
              </span>
            </div>
          </div>`;
        }

        const key = missionSlotKey(day.id, window.id);
        const selected = Boolean(selections[key]);
        const local = localSlot(day, window);
        const dayShift = localDayShift(local);

        return `<div class="timed-grid-cell">
          <label class="mission-slot ${selected ? "selected" : ""}">
            <input
              type="checkbox"
              data-advanced-selection="${sessionIndex}|${type.id}|${key}"
              ${selected ? "checked" : ""}
            >
            <span class="slot-icon">${window.icon || "⚡"}</span>
            <span class="slot-time">
              <span class="slot-local-time">
                ${local.time}
                <em>${local.zone}</em>
                ${dayShift ? `<b>${dayShift}</b>` : ""}
              </span>
            </span>
          </label>
        </div>`;
      }).join("")
    ).join("");

    const count = Calc.getWindowSlots(config, type).length;

    return `
      ${missionTypeHeader(type, count)}
      <div
        class="schedule-grid"
        style="--schedule-columns:${columns}"
      >
        ${headers}
        ${slotRows}
      </div>`;
  }

  function renderListMission(
    sessionIndex,
    type,
    mission,
    selected
  ) {
    const reward = Calc.rewardForMission(type, mission);
    const showMissionReward = Boolean(mission.reward);
    const localSchedule = localMissionSchedule(mission);

    return `<label class="mission-check ${selected ? "selected" : ""}">
      <input
        type="checkbox"
        data-advanced-selection="${sessionIndex}|${type.id}|${mission.id}"
        ${selected ? "checked" : ""}
      >

      <span class="mission-check-title">
        <span class="mission-title-with-help">
          <strong>${mission.label}</strong>
          ${mission.help ? tooltip(mission.help) : ""}
        </span>

        ${localSchedule ? `
          <small class="mission-schedule-meta">
            <span aria-hidden="true">${mission.schedule.icon || "🗓️"}</span>
            ${localSchedule.time}
            ${localSchedule.zone}
            ${localSchedule.dayShift ? `· ${localSchedule.dayShift}` : ""}
          </small>` : ""}
      </span>

      ${showMissionReward && reward ? `
        <span class="reward-chip">
          ${rewardHtml(reward, { compact: true })}
        </span>` : ""}
    </label>`;
  }

  function renderListType(type, session, sessionIndex) {
    const selections = session.selections[type.id] || {};
    const missions = type.missions || {};

    const checks = (type.missions || []).map(mission =>
      renderListMission(
        sessionIndex,
        type,
        mission,
        Boolean(selections[mission.id])
      )
    ).join("");

    return `
      ${missionTypeHeader(type, type.missions.length)}
      <div class="mission-check-grid">${checks}</div>`;
  }

  function renderMissionType(type, session, sessionIndex) {
    switch (type.controls?.advanced) {
      case "calendar":
        return renderCalendarType(type, session, sessionIndex);
      case "list":
        return renderListType(type, session, sessionIndex);
      default:
        return "";
    }
  }

  function renderSessionBody(session, sessionIndex) {
    const types = config.missionTypes.map(type =>
      renderMissionType(type, session, sessionIndex)
    ).join("");

    const login = config.automaticRewards.sessionLogin;

    return `<div class="session-body">
      ${types}

      <div class="automatic-login">
        <div class="automatic-login-title">
          <strong>${login.label}</strong>
          ${tooltip(login.help)}
          <span>Included automatically</span>
        </div>

        <div class="automatic-login-reward">
          ${rewardHtml(login.reward, { compact: true })}
        </div>
      </div>
    </div>`;
  }

  function onAdvancedChange(event) {
    const element = event.currentTarget;

    if (element.dataset.advancedSessionEnabled !== undefined) {
      const index =
        Number(element.dataset.advancedSessionEnabled);

      advancedState.sessions[index].enabled =
        element.checked;

      document
        .querySelector(`[data-session-card="${index}"]`)
        ?.classList.toggle(
          "session-disabled",
          !element.checked
        );

      recalculate();
      return;
    }

    if (element.dataset.advancedMirror !== undefined) {
      const index =
        Number(element.dataset.advancedMirror);

      advancedState.sessions[index].mirrorSession1 =
        element.checked;

      renderAdvanced();
      recalculate();
      return;
    }

    if (element.dataset.advancedSelection) {
      const [sessionIndex, typeId, key] =
        element.dataset.advancedSelection.split("|");

      advancedState
        .sessions[Number(sessionIndex)]
        .selections[typeId][key] =
        element.checked;

      element
        .closest(".mission-slot, .mission-check")
        ?.classList.toggle(
          "selected",
          element.checked
        );

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
    writeSavedState();
  }

  function updateResetButton() {
    const button = document.querySelector("#resetPlannerButton");
    const simple = mode === "simple";
    const label = simple ? "Reset Basic plan" : "Reset Advanced plan";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  }

  function applyModeUi() {
    document.querySelector("#simplePlanner").hidden = mode !== "simple";
    document.querySelector("#advancedPlanner").hidden = mode !== "advanced";

    document.querySelectorAll("[data-mode]").forEach(button => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.mode === mode)
      );
    });

    document.querySelector("#projectionLabel").textContent =
      mode === "simple"
        ? "Projected Rewards"
        : "Planned Rewards";

    updateResetButton();
  }

  function setMode(nextMode) {
    if (!["simple", "advanced"].includes(nextMode)) return;
    if (nextMode === mode) return;

    mode = nextMode;
    applyModeUi();
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

  function scheduleSectionLabel(type) {
    const display = type.schedule;
    const sharedReward = type.reward || null;

    const help = [
      display.help || type.help || "",
      sharedReward
        ? `Reward: ${rewardText(sharedReward)}.`
        : ""
    ].filter(Boolean).join(" ");

    return `<div
      class="reference-section-label"
      style="grid-column:1 / -1"
    >
      <strong>${type.label}</strong>
      <small>${display.subtitle || ""}</small>
      ${help ? tooltip(help) : ""}
    </div>`;
  }

  function referenceTimeCell({
    icon,
    localTime = "",
    localZone = "",
    localDayShift = "",
    utcTime = "",
    unavailable = false,
    unavailableLabel = "No Mission"
  }) {
    if (unavailable) {
      return `<div class="reference-window unavailable">
        <b class="reference-icon-placeholder" aria-hidden="true"></b>
        <span class="reference-unavailable-copy">
          <strong aria-hidden="true">—</strong>
          <small>${unavailableLabel}</small>
        </span>
      </div>`;
    }

    return `<div class="reference-window">
      <b aria-hidden="true">${icon || "⚡"}</b>
      <span>
        <span class="reference-local-time">
          ${localTime}
          <em>${localZone}</em>
          ${localDayShift ? `<b>${localDayShift}</b>` : ""}
        </span>
        <small>${utcTime}</small>
      </span>
    </div>`;
  }

  function renderWindowSchedule(type, days) {
    const windows = Calc.getDisplayWindows(config, type);

    const rows = windows.map(window =>
      days.map(day => {
        const dayWindows =
          type.schedule.windowsByDay?.[day.id] || [];

        if (!dayWindows.includes(window.id)) {
          return referenceTimeCell({
            unavailable: true,
            unavailableLabel:
              type.schedule.unavailableLabel ||
              `No ${type.label}`
          });
        }

        const local = localSlot(day, window);

        return referenceTimeCell({
          icon: window.icon || "⚡",
          localTime: local.time,
          localZone: local.zone,
          localDayShift: localDayShift(local),
          utcTime: `${window.start}–${window.end} UTC`
        });
      }).join("")
    ).join("");

    return `
      ${scheduleSectionLabel(type)}
      ${rows}`;
  }

  function renderDaySchedule(type, days) {
    const byDay = new Map(
      days.map(day => [day.id, []])
    );

    (type.missions || []).forEach(mission => {
      if (byDay.has(mission.schedule?.dayId)) {
        byDay.get(mission.schedule.dayId).push(mission);
      }
    });

    const representative =
      (type.missions || [])[0] || null;

    const cells = days.map(day => {
      const missions = byDay.get(day.id) || [];

      if (!missions.length) {
        return referenceTimeCell({
          unavailable: true,
          unavailableLabel:
            type.schedule.unavailableLabel ||
            `No ${type.label}`
        });
      }

      const mission = missions[0];
      const missionSchedule = mission.schedule;
      const local = localSlot(day, {
        start: missionSchedule.start,
        end: missionSchedule.end
      });

      return referenceTimeCell({
        icon:
          missionSchedule.icon ||
          representative?.schedule?.icon ||
          "🗓️",
        localTime: local.time,
        localZone: local.zone,
        localDayShift: localDayShift(local),
        utcTime:
          `${missionSchedule.start}–${missionSchedule.end} UTC`
      });
    }).join("");

    return `
      ${scheduleSectionLabel(type)}
      ${cells}`;
  }

  function renderScheduleType(type, days) {
    switch (type.schedule?.layout) {
      case "windows":
        return renderWindowSchedule(type, days);
      case "days":
        return renderDaySchedule(type, days);
      default:
        return "";
    }
  }

  function renderScheduleReference() {
    document.querySelector("#detectedTimezone").textContent =
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      "your browser timezone";

    const host =
      document.querySelector("#scheduleReference");

    const days = config.pts.days;
    const columns = days.length;

    const headers = days.map(day => `
      <div class="reference-heading">
        <strong>${day.label}</strong>
        <small>WG mission day</small>
      </div>`).join("");

    const sections = config.missionTypes
      .filter(type => Boolean(type.schedule))
      .map(type => renderScheduleType(type, days))
      .join("");

    host.innerHTML = `
      <div
        class="reference-days"
        style="--schedule-columns:${columns}"
      >
        ${headers}
        ${sections}
      </div>`;
  }

  function init(loadedConfig) {
    if (initialized) return;
    initialized = true;
    config = loadedConfig;
    initFloatingTooltips();

    const savedState = readSavedState();

    simpleState = restoreSimpleState(savedState?.simpleState);
    advancedState = restoreAdvancedState(savedState?.advancedState);

    mode = ["simple", "advanced"].includes(savedState?.mode)
      ? savedState.mode
      : "simple";

    const schedulePanel = document.querySelector("#schedulePanel");
    if (schedulePanel && typeof savedState?.scheduleOpen === "boolean") {
      schedulePanel.open = savedState.scheduleOpen;
    }

    document.querySelector("#verifiedAgainst").textContent = `Verified ${config.model.verifiedAgainst}`;

    const scheduledTypes = config.missionTypes.filter(type => Boolean(type.schedule));
    const scheduleSubtitle = document.querySelector("#scheduleSummarySubtitle");
    if (scheduleSubtitle) {
      scheduleSubtitle.textContent =
        `${scheduledTypes.map(type => type.label).join(" and ")} in your local time`;
    }

    const calendarType = config.missionTypes.find(
      type => type.controls?.advanced === "calendar"
    );
    if (calendarType) {
      const shortLabel = calendarType.label.replace(/ Missions$/, "");
      const countLabel = document.querySelector("#timedCountLabel");
      const coverageLabel = document.querySelector("#captureRateLabel");
      if (countLabel) countLabel.textContent = shortLabel;
      if (coverageLabel) coverageLabel.textContent = `${shortLabel} coverage`;
    }

    document.querySelector("#appContent").hidden = false;

    renderSimple();
    renderAdvanced();
    renderScheduleReference();
    applyModeUi();
    recalculate();

    document.querySelectorAll("[data-mode]").forEach(button => {
      button.addEventListener("click", () => setMode(button.dataset.mode));
    });

    document.querySelector("#resetPlannerButton").addEventListener(
      "click",
      resetCurrentMode
    );

    document.querySelector("#schedulePanel")?.addEventListener(
      "toggle",
      writeSavedState
    );
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
