import { afterEach, describe, expect, it } from 'vitest';
import { resetAnalyticsForTests, startAnalytics, track, withoutQuery } from '../../src/client/analytics.js';

function fakePage(referrer = '') {
  const appended: { src: string; async: boolean }[] = [];
  const win: { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void; location: { origin: string; pathname: string } } = {
    location: { origin: 'https://your-domain.example', pathname: '/' },
  };
  const doc = {
    referrer,
    head: { append: (node: { src: string; async: boolean }) => void appended.push(node) },
    createElement: () => ({ src: '', async: false }),
  } as unknown as Pick<Document, 'createElement' | 'head' | 'referrer'>;
  const calls = () => (win.dataLayer ?? []).map((args) => Array.from(args as ArrayLike<unknown>));
  return { win, doc, appended, calls };
}

describe('analytics', () => {
  afterEach(() => resetAnalyticsForTests());

  it('loads nothing without a measurement ID, or with one that is not an ID', () => {
    for (const id of ['', 'UA-1-1', 'G-x"><script>']) {
      const page = fakePage();
      expect(startAnalytics(id, page.win, page.doc)).toBe(false);
      expect(page.appended).toEqual([]);
      expect(page.win.dataLayer).toBeUndefined();
    }
    track('display_start'); // no-op
  });

  it('sends the page without its query, with signals and ad personalization off', () => {
    const page = fakePage('https://your-domain.example/location?lat=28.5&lon=-81.3#x');
    page.win.location.pathname = '/';
    expect(startAnalytics('G-TEST1234', page.win, page.doc)).toBe(true);

    expect(page.appended).toEqual([{ src: 'https://www.googletagmanager.com/gtag/js?id=G-TEST1234', async: true }]);
    const config = page.calls().find((c) => c[0] === 'config')!;
    expect(config[1]).toBe('G-TEST1234');
    expect(config[2]).toEqual({
      page_location: 'https://your-domain.example/',
      page_referrer: 'https://your-domain.example/location',
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    expect(JSON.stringify(page.calls())).not.toContain('28.5');
  });

  it('sends events once started, and starts only once', () => {
    const page = fakePage();
    startAnalytics('G-TEST1234', page.win, page.doc);
    expect(startAnalytics('G-TEST1234', page.win, page.doc)).toBe(false);
    track('location_saved', { radius_unit: 'mi' });
    expect(page.calls().at(-1)).toEqual(['event', 'location_saved', { radius_unit: 'mi' }]);
    expect(page.appended).toHaveLength(1);
  });

  it('strips queries and fragments from a URL', () => {
    expect(withoutQuery('https://a.example/p?q=1#h')).toBe('https://a.example/p');
    expect(withoutQuery('')).toBe('');
    expect(withoutQuery('not a url')).toBe('');
  });
});
