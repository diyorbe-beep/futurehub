import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';

export function resolveSafe(root: string, relPath: string): string | null {
  const rootR = resolve(root);
  const abs = resolve(rootR, normalize(relPath));
  const rel = relative(rootR, abs);

  if (rel.startsWith('..') || rel.startsWith('/') || rel === '') {
    return null;
  }

  if (abs !== rootR && !abs.startsWith(rootR + sep)) {
    return null;
  }

  return abs;
}

export async function readFileSafe(root: string, relPath: string): Promise<string | null> {
  const abs = resolveSafe(root, relPath);

  if (!abs) {
    return null;
  }

  try {
    const s = await stat(abs);

    if (!s.isFile()) {
      return null;
    }

    const buf = await readFile(abs, 'utf8');

    return buf.slice(0, 200_000);
  } catch {
    return null;
  }
}

export async function writeFileSafe(root: string, relPath: string, content: string): Promise<boolean> {
  const abs = resolveSafe(root, relPath);

  if (!abs) {
    return false;
  }

  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');

  return true;
}

export async function deleteFileSafe(root: string, relPath: string): Promise<boolean> {
  const abs = resolveSafe(root, relPath);

  if (!abs) {
    return false;
  }

  try {
    await unlink(abs);

    return true;
  } catch {
    return false;
  }
}

export async function listTreeSnippet(root: string, maxFiles = 80): Promise<string> {
  const out: string[] = [];

  async function walk(dir: string, depth: number) {
    if (out.length >= maxFiles || depth > 4) {
      return;
    }

    let entries: string[];

    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    for (const name of entries.sort()) {
      if (name === 'node_modules' || name === '.git' || name === 'dist' || name === 'build') {
        continue;
      }

      const p = join(dir, name);

      let st;

      try {
        st = await stat(p);
      } catch {
        continue;
      }

      const rel = relative(root, p);

      if (st.isDirectory()) {
        out.push(`${rel}/`);
        await walk(p, depth + 1);
      } else {
        out.push(rel);
      }

      if (out.length >= maxFiles) {
        return;
      }
    }
  }

  await walk(root, 0);

  return out.join('\n');
}
