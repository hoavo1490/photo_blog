import type { GitHubOAuth } from './oauth';
import type { SqlDriver } from '../db/driver';
import * as users from '../db/users';
import * as sessions from '../db/sessions';

// Thin orchestrator: composes oauth + db/users + db/sessions. Routes
// import this; tests verify the full happy path against PGLite + fake
// OAuth.
//
// Allowlist: empty array => allow anyone (lets us run open-registration
// in dev / tests). Production passes a curated lowercase list.

const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 86_400 * 1000;

export interface CompleteLoginInput {
  code: string;
  redirectUri: string;
  userAgent: string | null;
}

export interface CompleteLoginResult {
  sessionId: string;
  expiresAt: Date;
  userId: string;
}

/** Exchange the OAuth code, upsert the user, create a session.
 *  Throws if OAuth fails or if the GitHub user's login is not in the allowlist. */
export async function completeLogin(
  driver: SqlDriver,
  oauth: GitHubOAuth,
  allowedLogins: string[],
  input: CompleteLoginInput,
): Promise<CompleteLoginResult> {
  const token = await oauth.exchangeCode(input.code, input.redirectUri);
  const ghUser = await oauth.fetchUser(token);

  if (allowedLogins.length > 0) {
    const lower = ghUser.login.toLowerCase();
    const ok = allowedLogins.some((l) => l.toLowerCase() === lower);
    if (!ok) {
      throw new Error(`user not allowed: ${ghUser.login}`);
    }
  }

  const user = await users.upsertByGithubId(driver, {
    githubId: ghUser.id,
    githubLogin: ghUser.login,
    email: ghUser.email,
  });

  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const session = await sessions.create(driver, {
    userId: user.id,
    expiresAt,
    userAgent: input.userAgent,
  });

  return {
    sessionId: session.id,
    expiresAt: session.expiresAt,
    userId: user.id,
  };
}

/** Look up the active session and the user it belongs to.
 *  Returns null if cookie missing, malformed, expired, or revoked. */
export async function loadSession(
  driver: SqlDriver,
  sessionId: string,
): Promise<{ sessionId: string; userId: string; githubLogin: string } | null> {
  const session = await sessions.findActive(driver, sessionId);
  if (!session) return null;

  const user = await users.findById(driver, session.userId);
  if (!user) return null;

  // Fire-and-forget: refreshing last_used_at is best-effort and must
  // not block the response. We swallow errors deliberately -- a touch
  // failure does not invalidate the session.
  void sessions.touch(driver, sessionId).catch(() => {});

  return {
    sessionId: session.id,
    userId: user.id,
    githubLogin: user.githubLogin,
  };
}
