// ===== CONFIG =====
const LAT_MIN = -40.0, LAT_MAX = -10.0;
const LON_MIN = 110.0, LON_MAX = 154.0;
const STEP = 1.0;

const CONCURRENCY = 3;           // be gentle
const SLEEP_BETWEEN = 300;       // ms between tasks
// 2 / 900 / 150 works quite fine
const MAX_PER_RUN = 300;         // <= 100 requests per run

// ===== URL BUILDER =====
function buildUrl(lat, lon) {
  const adv = "{}";
  const loc = `(${lat},%20${lon})`;
  return `wp-content/themes/freecampsites/androidApp.php?location=${loc}&coordinates=${loc}&advancedSearch=${adv}`;
}

// ===== UTILS =====
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const round6 = (x) => +x.toFixed(6);

// Stable cell key (avoid FP noise)
function cellKey(lat, lon) {
  // snap to step explicitly to kill drift
  const la = round6(Math.round((lat - LAT_MIN) / STEP) * STEP + LAT_MIN);
  const lo = round6(Math.round((lon - LON_MIN) / STEP) * STEP + LON_MIN);
  return `${la},${lo}`;
}

function* gridPoints(latMin, latMax, lonMin, lonMax, step) {
  for (let lat = latMin; lat <= latMax + 1e-9; lat += step) {
    const la = round6(lat);
    for (let lon = lonMin; lon <= lonMax + 1e-9; lon += step) {
      const lo = round6(lon);
      yield [la, lo];
    }
  }
}

// Strip noisy fields
function sanitizeItem(item) {
  if (!item) return null;
  const { rating, table_row, ...rest } = item;
  return rest;
}

// ===== PERSISTED STATE (localStorage) =====
const STATE_KEY = (() => {
  return `fcs.coverage.v1:stuff`;
})();

function loadState() {
  const raw = localStorage.getItem(STATE_KEY);
  if (!raw) return { covered: {} };
  try {
    const parsed = JSON.parse(raw);
    return { covered: parsed.covered || {} };
  } catch {
    return { covered: {} };
  }
}

function saveState(state) {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

// Return first ≤limit cells not covered yet
function nextBatch(limit) {
  const state = loadState();
  const batch = [];
  for (const [lat, lon] of gridPoints(LAT_MIN, LAT_MAX, LON_MIN, LON_MAX, STEP)) {
    const key = cellKey(lat, lon);
    if (!state.covered[key]) {
      batch.push([lat, lon, key]);
      if (batch.length >= limit) break;
    }
  }
  return batch;
}

// ===== FETCH WITH RETRIES (exponential backoff + Retry-After) =====
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 7000; // initial delay

function parseRetryAfter(h) {
  if (!h) return null;
  const asInt = parseInt(h, 10);
  if (!Number.isNaN(asInt)) return asInt * 1000;
  const when = Date.parse(h);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return null;
}

async function fetchWithRetry(url, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) {
        // Respect Retry-After on 429/503/5xx if provided
        const ra = (r.status === 429 || r.status === 503 || (r.status >= 500 && r.status < 600))
          ? parseRetryAfter(r.headers.get('Retry-After'))
          : null;
        if (!r.ok) throw Object.assign(new Error(`${r.status} ${r.statusText}`), { retryAfterMs: ra });
      }

      // Some endpoints sometimes return text; handle both:
      let j;
      try { j = await r.json(); }
      catch { j = JSON.parse(await r.text()); }
      const list = Array.isArray(j?.resultList) ? j.resultList : [];
      return list.map(sanitizeItem).filter(Boolean);

    } catch (err) {
      if (attempt === retries) throw err;

      // Exponential backoff with jitter; prefer Retry-After if larger
      const backoff = BASE_DELAY_MS * 2 ** attempt;
      const jitter = Math.random() * 0.3 * backoff;
      let wait = backoff + jitter;
      if (err && typeof err.retryAfterMs === 'number')
        wait = Math.max(wait, err.retryAfterMs);

      console.warn(
        `Retry ${attempt + 1}/${retries} in ${Math.ceil(wait)} ms for ${url}:`,
        err?.message || err
      );
      await sleep(wait);
    }
  }
}

// ===== CONCURRENCY POOL =====
async function runPool(tasks, k) {
  const out = [];
  let i = 0;

  const workers = Array.from({ length: k }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= tasks.length) break;
      try {
        out[idx] = await tasks[idx]();
      } catch (e) {
        console.error("Task failed:", e);
        out[idx] = [];
      }
      await sleep(SLEEP_BETWEEN);
    }
  });

  await Promise.all(workers);
  return out;
}

function checkProgress() {
  const state = loadState();
  const covered = Object.keys(state.covered).length;

  // Compute total number of grid cells for the current bounds/step
  const totalLat = Math.floor((LAT_MAX - LAT_MIN) / STEP + 1);
  const totalLon = Math.floor((LON_MAX - LON_MIN) / STEP + 1);
  const total = totalLat * totalLon;

  const left = total - covered;
  const pct = ((covered / total) * 100).toFixed(2);

  console.log(`Progress for current bounds/step:`);
  console.log(`  Total squares : ${total}`);
  console.log(`  Done           : ${covered}`);
  console.log(`  Left           : ${left}`);
  console.log(`  Completed      : ${pct}%`);

  return { total, covered, left, pct: Number(pct) };
}
  
async function runIncremental() {
  const state = loadState();
  const batch = nextBatch(MAX_PER_RUN);

  if (batch.length === 0) {
    console.log("All cells covered for current bounds/step.");
    return;
  }

  console.log(`Planned requests this run: ${batch.length} (cap ${MAX_PER_RUN})`);

  const tasks = batch.map(([lat, lon, key]) => async () => {
    const url = buildUrl(lat, lon);
    const res = await fetchWithRetry(url);
    state.covered[key] = true;
    return { key, res };
  });

  const chunks = await runPool(tasks, CONCURRENCY);

  // Merge & dedupe by id (keep the most complete record)
  const byId = new Map();
  for (const item of chunks) {
    const arr = item?.res || [];
    for (const it of arr) {
      if (it?.id == null) continue;
      const prev = byId.get(it.id);
      if (!prev || Object.keys(it).length > Object.keys(prev).length) {
        byId.set(it.id, it);
      }
    }
  }

  const items = [...byId.values()];
  console.log(`Unique items this run: ${items.length}`);
  console.table(items.slice(0, 5).map(p => ({
    id: p.id, name: p.name, lat: p.latitude, lon: p.longitude, url: p.url, fee: p.type_specific?.fee
  })));

  // Optional: keep an accumulated set of discovered IDs in localStorage
  // (IDs only; data can be too big for localStorage — prefer IndexedDB for full objects)

  // Optional: export just this run's data as GeoJSON
  const geojson = {
    type: "FeatureCollection",
    features: items.map(p => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [Number(p.longitude), Number(p.latitude)] },
      properties: p
    }))
  };
  const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: `freecampsites_step${STEP}_run.geojson`
  });
  document.body.appendChild(a); a.click(); URL.revokeObjectURL(a.href); a.remove();

  // Final persist for this run
  saveState(state);
  appendItems(items);
}


// ===== MAIN (INCREMENTAL) =====
(async () => {
  await runIncremental()
})();


const DATA_KEY = `${STATE_KEY}::data`;

function appendItems(items) {
  const existing = JSON.parse(localStorage.getItem(DATA_KEY) || '[]');
  const merged = [...existing, ...items];
  localStorage.setItem(DATA_KEY, JSON.stringify(merged));
}

function downloadAll() {
  const all = JSON.parse(localStorage.getItem(DATA_KEY) || '[]');
  const geojson = {
    type: "FeatureCollection",
    features: all.map(p => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [Number(p.longitude), Number(p.latitude)] },
      properties: p
    }))
  };
  const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: "freecampsites_all.geojson"
  });
  document.body.appendChild(a); a.click(); URL.revokeObjectURL(a.href); a.remove();
}
