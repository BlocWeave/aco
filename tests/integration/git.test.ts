import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { createGitClient, GitError } from "../../src/integrations/git.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

async function initRepo(dir: string): Promise<void> {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@aco.blocweave.com"', {
    cwd: dir,
    stdio: "pipe",
  });
  execSync('git config user.name "ACO Test"', { cwd: dir, stdio: "pipe" });
}

async function writeAndCommit(
  dir: string,
  filename: string,
  content: string,
  message: string,
): Promise<string> {
  await fs.writeFile(path.join(dir, filename), content, "utf-8");
  execSync(`git add ${filename}`, { cwd: dir, stdio: "pipe" });
  execSync(`git commit -m "${message}"`, { cwd: dir, stdio: "pipe" });
  return execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
}

// ─── Suite ────────────────────────────────────────────────────────────────

describe("GitClient", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aco-git-test-"));
    await initRepo(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── isClean ──────────────────────────────────────────────────────────────

  it("isClean returns true on a fresh empty repo with no changes", async () => {
    // Empty repo (no commits) — git status considers it clean
    const client = createGitClient(tmpDir);
    const clean = await client.isClean();
    expect(clean).toBe(true);
  });

  it("isClean returns true after a commit", async () => {
    await writeAndCommit(tmpDir, "file.txt", "hello", "init");
    const client = createGitClient(tmpDir);
    expect(await client.isClean()).toBe(true);
  });

  it("isClean returns false when there are untracked files", async () => {
    await writeAndCommit(tmpDir, "file.txt", "hello", "init");
    await fs.writeFile(path.join(tmpDir, "dirty.txt"), "unsaved", "utf-8");
    const client = createGitClient(tmpDir);
    expect(await client.isClean()).toBe(false);
  });

  it("isClean returns false when there are staged changes", async () => {
    await writeAndCommit(tmpDir, "file.txt", "hello", "init");
    await fs.writeFile(path.join(tmpDir, "file.txt"), "changed", "utf-8");
    execSync("git add file.txt", { cwd: tmpDir, stdio: "pipe" });
    const client = createGitClient(tmpDir);
    expect(await client.isClean()).toBe(false);
  });

  // ── commit ────────────────────────────────────────────────────────────────

  it("stageFile + commit creates a commit and returns a non-empty hash", async () => {
    await fs.writeFile(
      path.join(tmpDir, "page.tsx"),
      "initial content",
      "utf-8",
    );
    execSync("git add page.tsx", { cwd: tmpDir, stdio: "pipe" });
    execSync('git commit -m "baseline"', { cwd: tmpDir, stdio: "pipe" });

    // Make a change
    await fs.writeFile(
      path.join(tmpDir, "page.tsx"),
      "updated content",
      "utf-8",
    );
    const client = createGitClient(tmpDir);
    await client.stageFile("page.tsx");
    const hash = await client.commit("aco[H01]: test change");

    expect(hash).toBeTruthy();
    expect(hash.length).toBeGreaterThan(6);
  });

  it("getLastCommitHash matches the hash returned by commit", async () => {
    await writeAndCommit(tmpDir, "file.txt", "v1", "first commit");
    const client = createGitClient(tmpDir);
    await fs.writeFile(path.join(tmpDir, "file.txt"), "v2", "utf-8");
    await client.stageFile("file.txt");
    const committedHash = await client.commit("second commit");
    const lastHash = await client.getLastCommitHash();

    // simple-git commit hash may be short; compare by prefix
    expect(
      lastHash.startsWith(committedHash) || committedHash.startsWith(lastHash),
    ).toBe(true);
  });

  // ── readFileAtHead ────────────────────────────────────────────────────────

  it("readFileAtHead returns the committed content of a file", async () => {
    await writeAndCommit(tmpDir, "app.tsx", "committed content", "commit");
    // Modify the file without committing
    await fs.writeFile(
      path.join(tmpDir, "app.tsx"),
      "modified but not committed",
      "utf-8",
    );

    const client = createGitClient(tmpDir);
    const content = await client.readFileAtHead("app.tsx");
    expect(content).toBe("committed content");
  });

  it("readFileAtHead throws GitError for a non-existent file", async () => {
    await writeAndCommit(tmpDir, "file.txt", "init", "commit");
    const client = createGitClient(tmpDir);
    await expect(
      client.readFileAtHead("nonexistent.tsx"),
    ).rejects.toBeInstanceOf(GitError);
  });

  // ── restoreFiles ──────────────────────────────────────────────────────────

  it("restoreFiles reverts a modified file to its last committed state", async () => {
    await writeAndCommit(tmpDir, "page.tsx", "original text", "initial commit");
    await fs.writeFile(path.join(tmpDir, "page.tsx"), "modified text", "utf-8");

    const client = createGitClient(tmpDir);
    await client.restoreFiles(["page.tsx"]);

    const content = await fs.readFile(path.join(tmpDir, "page.tsx"), "utf-8");
    expect(content).toBe("original text");
  });

  // ── revertCommit ──────────────────────────────────────────────────────────

  it("revertCommit creates a new revert commit", async () => {
    await writeAndCommit(tmpDir, "page.tsx", "v1", "initial");
    const changeHash = await writeAndCommit(
      tmpDir,
      "page.tsx",
      "v2",
      "change to revert",
    );

    const client = createGitClient(tmpDir);
    await client.revertCommit(changeHash);

    // File should be back to v1
    const content = await fs.readFile(path.join(tmpDir, "page.tsx"), "utf-8");
    expect(content).toBe("v1");

    // A new commit should have been created (revert commit)
    const log = execSync("git log --oneline", { cwd: tmpDir }).toString();
    expect(log).toContain("Revert");
  });

  // ── currentBranch ─────────────────────────────────────────────────────────

  it("currentBranch returns a non-empty string", async () => {
    await writeAndCommit(tmpDir, "file.txt", "init", "init");
    const client = createGitClient(tmpDir);
    const branch = await client.currentBranch();
    expect(typeof branch).toBe("string");
    expect(branch.length).toBeGreaterThan(0);
  });

  // ── diff ──────────────────────────────────────────────────────────────────

  it("diff returns a non-empty diff string for a commit that changed a file", async () => {
    await writeAndCommit(tmpDir, "page.tsx", "v1", "initial");
    const hash = await writeAndCommit(tmpDir, "page.tsx", "v2", "update");

    const client = createGitClient(tmpDir);
    const diffOutput = await client.diff(hash);
    expect(diffOutput).toContain("-v1");
    expect(diffOutput).toContain("+v2");
  });
});
