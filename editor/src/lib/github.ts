import { Octokit } from '@octokit/rest';
import type { TenantConfig } from './config';

export function client(token: string): Octokit {
  return new Octokit({ auth: token, userAgent: 'riovv-editor' });
}

export interface PostFile {
  name: string;          // filename, e.g. 2026-06-14-hello.md
  path: string;          // full path in repo
  sha: string;           // file SHA for updates
  size: number;
}

export async function listPosts(token: string, t: TenantConfig): Promise<PostFile[]> {
  const gh = client(token);
  try {
    const r = await gh.repos.getContent({
      owner: t.owner,
      repo: t.repo,
      path: t.contentPath,
      ref: t.branch,
    });
    const arr = Array.isArray(r.data) ? r.data : [];
    return arr
      .filter((f) => f.type === 'file' && /\.md$/i.test(f.name))
      .map((f) => ({ name: f.name, path: f.path, sha: f.sha, size: f.size }))
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch (err: any) {
    if (err.status === 404) return [];
    throw err;
  }
}

export async function readPost(
  token: string,
  t: TenantConfig,
  filename: string,
): Promise<{ content: string; sha: string } | null> {
  const gh = client(token);
  try {
    const r = await gh.repos.getContent({
      owner: t.owner,
      repo: t.repo,
      path: `${t.contentPath}/${filename}`,
      ref: t.branch,
    });
    if (Array.isArray(r.data) || r.data.type !== 'file') return null;
    const content = atob((r.data as any).content.replace(/\n/g, ''));
    return { content: utf8Decode(content), sha: r.data.sha };
  } catch (err: any) {
    if (err.status === 404) return null;
    throw err;
  }
}

export async function writePost(
  token: string,
  t: TenantConfig,
  filename: string,
  content: string,
  sha: string | undefined,
  message: string,
): Promise<{ sha: string }> {
  const gh = client(token);
  const r = await gh.repos.createOrUpdateFileContents({
    owner: t.owner,
    repo: t.repo,
    path: `${t.contentPath}/${filename}`,
    branch: t.branch,
    message,
    content: utf8Encode(content),
    sha,
  });
  return { sha: r.data.content!.sha! };
}

export async function deletePost(
  token: string,
  t: TenantConfig,
  filename: string,
  sha: string,
  message: string,
): Promise<void> {
  const gh = client(token);
  await gh.repos.deleteFile({
    owner: t.owner,
    repo: t.repo,
    path: `${t.contentPath}/${filename}`,
    branch: t.branch,
    message,
    sha,
  });
}

export async function writeImage(
  token: string,
  t: TenantConfig,
  filename: string,
  base64Content: string,
  message: string,
): Promise<{ url: string }> {
  const date = new Date();
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');

  // Append a short timestamp suffix so uploads never collide with existing
  // files. Camera defaults (IMG_4521.jpg, screenshot.png) and shared author
  // workflows in the future SaaS scenario make collisions otherwise common.
  // GitHub's create-or-update API requires the existing file's sha for
  // overwrites, and silent overwrite would break older posts referencing
  // the same path. A unique path is the right invariant.
  const stamp = Date.now().toString(36).slice(-5);
  const ext = filename.match(/\.[^.]+$/)?.[0] ?? '';
  const base = filename.replace(/\.[^.]+$/, '');
  const stampedName = `${base}-${stamp}${ext}`;

  const path = `${t.mediaPath}/${y}/${m}/${d}/${stampedName}`;
  const gh = client(token);
  await gh.repos.createOrUpdateFileContents({
    owner: t.owner,
    repo: t.repo,
    path,
    branch: t.branch,
    message,
    content: base64Content,
  });
  // Public URL relative to the blog site root.
  const publicPath = path.replace(/^public\//, '/');
  return { url: publicPath };
}

// Astro/Workers runtime exposes btoa/atob natively. Use them with explicit UTF-8 handling.
function utf8Encode(s: string): string {
  // string -> UTF-8 bytes -> base64
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function utf8Decode(b: string): string {
  // base64 -> latin1 string -> UTF-8 bytes -> string
  const bytes = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
