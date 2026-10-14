import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repository = "chigozzdevv/termbook";
const guard = fileURLToPath(new URL("../../../scripts/ci/check-job.sh", import.meta.url));
const trusted = {
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: repository,
  GITHUB_REF: "refs/heads/main",
  GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/test.yml@refs/heads/main`,
  GITHUB_EVENT_NAME: "push",
  GITHUB_JOB: "typescript",
};
const check = (changes: Record<string, string>) => spawnSync("sh", [guard, repository], {
  env: { ...process.env, ...trusted, ...changes }, encoding: "utf8", timeout: 2000,
});

describe("VPS runner admission", () => {
  it.each(["typescript", "evm", "solana"])("accepts the main-branch %s check", (job) => {
    expect(check({ GITHUB_JOB: job }).status).toBe(0);
  });

  it("accepts a manual run against main", () => {
    expect(check({ GITHUB_EVENT_NAME: "workflow_dispatch" }).status).toBe(0);
  });

  it.each([
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_EVENT_NAME: "pull_request_target" },
    { GITHUB_EVENT_NAME: "workflow_run" },
    { GITHUB_EVENT_NAME: "repository_dispatch" },
    { GITHUB_REF: "refs/pull/1/merge" },
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_REPOSITORY: "other/termbook" },
    { GITHUB_SERVER_URL: "https://example.com" },
    { GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/other.yml@refs/heads/main` },
    { GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/test.yml@refs/heads/feature` },
    { GITHUB_EVENT_NAME: "" },
    { GITHUB_JOB: "deploy" },
  ])("rejects an untrusted job: %j", (changes) => {
    const result = check(changes);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("main-branch Tests workflow");
  });
});
