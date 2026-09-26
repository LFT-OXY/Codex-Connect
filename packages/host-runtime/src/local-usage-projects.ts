import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Where a working directory's Git configuration lives, if it is inside a repository, and the
 * repository's own folder: a linked worktree names its main repository.
 */
async function gitRepository(cwd: string): Promise<{ folder: string; config: string } | null> {
  for (let directory = path.resolve(cwd); ; directory = path.dirname(directory)) {
    const dotGit = path.join(directory, ".git");
    const metadata = await stat(dotGit).catch(() => null);
    if (metadata?.isDirectory()) {
      return { folder: path.basename(directory), config: path.join(dotGit, "config") };
    }
    if (metadata?.isFile()) {
      // Linked worktrees and submodules point at their Git directory; worktrees share the
      // main repository's configuration through `commondir`.
      const pointer = /^gitdir:\s*(.+?)\s*$/mu.exec(await readFile(dotGit, "utf8"))?.[1];
      if (!pointer) return null;
      const gitDirectory = path.resolve(directory, pointer);
      const common = await readFile(path.join(gitDirectory, "commondir"), "utf8").catch(() => null);
      if (!common) {
        return { folder: path.basename(directory), config: path.join(gitDirectory, "config") };
      }
      const commonDirectory = path.resolve(gitDirectory, common.trim());
      return {
        // `<repo>/.git` of a regular repository, or `<repo>.git` of a bare one.
        folder:
          path.basename(commonDirectory) === ".git"
            ? path.basename(path.dirname(commonDirectory))
            : path.basename(commonDirectory).replace(/\.git$/iu, ""),
        config: path.join(commonDirectory, "config"),
      };
    }
    if (path.dirname(directory) === directory) return null;
  }
}

/** Remote URLs by remote name, in file order. */
function remoteUrls(config: string): Map<string, string> {
  const urls = new Map<string, string>();
  let remote: string | null = null;
  for (const raw of config.split(/\r?\n/u)) {
    const line = raw.trim();
    const section = /^\[\s*([^\s\]"]+)(?:\s+"(.*)")?\s*\]/u.exec(line);
    if (section) {
      remote = section[1]?.toLowerCase() === "remote" ? (section[2] ?? null) : null;
      continue;
    }
    const url = /^url\s*=\s*(.*)$/iu.exec(line)?.[1];
    if (remote !== null && url && !urls.has(remote)) {
      urls.set(remote, url.replace(/^"(.*)"$/u, "$1").trim());
    }
  }
  return urls;
}

/**
 * `owner/repo` — the last two path segments — from a remote such as
 * `git@github.com:owner/repo.git` or `https://gitlab.com/group/owner/repo`; null for local
 * paths and unrecognized forms.
 */
function ownerRepository(url: string): string | null {
  let location: string | undefined;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//iu.exec(url);
  if (scheme) {
    if (/^file:/iu.test(url)) return null;
    try {
      location = new URL(url).pathname;
    } catch {
      return null;
    }
  } else {
    // scp-like `user@host:path`; a single letter before the colon is a Windows drive.
    location = /^(?:[^@/\\]+@)?[^/\\:]{2,}:(.+)$/u.exec(url)?.[1];
  }
  const [owner, repository] = (location ?? "").split("/").filter(Boolean).slice(-2);
  const name = repository?.replace(/\.git$/iu, "");
  return owner && name ? `${owner}/${name}` : null;
}

async function projectName(cwd: string): Promise<string> {
  const repository = await gitRepository(cwd).catch(() => null);
  if (repository) {
    const urls = remoteUrls(await readFile(repository.config, "utf8").catch(() => ""));
    const url = urls.get("origin") ?? urls.values().next().value;
    const hosted = url ? ownerRepository(url) : null;
    if (hosted) return hosted;
  }
  const resolved = path.resolve(cwd);
  // A filesystem root has no folder name; its root is not a private path.
  return repository?.folder || path.basename(resolved) || path.parse(resolved).root;
}

/** Resolves project names for working directories, caching each directory's result. */
export function createProjectResolver(): (cwd: string) => Promise<string> {
  const cache = new Map<string, Promise<string>>();
  return (cwd) => {
    let name = cache.get(cwd);
    if (!name) {
      name = projectName(cwd);
      cache.set(cwd, name);
    }
    return name;
  };
}
