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

  function getTimedSlots(config) {
    const slots = [];
    config.schedule.days.forEach(day => {
      day.windows.forEach(windowId => {
        slots.push({ key: `${day.id}:${windowId}`, dayId: day.id, windowId });
      });
    });
    return slots;
  }

  function getDisplayWindows(config) {
    const used = new Set(config.schedule.days.flatMap(day => day.windows));
    return config.schedule.timedWindowsUtc.filter(window => used.has(window.id));
  }

  function maximumTimedCompletions(config) {
    return getTimedSlots(config).length * config.schedule.sessionCount;
  }

  function calculateMaximum(config) {
    const result = zeroRewards(config);
    const sessions = config.schedule.sessionCount;

    addReward(result, config.missions.login.reward, sessions);
    result.timedCompletions = maximumTimedCompletions(config);
    addReward(result, config.missions.timed.reward, result.timedCompletions);

    config.missions.groups.forEach(group => {
      group.missions.forEach(mission => addReward(result, mission.reward, sessions));
    });

    return result;
  }

  function calculateSimple(config, state) {
    const result = zeroRewards(config);
    const activeSessions = state.sessions.filter(Boolean).length;

    addReward(result, config.missions.login.reward, activeSessions);

    let timedPerSession = 0;
    config.schedule.days.forEach(day => {
      if (!state.days[day.id]) return;
      day.windows.forEach(windowId => {
        timedPerSession += Number(state.windowRates[windowId] || 0);
      });
    });

    result.timedCompletions = timedPerSession * activeSessions;
    addReward(result, config.missions.timed.reward, result.timedCompletions);

    config.missions.groups.forEach(group => {
      const rate = Number(state.missionGroupRates[group.id] ?? 0);
      group.missions.forEach(mission => {
        addReward(result, mission.reward, activeSessions * rate);
      });
    });

    return result;
  }

  function calculateAdvanced(config, state) {
    const result = zeroRewards(config);
    const sessionOne = state.sessions[0];

    state.sessions.forEach((session, sessionIndex) => {
      if (!session.enabled) return;
      const choices = sessionIndex > 0 && session.mirrorSession1 ? sessionOne : session;

      addReward(result, config.missions.login.reward);

      Object.values(choices.timed).forEach(selected => {
        if (!selected) return;
        result.timedCompletions += 1;
        addReward(result, config.missions.timed.reward);
      });

      config.missions.groups.forEach(group => {
        const groupChoices = choices.groups[group.id] || {};
        group.missions.forEach(mission => {
          if (groupChoices[mission.id]) addReward(result, mission.reward);
        });
      });
    });

    return result;
  }

  function buildAdvancedDefaults(config) {
    const timedSlots = getTimedSlots(config);
    const sessions = [];

    for (let sessionIndex = 0; sessionIndex < config.schedule.sessionCount; sessionIndex += 1) {
      const timed = {};
      timedSlots.forEach(slot => { timed[slot.key] = false; });

      const groups = {};
      config.missions.groups.forEach(group => {
        groups[group.id] = {};
        group.missions.forEach(mission => {
          groups[group.id][mission.id] = false;
        });
      });

      sessions.push({
        enabled: config.advancedDefaults?.playSessions ?? true,
        mirrorSession1:
          sessionIndex > 0 && (config.advancedDefaults?.mirrorSession1 ?? true),
        timed,
        groups
      });
    }

    return { sessions };
  }

  function buildAdvancedFromSimple(config, simpleState) {
    const timedSlots = getTimedSlots(config);
    const sessions = [];

    for (let sessionIndex = 0; sessionIndex < config.schedule.sessionCount; sessionIndex += 1) {
      const timed = {};
      timedSlots.forEach(slot => { timed[slot.key] = false; });

      config.schedule.timedWindowsUtc.forEach(window => {
        const eligible = timedSlots.filter(slot =>
          slot.windowId === window.id && simpleState.days[slot.dayId]
        );
        const desired = Math.round(eligible.length * Number(simpleState.windowRates[window.id] || 0));
        eligible.slice(0, desired).forEach(slot => { timed[slot.key] = true; });
      });

      const groups = {};
      config.missions.groups.forEach(group => {
        const rate = Number(simpleState.missionGroupRates[group.id] ?? 0);
        const desired = Math.round(group.missions.length * rate);
        groups[group.id] = {};
        group.missions.forEach((mission, index) => {
          groups[group.id][mission.id] = index < desired;
        });
      });

      sessions.push({
        enabled: simpleState.sessions[sessionIndex] ?? true,
        mirrorSession1: sessionIndex > 0,
        timed,
        groups
      });
    }

    return { sessions };
  }

  window.PTS_CALCULATOR = {
    calculateSimple,
    calculateAdvanced,
    calculateMaximum,
    buildAdvancedDefaults,
    buildAdvancedFromSimple,
    getTimedSlots,
    getDisplayWindows,
    maximumTimedCompletions
  };
})();
