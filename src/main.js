/**
 * Google Maps Cold-Lead Scraper (custom build — no Apify Store actors).
 *
 * Stage 1  PlaywrightCrawler  → Google Maps search + place pages
 * Stage 2  CheerioCrawler     → each business website (home + about/team/contact pages)
 * Stage 3  Merge + score      → one clean, CSV-ready lead per business in the dataset
 */
import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { createMapsRouterHandlers, searchUrl, LABELS } from './maps.js';
import { geocode, buildGrid } from './lib/geo.js';
import { crawlWebsites } from './lib/siteCrawler.js';
import { buildLead, passesFilters } from './lib/output.js';

await Actor.init();

const raw = (await Actor.getInput()) ?? {};
const input = {
    searchTerms: raw.searchTerms?.filter(Boolean) ?? [],
    locations: raw.locations?.filter(Boolean) ?? [],
    maxPlacesPerSearch: raw.maxPlacesPerSearch ?? 40,
    deepSearch: raw.deepSearch ?? false,
    gridSize: raw.gridSize ?? 3,
    language: raw.language || 'en',
    skipClosedPlaces: raw.skipClosedPlaces ?? true,
    scrapeWebsites: raw.scrapeWebsites ?? true,
    maxPagesPerWebsite: raw.maxPagesPerWebsite ?? 4,
    onlyWithEmail: raw.onlyWithEmail ?? false,
    onlyWithoutWebsite: raw.onlyWithoutWebsite ?? false,
    minLeadScore: raw.minLeadScore ?? 0,
    maxRating: raw.maxRating ?? null,
    excludeKeywords: raw.excludeKeywords ?? [],
    maxConcurrency: raw.maxConcurrency ?? 4,
    websiteMaxConcurrency: raw.websiteMaxConcurrency ?? 10,
    headless: raw.headless ?? true,
};

if (!input.searchTerms.length || !input.locations.length) {
    throw new Error('Please provide at least one search term (e.g. "dentist") and one location (e.g. "Toronto, ON").');
}

const proxyConfiguration = await Actor.createProxyConfiguration(raw.proxyConfiguration ?? { useApifyProxy: true });

// Persisted state survives migrations / resurrected runs.
const state = await Actor.useState('LEADS_STATE', {
    seen: {}, // placeKey -> true
    enqueued: {}, // searchKey -> number of places enqueued
    places: {}, // placeKey -> place data
    sitePages: {}, // placeKey -> [page extraction]
    pushed: {}, // placeKey -> true
    stats: { places: 0, pushed: 0, filtered: 0, closed: 0 },
});

async function pushLead(place, site) {
    if (state.pushed[place.placeKey]) return;
    state.pushed[place.placeKey] = true;
    const lead = buildLead(place, site, { searchTerm: place.searchTerm, location: place.searchLocation });
    if (!passesFilters(lead, input)) { state.stats.filtered += 1; return; }
    await Actor.pushData(lead);
    state.stats.pushed += 1;
}

// ---------------- Stage 1: Google Maps ----------------
const handlers = createMapsRouterHandlers({
    state,
    input,
    onPlace: async (place, { term, location }) => {
        if (state.places[place.placeKey]) return;
        if (input.skipClosedPlaces && (place.permanentlyClosed || place.temporarilyClosed)) {
            state.stats.closed += 1;
            return;
        }
        place.searchTerm = term;
        place.searchLocation = location;
        state.places[place.placeKey] = place;
        state.stats.places += 1;
        log.info(`✓ ${place.name} | ${place.phone ?? 'no phone'} | ${place.website ?? 'NO WEBSITE'}`);
        await Actor.setStatusMessage(`Maps: ${state.stats.places} businesses scraped`);
        // Businesses with no website are final right away (that's a hot web-dev lead!)
        if (!place.website || !input.scrapeWebsites) await pushLead(place, null);
    },
});

const startRequests = [];
for (const term of input.searchTerms) {
    for (const location of input.locations) {
        const searchKey = `${term}|${location}`.toLowerCase();
        if (input.deepSearch) {
            const box = await geocode(location);
            if (box) {
                const { cells, zoom } = buildGrid(box, input.gridSize);
                log.info(`Deep search "${term}" in ${box.displayName}: ${cells.length} grid cells @ zoom ${zoom}`);
                cells.forEach((c, i) => startRequests.push({
                    url: searchUrl({ term, lat: c.lat, lng: c.lng, zoom, language: input.language }),
                    uniqueKey: `search:${searchKey}:${i}`,
                    label: LABELS.SEARCH,
                    userData: { term, location, searchKey, cell: `${i + 1}/${cells.length}` },
                }));
                continue;
            }
        }
        startRequests.push({
            url: searchUrl({ term, location, language: input.language }),
            uniqueKey: `search:${searchKey}`,
            label: LABELS.SEARCH,
            userData: { term, location, searchKey },
        });
    }
}

const mapsCrawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxConcurrency: input.maxConcurrency,
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 300,
    navigationTimeoutSecs: 90,
    headless: input.headless,
    launchContext: {
        launchOptions: {
            args: [`--lang=${input.language}`],
            // Only used for local runs outside the Apify base image
            ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}),
        },
    },
    browserPoolOptions: { useFingerprints: true },
    preNavigationHooks: [
        async ({ page }) => {
            await page.context().addCookies([
                // Pre-accept the EU cookie consent so we land directly on Maps
                { name: 'SOCS', value: 'CAESHAgBEhJnd3NfMjAyNDAxMDEtMF9SQzEaAmVuIAEaBgiA_LyuBg', domain: '.google.com', path: '/' },
                { name: 'CONSENT', value: 'YES+cb', domain: '.google.com', path: '/' },
            ]).catch(() => {});
            await page.setExtraHTTPHeaders({ 'Accept-Language': `${input.language},en;q=0.8` });
            await page.route(/\.(png|jpe?g|gif|webp|woff2?|ttf|mp4)(\?|$)/i, (r) => r.abort());
        },
    ],
    requestHandler: async (ctx) => handlers[ctx.request.label](ctx),
    failedRequestHandler: async ({ request }, err) => {
        log.error(`Failed ${request.label} ${request.url}: ${err.message}`);
    },
});

log.info(`Starting Google Maps stage with ${startRequests.length} search request(s).`);
await mapsCrawler.run(startRequests);
log.info(`Maps stage done: ${state.stats.places} businesses (${state.stats.closed} closed skipped).`);

// ---------------- Stage 2: Business websites ----------------
const withSite = Object.values(state.places).filter((p) => p.website && !state.pushed[p.placeKey]);
if (input.scrapeWebsites && withSite.length) {
    await Actor.setStatusMessage(`Enriching ${withSite.length} websites (emails, owners, audit)…`);
    const sites = await crawlWebsites(withSite, {
        proxyConfiguration,
        maxPagesPerWebsite: input.maxPagesPerWebsite,
        maxConcurrency: input.websiteMaxConcurrency,
        store: state.sitePages,
    });
    // ---------------- Stage 3: merge + score + push ----------------
    for (const place of withSite) await pushLead(place, sites[place.placeKey] || null);
}

// Any leftovers (e.g. scrapeWebsites disabled mid-run)
for (const place of Object.values(state.places)) await pushLead(place, null);

const summary = { ...state.stats, finishedAt: new Date().toISOString(), input };
await Actor.setValue('RUN_SUMMARY', summary);
await Actor.setStatusMessage(`Done: ${state.stats.pushed} leads saved (${state.stats.filtered} filtered out, ${state.stats.closed} closed skipped).`, { isStatusMessageTerminal: true });
log.info('Summary', summary);
await Actor.exit();
