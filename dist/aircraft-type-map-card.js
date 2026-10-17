/*
 * Aircraft Type Map Card — a Lovelace card for the FlightRadar24 integration
 * (AlexandrErohin/home-assistant-flightradar24) that draws each aircraft with a
 * top-down silhouette for its class: jet, turboprop, light aircraft, helicopter.
 *
 *   type: custom:aircraft-type-map-card
 *   entity: sensor.flightradar24_current_in_area   # required
 *   title: Flights by type                          # optional
 *   height: 420                                     # px
 *   map_style: auto        # auto | dark | light | satellite | osm
 *   tile_url: ...          # optional custom XYZ template (overrides map_style)
 *   show_tracks: true
 *   show_labels: true      # callsign + altitude next to each aircraft
 *   show_legend: true      # tap a legend row to hide/show that class
 *   show_home: true
 *   show_radius: true      # dashed circle for the FR24 tracking radius
 *   dead_reckoning: true   # glide aircraft along their heading between polls
 *   icon_scale: 1
 *   highlight_entity: sensor.featured_flight   # optional; glows the aircraft whose fr24_id matches
 *   colors: { jet: '#ffb300', turboprop: '#26c6da', light: '#66bb6a', helicopter: '#ec407a' }
 *   type_overrides: { C208: light, PC12: jet }  # ICAO type code -> class
 */

const ATM_VERSION = '0.1.1';
const LEAFLET = {
  js: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
  jsSri: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',
  css: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css',
  cssSri: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=',
};

const CLASSES = ['jet', 'turboprop', 'light', 'helicopter'];
const CLASS_NAMES = { jet: 'Jet', turboprop: 'Turboprop', light: 'Light aircraft', helicopter: 'Helicopter' };
const DEFAULT_COLORS = { jet: '#ffb300', turboprop: '#26c6da', light: '#66bb6a', helicopter: '#ec407a' };
const ICON_PX = { jet: 40, turboprop: 36, light: 32, helicopter: 36 };

// ---- classification -------------------------------------------------------
const set = (s) => new Set(s.trim().split(/\s+/));
const HELI_CODES = set(`H269 H500 H47 H60 H64 UH1 UH1Y R22 R44 R66 EC20 EC25 EC30 EC35 EC45 EC55 EC75
  AS32 AS3B AS50 AS55 AS65 B06 B06T B105 B204 B205 B206 B212 B222 B230 B407 B412 B427 B429 B430 B505 B525
  A109 A119 A129 A139 A149 A169 A189 AW09 S61 S64 S70 S76 S92 H160 H175 BK17 MD60 EXPL NH90 TIGR LYNX KMAX
  GAZL ALO2 ALO3 MI8 MI24 MI26 KA32 EN28 EN48 S300 S330 G2CA HUCO`);
const TPROP_CODES = set(`AT43 AT44 AT45 AT46 AT72 AT73 AT75 AT76 DH8A DH8B DH8C DH8D DHC6 DHC7 SF34 SB20
  B190 B350 BE20 BE30 BE9L BE9T BE10 BE99 C208 C08T C425 C441 PC12 PC6T PC21 PC9 PC7 TBM7 TBM8 TBM9 P46T
  PAY1 PAY2 PAY3 PAY4 P180 JS31 JS32 JS41 E110 E120 F27 F50 D228 D328 SW3 SW4 L410 AN24 AN26 C130 C30J C295
  CN35 A400 AT3T AT5T AT6T AT8T TUCA SH33 SH36 SC7 N22B N24A MU2 KODI`);
const JET_CODE_RE = /^(A3\d\d|A[23]\dN|A35K|A38\d|B7\d\d|B3\dM|B7\dX|E1[3-9]\d|E75[LS]|E2\d\d|CRJ[\dX]|BCS[13]|B46[123]|RJ\d\d|F100|F70|MD[89]\d|DC[89]\d?|C25[ABCM]|C5\d\d|C56X|C6\d[\dA]|C7[05]0|LJ\d\d|GLF\d|GL[57]T|GLEX|CL[36][05]|FA\dX|F2TH|F900|E50P|E55P|E545|E550|PC24|HDJT|SF50|EA50|PRM1|H25[AB]|BE40|C17|K35R|P8|E737|F18[EFS]?|F35)$/;
const HELI_RE = /helicop|robinson|schweizer|eurocopter|airbus h1\d\d|agusta|leonardo aw|sikorsky|bell \d{3}|hughes|md \d{3}|enstrom|kaman|westland|mil mi|kamov|cabri|guimbal|bo ?105|bk ?117/i;
const TPROP_RE = /dash 8|dhc-8|q[234]00|saab (340|2000)|\batr ?\d|king air|caravan|pc-?12|pc-?6|twin otter|metro|jetstream|1900|dornier (228|328)|cheyenne|conquest|tbm ?\d|meridian|air tractor|hercules|c-130|fokker (27|50)|l-?410|kodiak|nomad|piaggio|avanti|mu-2|turbo commander|brasilia|bandeirante|tucano|cn-?235|c-?295/i;
const JET_RE = /boeing 7\d7|737|airbus a3\d\d|a220|embraer (e?1[79]\d|e?2|erj|phenom|legacy|praetor|lineage)|crj|citation|learjet|gulfstream|challenger|global \d|falcon|hawker \d|beechjet|premier|honda ?jet|pc-24|vision jet|eclipse|bae 146|avro rj|fokker (70|100)|\bmd-?\d\d|dc-?(8|9|10)|superjet|comac|c-17|globemaster|poseidon|wedgetail|hornet|f-35/i;

function classify(f, overrides) {
  const code = String(f.aircraft_code || '').toUpperCase();
  const model = String(f.aircraft_model || '');
  if (code && overrides[code] && CLASSES.includes(overrides[code])) return overrides[code];
  if (f.aircraft_category === 'Helicopter' || HELI_CODES.has(code) || HELI_RE.test(model)) return 'helicopter';
  if (TPROP_CODES.has(code) || TPROP_RE.test(model)) return 'turboprop';
  if (JET_CODE_RE.test(code) || JET_RE.test(model)) return 'jet';
  // Unknown type: fast or high is almost certainly a jet, everything else light.
  if ((f.ground_speed || 0) >= 260 || (f.altitude || 0) >= 22000) return 'jet';
  return 'light';
}

// ---- icons: top-down, nose up, 64x64 --------------------------------------
// Each shape is a list of separate parts. They are drawn twice: once as a thick
// dark outline and once as the fill on top, so overlapping parts merge into one
// clean silhouette with no seams or holes.
const part = (d, t = '') => `<path d="${d}"${t ? ` transform="${t}"` : ''}/>`;
const SHAPES = {
  jet: {
    parts: [
      part('M32 3C34.2 3 35.2 6 35.2 10V52C35.2 56 33.8 61 32 61S28.8 56 28.8 52V10C28.8 6 29.8 3 32 3Z'),
      part('M29 24.5 3 39.5V43.5L29 36Z'), part('M35 24.5 61 39.5V43.5L35 36Z'),
      part('M14.2 29.8h4.2v8.4h-4.2z'), part('M45.6 29.8h4.2v8.4h-4.2z'),
      part('M29 48.5 18 57V60L29 55.5Z'), part('M35 48.5 46 57V60L35 55.5Z'),
    ],
  },
  turboprop: {
    parts: [
      part('M32 4C34 4 34.8 6.5 34.8 10V54C34.8 57.5 33.4 60.5 32 60.5S29.2 57.5 29.2 54V10C29.2 6.5 30 4 32 4Z'),
      part('M29.5 22.5 4 24.5V29.5L29.5 31Z'), part('M34.5 22.5 60 24.5V29.5L34.5 31Z'),
      part('M16.6 16.5h4.8v18h-4.8z'), part('M42.6 16.5h4.8v18h-4.8z'),
      part('M12 14.6h14v2h-14z'), part('M38 14.6h14v2h-14z'),
      part('M29.5 51.5 18.5 52.5V56.5L29.5 57Z'), part('M34.5 51.5 45.5 52.5V56.5L34.5 57Z'),
    ],
  },
  light: {
    parts: [
      part('M32 8.5C34 8.5 34.9 10.5 34.9 13.5L34.6 30 33.2 56H30.8L29.4 30 29.1 13.5C29.1 10.5 30 8.5 32 8.5Z'),
      part('M24.5 5.8h15v2.2h-15z'),
      part('M3 21.3C3 20.3 3.8 19.5 4.8 19.5H59.2C60.2 19.5 61 20.3 61 21.3V25.7C61 26.7 60.2 27.5 59.2 27.5H4.8C3.8 27.5 3 26.7 3 25.7Z'),
      part('M20 51.1C20 50.2 20.7 49.5 21.6 49.5H42.4C43.3 49.5 44 50.2 44 51.1V53.9C44 54.8 43.3 55.5 42.4 55.5H21.6C20.7 55.5 20 54.8 20 53.9Z'),
    ],
  },
  helicopter: {
    under: '<circle cx="32" cy="27" r="24.5" fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-opacity=".5" stroke-width="1.2"/>',
    parts: [
      part('M32 13.5C37.2 13.5 40 18.5 40 25S37.2 38.5 32 38.5 24 31.5 24 25 26.8 13.5 32 13.5Z'),
      part('M30.6 36h2.8v20.5h-2.8z'), part('M26.5 53.6h11v3h-11z'), part('M36.4 50h2v9h-2z'),
      part('M31.1 3.5h1.8v47h-1.8z', 'rotate(45 32 27)'), part('M31.1 3.5h1.8v47h-1.8z', 'rotate(-45 32 27)'),
    ],
  },
};

function iconSvg(cls, color, px, heading = 0) {
  const s = SHAPES[cls], parts = s.parts.join('');
  return `<svg class="ac" viewBox="0 0 64 64" width="${px}" height="${px}" style="color:${color};transform:rotate(${heading}deg)">${s.under || ''}`
    + `<g opacity=".72" fill="#111" stroke="#111" stroke-width="3.4" stroke-linejoin="round">${parts}</g>`
    + `<g fill="${color}">${parts}</g></svg>`;
}

// ---- helpers --------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ident = (f) => f.flight_number || f.callsign || f.aircraft_registration || f.aircraft_code || '—';
function altText(f) {
  if (f.on_ground) return 'GND';
  const a = Number(f.altitude) || 0;
  return a >= 10000 ? `FL${Math.round(a / 100)}` : `${a.toLocaleString()} ft`;
}
function project(lat, lon, bearingDeg, km) {
  const R = 6371, d = km / R, t = (bearingDeg * Math.PI) / 180;
  const p1 = (lat * Math.PI) / 180, l1 = (lon * Math.PI) / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [(p2 * 180) / Math.PI, (l2 * 180) / Math.PI];
}

let leafletPromise;
function loadLeaflet() {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LEAFLET.js;
      s.integrity = LEAFLET.jsSri;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve(window.L);
      s.onerror = () => { leafletPromise = null; reject(new Error('Could not load Leaflet from the CDN')); };
      document.head.appendChild(s);
    });
  }
  return leafletPromise;
}

const TILES = {
  dark: [
    ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', 16],
    ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', 16],
  ],
  light: [
    ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', 16],
    ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', 16],
  ],
  satellite: [
    ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 18],
    ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', 18],
  ],
  osm: [['https://tile.openstreetmap.org/{z}/{x}/{y}.png', 19]],
};
const ATTRIB = { osm: '&copy; OpenStreetMap contributors', other: 'Tiles &copy; Esri' };

const STYLE = `
  :host { display: block; }
  ha-card { overflow: hidden; }
  .wrap { position: relative; }
  .map { width: 100%; background: #1e1f22; }
  :host(.light) .map { background: #e8e8e8; }
  .err { padding: 16px; color: var(--error-color, #db4437); }
  .ac-icon { background: none; border: 0; }
  .ac-icon svg { display: block; transition: transform .6s linear; overflow: visible; }
  .ac-icon.ground svg { opacity: .55; }
  .ac-icon.featured svg { filter: drop-shadow(0 0 4px #fff) drop-shadow(0 0 7px currentColor); }
  .leaflet-tooltip.ac-label {
    background: rgba(18,18,20,.72); color: #fff; border: 0; border-radius: 4px; box-shadow: none;
    padding: 1px 5px; font: 600 11px/1.25 var(--ha-font-family-body, system-ui, sans-serif); white-space: nowrap;
  }
  :host(.light) .leaflet-tooltip.ac-label { background: rgba(255,255,255,.88); color: #111; }
  .leaflet-tooltip.ac-label::before { display: none; }
  .ac-label small { display: block; font-weight: 500; opacity: .8; font-size: 10px; }
  .ac-label.featured { outline: 1.5px solid currentColor; }
  .atm-legend {
    background: var(--card-background-color, #fff); color: var(--primary-text-color, #111);
    border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,.35); font: 12px/1.2 var(--ha-font-family-body, system-ui, sans-serif);
  }
  :host(:not(.light)) .leaflet-bar { border-color: rgba(255,255,255,.15); }
  :host(:not(.light)) .leaflet-bar a { background: #26272b; color: #e6e6e6; border-bottom-color: rgba(255,255,255,.12); }
  :host(:not(.light)) .leaflet-bar a:hover { background: #33353a; }
  :host(:not(.light)) .leaflet-bar a.leaflet-disabled { background: #1f2023; color: #666; }
  :host(:not(.light)) .leaflet-control-attribution { background: rgba(0,0,0,.55); color: #bbb; }
  :host(:not(.light)) .leaflet-control-attribution a { color: #8fd3ff; }
  .leaflet-bar a.atm-fit { font-size: 16px; }
  .atm-legend { padding: 4px; }
  .atm-legend button {
    all: unset; display: flex; align-items: center; gap: 6px; padding: 3px 6px; border-radius: 4px; cursor: pointer; width: 100%; box-sizing: border-box;
  }
  .atm-legend button:hover { background: rgba(127,127,127,.15); }
  .atm-legend button.off { opacity: .35; }
  .atm-legend button svg { flex: none; }
  .atm-legend .n { margin-left: auto; padding-left: 10px; font-variant-numeric: tabular-nums; opacity: .75; }
  .leaflet-popup-content-wrapper, .leaflet-popup-tip { background: var(--card-background-color, #fff); color: var(--primary-text-color, #111); }
  .leaflet-popup-content { margin: 10px 12px; font: 13px/1.4 var(--ha-font-family-body, system-ui, sans-serif); }
  .pop img { display: block; width: 100%; border-radius: 4px; margin-bottom: 6px; }
  .pop h3 { margin: 0 0 2px; font-size: 16px; display: flex; align-items: center; gap: 6px; }
  .pop .chip { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 8px; color: #111; }
  .pop .muted { opacity: .7; }
  .pop table { border-collapse: collapse; margin-top: 6px; width: 100%; }
  .pop td { padding: 1px 0; }
  .pop td + td { text-align: right; font-variant-numeric: tabular-nums; }
  .pop a { color: var(--primary-color, #03a9f4); }
`;

class AircraftTypeMapCard extends HTMLElement {
  static getStubConfig() { return { entity: 'sensor.flightradar24_current_in_area' }; }

  setConfig(config) {
    if (!config || !config.entity) throw new Error('Set "entity" to the FlightRadar24 "Current in area" sensor');
    this._config = {
      height: 420, map_style: 'auto', show_tracks: true, show_labels: true, show_legend: true,
      show_home: true, show_radius: true, dead_reckoning: true, icon_scale: 1, ...config,
    };
    this._colors = { ...DEFAULT_COLORS, ...(config.colors || {}) };
    this._overrides = {};
    for (const [k, v] of Object.entries(config.type_overrides || {})) this._overrides[String(k).toUpperCase()] = String(v).toLowerCase();
    if (this._map) this._rebuild();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._started) this._start();
    else if (this._map) this._update();
  }

  getCardSize() { return Math.ceil((Number(this._config?.height) || 420) / 50) + (this._config?.title ? 1 : 0); }

  connectedCallback() {
    if (this._map && !this._timer) this._startTimer();
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    this._timer = null;
  }

  async _start() {
    this._started = true;
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<link rel="stylesheet" href="${LEAFLET.css}" integrity="${LEAFLET.cssSri}" crossorigin="anonymous">
      <style>${STYLE}</style>
      <ha-card ${this._config.title ? `header="${esc(this._config.title)}"` : ''}><div class="wrap"><div class="map"></div></div></ha-card>`;
    this._mapEl = root.querySelector('.map');
    this._mapEl.style.height = `${Number(this._config.height) || 420}px`;
    try {
      this._L = await loadLeaflet();
    } catch (e) {
      root.querySelector('.wrap').innerHTML = `<div class="err">${esc(e.message)}</div>`;
      return;
    }
    this._initMap();
    this._update();
    this._startTimer();
  }

  _initMap() {
    const L = this._L;
    this._planes = new Map();
    this._hidden = new Set();
    this._map = L.map(this._mapEl, { zoomControl: true, scrollWheelZoom: false, attributionControl: true, zoomSnap: 0.25 });
    this._map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    this._overlay = L.layerGroup().addTo(this._map);
    this._trackLayer = L.layerGroup().addTo(this._map);
    this._planeLayer = L.layerGroup().addTo(this._map);

    const Fit = L.Control.extend({
      onAdd: () => {
        const bar = L.DomUtil.create('div', 'leaflet-bar');
        const a = L.DomUtil.create('a', 'atm-fit', bar);
        a.href = '#'; a.title = 'Fit to tracking area'; a.setAttribute('role', 'button'); a.textContent = '⤢';
        L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); L.DomEvent.stopPropagation(e); this._fit(); });
        return bar;
      },
    });
    new Fit({ position: 'topleft' }).addTo(this._map);

    const Legend = L.Control.extend({
      onAdd: () => {
        const d = L.DomUtil.create('div', 'atm-legend');
        L.DomEvent.disableClickPropagation(d);
        this._legendEl = d;
        return d;
      },
    });
    this._legend = new Legend({ position: 'bottomleft' });
    // Once the person pans or zooms, stop auto-fitting until they press the fit button.
    const touched = (e) => { if (!e.target?.closest?.('.atm-legend, .atm-fit')) this._userMoved = true; };
    ['pointerdown', 'wheel', 'dblclick'].forEach((ev) => this._mapEl.addEventListener(ev, touched, { passive: true }));
    this._ro = new ResizeObserver(() => {
      if (!this._map) return;
      this._map.invalidateSize();
      if (!this._userMoved) this._fit();
    });
    this._ro.observe(this._mapEl);
    this._rebuild();
  }

  _theme() {
    const s = this._config.map_style;
    if (s && s !== 'auto') return s;
    return this._hass?.themes?.darkMode === false ? 'light' : 'dark';
  }

  _rebuild() {
    const L = this._L;
    this._mapEl.style.height = `${Number(this._config.height) || 420}px`;
    const theme = this._theme();
    this._appliedTheme = theme;
    this.classList.toggle('light', theme === 'light' || theme === 'osm');
    (this._tiles || []).forEach((t) => t.remove());
    const defs = this._config.tile_url ? [[this._config.tile_url, 19]] : TILES[theme] || TILES.dark;
    const attribution = this._config.tile_url ? (this._config.tile_attribution || '') : theme === 'osm' ? ATTRIB.osm : ATTRIB.other;
    this._tiles = defs.map(([url, nativeZoom], i) =>
      L.tileLayer(url, { maxZoom: 18, maxNativeZoom: nativeZoom, attribution: i === 0 ? attribution : '' }).addTo(this._map));
    if (this._config.show_legend) this._legend.addTo(this._map); else this._legend.remove();
    for (const p of this._planes.values()) { p.iconKey = null; p.ttKey = null; }
    this._lastStamp = null;
    this._update();
  }

  _bounds() {
    const b = this._stateObj?.attributes?.bounds;
    if (!b) return null;
    const [n, s, w, e] = String(b).split(',').map(Number);
    return [n, s, w, e].every(Number.isFinite) ? { n, s, w, e } : null;
  }

  _fit() {
    if (!this._map || this._mapEl.clientWidth === 0 || this._mapEl.clientHeight === 0) return;
    const b = this._bounds();
    if (b) {
      this._map.fitBounds([[b.s, b.w], [b.n, b.e]], { padding: [6, 6] });
    } else {
      const c = this._home();
      this._map.setView(c || [0, 0], c ? 10 : 2);
    }
    this._userMoved = false;
    this._fitKey = this._stateObj?.attributes?.bounds ?? null;
  }

  _home() {
    const c = this._config, h = this._hass?.config;
    const lat = c.latitude ?? h?.latitude, lon = c.longitude ?? h?.longitude;
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
  }

  _update() {
    const L = this._L, hass = this._hass;
    if (!L || !hass || !this._map) return;
    if (this._theme() !== this._appliedTheme) { this._rebuild(); return; }
    const st = hass.states[this._config.entity];
    this._stateObj = st;
    const hl = this._config.highlight_entity ? hass.states[this._config.highlight_entity]?.attributes?.fr24_id : null;
    const stamp = `${st?.last_updated}|${hl}|${[...this._hidden].join()}`;
    if (stamp === this._lastStamp) return;
    this._lastStamp = stamp;

    // overlay: tracking radius + home
    this._overlay.clearLayers();
    const home = this._home(), b = this._bounds();
    if (this._config.show_radius && home && b) {
      const radiusKm = ((b.n - b.s) / 2) * 111.32;
      L.circle(home, { radius: radiusKm * 1000, color: '#9e9e9e', weight: 1, dashArray: '4 6', fill: false, interactive: false }).addTo(this._overlay);
    }
    if (this._config.show_home && home) {
      L.circleMarker(home, { radius: 5, color: '#fff', weight: 2, fillColor: '#03a9f4', fillOpacity: 1, interactive: false }).addTo(this._overlay);
    }
    if (!this._userMoved && (st?.attributes?.bounds ?? null) !== this._fitKey) this._fit();

    const flights = Array.isArray(st?.attributes?.flights) ? st.attributes.flights : [];
    const counts = { jet: 0, turboprop: 0, light: 0, helicopter: 0 };
    const seen = new Set();
    const now = Date.now();
    for (const f of flights) {
      if (!Number.isFinite(f.latitude) || !Number.isFinite(f.longitude)) continue;
      const id = f.id || f.aircraft_icao_24bit || ident(f);
      seen.add(id);
      const cls = classify(f, this._overrides);
      counts[cls] += 1;
      let p = this._planes.get(id);
      if (!p) {
        p = { marker: L.marker([f.latitude, f.longitude], { keyboard: false }), track: L.polyline([], { weight: 2, opacity: 0.55, interactive: false }) };
        p.marker.bindPopup(() => this._popup(p), { maxWidth: 260, minWidth: 220, autoPanPadding: [20, 20] });
        this._planes.set(id, p);
      }
      if (!p.f || p.f.latitude !== f.latitude || p.f.longitude !== f.longitude) p.fixAt = now;
      p.f = f;
      const featured = hl && hl === f.id;
      const px = Math.round((ICON_PX[cls] || 28) * (Number(this._config.icon_scale) || 1) * (f.on_ground ? 0.8 : 1));
      const iconKey = `${cls}|${px}|${featured}|${!!f.on_ground}`;
      if (p.iconKey !== iconKey) {
        p.iconKey = iconKey;
        p.cls = cls;
        p.marker.setIcon(L.divIcon({
          className: `ac-icon${f.on_ground ? ' ground' : ''}${featured ? ' featured' : ''}`,
          html: iconSvg(cls, this._colors[cls], px, Number(f.heading) || 0),
          iconSize: [px, px], iconAnchor: [px / 2, px / 2], popupAnchor: [0, -px / 2],
        }));
        p.marker.setZIndexOffset(featured ? 1000 : { jet: 300, turboprop: 200, helicopter: 100, light: 0 }[cls]);
      }
      p.marker.setLatLng([f.latitude, f.longitude]);
      if (this._config.show_labels) {
        const html = `${esc(ident(f))}<small>${esc(altText(f))}</small>`;
        const ttKey = `${px}|${featured}`;
        if (p.ttKey !== ttKey) {
          p.marker.unbindTooltip();
          p.marker.bindTooltip(html, { permanent: true, direction: 'right', offset: [px / 2, 0], className: `ac-label${featured ? ' featured' : ''}` });
          p.ttKey = ttKey;
        } else p.marker.setTooltipContent(html);
      } else if (p.ttKey) { p.marker.unbindTooltip(); p.ttKey = null; }
      const coords = Array.isArray(f.coordinates) ? f.coordinates.filter((c) => Array.isArray(c) && c.length >= 2) : [];
      p.track.setLatLngs(coords);
      p.track.setStyle({ color: this._colors[cls] });
      const visible = !this._hidden.has(cls);
      this._show(p.marker, this._planeLayer, visible);
      this._show(p.track, this._trackLayer, visible && this._config.show_tracks && coords.length > 1);
      this._rotate(p);
    }
    for (const [id, p] of this._planes) {
      if (seen.has(id)) continue;
      p.marker.remove(); p.track.remove();
      this._planes.delete(id);
    }
    this._renderLegend(counts);
  }

  _show(layer, group, on) {
    if (on && !group.hasLayer(layer)) group.addLayer(layer);
    else if (!on && group.hasLayer(layer)) group.removeLayer(layer);
  }

  _rotate(p) {
    const svg = p.marker.getElement()?.querySelector('svg.ac');
    if (svg) svg.style.transform = `rotate(${Number(p.f.heading) || 0}deg)`;
  }

  _renderLegend(counts) {
    if (!this._legendEl || !this._config.show_legend) return;
    this._legendEl.innerHTML = CLASSES.map((c) =>
      `<button data-c="${c}" class="${this._hidden.has(c) ? 'off' : ''}" title="Show/hide ${CLASS_NAMES[c].toLowerCase()}">${iconSvg(c, this._colors[c], 16)}<span>${CLASS_NAMES[c]}</span><span class="n">${counts[c]}</span></button>`).join('');
    this._legendEl.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => {
      const c = btn.dataset.c;
      if (this._hidden.has(c)) this._hidden.delete(c); else this._hidden.add(c);
      this._update();
    }));
  }

  _popup(p) {
    const f = p.f, cls = p.cls || classify(f, this._overrides);
    const photo = typeof f.aircraft_photo_medium === 'string' && f.aircraft_photo_medium.startsWith('https://') ? f.aircraft_photo_medium : null;
    const o = f.airport_origin_code_iata, d = f.airport_destination_code_iata;
    const route = o || d
      ? `${esc(f.airport_origin_city || o || '?')} <span class="muted">${esc(o || '')}</span> → ${esc(f.airport_destination_city || d || '?')} <span class="muted">${esc(d || '')}</span>`
      : '';
    const kmh = Math.round((Number(f.ground_speed) || 0) * 1.852);
    const fr24 = f.id ? `https://www.flightradar24.com/${encodeURIComponent(f.callsign || f.aircraft_registration || 'flight')}/${encodeURIComponent(f.id)}` : null;
    return `<div class="pop">
      ${photo ? `<img src="${esc(photo)}" alt="" loading="lazy">` : ''}
      <h3>${esc(ident(f))}<span class="chip" style="background:${this._colors[cls]}">${CLASS_NAMES[cls]}</span></h3>
      <div>${esc(f.airline || 'Unknown operator')}</div>
      <div class="muted">${esc(f.aircraft_model || f.aircraft_code || '')}${f.aircraft_registration ? ` · ${esc(f.aircraft_registration)}` : ''}</div>
      ${route ? `<div style="margin-top:4px">${route}</div>` : ''}
      <table>
        <tr><td>Altitude</td><td>${esc(altText(f))}${!f.on_ground && f.altitude >= 10000 ? ` <span class="muted">(${Number(f.altitude).toLocaleString()} ft)</span>` : ''}</td></tr>
        <tr><td>Speed</td><td>${esc(f.ground_speed ?? '–')} kts <span class="muted">(${kmh} km/h)</span></td></tr>
        <tr><td>Heading</td><td>${esc(f.heading ?? '–')}°</td></tr>
        <tr><td>Distance</td><td>${Number.isFinite(f.distance) ? f.distance.toFixed(1) : '–'} km</td></tr>
      </table>
      ${fr24 ? `<div style="margin-top:6px"><a href="${esc(fr24)}" target="_blank" rel="noopener noreferrer">Open in Flightradar24</a></div>` : ''}
    </div>`;
  }

  _startTimer() {
    clearInterval(this._timer);
    this._timer = setInterval(() => this._tick(), 1000);
  }

  _tick() {
    if (!this._map || !this._config.dead_reckoning) return;
    const now = Date.now();
    for (const p of this._planes.values()) {
      const f = p.f;
      const gs = Number(f?.ground_speed) || 0;
      if (!f || f.on_ground || gs < 40 || !p.fixAt) continue;
      const secs = Math.min((now - p.fixAt) / 1000, 60);
      const pos = project(f.latitude, f.longitude, Number(f.heading) || 0, (gs * 1.852 * secs) / 3600);
      p.marker.setLatLng(pos);
      this._rotate(p);
    }
  }
}

if (!customElements.get('aircraft-type-map-card')) {
  customElements.define('aircraft-type-map-card', AircraftTypeMapCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: 'aircraft-type-map-card',
    name: 'Aircraft Type Map Card',
    description: 'FlightRadar24 map with jet, turboprop, light-aircraft and helicopter icons',
    preview: false,
  });
  console.info(`%c AIRCRAFT-TYPE-MAP-CARD %c v${ATM_VERSION} `, 'background:#ffb300;color:#111;font-weight:700', 'background:#333;color:#fff');
}
