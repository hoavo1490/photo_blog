import { describe, it, expect } from 'vitest';
import { createGitHubOAuth } from './oauth';

// Hand-rolled fake fetch: route by (method, url-without-query) tuple.
// Simpler than msw and keeps assertions visible right in the test.

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

interface Route {
  status?: number;
  json?: unknown;
}

function makeFetch(routes: Record<string, Route | ((req: Request) => Route)>, calls: RecordedCall[]): typeof fetch {
  return async (input: Request | string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const headersInit = init?.headers ?? (input instanceof Request ? input.headers : undefined);
    const headers: Record<string, string> = {};
    if (headersInit) {
      const h = new Headers(headersInit);
      h.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
    }
    const body = typeof init?.body === 'string' ? init.body : null;
    calls.push({ url, method, headers, body });

    // Route by url-without-query.
    const noQuery = url.split('?')[0];
    const key = `${method} ${noQuery}`;
    const handler = routes[key];
    if (!handler) {
      return new Response(`unrouted: ${key}`, { status: 599 });
    }
    const route = typeof handler === 'function' ? handler(input instanceof Request ? input : new Request(url, init)) : handler;
    return new Response(route.json !== undefined ? JSON.stringify(route.json) : '', {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

const cfg = (fetchImpl: typeof fetch) => ({
  clientId: 'abc123',
  clientSecret: 'shh',
  fetchImpl,
});

describe('authorizeUrl', () => {
  it('builds URL with scope, state, redirect_uri, client_id', () => {
    const oauth = createGitHubOAuth(cfg(makeFetch({}, [])));
    const url = oauth.authorizeUrl('xyz', 'https://app.example.com/cb');
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('abc123');
    expect(parsed.searchParams.get('scope')).toBe('read:user user:email');
    expect(parsed.searchParams.get('state')).toBe('xyz');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.example.com/cb');
  });

  it('URL-encodes special characters in state and redirectUri', () => {
    const oauth = createGitHubOAuth(cfg(makeFetch({}, [])));
    const url = oauth.authorizeUrl('a b&c=d', 'https://app.example.com/cb?next=/a b');
    // URLSearchParams encoding: space => '+', '&' => %26, '=' => %3D.
    expect(url).toContain('state=a+b%26c%3Dd');
    expect(url).toContain('redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb%3Fnext%3D%2Fa+b');
  });
});

describe('exchangeCode', () => {
  it('posts to the token endpoint and returns the access_token', async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = makeFetch(
      {
        'POST https://github.com/login/oauth/access_token': { json: { access_token: 'gho_abc', token_type: 'bearer' } },
      },
      calls,
    );
    const oauth = createGitHubOAuth(cfg(fetchImpl));
    const token = await oauth.exchangeCode('the-code', 'https://app/cb');
    expect(token).toBe('gho_abc');
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['accept']).toBe('application/json');
    expect(calls[0].headers['user-agent']).toMatch(/hoavv/i);
    const sent = JSON.parse(calls[0].body!);
    expect(sent).toEqual({
      client_id: 'abc123',
      client_secret: 'shh',
      code: 'the-code',
      redirect_uri: 'https://app/cb',
    });
  });

  it("throws with 'bad_verification_code' included when GitHub returns that error", async () => {
    const fetchImpl = makeFetch(
      {
        'POST https://github.com/login/oauth/access_token': {
          json: { error: 'bad_verification_code', error_description: 'The code is invalid.' },
        },
      },
      [],
    );
    const oauth = createGitHubOAuth(cfg(fetchImpl));
    await expect(oauth.exchangeCode('bad', 'https://app/cb')).rejects.toThrow(/bad_verification_code|invalid/);
  });

  it('throws on HTTP 5xx', async () => {
    const fetchImpl = makeFetch(
      {
        'POST https://github.com/login/oauth/access_token': { status: 502 },
      },
      [],
    );
    const oauth = createGitHubOAuth(cfg(fetchImpl));
    await expect(oauth.exchangeCode('x', 'https://app/cb')).rejects.toThrow(/502/);
  });
});

describe('fetchUser', () => {
  it('returns id/login and the primary+verified email', async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = makeFetch(
      {
        'GET https://api.github.com/user': { json: { id: 42, login: 'rio', email: null } },
        'GET https://api.github.com/user/emails': {
          json: [
            { email: 'noise@example.com', primary: false, verified: true },
            { email: 'rio@example.com', primary: true, verified: true },
            { email: 'unverified@example.com', primary: false, verified: false },
          ],
        },
      },
      calls,
    );
    const oauth = createGitHubOAuth(cfg(fetchImpl));
    const user = await oauth.fetchUser('gho_xyz');
    expect(user).toEqual({ id: 42, login: 'rio', email: 'rio@example.com' });
    // Headers on both calls.
    for (const c of calls) {
      expect(c.headers['authorization']).toBe('Bearer gho_xyz');
      expect(c.headers['user-agent']).toMatch(/hoavv/i);
    }
  });

  it('returns email=null when no primary+verified email exists', async () => {
    const fetchImpl = makeFetch(
      {
        'GET https://api.github.com/user': { json: { id: 7, login: 'ghost' } },
        'GET https://api.github.com/user/emails': {
          json: [
            { email: 'primary-but-unverified@example.com', primary: true, verified: false },
            { email: 'verified-but-not-primary@example.com', primary: false, verified: true },
          ],
        },
      },
      [],
    );
    const oauth = createGitHubOAuth(cfg(fetchImpl));
    const user = await oauth.fetchUser('gho_xyz');
    expect(user).toEqual({ id: 7, login: 'ghost', email: null });
  });

  it('throws on 401', async () => {
    const fetchImpl = makeFetch(
      {
        'GET https://api.github.com/user': { status: 401 },
      },
      [],
    );
    const oauth = createGitHubOAuth(cfg(fetchImpl));
    await expect(oauth.fetchUser('bad-token')).rejects.toThrow(/401/);
  });

  it('sends User-Agent and Authorization headers on both /user and /user/emails', async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = makeFetch(
      {
        'GET https://api.github.com/user': { json: { id: 1, login: 'a' } },
        'GET https://api.github.com/user/emails': { json: [] },
      },
      calls,
    );
    const oauth = createGitHubOAuth(cfg(fetchImpl));
    await oauth.fetchUser('tok');
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.github.com/user',
      'https://api.github.com/user/emails',
    ]);
    for (const c of calls) {
      expect(c.headers['user-agent']).toBeTruthy();
      expect(c.headers['authorization']).toBe('Bearer tok');
    }
  });
});
