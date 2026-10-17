// Renders the card in headless Chromium against synthetic data and checks the basics.
//
//   npm install
//   npx playwright-core install chromium      # once, unless CHROMIUM_PATH points at a browser
//   npm test                                  # screenshots land in test/out/
//
// Network is fully stubbed: Leaflet is served from node_modules, map tiles are a plain grid,
// so the run is deterministic and needs no internet.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');
const out = path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });
const fx = JSON.parse(fs.readFileSync(path.join(here, 'fixture.json'), 'utf8'));
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

async function open(theme = 'dark', viewport = { width: 900, height: 560 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.host === 'test.local') {
      const f = u.pathname === '/' ? path.join(here, 'index.html') : path.join(root, 'dist', path.basename(u.pathname));
      return route.fulfill({ path: f });
    }
    if (u.host === 'cdn.jsdelivr.net') {
      return route.fulfill({
        path: path.join(root, 'node_modules/leaflet/dist', path.basename(u.pathname)),
        headers: { 'Access-Control-Allow-Origin': '*' },
        contentType: u.pathname.endsWith('.css') ? 'text/css' : 'application/javascript',
      });
    }
    if (u.host === 'server.arcgisonline.com') {
      return u.pathname.includes('Reference') ? route.fulfill({ status: 204 })
        : route.fulfill({ path: path.join(here, theme === 'light' ? 'tile-light.png' : 'tile-dark.png') });
    }
    if (u.host === 'cdn.jetphotos.com') return route.fulfill({ path: path.join(here, 'photo.png') });
    return route.fulfill({ status: 404 });
  });
  await page.goto('http://test.local/');
  return page;
}

async function mount(page, theme, config = {}, width = 860) {
  await page.evaluate(({ fx, theme, config, width }) => {
    document.body.className = theme;
    const slot = document.getElementById('slot');
    slot.style.width = `${width}px`;
    const card = document.createElement('aircraft-type-map-card');
    card.setConfig({ entity: 'sensor.flightradar24_current_in_area', highlight_entity: 'sensor.featured_flight', height: 440, ...config });
    slot.appendChild(card);
    window.__card = card;
    window.__set = (bounds, stamp) => {
      card.hass = {
        config: { latitude: fx.home[0], longitude: fx.home[1] },
        themes: { darkMode: theme === 'dark' },
        states: {
          'sensor.flightradar24_current_in_area': { state: String(fx.flights.length), last_updated: stamp, attributes: { flights: fx.flights, bounds } },
          'sensor.featured_flight': { state: 'QF431', attributes: { fr24_id: fx.featured_id } },
        },
      };
    };
    window.__set(fx.bounds, '1');
  }, { fx, theme, config, width });
  await page.waitForTimeout(1200);
}

const state = (page) => page.evaluate(() => {
  const c = window.__card;
  return {
    classes: Object.fromEntries([...c._planes.values()].map((p) => [p.f.id, p.cls])),
    onMap: c._planeLayer.getLayers().length,
    zoom: c._map.getZoom(),
    userMoved: !!c._userMoved,
  };
});

// 1. Classification + rendering, dark and light
for (const theme of ['dark', 'light']) {
  const page = await open(theme);
  await mount(page, theme, { title: 'Flights by type' });
  const s = await state(page);
  check(JSON.stringify(s.classes) === JSON.stringify({
    't-jet': 'jet', 't-tprop': 'turboprop', 't-light1': 'light', 't-light2': 'light', 't-heli': 'helicopter', 't-ground': 'jet',
  }), `${theme}: every fixture aircraft gets the expected class ${JSON.stringify(s.classes)}`);
  check(s.onMap === fx.flights.length, `${theme}: all ${fx.flights.length} aircraft are on the map`);
  await page.screenshot({ path: path.join(out, `map-${theme}.png`) });
  check(page.errors.length === 0, `${theme}: no console errors ${page.errors.join('; ')}`);
  await page.close();
}

// 2. Popup and legend toggle
{
  const page = await open('dark');
  await mount(page, 'dark');
  await page.evaluate(() => [...window.__card._planes.values()].find((p) => p.f.id === 't-jet').marker.openPopup());
  await page.waitForTimeout(600);
  const popup = await page.evaluate(() => window.__card.shadowRoot.querySelector('.leaflet-popup-content')?.innerText || '');
  check(/QF431/.test(popup) && /Melbourne/.test(popup) && /Jet/.test(popup), 'popup shows flight, route and class');
  await page.screenshot({ path: path.join(out, 'popup.png') });
  await page.evaluate(() => window.__card._map.closePopup());
  await page.evaluate(() => window.__card.shadowRoot.querySelector('.atm-legend button[data-c="light"]').click());
  await page.waitForTimeout(300);
  check((await state(page)).onMap === fx.flights.length - 2, 'legend toggle hides the two light aircraft');
  check(page.errors.length === 0, `popup/legend: no console errors ${page.errors.join('; ')}`);
  await page.close();
}

// 3. Auto-fit: resize, radius change, user pan, fit button
{
  const wider = '-33.2723,-34.6199,150.3651,151.9893';
  const page = await open('dark', { width: 1000, height: 700 });
  await mount(page, 'dark', {}, 860);
  const z860 = (await state(page)).zoom;
  await page.close();

  const p2 = await open('dark', { width: 1000, height: 700 });
  await mount(p2, 'dark', {}, 200);
  await p2.evaluate(() => { document.getElementById('slot').style.width = '860px'; });
  await p2.waitForTimeout(500);
  check((await state(p2)).zoom === z860, 'refits after the card grows from narrow to wide');
  await p2.evaluate((b) => window.__set(b, '2'), wider);
  await p2.waitForTimeout(500);
  check((await state(p2)).zoom < z860, 'refits when the tracking radius grows');
  const box = await p2.evaluate(() => { const r = window.__card._mapEl.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p2.mouse.move(box.x, box.y); await p2.mouse.down(); await p2.mouse.move(box.x + 80, box.y + 40, { steps: 5 }); await p2.mouse.up();
  const zMoved = (await state(p2)).zoom;
  await p2.evaluate((b) => window.__set(b, '3'), fx.bounds);
  await p2.waitForTimeout(500);
  check((await state(p2)).zoom === zMoved, 'leaves the view alone after the user pans');
  await p2.evaluate(() => window.__card.shadowRoot.querySelector('.atm-fit').click());
  await p2.waitForTimeout(500);
  const s = await state(p2);
  check(s.zoom === z860 && !s.userMoved, 'fit button refits and resumes auto-fit');
  await p2.close();
}

// 4. Icon sheet for the README
{
  const page = await open('dark', { width: 760, height: 330 });
  await page.evaluate(() => {
    document.body.className = 'dark';
    document.getElementById('slot').style.width = '720px';
    const mk = (id, code, lon) => ({ id, callsign: id, aircraft_code: code, latitude: -33.95, longitude: lon, heading: 0, altitude: 3000, ground_speed: 0, on_ground: 0 });
    const flights = [mk('JET', 'B738', 151.05), mk('TPROP', 'DH8D', 151.11), mk('LIGHT', 'C172', 151.17), mk('HELI', 'R44', 151.23)];
    const card = document.createElement('aircraft-type-map-card');
    card.setConfig({ entity: 's', height: 300, icon_scale: 3, show_labels: false, show_legend: false, show_radius: false, show_home: false, dead_reckoning: false, map_style: 'dark' });
    document.getElementById('slot').appendChild(card);
    card.hass = { config: {}, themes: { darkMode: true }, states: { s: { state: '4', last_updated: '1', attributes: { flights, bounds: '-33.90,-34.00,151.01,151.27' } } } };
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(out, 'icons.png') });
  await page.close();
}

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
