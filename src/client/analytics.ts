/**
 * Google Analytics 4 (BOLT-53), only when the deployment sets GA_MEASUREMENT_ID. Privacy first, as the rest of the app:
 * the page location and referrer sent to Google drop their query string and fragment, so a kiosk's ?lat&lon (or any
 * coordinates) never leave the device, and Google signals and ad personalization are off. Events carry no coordinates,
 * addresses or search text.
 */

/** A GA4 measurement ID, "G-" and letters or digits. Anything else turns analytics off. */
const MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/;

type Gtag = (...args: unknown[]) => void;

interface AnalyticsWindow {
  dataLayer?: unknown[];
  gtag?: Gtag;
  location: { origin: string; pathname: string };
}

let gtag: Gtag | undefined;

/** "https://site.example/path?a=1#b" → "https://site.example/path". Empty stays empty. */
export function withoutQuery(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '';
  }
}

/** Loads gtag.js and sends the page view. Does nothing without a valid measurement ID, or when called again. */
export function startAnalytics(
  measurementId: string,
  win: AnalyticsWindow = window as unknown as AnalyticsWindow,
  doc: Pick<Document, 'createElement' | 'head' | 'referrer'> = document,
): boolean {
  if (gtag || !MEASUREMENT_ID.test(measurementId)) return false;
  const dataLayer = (win.dataLayer = win.dataLayer ?? []);
  // gtag.js reads the arguments object itself, as Google's snippet pushes it.
  gtag = win.gtag = function gtagShim() {
    // eslint-disable-next-line prefer-rest-params
    dataLayer.push(arguments);
  };
  gtag('js', new Date());
  gtag('config', measurementId, {
    page_location: `${win.location.origin}${win.location.pathname}`,
    page_referrer: withoutQuery(doc.referrer),
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  const script = doc.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  doc.head.append(script);
  return true;
}

/** Sends an event when analytics is on. Parameters must never hold coordinates, addresses or search text. */
export function track(event: string, params: Record<string, string | number | boolean> = {}): void {
  gtag?.('event', event, params);
}

/** Tests only: forget a started session. */
export function resetAnalyticsForTests(): void {
  gtag = undefined;
}
