// Env-driven tenant config. Phase 1 is single-tenant; in Phase 2 the per-tenant
// lookup moves to a D1 query keyed by session.userLogin or hostname.

export interface TenantConfig {
  owner: string;
  repo: string;
  branch: string;
  contentPath: string;
  mediaPath: string;
}

export function tenant(env: Record<string, string | undefined>): TenantConfig {
  return {
    owner: required(env, 'GITHUB_OWNER'),
    repo: required(env, 'GITHUB_REPO'),
    branch: env.GITHUB_BRANCH || 'main',
    contentPath: env.CONTENT_PATH || 'src/content/posts',
    mediaPath: env.MEDIA_PATH || 'public/media/files',
  };
}

export function oauth(env: Record<string, string | undefined>) {
  return {
    clientId: required(env, 'GITHUB_OAUTH_CLIENT_ID'),
    clientSecret: required(env, 'GITHUB_OAUTH_CLIENT_SECRET'),
    allowedUsers: (env.ALLOWED_USERS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    sessionSecret: required(env, 'SESSION_SECRET'),
    cookieDomain: env.COOKIE_DOMAIN || undefined,
  };
}

function required(env: Record<string, string | undefined>, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}
