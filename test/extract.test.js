import assert from 'node:assert/strict';
import { extractFromHtml, mergeSiteResults, decodeCfEmail } from '../src/lib/websiteExtract.js';
import { buildLead } from '../src/lib/output.js';
import { parseAddress } from '../src/lib/geo.js';
import { placeKeyFromUrl } from '../src/maps.js';

const home = `<!doctype html><html><head><title>Bright Smile Dental | Family Dentist Mississauga</title>
<meta name="viewport" content="width=device-width">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Dentist","name":"Bright Smile","founder":{"@type":"Person","name":"Dr. Priya Sharma","jobTitle":"Founder & Principal Dentist"}}</script>
<script>gtag('config','G-ABC123')</script></head><body>
<h1>Welcome</h1><a href="/about-us">About Us</a><a href="/contact">Contact</a><a href="/blog/x">Blog</a>
<a href="mailto:info@brightsmile.ca">Email</a> <a href="tel:+1 905-555-0101">Call</a>
<a href="https://www.facebook.com/brightsmiledental/">fb</a><a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
<a href="https://instagram.com/brightsmile">ig</a>
<span class="__cf_email__" data-cfemail="${(() => { const k = 0x42; return k.toString(16) + [...'priya@brightsmile.ca'].map(c => (c.charCodeAt(0) ^ k).toString(16).padStart(2, '0')).join(''); })()}">[email protected]</span>
<img src="logo@2x.png"> <p>© 2019 Bright Smile Dental. All rights reserved.</p></body></html>`;
const about = `<html><body><h2>Meet the team</h2><h3>Dr. Priya Sharma</h3><p>Owner and Lead Dentist</p>
<h3>Mark Thompson</h3><p>Office Manager</p><p>Bright Smile was founded by Dr. Priya Sharma in 2008. Contact office (at) brightsmile [dot] ca</p></body></html>`;

const p1 = extractFromHtml(home, 'https://www.brightsmile.ca/', { status: 200, loadTimeMs: 1200 });
const p2 = extractFromHtml(about, 'https://www.brightsmile.ca/about-us', { status: 200 });
console.log('page1', JSON.stringify({ emails: p1.emails, phones: p1.phones, socials: p1.socials, links: p1.contactLinks, owners: p1.ownerCandidates }, null, 1));
console.log('page2 owners', p2.ownerCandidates, p2.emails);

assert.ok(p1.emails.includes('info@brightsmile.ca'));
assert.ok(p1.emails.includes('priya@brightsmile.ca'), 'cloudflare email decoded');
assert.ok(!p1.emails.some(e => e.includes('2x')));
assert.ok(p2.emails.includes('office@brightsmile.ca'), 'obfuscated email');
assert.equal(p1.socials.facebook, 'https://www.facebook.com/brightsmiledental');
assert.deepEqual(p1.contactLinks.sort(), ['https://www.brightsmile.ca/about-us', 'https://www.brightsmile.ca/contact']);
assert.equal(p1.audit.hasGoogleAnalytics, true);
assert.equal(p1.audit.hasGoogleAdsTag, false);
assert.equal(p1.audit.copyrightYear, 2019);

const site = mergeSiteResults([{ ...p1, url: 'h', isHomepage: true }, { ...p2, url: 'a', isHomepage: false }], 'https://www.brightsmile.ca/');
console.log('owner', site.owner, 'emails', site.emails);
assert.match(site.owner.name, /Priya Sharma/);
assert.equal(site.owner.email, 'priya@brightsmile.ca');
assert.equal(site.emails[0], 'priya@brightsmile.ca');

const place = { name: 'Bright Smile Dental', category: 'Dentist', address: '123 Main St, Mississauga, ON L5B 1A1', phone: '(905) 555-0101',
  website: 'https://www.brightsmile.ca/', rating: 3.8, reviewsCount: 14, isClaimed: false, url: 'https://www.google.com/maps/place/x/data=!4m7!3m6!1s0x882b:0x1a2b!8m2!3d43.59!4d-79.64', placeKey: 'k',
  ...parseAddress('123 Main St, Mississauga, ON L5B 1A1') };
const lead = buildLead(place, site, { searchTerm: 'dentist', location: 'Mississauga' });
console.log(JSON.stringify(lead, null, 1));
assert.equal(lead.city, 'Mississauga'); assert.equal(lead.state, 'ON'); assert.equal(lead.postalCode, 'L5B 1A1');
assert.equal(lead.leadTier, 'Hot');

const noSite = buildLead({ name: 'Joe Plumbing', phone: '1', rating: 4.8, reviewsCount: 3, isClaimed: true }, null, {});
console.log('noSite', noSite.leadScore, noSite.leadTier, noSite.recommendedServices);

for (const a of ['Plot 5, Sector V, Salt Lake, Kolkata, West Bengal 700091, India', '500 W 2nd St, Austin, TX 78701, United States', '10 Downing St, London SW1A 2AA, United Kingdom'])
  console.log(a, '=>', parseAddress(a));
assert.equal(placeKeyFromUrl('https://www.google.com/maps/place/Foo/data=!4m7!3m6!1s0x89d4cb:0xabc123!8m2'), '0x89d4cb:0xabc123');
console.log('\nALL TESTS PASSED');
