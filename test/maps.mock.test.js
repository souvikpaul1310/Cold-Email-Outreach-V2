import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { extractPlace } from '../src/maps.js';
const html = `<div role="main"><h1 class="DUwDvf">Bright Smile Dental</h1>
<div class="F7nice"><span><span aria-hidden="true">3.8</span></span><span><span aria-label="14 reviews">(14)</span></span></div>
<button jsaction="pane.rating.category">Dentist</button>
<button data-item-id="address" aria-label="Address: 123 Main St, Mississauga, ON L5B 1A1">123 Main St</button>
<a data-item-id="authority" href="https://www.brightsmile.ca/">brightsmile.ca</a>
<button data-item-id="phone:tel:+19055550101" aria-label="Phone: (905) 555-0101"></button>
<div class="t39EBf" aria-label="Monday, 9 AM to 5 PM; Tuesday, 9 AM to 5 PM. Hide open hours for the week"></div>
<a data-item-id="merchant">Claim this business</a></div>`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await b.newPage();
await page.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: html }));
await page.goto('https://www.google.com/maps/place/Bright+Smile/@43.59,-79.64,17z/data=!3m1!4b1!4m6!3m5!1s0x882b4:0x1a2b3c!8m2!3d43.5901!4d-79.6402!16s%2Fg%2F11');
const p = await extractPlace(page);
console.log(p);
assert.equal(p.name, 'Bright Smile Dental'); assert.equal(p.rating, 3.8); assert.equal(p.reviewsCount, 14);
assert.equal(p.phone, '(905) 555-0101'); assert.equal(p.isClaimed, false); assert.equal(p.city, 'Mississauga');
assert.equal(p.placeKey, '0x882b4:0x1a2b3c'); assert.equal(p.lat, 43.5901);
await b.close(); console.log('MAPS MOCK PASSED');
