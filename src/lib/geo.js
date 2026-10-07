/**
 * Location helpers: geocode a free-text location (OpenStreetMap Nominatim)
 * and split its bounding box into a grid so we can get past Google Maps'
 * ~120-results-per-search cap (same idea as Apify's built-in "deep" search).
 */
import { log } from 'apify';

export async function geocode(location) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(location)}`;
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'apify-maps-lead-scraper/1.0 (lead research)' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const [hit] = await res.json();
        if (!hit) return null;
        const [south, north, west, east] = hit.boundingbox.map(Number);
        return { lat: Number(hit.lat), lng: Number(hit.lon), south, north, west, east, displayName: hit.display_name };
    } catch (err) {
        log.warning(`Geocoding failed for "${location}": ${err.message}. Falling back to plain text search.`);
        return null;
    }
}

/** Returns gridSize x gridSize cell centres + a zoom level suited to the cell size. */
export function buildGrid(box, gridSize) {
    const n = Math.max(1, Math.min(10, gridSize));
    const latStep = (box.north - box.south) / n;
    const lngStep = (box.east - box.west) / n;
    const cells = [];
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            cells.push({
                lat: +(box.south + latStep * (i + 0.5)).toFixed(6),
                lng: +(box.west + lngStep * (j + 0.5)).toFixed(6),
            });
        }
    }
    // approx: degrees of longitude visible ≈ 360 / 2^zoom * (viewport ~ 1.5 tiles)
    const span = Math.max(latStep, lngStep);
    const zoom = Math.max(10, Math.min(17, Math.round(Math.log2(360 / Math.max(span, 0.001)) - 1)));
    return { cells, zoom };
}

/** Best-effort split of a Google Maps address into components. */
export function parseAddress(address) {
    const out = { city: null, state: null, postalCode: null, countryCode: null };
    if (!address) return out;
    const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2 && !/\d/.test(parts[parts.length - 1]) && parts[parts.length - 1].length > 2) {
        out.countryCode = parts.pop();
    }
    const last = parts[parts.length - 1] || '';
    const m = last.match(/^(.*?)[\s,]+([A-Z]\d[A-Z]\s?\d[A-Z]\d|\d{5}(?:-\d{4})?|\d{6}|\d{3}\s?\d{3}|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}|\d{4})$/i);
    if (m) {
        out.state = m[1].trim() || null;
        out.postalCode = m[2].trim();
        if (parts.length >= 2) out.city = parts[parts.length - 2];
        // "10 Downing St, London SW1A 2AA" → the "state" slot is really the city
        if (!out.city || /^\d/.test(out.city)) { out.city = out.state; out.state = null; }
    } else if (parts.length >= 2) {
        out.state = /^[A-Z]{2}$/.test(last) ? last : null;
        out.city = out.state ? parts[parts.length - 2] : last;
    }
    return out;
}
