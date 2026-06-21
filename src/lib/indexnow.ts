// IndexNow protocol — single POST to api.indexnow.org tells Bing,
// Yandex, Seznam, and Naver about a new/changed URL. They index within
// minutes instead of waiting for the next scheduled crawl. Google
// doesn't participate (yet) but a fast index in Bing + Yandex covers a
// real share of search referrals globally.
//
// Enablement: set INDEXNOW_KEY as a Cloudflare secret. The key is any
// 8–128 hex/alphanumeric string. We host it at /indexnow-key.txt for
// the protocol's ownership-verification step.

const ENDPOINT = 'https://api.indexnow.org/IndexNow';

export interface IndexNowEnv {
  INDEXNOW_KEY?: string;
}

/** Submit one or more URLs to IndexNow. Silent no-op when INDEXNOW_KEY
 *  is unset, so unconfigured environments don't fail their save path.
 *  Always fire-and-forget through ctx.waitUntil — the protocol replies
 *  in ~50ms but we shouldn't block save acknowledgement on it. */
export async function pingIndexNow(args: {
  env: IndexNowEnv;
  host: string;
  urls: string[];
}): Promise<void> {
  const key = args.env.INDEXNOW_KEY;
  if (!key || args.urls.length === 0) return;
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: args.host,
        key,
        keyLocation: `https://${args.host}/indexnow-key.txt`,
        urlList: args.urls,
      }),
    });
  } catch {
    // IndexNow is a best-effort SEO booster; an outage on their side
    // mustn't surface as a failed save on our side.
  }
}
