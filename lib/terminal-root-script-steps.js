"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function readPackageScripts() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  return pkg.scripts || {};
}

function splitRootCommands(rootCommand) {
  return String(rootCommand || "")
    .split(/\s+&&\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function npmScriptName(command) {
  const match = command.match(/^npm\s+run\s+([^\s]+)/);
  return match ? match[1] : "";
}

function collectorSteps(rootCommand) {
  if (!/scripts[\\/]verify-terminal-unattended-root\.js/.test(rootCommand)) return [];
  const mod = require(path.join(ROOT, "scripts", "verify-terminal-unattended-root.js"));
  return Array.isArray(mod.STEPS) ? mod.STEPS.slice() : [];
}

function readTerminalRootSteps() {
  const scripts = readPackageScripts();
  const rootCommand = String(scripts["verify:terminal-unattended-root"] || "");
  const collector = collectorSteps(rootCommand);
  const rootScripts = collector.length
    ? collector
    : splitRootCommands(rootCommand).map(npmScriptName).filter(Boolean);
  return {
    scripts,
    rootCommand,
    rootScripts,
    source: collector.length ? "collector" : "package-inline",
  };
}

module.exports = {
  readTerminalRootSteps,
  splitRootCommands,
  npmScriptName,
};
