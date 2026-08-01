"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  visibleCredentialState,
  resolveProtectedReadbackCredential,
  protectedReadbackHeaders,
  publicCredentialSummary,
  configuredCredentialFile,
} = require("../lib/protected-readback-credential");

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function baseEnv(root) {
  return {
    FUMAN_RUNTIME_DIR: root,
    FUMAN_PROTECTED_READBACK_TIMEOUT_MS: "1",
    FUMAN_VERIFY_BEARER_TOKEN: "",
    FUMAN_MEMBERSHIP_BEARER_TOKEN: "",
    FUMAN_AUTH_BEARER_TOKEN: "",
    FUMAN_TEST_MEMBER_ACCESS_TOKEN: "",
    FUMAN_SMOKE_BEARER_TOKEN: "",
    FUMAN_TEST_MEMBER_EMAIL: "",
    FUMAN_TEST_MEMBER_PASSWORD: "",
  };
}

function readSecretFree(value) {
  const text = JSON.stringify(value);
  assert(!text.includes("env-token-secret"), "contract leaked env token");
  assert(!text.includes("file-token-secret"), "contract leaked file token");
  assert(!text.includes("fixture-password"), "contract leaked password");
  return value;
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fuman-protected-readback-"));
  const failures = [];
  const checks = [];
  try {
    const verifierText = fs.readFileSync(path.join(__dirname, "verify-protected-readback-credential.js"), "utf8");
    checks.push(readSecretFree({
      name: "verifier_next_actions",
      ok: verifierText.includes("buildNextActions") && (verifierText.includes("install_runtime_credential") || verifierText.includes("setup_runtime_credential_from_any_directory")) && verifierText.includes("verify_runtime_file_created"),
      includesRuntimeFile: /C:\\\\fuman-runtime\\\\secrets\\\\protected-readback-credential\.json/.test(verifierText),
      includesVerifyCommand: verifierText.includes("npm run verify:protected-readback-credential"),
    }));
    assert(verifierText.includes("buildNextActions"), "verifier should expose actionable nextActions");
    assert(verifierText.includes("install_runtime_credential") || verifierText.includes("setup_runtime_credential_from_any_directory"), "verifier should include an install/setup runtime credential action");
    assert(verifierText.includes("verify_runtime_file_created"), "verifier should include runtime file verification action");
    assert(/C:\\\\fuman-runtime\\\\secrets\\\\protected-readback-credential\.json/.test(verifierText), "verifier should include runtime credential file path");
    assert(verifierText.includes("npm run verify:protected-readback-credential"), "verifier should include verify command action");

    const emptyEnv = baseEnv(tmpRoot);
    const emptyCredential = await resolveProtectedReadbackCredential({ env: emptyEnv, timeoutMs: 1 });
    checks.push(readSecretFree({ name: "not_armed", ok: emptyCredential.ok === false, reason: emptyCredential.reason, source: emptyCredential.source }));
    assert(emptyCredential.ok === false, "empty env should not be armed", emptyCredential);
    assert(emptyCredential.reason === "protected_readback_credential_not_armed", "empty env reason mismatch", emptyCredential);
    assert(configuredCredentialFile(emptyEnv).startsWith(tmpRoot), "runtime credential file should follow FUMAN_RUNTIME_DIR");

    const envToken = { ...baseEnv(tmpRoot), FUMAN_VERIFY_BEARER_TOKEN: "env-token-secret" };
    const envCredential = await resolveProtectedReadbackCredential({ env: envToken, timeoutMs: 1 });
    const envSummary = publicCredentialSummary(envCredential);
    const envHeaders = protectedReadbackHeaders(envCredential);
    checks.push(readSecretFree({ name: "env_token", ok: envCredential.ok, source: envCredential.source, summaryReason: envSummary.reason, headerKeys: Object.keys(envHeaders).sort() }));
    assert(envCredential.ok === true && envCredential.enabled === true, "env token should arm credential", envSummary);
    assert(envCredential.source === "FUMAN_VERIFY_BEARER_TOKEN", "env token source mismatch", envCredential);
    assert(envHeaders.authorization === "Bearer env-token-secret", "env authorization header missing");
    assert(envSummary.env.tokenArmed === true && envSummary.env.tokenSource === "FUMAN_VERIFY_BEARER_TOKEN", "env summary token state mismatch", envSummary);

    const fileRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fuman-protected-readback-file-"));
    const fileEnv = baseEnv(fileRoot);
    const secretDir = path.dirname(configuredCredentialFile(fileEnv));
    fs.mkdirSync(secretDir, { recursive: true });
    fs.writeFileSync(configuredCredentialFile(fileEnv), JSON.stringify({ bearerToken: "file-token-secret" }, null, 2));
    const fileCredential = await resolveProtectedReadbackCredential({ env: fileEnv, timeoutMs: 1 });
    const fileState = visibleCredentialState(fileEnv);
    checks.push(readSecretFree({ name: "runtime_file_token", ok: fileCredential.ok, source: fileCredential.source, fileState: fileState.runtimeFile }));
    assert(fileCredential.ok === true && fileCredential.source === "runtime-file-token", "runtime file token should arm credential", publicCredentialSummary(fileCredential));
    assert(fileState.runtimeFile.exists === true && fileState.runtimeFile.hasToken === true, "runtime file visibility mismatch", fileState);

    const emailRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fuman-protected-readback-email-"));
    const emailEnv = baseEnv(emailRoot);
    fs.mkdirSync(path.dirname(configuredCredentialFile(emailEnv)), { recursive: true });
    fs.writeFileSync(configuredCredentialFile(emailEnv), JSON.stringify({ email: "fixture@example.com", password: "fixture-password" }, null, 2));
    const emailState = visibleCredentialState(emailEnv);
    checks.push(readSecretFree({ name: "runtime_file_email_password_state", ok: emailState.emailArmed && emailState.passwordArmed, emailHash: emailState.emailHash, fileState: emailState.runtimeFile }));
    assert(emailState.emailArmed === true && emailState.passwordArmed === true, "runtime email/password state mismatch", emailState);
    assert(emailState.emailHash && !JSON.stringify(emailState).includes("fixture@example.com"), "email should be hashed in public state", emailState);
  } catch (error) {
    failures.push({ message: error.message, details: error.details || {} });
  }

  const payload = {
    ok: failures.length === 0,
    contract: "protected-readback-credential-contract-v1",
    checks,
    failures,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[protected-readback-credential-contract] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});


