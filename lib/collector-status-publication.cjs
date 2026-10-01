'use strict';
// Component persistence callbacks are not transport observations. They may
// annotate the last observation, but must never refresh its clock or defaults.
function createStatusPublication(write) {
  let latest = null;
  let identity = null;
  let components = {};
  function scope(value) {
    const next = `${value.tradeDate}:${value.pid}`;
    if (identity !== next) { identity = next; latest = null; components = {}; }
  }
  return {
    publish(snapshot) {
      scope(snapshot);
      latest = { ...snapshot, ...components };
      write(latest);
      return latest;
    },
    component(name, value, currentIdentity) {
      if (!['candlePersistence', 'memoryDetection'].includes(name)) throw Error('UNKNOWN_STATUS_COMPONENT');
      scope(currentIdentity);
      components[name] = value;
      if (!latest) return null;
      latest = { ...latest, [name]: value };
      write(latest);
      return latest;
    },
  };
}
module.exports = { createStatusPublication };
