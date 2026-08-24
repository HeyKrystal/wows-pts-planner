(() => {
  const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const SIMPLE_CONTROLS = new Set([
    "window-frequency",
    "completion-frequency",
    "none"
  ]);
  const ADVANCED_CONTROLS = new Set(["calendar", "list"]);
  const SCHEDULE_LAYOUTS = new Set(["windows", "days"]);

  function validateReward(reward, resourceIds, problems, label) {
    if (!reward || typeof reward !== "object") {
      problems.push(`${label} needs a reward object.`);
      return;
    }

    Object.keys(reward).forEach(key => {
      if (!resourceIds.has(key)) {
        problems.push(`${label} references unknown resource: ${key}`);
      }
    });
  }

  function validateConfig(config) {
    const problems = [];

    if (!config || typeof config !== "object") {
      problems.push("Config must be an object.");
    }

    if (config?.schemaVersion !== 4) {
      problems.push("Unsupported or missing schemaVersion.");
    }

    if (!Array.isArray(config?.resources) || !config.resources.length) {
      problems.push("resources must be a non-empty array.");
    }

    const resourceIds = new Set();
    (config?.resources || []).forEach(resource => {
      if (!resource.id) problems.push("Every resource needs an id.");
      if (resourceIds.has(resource.id)) {
        problems.push(`Duplicate resource id: ${resource.id}`);
      }
      resourceIds.add(resource.id);

      if (!resource.label) {
        problems.push(`Resource ${resource.id || "?"} needs a label.`);
      }

      if (
        resource.icon !== undefined &&
        typeof resource.icon !== "string"
      ) {
        problems.push(
          `Resource ${resource.id || "?"} icon must be a string path or URL.`
        );
      }
    });

    if (config?.pts?.timezone !== "UTC") {
      problems.push("pts.timezone must currently be UTC.");
    }

    if (
      !Number.isInteger(config?.pts?.sessionCount) ||
      config.pts.sessionCount < 1
    ) {
      problems.push("pts.sessionCount must be at least 1.");
    }

    if (!Array.isArray(config?.pts?.days) || !config.pts.days.length) {
      problems.push("pts.days must be a non-empty array.");
    }

    const dayIds = new Set();
    (config?.pts?.days || []).forEach(day => {
      if (
        !day.id ||
        !day.label ||
        !Number.isInteger(day.offsetDays)
      ) {
        problems.push(`Invalid PTS day: ${JSON.stringify(day)}`);
      }

      if (dayIds.has(day.id)) {
        problems.push(`Duplicate PTS day id: ${day.id}`);
      }
      dayIds.add(day.id);
    });

    validateReward(
      config?.automaticRewards?.sessionLogin?.reward,
      resourceIds,
      problems,
      "automaticRewards.sessionLogin"
    );

    if (!Array.isArray(config?.missionTypes) || !config.missionTypes.length) {
      problems.push("missionTypes must be a non-empty array.");
    }

    const typeIds = new Set();

    (config?.missionTypes || []).forEach(type => {
      const typeLabel = `Mission type ${type?.id || "?"}`;

      if (!type.id) problems.push("Every mission type needs an id.");
      if (typeIds.has(type.id)) {
        problems.push(`Duplicate mission type id: ${type.id}`);
      }
      typeIds.add(type.id);

      if (!type.label) problems.push(`${typeLabel} needs a label.`);

      if (!SIMPLE_CONTROLS.has(type.controls?.simple || "none")) {
        problems.push(
          `${typeLabel} has unsupported simple control: ${type.controls?.simple}`
        );
      }

      if (!ADVANCED_CONTROLS.has(type.controls?.advanced)) {
        problems.push(
          `${typeLabel} has unsupported advanced control: ${type.controls?.advanced}`
        );
      }

      const missions = type.missions || [];
      const hasSharedReward = Boolean(type.reward);
      const missionsWithRewards = missions.filter(mission => mission.reward);

      if (hasSharedReward && missionsWithRewards.length) {
        problems.push(
          `${typeLabel} cannot define both a shared type reward and per-mission rewards.`
        );
      }

      if (hasSharedReward) {
        validateReward(type.reward, resourceIds, problems, typeLabel);
      } else if (missions.length) {
        missions.forEach(mission => {
          validateReward(
            mission.reward,
            resourceIds,
            problems,
            `${typeLabel} mission ${mission.id || "?"}`
          );
        });
      } else {
        problems.push(`${typeLabel} needs either a shared reward or rewarded missions.`);
      }

      if (type.controls?.advanced === "list") {
        if (!Array.isArray(type.missions) || !type.missions.length) {
          problems.push(`${typeLabel} list control needs missions.`);
        }

        const missionIds = new Set();
        missions.forEach(mission => {
          if (!mission.id || !mission.label) {
            problems.push(
              `${typeLabel} contains an invalid mission: ${JSON.stringify(mission)}`
            );
          }

          if (missionIds.has(mission.id)) {
            problems.push(
              `${typeLabel} contains duplicate mission id: ${mission.id}`
            );
          }
          missionIds.add(mission.id);
        });
      }

      const schedule = type.schedule;
      if (!schedule) return;

      if (!SCHEDULE_LAYOUTS.has(schedule.layout)) {
        problems.push(
          `${typeLabel} has unsupported schedule layout: ${schedule.layout}`
        );
      }

      if (!schedule.subtitle) {
        problems.push(`${typeLabel} schedule needs a subtitle.`);
      }

      if (schedule.layout === "windows") {
        if (!Array.isArray(schedule.windows) || !schedule.windows.length) {
          problems.push(`${typeLabel} window schedule needs windows.`);
        }

        const windowIds = new Set();
        (schedule.windows || []).forEach(window => {
          if (
            !window.id ||
            !TIME_PATTERN.test(window.start || "") ||
            !TIME_PATTERN.test(window.end || "")
          ) {
            problems.push(
              `${typeLabel} has an invalid window: ${JSON.stringify(window)}`
            );
          }
          windowIds.add(window.id);
        });

        Object.entries(schedule.windowsByDay || {}).forEach(
          ([dayId, windows]) => {
            if (!dayIds.has(dayId)) {
              problems.push(`${typeLabel} references unknown PTS day: ${dayId}`);
            }

            if (!Array.isArray(windows)) {
              problems.push(
                `${typeLabel} day ${dayId} must contain a window array.`
              );
              return;
            }

            windows.forEach(windowId => {
              if (!windowIds.has(windowId)) {
                problems.push(
                  `${typeLabel} day ${dayId} references unknown window: ${windowId}`
                );
              }
            });
          }
        );
      }

      if (schedule.layout === "days") {
        if (!Array.isArray(type.missions) || !type.missions.length) {
          problems.push(`${typeLabel} day schedule needs missions.`);
        }

        missions.forEach(mission => {
          if (!dayIds.has(mission.schedule?.dayId)) {
            problems.push(
              `${typeLabel} mission ${mission.id || "?"} needs a valid schedule.dayId.`
            );
          }

          if (
            !TIME_PATTERN.test(mission.schedule?.start || "") ||
            !TIME_PATTERN.test(mission.schedule?.end || "")
          ) {
            problems.push(
              `${typeLabel} mission ${mission.id || "?"} needs valid HH:MM schedule start/end times.`
            );
          }
        });
      }
    });

    const simpleDefaults = config?.simpleDefaults?.missionTypes || {};
    config.missionTypes.forEach(type => {
      if (!simpleDefaults[type.id]) {
        problems.push(`simpleDefaults.missionTypes is missing ${type.id}.`);
      }
    });

    if (problems.length) {
      throw new Error(problems.join(" "));
    }
  }

  async function loadConfig() {
    const response = await fetch("data/pts-config.json", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        `Could not load data/pts-config.json (HTTP ${response.status}).`
      );
    }

    const config = await response.json();
    validateConfig(config);
    return config;
  }

  loadConfig()
    .then(config => {
      window.PTS_CONFIG = config;
      window.dispatchEvent(
        new CustomEvent("pts-config-ready", { detail: config })
      );
    })
    .catch(error => {
      console.error(error);
      window.PTS_CONFIG_ERROR = error.message;
      window.dispatchEvent(
        new CustomEvent("pts-config-error", { detail: error.message })
      );
    });
})();
