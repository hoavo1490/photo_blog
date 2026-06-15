// GitHub OAuth as an interface so route handlers and the login flow stay
// testable without HTTP mocking. The production impl talks to github.com
// and api.github.com; tests inject a hand-rolled fake (see
// tests/fakes/github-oauth.ts).
//
// Scope is `read:user user:email` -- explicitly narrower than the old
// editor's `repo` scope. We only need identity + email; we don't touch
// the user's repos.

export interface GitHubUser {
  /** Numeric GitHub user id. Immutable -- this is THE identity key. */
  id: number;
  /** Current GitHub username. Denormalized in the users table. May change. */
  login: string;
  /** Primary verified email, or null when the user has none. */
  email: string | null;
}

export interface GitHubOAuth {
  /** Returns the URL to redirect the browser to (initiates the OAuth dance). */
  authorizeUrl(state: string, redirectUri: string): string;

  /** Exchange a one-shot ?code= for an access_token. Throws on GitHub failure. */
  exchangeCode(code: string, redirectUri: string): Promise<string>;

  /** Fetch the authenticated user's id/login/email using the access token.
   *  Picks the primary verified email if multiple are returned. */
  fetchUser(accessToken: string): Promise<GitHubUser>;
}

export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
  /** Optional fetch override -- production passes globalThis.fetch; tests inject. */
  fetchImpl?: typeof fetch;
}

const SCOPE = 'read:user user:email';
const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API_USER_URL = 'https://api.github.com/user';
const API_EMAILS_URL = 'https://api.github.com/user/emails';
// GitHub requires a User-Agent header on all API requests.
const USER_AGENT = 'hoavv-blog (+https://hoavv.com)';

interface GhUserResponse {
  id: number;
  login: string;
  email?: string | null;
}

interface GhEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

interface GhTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** Production implementation that talks to github.com / api.github.com. */
export function createGitHubOAuth(config: GitHubOAuthConfig): GitHubOAuth {
  const fetchImpl: typeof fetch = config.fetchImpl ?? globalThis.fetch.bind(globalThis);

  return {
    authorizeUrl(state: string, redirectUri: string): string {
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        scope: SCOPE,
        state,
      });
      return `${AUTHORIZE_URL}?${params.toString()}`;
    },

    async exchangeCode(code: string, redirectUri: string): Promise<string> {
      const res = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });

      if (!res.ok) {
        throw new Error(`GitHub token exchange failed: HTTP ${res.status}`);
      }

      const body = (await res.json()) as GhTokenResponse;
      if (body.error || !body.access_token) {
        const detail = body.error_description ?? body.error ?? 'no access_token in response';
        throw new Error(`GitHub token exchange failed: ${detail}`);
      }
      return body.access_token;
    },

    async fetchUser(accessToken: string): Promise<GitHubUser> {
      const headers = {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': USER_AGENT,
      };

      const userRes = await fetchImpl(API_USER_URL, { headers });
      if (!userRes.ok) {
        throw new Error(`GitHub /user failed: HTTP ${userRes.status}`);
      }
      const user = (await userRes.json()) as GhUserResponse;

      const emailsRes = await fetchImpl(API_EMAILS_URL, { headers });
      if (!emailsRes.ok) {
        throw new Error(`GitHub /user/emails failed: HTTP ${emailsRes.status}`);
      }
      const emails = (await emailsRes.json()) as GhEmail[];
      const primary = emails.find((e) => e.primary && e.verified);

      return {
        id: user.id,
        login: user.login,
        email: primary?.email ?? null,
      };
    },
  };
}
