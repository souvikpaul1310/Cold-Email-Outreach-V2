/**
 * Custom Google Maps scraping logic (Playwright). No Apify Store actors used.
 *  - SEARCH pages: scroll the results feed, collect place links.
 *  - PLACE pages: open each listing and extract business details.
 */
import { log } from 'apify';
import { parseAddress } from './lib/geo.js';

export const LABELS = { SEARCH: 'SEARCH', PLACE: 'PLACE' };

export function searchUrl({ term, location, lat, lng, zoom, language }) {
    const q = encodeURIComponent(location ? `${term} in ${location}` : term).replace(/%20/g, '+');
    const at = lat != null ? `/@${lat},${lng},${zoom}z` : '';
    return `https://www.google.com/maps/search/${q}${at}?hl=${language}`;
}

export function placeKeyFromUrl(url) {
    const fid = url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
    if (fid) return fid[1].toLowerCase();
    const cid = url.match(/[?&]cid=(\d+)/);
    if (cid) return `cid:${cid[1]}`;
    const name = url.match(/\/maps\/place\/([^/]+)/);
    return name ? `name:${decodeURIComponent(name[1]).toLowerCase()}` : url;
}

export async function acceptConsent(page) {
    if (!/consent\.google\./.test(page.url())) {
        // In-page consent dialog variant
        const btn = page.locator('form[action*="consent"] button, button[aria-label*="Accept all"], button[aria-label*="Reject all"]').first();
        if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
            await btn.click().catch(() => {});
            await page.waitForLoadState('domcontentloaded').catch(() => {});
        }
        return;
    }
    const btn = page.locator('button:has-text("Reject all"), button:has-text("Accept all"), input[type=submit][value*="Accept"]').first();
    await btn.click({ timeout: 10000 }).catch(() => {});
    await page.waitForURL(/google\.[^/]+\/maps/, { timeout: 30000 }).catch(() => {});
}

/** Scroll the left results panel until we have enough results or reach the end. */
async function scrollFeed(page, want) {
    const feedSel = 'div[role="feed"]';
    let prev = 0;
    let stale = 0;
    for (let i = 0; i < 200; i++) {
        const count = await page.$$eval(`${feedSel} a[href*="/maps/place/"]`, (els) => els.length).catch(() => 0);
        if (count >= want) break;
        const ended = await page.evaluate(() => /reached the end of the list|no more results/i
            .test(document.querySelector('div[role="feed"]')?.innerText || '')).catch(() => false);
        if (ended) break;
        if (count === prev) {
            stale += 1;
            if (stale >= 8) break;
        } else stale = 0;
        prev = count;
        await page.evaluate((sel) => {
            const feed = document.querySelector(sel);
            if (feed) feed.scrollBy(0, feed.scrollHeight);
        }, feedSel);
        await page.waitForTimeout(1200 + Math.random() * 800);
    }
    return page.$$eval(`${feedSel} a[href*="/maps/place/"]`, (els) => [...new Set(els.map((a) => a.href))]);
}

/** Extract every field we can from an open place page. */
export async function extractPlace(page) {
    await page.waitForSelector('h1', { timeout: 30000 });
    // give the side panel a moment to render buttons (address, phone, website)
    await page.waitForSelector('button[data-item-id="address"], a[data-item-id="authority"], button[data-item-id^="phone"]', { timeout: 8000 }).catch(() => {});

    const d = await page.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const txt = (s) => q(s)?.textContent?.trim() || null;
        const aria = (s) => q(s)?.getAttribute('aria-label') || null;
        const main = q('div[role="main"]') || document.body;
        const mainText = main.innerText || '';

        const name = txt('h1.DUwDvf') || txt('div[role="main"] h1') || txt('h1');
        const category = txt('button[jsaction*="category"]') || txt('span.DkEaL') || null;

        const addrBtn = q('button[data-item-id="address"]');
        const address = (addrBtn?.getAttribute('aria-label') || addrBtn?.innerText || '')
            .replace(/^Address:\s*/i, '').trim() || null;

        const phoneBtn = q('button[data-item-id^="phone:tel:"]');
        const phone = phoneBtn
            ? (phoneBtn.getAttribute('aria-label')?.replace(/^Phone:\s*/i, '').trim()
                || phoneBtn.getAttribute('data-item-id').replace('phone:tel:', ''))
            : null;

        let website = q('a[data-item-id="authority"]')?.getAttribute('href') || null;
        if (website && website.includes('/url?')) {
            try { website = new URL(website, location.origin).searchParams.get('q') || website; } catch { /* keep */ }
        }

        const plusCode = (aria('button[data-item-id="oloc"]') || '').replace(/^Plus code:\s*/i, '') || null;

        // Rating & reviews (several fallbacks; Google changes class names often)
        let rating = null;
        let reviewsCount = null;
        const ratingSpan = q('div.F7nice span[aria-hidden="true"]');
        if (ratingSpan) rating = parseFloat(ratingSpan.textContent.replace(',', '.'));
        if (rating == null || Number.isNaN(rating)) {
            const star = [...document.querySelectorAll('[role="img"][aria-label]')]
                .map((e) => e.getAttribute('aria-label')).find((l) => /stars?/i.test(l));
            if (star) rating = parseFloat(star.replace(',', '.'));
        }
        const revLabel = [...main.querySelectorAll('[aria-label]')]
            .map((e) => e.getAttribute('aria-label')).find((l) => /^[\d,.\s]+reviews?$/i.test(l.trim()));
        if (revLabel) reviewsCount = parseInt(revLabel.replace(/[^\d]/g, ''), 10);
        if (reviewsCount == null) {
            const m = (q('div.F7nice')?.innerText || '').match(/\(([\d,.\s]+)\)/);
            if (m) reviewsCount = parseInt(m[1].replace(/[^\d]/g, ''), 10);
        }
        if (Number.isNaN(rating)) rating = null;

        const priceLevel = (aria('span[aria-label^="Price"]') || '').replace(/^Price:\s*/i, '') || null;
        const hoursLabel = aria('div.t39EBf') || aria('[aria-label*="Hide open hours"]') || aria('[data-item-id="oh"]');
        const openingHours = hoursLabel ? hoursLabel.replace(/\.\s*Hide open hours for the week\.?$/i, '').trim() : null;

        const isClaimed = !(q('a[data-item-id="merchant"]') || /Claim this business/i.test(mainText));
        const permanentlyClosed = /Permanently closed/i.test(mainText);
        const temporarilyClosed = /Temporarily closed/i.test(mainText);

        return {
            name, category, address, phone, website, plusCode, rating, reviewsCount,
            priceLevel, openingHours, isClaimed, permanentlyClosed, temporarilyClosed,
        };
    });

    const url = page.url();
    const coords = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    const pid = url.match(/!19s(ChIJ[^!?&]+)/);
    return {
        ...d,
        ...parseAddress(d.address),
        url,
        placeKey: placeKeyFromUrl(url),
        placeId: pid ? decodeURIComponent(pid[1]) : placeKeyFromUrl(url),
        lat: coords ? Number(coords[1]) : null,
        lng: coords ? Number(coords[2]) : null,
    };
}

export function createMapsRouterHandlers({ state, input, onPlace }) {
    return {
        async [LABELS.SEARCH]({ page, request, crawler }) {
            const { searchKey, term, location } = request.userData;
            await acceptConsent(page);
            await page.waitForSelector('div[role="feed"], h1', { timeout: 45000 });

            // Google sometimes jumps straight to a single place
            if (page.url().includes('/maps/place/') && !(await page.$('div[role="feed"]'))) {
                const place = await extractPlace(page);
                await onPlace(place, { term, location, searchKey });
                return;
            }

            const already = state.enqueued[searchKey] || 0;
            const remaining = input.maxPlacesPerSearch - already;
            if (remaining <= 0) return;

            const links = await scrollFeed(page, remaining + 10);
            const fresh = [];
            for (const href of links) {
                const key = placeKeyFromUrl(href);
                if (state.seen[key]) continue;
                state.seen[key] = true;
                fresh.push({ href, key });
                if (fresh.length >= remaining) break;
            }
            state.enqueued[searchKey] = already + fresh.length;
            log.info(`[${term} @ ${location}] ${request.userData.cell ? `cell ${request.userData.cell} ` : ''}found ${links.length} listings, ${fresh.length} new (total ${state.enqueued[searchKey]}/${input.maxPlacesPerSearch}).`);

            await crawler.addRequests(fresh.map(({ href, key }) => {
                const u = new URL(href);
                u.searchParams.set('hl', input.language);
                return {
                    url: u.href,
                    uniqueKey: `place:${key}`,
                    label: LABELS.PLACE,
                    userData: { term, location, searchKey },
                };
            }));
        },

        async [LABELS.PLACE]({ page, request }) {
            await acceptConsent(page);
            const place = await extractPlace(page);
            if (!place.name) throw new Error('Place name not found — page probably did not render, retrying.');
            await onPlace(place, request.userData);
        },
    };
}
