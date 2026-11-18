
'use strict';

// ============================================================
// SmartBuilding Group D — Final Student Dashboard
// Device: ENV_GROUP_D_01
// Public GitHub Pages JavaScript
//
// SECURITY:
// Never hardcode dashboard passwords, ESP32 tokens,
// Supabase service_role keys, or other secrets.
// ============================================================

const API_URL =
  'https://izbtxfmkfmkfledrqtpu.supabase.co/functions/v1/read-group-data';

const DEVICE_ID = 'ENV_GROUP_D_01';

const MAX_POINTS = 60;
const REFRESH_MS = 30000;
const REQUEST_TIMEOUT_MS = 12000;
const STALE_AFTER_MS = 120000;
const FUTURE_TOLERANCE_MS = 60000;

const $ = id => document.getElementById(id);

let accessCode = '';
let rows = [];
let timer = null;
let inFlight = false;
let connecting = false;
let sessionId = 0;
let activeController = null;

// ============================================================
// Data Formatting
// ============================================================

const number = v => {
  if (
    v === null ||
    v === undefined ||
    v === '' ||
    typeof v === 'boolean'
  ) {
    return null;
  }

  const n = Number(v);

  return Number.isFinite(n)
    ? n
    : null;
};

const format = (v, digits = 1) => {
  const n = number(v);

  return n === null
    ? '—'
    : n.toFixed(digits);
};

const dateText = v => {
  if (!v) return '—';

  const d = new Date(v);

  return Number.isFinite(d.getTime())
    ? d.toLocaleString()
    : '—';
};

// ============================================================
// UI Status
// ============================================================

function status(text, css = '') {
  $('status').textContent = text;
  $('status').className = 'status ' + css;
}

function message(text) {
  $('message').textContent = text;
}

function clearReadings() {
  const ids = [
    'temperature',
    'humidity',
    'lux1',
    'lux2',
    'delta',
    'absolute',
    'motion',
    'sampletime',
    'recorded',
    'received'
  ];

  for (const id of ids) {
    $(id).textContent = '—';
  }
}

// ============================================================
// API Communication
// ============================================================

async function api(action, key, signal) {
  const response = await fetch(API_URL, {
    method: 'POST',
    cache: 'no-store',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-dashboard-key': key
    },
    body: JSON.stringify({
      action,
      device_id: DEVICE_ID
    })
  });

  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error(
      'Server returned an invalid response.'
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        'Incorrect Group D access code.'
      );
    }

    if (response.status === 403) {
      throw new Error(
        'Access denied. Check the access code and approved GitHub Pages origin.'
      );
    }

    throw new Error(
      result?.error || `HTTP ${response.status}`
    );
  }

  if (
    !result ||
    typeof result !== 'object' ||
    result.device_id !== DEVICE_ID
  ) {
    throw new Error(
      'Unexpected device ID in server response.'
    );
  }

  if (
    action === 'recent' &&
    !Array.isArray(result.rows)
  ) {
    throw new Error(
      'Invalid recent-data response.'
    );
  }

  if (
    action === 'latest' &&
    !Object.prototype.hasOwnProperty.call(
      result,
      'latest'
    )
  ) {
    throw new Error(
      'Invalid latest-data response.'
    );
  }

  return result;
}

// ============================================================
// Historical Data Management
// ============================================================

function appendRow(row) {
  if (
    !row ||
    typeof row.record_id !== 'string' ||
    !Number.isFinite(
      Date.parse(row.recorded_at)
    )
  ) {
    return;
  }

  const index = rows.findIndex(
    x => x.record_id === row.record_id
  );

  if (index >= 0) {
    rows[index] = row;
  } else {
    rows.push(row);
  }

  rows.sort((a, b) =>
    Date.parse(a.recorded_at) -
    Date.parse(b.recorded_at) ||
    String(a.record_id).localeCompare(
      String(b.record_id)
    )
  );

  rows = rows.slice(-MAX_POINTS);
}

// ============================================================
// Latest Sensor Readings
// ============================================================

function showLatest(r) {
  if (!r) {
    clearReadings();

    status('No samples', 'stale');

    message(
      'No records found for this device.'
    );

    return;
  }

  const a = number(
    r.illuminance_1_lux
  );

  const b = number(
    r.illuminance_2_lux
  );

  const delta =
    a === null || b === null
      ? null
      : b - a;

  // Temperature and humidity
  $('temperature').textContent =
    format(r.temperature_c);

  $('humidity').textContent =
    format(r.humidity_rh);

  // Illuminance sensors
  $('lux1').textContent =
    format(a, 0);

  $('lux2').textContent =
    format(b, 0);

  // Signed difference: Sensor 2 - Sensor 1
  $('delta').textContent =
    format(delta, 1);

  // Absolute difference
  $('absolute').textContent =
    format(
      delta === null
        ? null
        : Math.abs(delta),
      1
    );

  // PIR motion
  $('motion').textContent =
    r.motion_detected === true
      ? 'Detected'
      : r.motion_detected === false
        ? 'Clear'
        : '—';

  // Timestamps
  $('sampletime').textContent =
    dateText(r.recorded_at);

  $('recorded').textContent =
    dateText(r.recorded_at);

  $('received').textContent =
    r.received_at
      ? dateText(r.received_at)
      : 'Not provided by API';

  // Data freshness
  const age =
    Date.now() -
    Date.parse(r.recorded_at);

  if (!Number.isFinite(age)) {
    status(
      'Unknown timestamp',
      'stale'
    );
  } else if (
    age < -FUTURE_TOLERANCE_MS
  ) {
    status(
      'Clock mismatch',
      'stale'
    );
  } else if (
    age > STALE_AFTER_MS
  ) {
    status(
      'Data delayed',
      'stale'
    );
  } else {
    status(
      'Connected · Live',
      'online'
    );
  }
}

// ============================================================
// Five Charts
// ============================================================

const chartConfigs = [
  {
    id: 'chartLux',
    lines: [
      {
        label: 'Sensor 1',
        field: r =>
          number(r.illuminance_1_lux),
        color: '#18b7c5'
      },
      {
        label: 'Sensor 2',
        field: r =>
          number(r.illuminance_2_lux),
        color: '#f4c873'
      }
    ]
  },

  {
    id: 'chartDelta',
    lines: [
      {
        label: 'S2 − S1',
        field: r => {
          const a = number(
            r.illuminance_1_lux
          );

          const b = number(
            r.illuminance_2_lux
          );

          return a === null || b === null
            ? null
            : b - a;
        },
        color: '#eea1bd'
      }
    ]
  },

  {
    id: 'chartTemp',
    lines: [
      {
        label: 'Temperature',
        field: r =>
          number(r.temperature_c),
        color: '#18b7c5'
      }
    ]
  },

  {
    id: 'chartHumidity',
    lines: [
      {
        label: 'Humidity',
        field: r =>
          number(r.humidity_rh),
        color: '#8cb8ff'
      }
    ]
  },

  {
    id: 'chartMotion',
    binary: true,
    lines: [
      {
        label: 'PIR',
        field: r =>
          r.motion_detected === true
            ? 1
            : r.motion_detected === false
              ? 0
              : null,
        color: '#b5e68a'
      }
    ]
  }
];

// ============================================================
// Chart Drawing
// ============================================================

function draw(cfg) {
  const canvas = $(cfg.id);

  if (!canvas) return;

  const rect =
    canvas.getBoundingClientRect();

  const w = Math.max(
    260,
    rect.width
  );

  const h = Math.max(
    180,
    rect.height
  );

  const dpr = Math.min(
    window.devicePixelRatio || 1,
    2
  );

  canvas.width =
    Math.round(w * dpr);

  canvas.height =
    Math.round(h * dpr);

  const c = canvas.getContext('2d');

  if (!c) return;

  c.setTransform(
    dpr, 0, 0, dpr, 0, 0
  );

  c.clearRect(
    0, 0, w, h
  );

  const L = 52;
  const R = 14;
  const T = 24;
  const B = 33;

  const pw = w - L - R;
  const ph = h - T - B;

  // Preserve missing values.
  // Do not filter null values before drawing.
  const all = cfg.lines.map(line => ({
    ...line,
    pts: rows.map(r => ({
      t: Date.parse(
        r.recorded_at
      ),
      v: line.field(r)
    }))
  }));

  const valid = all.flatMap(line =>
    line.pts.filter(p =>
      Number.isFinite(p.t) &&
      p.v !== null &&
      Number.isFinite(p.v)
    )
  );

  c.font = '12px system-ui';
  c.fillStyle = '#99b5c1';

  if (!valid.length) {
    c.textAlign = 'center';

    c.fillText(
      'Waiting for readings',
      w / 2,
      h / 2
    );

    return;
  }

  const tMin = Math.min(
    ...valid.map(p => p.t)
  );

  const tMax = Math.max(
    ...valid.map(p => p.t)
  );

  let lo = cfg.binary
    ? -0.15
    : Math.min(
        ...valid.map(p => p.v)
      );

  let hi = cfg.binary
    ? 1.15
    : Math.max(
        ...valid.map(p => p.v)
      );

  if (!cfg.binary) {
    const pad = Math.max(
      (hi - lo) * 0.12,
      Math.abs(hi) * 0.01,
      0.5
    );

    lo -= pad;
    hi += pad;
  }

  // Center a single timestamp.
  const X = t =>
    L + (
      tMax === tMin
        ? pw / 2
        : (t - tMin) /
          (tMax - tMin) * pw
    );

  const Y = v =>
    T + (hi - v) /
    (hi - lo) * ph;

  // Grid and Y-axis
  c.textAlign = 'right';
  c.lineWidth = 1;
  c.strokeStyle = '#315362';

  for (
    let j = 0;
    j <= 4;
    j++
  ) {
    const y =
      T + ph * j / 4;

    c.beginPath();
    c.moveTo(L, y);
    c.lineTo(w - R, y);
    c.stroke();

    const tick =
      hi - (hi - lo) * j / 4;

    c.fillStyle = '#99b5c1';

    c.fillText(
      tick.toFixed(
        cfg.binary
          ? 1
          : hi - lo > 100
            ? 0
            : 1
      ),
      L - 7,
      y + 4
    );
  }

  // Draw each sensor independently.
  for (const line of all) {
    c.strokeStyle = line.color;
    c.fillStyle = line.color;
    c.lineWidth = 2.3;

    let segment = [];

    const flush = () => {
      if (!segment.length) return;

      if (
        segment.length > 1
      ) {
        c.beginPath();

        segment.forEach(
          (p, i) => {
            if (i === 0) {
              c.moveTo(
                X(p.t),
                Y(p.v)
              );
            } else {
              c.lineTo(
                X(p.t),
                Y(p.v)
              );
            }
          }
        );

        c.stroke();
      }

      // Display isolated valid points.
      if (
        segment.length === 1 ||
        rows.length <= 30
      ) {
        for (
          const p of segment
        ) {
          c.beginPath();

          c.arc(
            X(p.t),
            Y(p.v),
            3,
            0,
            Math.PI * 2
          );

          c.fill();
        }
      }

      segment = [];
    };

    for (
      const p of line.pts
    ) {
      if (
        !Number.isFinite(p.t) ||
        p.v === null ||
        !Number.isFinite(p.v)
      ) {
        flush();
        continue;
      }

      segment.push(p);
    }

    flush();
  }

  // X-axis timestamps
  c.textAlign = 'left';
  c.fillStyle = '#99b5c1';

  c.fillText(
    new Date(tMin)
      .toLocaleTimeString(
        [],
        {
          hour: '2-digit',
          minute: '2-digit'
        }
      ),
    L,
    h - 7
  );

  c.textAlign = 'right';

  c.fillText(
    new Date(tMax)
      .toLocaleTimeString(
        [],
        {
          hour: '2-digit',
          minute: '2-digit'
        }
      ),
    w - R,
    h - 7
  );

  // Legend
  let lx = L;

  c.textAlign = 'left';

  for (
    const line of all
  ) {
    c.fillStyle = line.color;

    c.fillRect(
      lx,
      T - 17,
      10,
      3
    );

    c.fillStyle = '#c5dbe3';

    c.fillText(
      line.label,
      lx + 14,
      T - 11
    );

    lx +=
      c.measureText(
        line.label
      ).width + 35;
  }
}

function render() {
  $('count').textContent =
    String(rows.length);

  chartConfigs.forEach(draw);
}

// ============================================================
// Request Lifecycle
// ============================================================

function stopRequests() {
  if (
    timer !== null
  ) {
    clearInterval(timer);
  }

  timer = null;

  if (activeController) {
    activeController.abort();
  }

  activeController = null;
}

async function loadData(
  session,
  key
) {
  if (inFlight) return false;

  inFlight = true;

  const controller =
    new AbortController();

  activeController =
    controller;

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    // Both requests must succeed.
    const [recent, latest] =
      await Promise.all([
        api(
          'recent',
          key,
          controller.signal
        ),
        api(
          'latest',
          key,
          controller.signal
        )
      ]);

    // Ignore old sessions.
    if (
      session !== sessionId ||
      key !== accessCode
    ) {
      return false;
    }

    rows = [];

    for (
      const row of recent.rows
    ) {
      appendRow(row);
    }

    if (latest.latest) {
      appendRow(
        latest.latest
      );

      showLatest(
        latest.latest
      );

      message('');
    } else {
      showLatest(null);
    }

    render();

    return true;

  } catch (err) {
    if (
      session === sessionId &&
      key === accessCode
    ) {
      status(
        'Connection issue',
        'stale'
      );

      message(
        err.name === 'AbortError'
          ? 'Request timed out.'
          : err.message ||
            'Unable to load data.'
      );
    }

    return false;

  } finally {
    clearTimeout(timeout);

    if (
      activeController ===
      controller
    ) {
      activeController = null;
    }

    if (
      session === sessionId
    ) {
      inFlight = false;
    }
  }
}

// ============================================================
// Connect
// ============================================================

async function connect() {
  if (
    connecting ||
    accessCode
  ) {
    return;
  }

  const code =
    $('access').value.trim();

  if (!code) {
    message(
      'Enter your Group D access code.'
    );
    return;
  }

  connecting = true;
  accessCode = code;

  const session =
    ++sessionId;

  $('connect').disabled = true;

  message(
    'Connecting…'
  );

  const success =
    await loadData(
      session,
      code
    );

  if (
    session !== sessionId
  ) {
    return;
  }

  connecting = false;

  if (!success) {
    accessCode = '';
    rows = [];

    clearReadings();
    render();

    status(
      'Not connected'
    );

    $('connect').disabled =
      false;

    $('disconnect').disabled =
      true;

    return;
  }

  $('disconnect').disabled =
    false;

  $('access').value = '';
  $('access').disabled = true;

  if (
    timer !== null
  ) {
    clearInterval(timer);
  }

  timer = setInterval(
    refresh,
    REFRESH_MS
  );
}

// ============================================================
// Refresh
// ============================================================

async function refresh() {
  if (
    !accessCode ||
    connecting ||
    inFlight
  ) {
    return;
  }

  await loadData(
    sessionId,
    accessCode
  );
}

// ============================================================
// Disconnect
// ============================================================

function disconnect() {
  sessionId++;

  stopRequests();

  accessCode = '';
  rows = [];

  inFlight = false;
  connecting = false;

  $('access').value = '';
  $('access').disabled = false;

  $('connect').disabled = false;
  $('disconnect').disabled = true;

  clearReadings();
  render();

  status(
    'Not connected'
  );

  message(
    'Disconnected.'
  );
}

// ============================================================
// Event Listeners
// ============================================================

$('connect').addEventListener(
  'click',
  connect
);

$('disconnect').addEventListener(
  'click',
  disconnect
);

$('access').addEventListener(
  'keydown',
  e => {
    if (
      e.key === 'Enter'
    ) {
      connect();
    }
  }
);

window.addEventListener(
  'resize',
  render
);

// Initial state
clearReadings();
status('Not connected');
render();
