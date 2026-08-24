(() => {
  function zeroRewards(config) {
    const result = { timedCompletions: 0 };
    config.resources.forEach(resource => { result[resource.id] = 0; });
    return result;
  }

  function addReward(target, reward, scale = 1) {
    Object.entries(reward || {}).forEach(([key, value]) => {
      target[key] = (target[key] || 0) + value * scale;
    });
  }

  function rewardForMission(type, mission = null) {
    return type.reward || mission?.reward || null;
  }

  function getCalendarType(config) {
    return config.missionTypes.find(
      type => type.controls?.advanced === "calendar"
    ) || null;
  }

  function getDisplayWindows(config, type = getCalendarType(config)) {
    if (!type?.schedule || type.schedule.layout !== "windows") return [];

    const used = new Set(
      Object.values(type.schedule.windowsByDay || {}).flat()
    );

    return (type.schedule.windows || []).filter(window => used.has(window.id));
  }

  function getWindowSlots(config, type = getCalendarType(config)) {
    if (!type?.schedule || type.schedule.layout !== "windows") return [];

    const slots = [];
    config.pts.days.forEach(day => {
      const windows = type.schedule.windowsByDay?.[day.id] || [];
      windows.forEach(windowId => {
        slots.push({
          key: `${day.id}:${windowId}`,
          dayId: day.id,
          windowId
        });
      });
    });
    return slots;
  }

  function maximumTimedCompletions(config) {
    return config.missionTypes
      .filter(type => type.controls?.advanced === "calendar")
      .reduce(
        (sum, type) => sum + getWindowSlots(config, type).length * config.pts.sessionCount,
        0
      );
  }

  function calculateMaximum(config) {
    const result = zeroRewards(config);
    const sessions = config.pts.sessionCount;

    addReward(result, config.automaticRewards.sessionLogin.reward, sessions);

    config.missionTypes.forEach(type => {
      if (type.controls?.advanced === "calendar") {
        const count = getWindowSlots(config, type).length * sessions;
        result.timedCompletions += count;
        addReward(result, rewardForMission(type), count);
        return;
      }

      (type.missions || []).forEach(mission => {
        addReward(result, rewardForMission(type, mission), sessions);
      });
    });

    return result;
  }

  function calculateSimple(config, state) {
    const result = zeroRewards(config);
    const activeSessions = state.sessions.filter(Boolean).length;

    addReward(result, config.automaticRewards.sessionLogin.reward, activeSessions);

    config.missionTypes.forEach(type => {
      const typeState = state.missionTypes?.[type.id] || {};

      if (type.controls?.simple === "window-frequency") {
        let completionsPerSession = 0;

        config.pts.days.forEach(day => {
          if (!typeState.days?.[day.id]) return;

          const windows = type.schedule?.windowsByDay?.[day.id] || [];
          windows.forEach(windowId => {
            completionsPerSession += Number(typeState.rates?.[windowId] || 0);
          });
        });

        const completions = completionsPerSession * activeSessions;
        result.timedCompletions += completions;
        addReward(result, rewardForMission(type), completions);
        return;
      }

      if (type.controls?.simple === "completion-frequency") {
        const rate = Number(typeState.rate || 0);

        (type.missions || []).forEach(mission => {
          addReward(
            result,
            rewardForMission(type, mission),
            activeSessions * rate
          );
        });
      }
    });

    return result;
  }

  function calculateAdvanced(config, state) {
    const result = zeroRewards(config);
    const sessionOne = state.sessions[0];

    state.sessions.forEach((session, sessionIndex) => {
      if (!session.enabled) return;

      const choices =
        sessionIndex > 0 && session.mirrorSession1
          ? sessionOne
          : session;

      addReward(result, config.automaticRewards.sessionLogin.reward);

      config.missionTypes.forEach(type => {
        const selections = choices.selections?.[type.id] || {};

        if (type.controls?.advanced === "calendar") {
          Object.values(selections).forEach(selected => {
            if (!selected) return;
            result.timedCompletions += 1;
            addReward(result, rewardForMission(type));
          });
          return;
        }

        (type.missions || []).forEach(mission => {
          if (!selections[mission.id]) return;
          addReward(result, rewardForMission(type, mission));
        });
      });
    });

    return result;
  }

  function buildAdvancedDefaults(config) {
    const sessions = [];

    for (
      let sessionIndex = 0;
      sessionIndex < config.pts.sessionCount;
      sessionIndex += 1
    ) {
      const selections = {};

      config.missionTypes.forEach(type => {
        selections[type.id] = {};

        if (type.controls?.advanced === "calendar") {
          getWindowSlots(config, type).forEach(slot => {
            selections[type.id][slot.key] = false;
          });
          return;
        }

        (type.missions || []).forEach(mission => {
          selections[type.id][mission.id] = false;
        });
      });

      sessions.push({
        enabled: config.advancedDefaults?.sessionsEnabled ?? true,
        mirrorSession1:
          sessionIndex > 0 &&
          (config.advancedDefaults?.mirrorLaterSessions ?? true),
        selections
      });
    }

    return { sessions };
  }

  window.PTS_CALCULATOR = {
    calculateSimple,
    calculateAdvanced,
    calculateMaximum,
    buildAdvancedDefaults,
    getDisplayWindows,
    getWindowSlots,
    maximumTimedCompletions,
    rewardForMission
  };
})();
