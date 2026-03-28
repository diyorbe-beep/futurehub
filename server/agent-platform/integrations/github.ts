import { Octokit } from '@octokit/rest';
import { GITHUB_TOKEN } from '../config.ts';

export function getOctokit(): Octokit | null {
  if (!GITHUB_TOKEN) {
    return null;
  }

  return new Octokit({ auth: GITHUB_TOKEN });
}

/** Push a single file to a branch (create blob + update tree + create commit). */
export async function pushFileToRepo(input: {
  owner: string;
  repo: string;
  path: string;
  content: string;
  message: string;
  branch?: string;
}): Promise<{ sha: string; url: string } | { error: string }> {
  const octo = getOctokit();

  if (!octo) {
    return { error: 'GITHUB_TOKEN not configured' };
  }

  const branch = input.branch ?? 'main';

  try {
    const ref = await octo.git.getRef({ owner: input.owner, repo: input.repo, ref: `heads/${branch}` });
    const baseSha = ref.data.object.sha;
    const baseCommit = await octo.git.getCommit({ owner: input.owner, repo: input.repo, commit_sha: baseSha });
    const treeSha = baseCommit.data.tree.sha;
    const blob = await octo.git.createBlob({
      owner: input.owner,
      repo: input.repo,
      content: Buffer.from(input.content, 'utf8').toString('base64'),
      encoding: 'base64',
    });
    const tree = await octo.git.createTree({
      owner: input.owner,
      repo: input.repo,
      base_tree: treeSha,
      tree: [{ path: input.path, mode: '100644', type: 'blob', sha: blob.data.sha }],
    });
    const commit = await octo.git.createCommit({
      owner: input.owner,
      repo: input.repo,
      message: input.message,
      tree: tree.data.sha,
      parents: [baseSha],
    });
    await octo.git.updateRef({
      owner: input.owner,
      repo: input.repo,
      ref: `heads/${branch}`,
      sha: commit.data.sha,
    });

    return {
      sha: commit.data.sha,
      url: `https://github.com/${input.owner}/${input.repo}/commit/${commit.data.sha}`,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);

    return { error: msg };
  }
}
