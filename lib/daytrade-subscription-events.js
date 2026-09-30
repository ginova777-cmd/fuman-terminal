const fs = require('fs');
const path = require('path');
// Directory watches survive atomic replacement of the manifest file.
function startSubscriptionEvents({ files, onChange, onError, now = Date.now, watch = fs.watch, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let stopped = false, debounce, boundary;
  const watchers = [];
  const signal = reason => {
    if (stopped) return;
    clearTimer(debounce);
    debounce = setTimer(() => { if (!stopped) onChange(reason); }, 250);
  };
  const groups = new Map();
  for (const file of files) {
    const dir = path.dirname(file);
    if (!groups.has(dir)) groups.set(dir, new Set());
    groups.get(dir).add(path.basename(file).toLowerCase());
  }
  const stop = () => { stopped = true; clearTimer(debounce); clearTimer(boundary); for (const w of watchers) w.close(); };
  const fail = error => { stop(); onError(error); };
  try {
    for (const [dir, names] of groups) {
      const w = watch(dir, (event, name) => { if (!name || names.has(String(name).toLowerCase())) signal('manifest_changed'); });
      w.on('error', fail);
      watchers.push(w);
    }
    const scheduleBoundary = () => {
      const ms = now();
      const local = new Date(ms + 8 * 3600000);
      const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 8 * 3600000;
      const next = [midnight + 525 * 60000, midnight + 86400000].find(t => t > ms);
      boundary = setTimer(() => { if (!stopped) { signal('session_boundary'); scheduleBoundary(); } }, next - ms);
    };
    scheduleBoundary();
  } catch (error) { fail(error); }
  return stop;
}
module.exports = { startSubscriptionEvents };
