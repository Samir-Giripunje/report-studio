import { execFileSync } from "node:child_process";

function parseArgs(argv) {
  let branch = "main";
  let dryRun = false;
  let help = false;
  const checks = [];
  let repo = resolveRepoFromGitRemote();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }

    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (argument === "--branch") {
      branch = readRequiredValue(argv, index, "--branch");
      index += 1;
      continue;
    }

    if (argument === "--repo") {
      repo = readRequiredValue(argv, index, "--repo");
      index += 1;
      continue;
    }

    if (argument === "--check") {
      checks.push(readRequiredValue(argv, index, "--check"));
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return { branch, dryRun, help, checks, repo };
}

function readRequiredValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function resolveRepoFromGitRemote() {
  const remoteUrl = execFileSync("git", ["remote", "get-url", "origin"], {
    encoding: "utf8",
  }).trim();
  const normalizedUrl = remoteUrl.replace(/\.git$/u, "");

  const httpsMatch = normalizedUrl.match(/^https:\/\/github\.com\/(?<repo>[^/]+\/[^/]+)$/u);
  if (httpsMatch?.groups?.repo) {
    return httpsMatch.groups.repo;
  }

  const sshMatch = normalizedUrl.match(/^git@github\.com:(?<repo>[^/]+\/[^/]+)$/u);
  if (sshMatch?.groups?.repo) {
    return sshMatch.groups.repo;
  }

  throw new Error(`Could not parse GitHub repository from origin remote: ${remoteUrl}`);
}

function buildProtectionPayload(checks) {
  const requiredStatusChecks =
    checks.length > 0
      ? {
          strict: true,
          contexts: checks,
        }
      : null;

  return {
    required_status_checks: requiredStatusChecks,
    enforce_admins: true,
    required_pull_request_reviews: {
      dismiss_stale_reviews: false,
      require_code_owner_reviews: false,
      required_approving_review_count: 0,
      require_last_push_approval: false,
    },
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
  };
}

function runGhApi(args, input) {
  return execFileSync("gh", ["api", ...args], {
    encoding: "utf8",
    input,
    stdio: input ? ["pipe", "pipe", "inherit"] : ["ignore", "pipe", "inherit"],
  }).trim();
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(
      [
        'Usage: bun run github:protect-main -- [--repo owner/name] [--branch main] [--check "Branch Naming Policy"] [--dry-run]',
        "",
        "Run once with --dry-run to inspect the payload.",
        "Add one or more --check values after the required workflow is present on the protected branch.",
      ].join("\n"),
    );
    return;
  }

  const payload = buildProtectionPayload(options.checks);
  const endpoint = `repos/${options.repo}/branches/${options.branch}/protection`;
  const payloadJson = JSON.stringify(payload, null, 2);

  console.log(`Configuring branch protection for ${options.repo} on ${options.branch}.`);
  console.log(payloadJson);

  if (options.dryRun) {
    return;
  }

  runGhApi(
    ["--method", "PUT", "-H", "Accept: application/vnd.github+json", endpoint, "--input", "-"],
    payloadJson,
  );

  const appliedProtection = runGhApi(["-H", "Accept: application/vnd.github+json", endpoint]);

  console.log("Applied branch protection:");
  console.log(appliedProtection);
}

main();
