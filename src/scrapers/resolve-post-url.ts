// Apify's LinkedIn actor only accepts a canonical linkedin.com/posts/... or
// linkedin.com/feed/update/... permalink — it does not follow redirects
// itself. Users routinely paste share links instead (lnkd.in, LinkedIn's own
// shortener; possibly others), so those need resolving to their final
// linkedin.com URL before ever reaching the scraper.

const LINKEDIN_HOST_PATTERN = /(^|\.)linkedin\.com$/i;
const RESOLVE_TIMEOUT_MS = 8000;

// Some redirect services 405 on HEAD; a plain browser UA avoids bot-block
// responses that a bare fetch's default UA can trigger on either hop.
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function isLinkedInHost(url: string): boolean {
  try {
    return LINKEDIN_HOST_PATTERN.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function followRedirect(url: string, method: 'HEAD' | 'GET'): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': BROWSER_USER_AGENT },
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Resolves a pasted URL to a canonical linkedin.com post permalink.
 *
 * Already-canonical linkedin.com URLs are returned unchanged — zero extra
 * network calls, and no risk of a direct fetch to linkedin.com itself
 * hitting a login wall. Only a non-linkedin.com host (a shortener) pays for
 * a resolution request, via HEAD first and falling back to GET for any
 * shortener that rejects HEAD.
 *
 * Throws with a user-facing message on invalid input, a request that never
 * reaches a linkedin.com host, or a timeout — the route turns these into a
 * 400 rather than wasting an Apify call on a URL that was never going to work.
 */
export async function resolvePostUrl(rawUrl: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }

  if (LINKEDIN_HOST_PATTERN.test(parsed.hostname)) return rawUrl;

  try {
    let response = await followRedirect(rawUrl, 'HEAD');
    if (response.status === 405 || response.status === 501) {
      response = await followRedirect(rawUrl, 'GET');
      // We only need the final URL, not the page body — cancelling frees the
      // connection immediately instead of streaming a full LinkedIn page.
      response.body?.cancel().catch(() => {});
    }

    if (!response.ok) {
      throw new Error(`This link returned an unexpected response (${response.status}).`);
    }
    if (!isLinkedInHost(response.url)) {
      throw new Error('This link does not resolve to a LinkedIn post.');
    }
    return response.url;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error('Timed out resolving this link. Try pasting the full linkedin.com post URL instead.');
    }
    throw error instanceof Error ? error : new Error('Could not resolve this link.');
  }
}
