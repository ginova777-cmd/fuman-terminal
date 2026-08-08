"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EXPECTED_PROJECT_NAME = "fuman-terminal";
const EXPECTED_PROJECT_ID = "prj_x0R2mMFsL0Xto4whcbPTKQTKJRUl";

function verifyProject(project = {}) {
  const issues = [];
  if (project.projectName !== EXPECTED_PROJECT_NAME) {
    issues.push({
      code: "vercel_project_name_mismatch",
      actual: project.projectName || "",
      expected: EXPECTED_PROJECT_NAME,
    });
  }
  if (project.projectId !== EXPECTED_PROJECT_ID) {
    issues.push({
      code: "vercel_project_id_mismatch",
      actual: project.projectId || "",
      expected: EXPECTED_PROJECT_ID,
    });
  }
  if (!project.orgId) {
    issues.push({ code: "vercel_org_id_missing" });
  }
  return {
    ok: issues.length === 0,
    contract: "vercel-production-project-guard-v1",
    projectName: project.projectName || "",
    projectId: project.projectId || "",
    orgId: project.orgId || "",
    expectedProjectName: EXPECTED_PROJECT_NAME,
    expectedProjectId: EXPECTED_PROJECT_ID,
    issues,
  };
}

function runSelfTest() {
  const good = verifyProject({
    projectName: EXPECTED_PROJECT_NAME,
    projectId: EXPECTED_PROJECT_ID,
    orgId: "team-test",
  });
  const wrongName = verifyProject({
    projectName: "dream-release-reconcile-20260808",
    projectId: EXPECTED_PROJECT_ID,
    orgId: "team-test",
  });
  const wrongId = verifyProject({
    projectName: EXPECTED_PROJECT_NAME,
    projectId: "prj_wrong",
    orgId: "team-test",
  });
  const missingOrg = verifyProject({
    projectName: EXPECTED_PROJECT_NAME,
    projectId: EXPECTED_PROJECT_ID,
  });
  const ok = good.ok
    && !wrongName.ok
    && !wrongId.ok
    && !missingOrg.ok
    && wrongName.issues.some((issue) => issue.code === "vercel_project_name_mismatch")
    && wrongId.issues.some((issue) => issue.code === "vercel_project_id_mismatch")
    && missingOrg.issues.some((issue) => issue.code === "vercel_org_id_missing");

  const payload = {
    ok,
    contract: "vercel-production-project-guard-self-test-v1",
    cases: { good, wrongName, wrongId, missingOrg },
  };
  console.log(JSON.stringify(payload, null, 2));
  if (!ok) process.exit(1);
}

function readProjectJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return;
  }

  const projectFile = path.join(ROOT, ".vercel", "project.json");
  let project = {};
  const readIssues = [];
  try {
    project = readProjectJson(projectFile);
  } catch (error) {
    readIssues.push({
      code: "vercel_project_json_unreadable",
      message: error.message,
    });
  }

  const result = verifyProject(project);
  result.projectFile = projectFile;
  result.issues = [...readIssues, ...result.issues];
  result.ok = result.issues.length === 0;
  result.rule = "Production root/readback/deploy work must run only from the official fuman-terminal Vercel project. Wrong project deployments are blocked before production evidence can be trusted.";

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main();
