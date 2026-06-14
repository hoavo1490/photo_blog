import type { GitHubOAuth, GitHubUser } from '../../src/lib/auth/oauth';

// Reusable fake for tests in the auth phase and later route tests.
//
// By default any code other than 'bad' succeeds and returns a stable
// test user (id=42, login='rio'). Pass `users` to map specific codes to
// specific users; pass `invalidCodes` to make additional codes fail.

export interface FakeOAuthOptions {
  /** Map of code -> user that exchangeCode + fetchUser will return. */
  users?: Record<string, GitHubUser>;
  /** Codes in this set will throw bad_verification_code on exchangeCode. */
  invalidCodes?: Set<string>;
}

const DEFAULT_USER: GitHubUser = {
  id: 42,
  login: 'rio',
  email: 'rio@example.com',
};

export function makeFakeGitHubOAuth(opts: FakeOAuthOptions = {}): GitHubOAuth {
  const userMap = opts.users ?? {};
  const invalid = opts.invalidCodes ?? new Set<string>(['bad']);

  // Maintain a token -> user mapping so fetchUser(token) returns the
  // user that the corresponding code exchanged for. Token format is
  // arbitrary; we use `tok:<code>` for traceability in test failures.
  const tokenToUser = new Map<string, GitHubUser>();

  return {
    authorizeUrl(state: string, redirectUri: string): string {
      const p = new URLSearchParams({
        client_id: 'fake-client',
        redirect_uri: redirectUri,
        scope: 'read:user user:email',
        state,
      });
      return `https://github.com/login/oauth/authorize?${p.toString()}`;
    },

    async exchangeCode(code: string): Promise<string> {
      if (invalid.has(code)) {
        throw new Error('GitHub token exchange failed: bad_verification_code');
      }
      const user = userMap[code] ?? DEFAULT_USER;
      const token = `tok:${code}`;
      tokenToUser.set(token, user);
      return token;
    },

    async fetchUser(accessToken: string): Promise<GitHubUser> {
      const u = tokenToUser.get(accessToken);
      if (!u) {
        throw new Error(`fake oauth: unknown token ${accessToken}`);
      }
      return u;
    },
  };
}
