# Google Maps Cold Lead Scraper (Custom build)

Finds businesses of any type in any location on Google Maps. It then visits each business's website to collect **emails, owner / founder names, phone numbers and social profiles**, and **audits the site** for SEO, PPC and web-development gaps. Each lead gets a **score from 0 to 100** and ready-made **pitch angles** for cold outreach.

It is built from scratch with Crawlee and Playwright and **does not call any Apify Store actors**. You pay only for compute and proxy.

## How it works

| Stage | Engine | What happens |
|---|---|---|
| 1. Google Maps | PlaywrightCrawler (Chrome) | Opens `google.com/maps/search/<term> in <location>`, scrolls the results feed, then opens every listing and extracts name, category, address, phone, website, rating, reviews, opening hours, coordinates, place ID and whether the profile is **unclaimed**. |
| Deep search (optional) | OpenStreetMap geocoder | Splits the location's bounding box into an N×N grid and searches each cell. This gets past Google's limit of about 120 results per search, the same idea as Apify's own scraper. |
| 2. Websites | CheerioCrawler (fast HTTP) | Fetches the homepage plus the best About, Team and Contact pages. It extracts emails, including Cloudflare-protected and `name [at] domain [dot] com` forms. It reads `tel:` links, socials, and owner names from schema.org JSON-LD, "Jane Smith, Founder" text patterns, team cards and "founded by…" sentences. |
| 3. Audit + score | Built in | Checks HTTPS, mobile viewport, title and meta description, H1, schema, Google Analytics and GTM, **Google Ads tag**, **Meta Pixel**, CMS, a stale © year, load time and whether the site is down. Lead score, tier (Hot, Warm or Cold), recommended services and pitch angles are calculated from these checks. |

Results are pushed to the dataset as soon as they are final, the same way Apify's own scrapers work. Businesses without a website are saved straight away. Progress is persisted, so runs survive migrations, and you get live status messages and a `RUN_SUMMARY` record in the key-value store.

## Input example

```json
{
  "searchTerms": ["dentist", "orthodontist"],
  "locations": ["Mississauga, ON, Canada", "Brampton, ON, Canada"],
  "maxPlacesPerSearch": 100,
  "deepSearch": true,
  "gridSize": 3,
  "scrapeWebsites": true,
  "maxPagesPerWebsite": 4,
  "onlyWithEmail": false,
  "minLeadScore": 35,
  "excludeKeywords": ["Walmart", "Shoppers Drug Mart"],
  "proxyConfiguration": { "useApifyProxy": true, "apifyProxyGroups": ["RESIDENTIAL"] }
}
```

## Output (one row per business)

`businessName, category, address, city, state, postalCode, country, phone, email, emailType (personal/generic), allEmails, ownerName, ownerTitle, ownerEmail, ownerConfidence, ownerSource, otherDecisionMakers, website, googleMapsUrl, rating, reviewsCount, isClaimed, openingHours, facebook, instagram, linkedin, twitter, youtube, tiktok, websiteAudit{…}, latitude, longitude, placeId, searchTerm, searchLocation, leadScore, leadTier, recommendedServices, pitchAngles, scrapedAt`

The dataset has three ready-made views: **Cold leads**, **All contact details** and **Website audit**. You can export any of them to CSV or Excel and import it straight into Instantly, Lemlist, Apollo, HubSpot or another tool.

### Lead score at a glance

| Signal | Points | Service to pitch |
|---|---|---|
| No website on Google Maps | +30 | Web Development, Local SEO |
| Website down or error | +25 | Web Development |
| Unclaimed Google Business Profile | +12 | Local SEO |
| No mobile viewport / no HTTPS / © 3+ years old | +10 / +8 / +6 | Web Development |
| Missing title or meta description, thin content | +4 to +6 | SEO |
| No Google Ads tag **and** no Meta Pixel | +8 | PPC |
| No GA or GTM | +5 | Analytics & Tracking |
| Rating below 4.0, fewer than 25 reviews | +8 each | Reputation, Local SEO |
| Has email, personal email, owner name, phone | up to +14 | (reachability) |

Leads without an email have their score multiplied by 0.75. Hot means 55 or more, Warm means 35 or more.

## Deploy to Apify

```bash
npm i -g apify-cli
apify login              # paste your Apify API token
cd v2-custom-maps-lead-scraper
apify push               # builds the Docker image and creates the actor in your account
```

Then open **Apify Console → Actors → Google Maps Cold Lead Scraper → Start**.

Run locally with `npm install && apify run`. Outside the Apify image, set `CHROME_EXECUTABLE_PATH` if Playwright's Chrome isn't installed.

## Tips

* **Proxy:** Google rate-limits datacenter IPs. For runs of more than a few hundred places, use the `RESIDENTIAL` Apify Proxy group.
* **Memory:** 4 GB with concurrency 4 is a good default. For big runs, raise memory and `maxConcurrency` together.
* **Selectors:** Google changes Maps class names from time to time. The extractor relies mostly on stable attributes (`data-item-id`, `aria-label`, `role="feed"`) with fallbacks. If a field comes back empty across a run, update `extractPlace()` in `src/maps.js`.
* **Owner names** are heuristic and come with `ownerConfidence`. JSON-LD and team cards are the most reliable sources. Many small-business sites never name the owner, so expect roughly 25–50% coverage depending on the niche.
* Run the tests with `npm test`. They cover email, owner and audit extraction and a mock Maps place page.

## Compliance

Scraping public business listings is common practice, but Google's Terms of Service restrict automated access, so use reasonable volumes. For outreach, follow the law where the recipients are, such as **CASL** (Canada), **CAN-SPAM** (US) or **GDPR/PECR** (EU/UK). In general, contact role-relevant, publicly listed business addresses, identify yourself, and include a working unsubscribe.
