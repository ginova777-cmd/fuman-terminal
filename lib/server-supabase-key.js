"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || "C:/fuman-runtime";

function readSecretText(file) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

function runtimeDir(options = {}) {
  return options.runtimeDir || process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || DEFAULT_RUNTIME_DIR;
}

function rootDir(options = {}) {
  return options.root || ROOT;
}

function serviceRoleKey(options = {}) {
  const root = rootDir(options);
  const runtime = runtimeDir(options);
  return process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_KEY
    || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
    || process.env.FUMAN_SUPABASE_SERVICE_KEY
    || readSecretText(path.join(root, "secrets", "supabase-service-role-key.txt"))
    || readSecretText(path.join(runtime, "secrets", "supabase-service-role-key.txt"));
}

function anonKey(options = {}) {
  const root = rootDir(options);
  const runtime = runtimeDir(options);
  return process.env.SUPABASE_ANON_KEY
    || process.env.FUMAN_SUPABASE_ANON_KEY
    || readSecretText(path.join(root, "secrets", "supabase-anon-key.txt"))
    || readSecretText(path.join(runtime, "secrets", "supabase-anon-key.txt"));
}

function serverSupabaseKey(options = {}) {
  return serviceRoleKey(options) || anonKey(options);
}

function terminalSupabaseKey(options = {}) {
  const root = rootDir(options);
  const runtime = runtimeDir(options);
  return process.env.FUMAN_TERMINAL_SUPABASE_SERVICE_ROLE_KEY
    || process.env.FUMAN_TERMINAL_SUPABASE_KEY
    || process.env.FUMAN_TERMINAL_SUPABASE_ANON_KEY
    || readSecretText(path.join(root, "secrets", "terminal-supabase-key.txt"))
    || readSecretText(path.join(runtime, "secrets", "terminal-supabase-key.txt"))
    || anonKey(options);
}

function terminalSupabaseUrl(options = {}) {
  const root = rootDir(options);
  const runtime = runtimeDir(options);
  return String(
    process.env.FUMAN_TERMINAL_SUPABASE_URL
    || process.env.SUPABASE_URL
    || process.env.FUMAN_SUPABASE_URL
    || readSecretText(path.join(root, "secrets", "terminal-supabase-url.txt"))
    || readSecretText(path.join(runtime, "secrets", "terminal-supabase-url.txt"))
    || readSecretText(path.join(root, "secrets", "supabase-url.txt"))
    || readSecretText(path.join(runtime, "secrets", "supabase-url.txt"))
    || "https://cpmpfhbzutkiecccekfr.supabase.co"
  ).replace(/\/+$/, "");
}

module.exports = {
  anonKey,
  readSecretText,
  serverSupabaseKey,
  serviceRoleKey,
  terminalSupabaseKey,
  terminalSupabaseUrl,
};
