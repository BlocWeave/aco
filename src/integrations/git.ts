import simpleGit, { type SimpleGit } from 'simple-git'
import * as path from 'node:path'

// ─── Error types ──────────────────────────────────────────────────────────

export type GitErrorCode =
  | 'NOT_A_REPO'
  | 'DIRTY_WORKING_TREE'
  | 'COMMIT_FAILED'
  | 'REVERT_FAILED'
  | 'FILE_NOT_FOUND'
  | 'GIT_ERROR'

export class GitError extends Error {
  constructor(
    message: string,
    readonly code: GitErrorCode
  ) {
    super(message)
    this.name = 'GitError'
  }
}

// ─── GitClient interface ──────────────────────────────────────────────────

export interface GitClient {
  readonly repoDir: string
  isClean(): Promise<boolean>
  changedPaths(): Promise<string[]>
  currentBranch(): Promise<string>
  stageFile(filePath: string): Promise<void>
  commit(message: string): Promise<string>
  revertCommit(hash: string): Promise<void>
  getLastCommitHash(): Promise<string>
  readFileAtHead(relPath: string): Promise<string>
  diff(hash: string): Promise<string>
  restoreFiles(filePaths: string[]): Promise<void>
}

// ─── Implementation ───────────────────────────────────────────────────────

class GitClientImpl implements GitClient {
  readonly repoDir: string
  private _git: SimpleGit

  constructor(repoDir: string) {
    this.repoDir = repoDir
    this._git = simpleGit({ baseDir: repoDir, binary: 'git', maxConcurrentProcesses: 1 })
  }

  async isClean(): Promise<boolean> {
    try {
      const status = await this._git.status()
      return status.isClean()
    } catch (err) {
      throw wrapGitError(err, 'GIT_ERROR')
    }
  }

  async changedPaths(): Promise<string[]> {
    try {
      const status = await this._git.status()
      return status.files.map(file => file.path)
    } catch (err) {
      throw wrapGitError(err, 'GIT_ERROR')
    }
  }

  async currentBranch(): Promise<string> {
    try {
      const status = await this._git.status()
      return status.current ?? 'HEAD'
    } catch (err) {
      throw wrapGitError(err, 'GIT_ERROR')
    }
  }

  async stageFile(filePath: string): Promise<void> {
    try {
      const absPath = path.isAbsolute(filePath) ? filePath : path.join(this.repoDir, filePath)
      await this._git.add(absPath)
    } catch (err) {
      throw wrapGitError(err, 'GIT_ERROR')
    }
  }

  async commit(message: string): Promise<string> {
    try {
      const result = await this._git.commit(message)
      if (!result.commit) {
        throw new GitError('Commit produced no hash — nothing was staged?', 'COMMIT_FAILED')
      }
      return result.commit
    } catch (err) {
      if (err instanceof GitError) throw err
      throw wrapGitError(err, 'COMMIT_FAILED')
    }
  }

  async revertCommit(hash: string): Promise<void> {
    // Validate hash format before passing to git — prevents injection if hash
    // ever originates from user input or an untrusted source.
    if (!/^[0-9a-f]{7,40}$/i.test(hash)) {
      throw new GitError(`Invalid commit hash: "${hash}"`, 'REVERT_FAILED')
    }
    try {
      // --no-edit: don't open editor; produces a new revert commit automatically
      await this._git.raw(['revert', '--no-edit', hash])
    } catch (err) {
      throw wrapGitError(err, 'REVERT_FAILED')
    }
  }

  async getLastCommitHash(): Promise<string> {
    try {
      const log = await this._git.log({ maxCount: 1 })
      const hash = log.latest?.hash
      if (!hash) throw new GitError('No commits found in this repository', 'GIT_ERROR')
      return hash
    } catch (err) {
      if (err instanceof GitError) throw err
      throw wrapGitError(err, 'GIT_ERROR')
    }
  }

  async readFileAtHead(relPath: string): Promise<string> {
    try {
      return await this._git.show([`HEAD:${relPath}`])
    } catch (err) {
      throw wrapGitError(err, 'FILE_NOT_FOUND')
    }
  }

  async diff(hash: string): Promise<string> {
    try {
      return await this._git.diff([`${hash}^..${hash}`])
    } catch (err) {
      throw wrapGitError(err, 'GIT_ERROR')
    }
  }

  async restoreFiles(filePaths: string[]): Promise<void> {
    try {
      for (const fp of filePaths) {
        const absPath = path.isAbsolute(fp) ? fp : path.join(this.repoDir, fp)
        await this._git.checkout(['--', absPath])
      }
    } catch (err) {
      throw wrapGitError(err, 'GIT_ERROR')
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────

export function createGitClient(repoDir: string): GitClient {
  return new GitClientImpl(repoDir)
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function wrapGitError(err: unknown, code: GitErrorCode): GitError {
  const message = err instanceof Error ? err.message : String(err)

  if (message.includes('not a git repository')) {
    return new GitError(`Not a git repository: ${message}`, 'NOT_A_REPO')
  }

  return new GitError(message, code)
}
