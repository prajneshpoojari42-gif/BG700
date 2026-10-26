const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const path = require('path');
const fs = require('fs');
const dgram = require('dgram');
const TuyAPI = require('tuyapi');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const DATA_DIR = __dirname;
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SCHEDULES_FILE = path.join(DATA_DIR, 'schedules.json');
const MAPS_FILE = path.join(DATA_DIR, 'maps.json');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Default Configurations
const DEFAULT_CONFIG = {
  ip: '192.168.1.100',
  id: '',
  key: '',
  version: '3.3',
  simulationMode: true,
  name: 'Bagotte BG700',
  dpsMap: {
    power: '1',
    mode: '2',
    direction: '3',
    status: '4',
    cleanTime: '5',
    cleanArea: '6',
    battery: '7',
    fault: '8',
    fanSpeed: '9',
    locate: '10',
    dock: '101'
  }
};

// Default Sample Floorplan for BG700 Optimization
const DEFAULT_MAPS = [
  {
    id: 'default-home',
    name: 'Home Floorplan (Ground)',
    isDefault: true,
    scaleMetersPerPixel: 0.02,
    dock: { x: 90, y: 340, angle: 0 },
    rooms: [
      {
        id: 'room-living',
        name: 'Living Room',
        x: 60,
        y: 60,
        width: 320,
        height: 240,
        floorType: 'hardwood',
        friction: 'medium',
        color: '#3b82f6',
        priority: 1,
        recommendedSpeed: 'normal',
        doors: [{ x: 380, y: 170, width: 40 }]
      },
      {
        id: 'room-kitchen',
        name: 'Kitchen & Dining',
        x: 400,
        y: 60,
        width: 250,
        height: 200,
        floorType: 'tile',
        friction: 'low',
        color: '#10b981',
        priority: 2,
        recommendedSpeed: 'gentle',
        doors: [{ x: 400, y: 170, width: 40 }]
      },
      {
        id: 'room-bedroom',
        name: 'Master Bedroom',
        x: 60,
        y: 320,
        width: 280,
        height: 220,
        floorType: 'carpet',
        friction: 'high',
        color: '#8b5cf6',
        priority: 3,
        recommendedSpeed: 'strong',
        doors: [{ x: 340, y: 400, width: 40 }]
      },
      {
        id: 'room-hallway',
        name: 'Central Corridor',
        x: 360,
        y: 280,
        width: 290,
        height: 110,
        floorType: 'hardwood',
        friction: 'medium',
        color: '#f59e0b',
        priority: 4,
        recommendedSpeed: 'gentle',
        doors: [{ x: 380, y: 280, width: 40 }]
      },
      {
        id: 'room-study',
        name: 'Home Office',
        x: 360,
        y: 410,
        width: 290,
        height: 130,
        floorType: 'hardwood',
        friction: 'medium',
        color: '#06b6d4',
        priority: 5,
        recommendedSpeed: 'gentle',
        doors: [{ x: 480, y: 410, width: 40 }]
      }
    ],
    noGoZones: [
      { id: 'nogo-cables', name: 'TV Cable Clutter', x: 75, y: 75, width: 60, height: 45, reason: 'Tangle Risk / Motor Strain' },
      { id: 'nogo-pet', name: 'Pet Feeding Area', x: 570, y: 200, width: 65, height: 50, reason: 'Water Spill Avoidance' }
    ]
  }
];

// Helper to load/save JSON
function loadJson(file, defaults) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error(`Error reading ${file}:`, e.message);
  }
  saveJson(file, defaults);
  return defaults;
}

function saveJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error(`Error writing ${file}:`, e.message);
  }
}

let config = loadJson(CONFIG_FILE, DEFAULT_CONFIG);
let schedules = loadJson(SCHEDULES_FILE, [
  {
    id: 'sched-1',
    name: 'Morning Living Room Eco-Sweep',
    enabled: true,
    time: '08:30',
    days: [1, 2, 3, 4, 5], // Mon-Fri
    mode: 'smart',
    fanSpeed: 'gentle',
    rooms: ['room-living'],
    batteryThreshold: 40,
    lastRun: null
  },
  {
    id: 'sched-2',
    name: 'Weekend Whole House Deep Clean',
    enabled: true,
    time: '11:00',
    days: [0, 6], // Sat-Sun
    mode: 'smart',
    fanSpeed: 'normal',
    rooms: ['room-living', 'room-kitchen', 'room-bedroom', 'room-hallway', 'room-study'],
    batteryThreshold: 60,
    lastRun: null
  }
]);
let maps = loadJson(MAPS_FILE, DEFAULT_MAPS);

// Global Robot State
let robotState = {
  power: false,
  status: 'standby', // standby, smart_clean, spot_clean, wall_clean, charging, docking, paused, fault
  mode: 'smart',     // smart, edge, spot, single_room, manual
  battery: 94,       // 0 - 100%
  cleanTime: 0,      // in minutes
  cleanArea: 0,      // in m²
  fanSpeed: 'normal',// gentle, normal, strong, max
  fault: 0,          // 0 = none
  isCharging: false,
  isDocked: true,
  connected: false,
  simulationMode: config.simulationMode !== false,
  lastUpdated: new Date().toISOString(),
  activeRoom: 'Dock Station',
  pathTrail: []      // Current cleaning coordinates
};

// TuyAPI instance reference
let tuyaDevice = null;
let reconnectTimer = null;
let simulationInterval = null;

// Initialize Tuya Connection or Simulator
function initTuya() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (tuyaDevice) {
    try {
      tuyaDevice.disconnect();
    } catch (e) {}
    tuyaDevice = null;
  }

  if (config.simulationMode || !config.id || !config.key) {
    console.log('[BG700] Starting in Simulation Mode (No physical Tuya device configured or simulation enabled).');
    robotState.simulationMode = true;
    robotState.connected = true;
    startSimulationLoop();
    broadcastState();
    return;
  }

  console.log(`[BG700] Attempting local Tuya connection to IP: ${config.ip}, ID: ${config.id}`);
  robotState.simulationMode = false;
  robotState.connected = false;

  try {
    tuyaDevice = new TuyAPI({
      id: config.id,
      key: config.key,
      ip: config.ip || undefined,
      version: config.version || '3.3',
      issueGetOnConnect: true
    });

    tuyaDevice.on('connected', () => {
      console.log('[BG700] Successfully connected to Bagotte BG700 over Wi-Fi (Tuya protocol)!');
      robotState.connected = true;
      broadcastState();
    });

    tuyaDevice.on('disconnected', () => {
      console.log('[BG700] Disconnected from robot. Will attempt auto-reconnect in 5s...');
      robotState.connected = false;
      broadcastState();
      scheduleReconnect();
    });

    tuyaDevice.on('error', (err) => {
      console.warn('[BG700] Tuya error:', err.message);
      robotState.connected = false;
      broadcastState();
      scheduleReconnect();
    });

    tuyaDevice.on('data', (data) => {
      handleTuyaData(data);
    });

    tuyaDevice.on('dp-refresh', (data) => {
      handleTuyaData(data);
    });

    // Auto-discover IP if blank
    if (!config.ip) {
      console.log('[BG700] Searching for device IP via UDP broadcast...');
      tuyaDevice.find().then(() => {
        tuyaDevice.connect();
      }).catch(err => {
        console.warn('[BG700] find() failed:', err.message, '- Falling back to simulation mode.');
        robotState.simulationMode = true;
        startSimulationLoop();
      });
    } else {
      tuyaDevice.connect().catch(err => {
        console.warn('[BG700] connect() error:', err.message);
        scheduleReconnect();
      });
    }
  } catch (err) {
    console.error('[BG700] Init error:', err.message);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (!config.simulationMode && config.id && config.key) {
      console.log('[BG700] Reconnecting...');
      initTuya();
    }
  }, 8000);
}

// Map DPS data coming from Tuya
function handleTuyaData(data) {
  if (!data || !data.dps) return;
  const dps = data.dps;
  const map = config.dpsMap || DEFAULT_CONFIG.dpsMap;

  if (map.power && dps[map.power] !== undefined) {
    robotState.power = Boolean(dps[map.power]);
  }
  if (map.status && dps[map.status] !== undefined) {
    robotState.status = dps[map.status];
    robotState.isCharging = robotState.status === 'charging';
    robotState.isDocked = robotState.status === 'charging' || (robotState.status === 'standby' && robotState.battery === 100);
  }
  if (map.mode && dps[map.mode] !== undefined) {
    robotState.mode = dps[map.mode];
  }
  if (map.battery && dps[map.battery] !== undefined) {
    robotState.battery = Number(dps[map.battery]);
  }
  if (map.cleanTime && dps[map.cleanTime] !== undefined) {
    robotState.cleanTime = Number(dps[map.cleanTime]);
  }
  if (map.cleanArea && dps[map.cleanArea] !== undefined) {
    robotState.cleanArea = Number(dps[map.cleanArea]);
  }
  if (map.fanSpeed && dps[map.fanSpeed] !== undefined) {
    robotState.fanSpeed = dps[map.fanSpeed];
  }
  if (map.fault && dps[map.fault] !== undefined) {
    robotState.fault = Number(dps[map.fault]);
  }

  robotState.lastUpdated = new Date().toISOString();
  broadcastState();
}

// Send Tuya Command
async function sendTuyaCommand(command, value) {
  if (robotState.simulationMode) {
    return handleSimulatedCommand(command, value);
  }

  if (!tuyaDevice || !robotState.connected) {
    throw new Error('Robot is offline or not connected over local Wi-Fi. Enable Simulation Mode in Settings to test without live hardware.');
  }

  const map = config.dpsMap || DEFAULT_CONFIG.dpsMap;
  let dpsPayload = {};

  switch (command) {
    case 'power':
      dpsPayload[map.power] = Boolean(value);
      break;
    case 'start':
      dpsPayload[map.power] = true;
      if (value && typeof value === 'string') {
        dpsPayload[map.mode] = value;
      }
      break;
    case 'pause':
      dpsPayload[map.status] = 'paused';
      break;
    case 'stop':
      dpsPayload[map.power] = false;
      dpsPayload[map.status] = 'standby';
      break;
    case 'dock':
      // Some models use 'goto_charge' or bool true on dp 101/12
      dpsPayload[map.dock] = true;
      dpsPayload[map.status] = 'docking';
      break;
    case 'setMode':
      dpsPayload[map.mode] = value;
      break;
    case 'setFanSpeed':
      dpsPayload[map.fanSpeed] = value;
      break;
    case 'drive':
      dpsPayload[map.direction] = value; // forward, backward, turn_left, turn_right, stop
      break;
    case 'locate':
      dpsPayload[map.locate] = true;
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }

  await tuyaDevice.set({ multiple: true, data: dpsPayload });
  return { success: true, command, value };
}

// ---------------------------------------------------------------------
// High-Fidelity Simulation Engine for Interactive Testing & Live Demos
// ---------------------------------------------------------------------
let simCleaningTimer = 0;
let simCoordinates = { x: 90, y: 340, angle: 0 };
let simTargetRoom = null;
let simTrail = [];

function startSimulationLoop() {
  if (simulationInterval) clearInterval(simulationInterval);
  
  // Set default dock coordinates
  const currentMap = maps[0] || DEFAULT_MAPS[0];
  if (currentMap && currentMap.dock) {
    simCoordinates = { ...currentMap.dock };
  }

  simulationInterval = setInterval(() => {
    if (!robotState.simulationMode) return;

    if (robotState.status === 'smart_clean' || robotState.status === 'spot_clean' || robotState.status === 'wall_clean') {
      simCleaningTimer++;
      robotState.cleanTime = Math.floor(simCleaningTimer / 10); // 1 simulated min per 10 seconds
      robotState.cleanArea = +(robotState.cleanTime * 0.85).toFixed(1);

      // Battery consumption depends on fan speed:
      // gentle (eco) = -0.15% per tick, normal = -0.25%, strong = -0.4%, max = -0.6%
      const drainRates = { gentle: 0.1, normal: 0.2, strong: 0.35, max: 0.5 };
      const rate = drainRates[robotState.fanSpeed] || 0.2;
      robotState.battery = Math.max(0, +(robotState.battery - rate).toFixed(1));

      // Move simulated robot along smart path
      simulateMovement();

      // Auto-return if battery critical (< 15%)
      if (robotState.battery <= 15) {
        console.log('[Simulation] Battery critical (<=15%). Auto-returning to dock.');
        robotState.status = 'docking';
      }
    } else if (robotState.status === 'docking') {
      // Step towards dock
      const dock = (maps[0] && maps[0].dock) ? maps[0].dock : { x: 90, y: 340 };
      const dx = dock.x - simCoordinates.x;
      const dy = dock.y - simCoordinates.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 12) {
        simCoordinates.x = dock.x;
        simCoordinates.y = dock.y;
        robotState.status = 'charging';
        robotState.isCharging = true;
        robotState.isDocked = true;
        robotState.activeRoom = 'Dock Station';
        console.log('[Simulation] Dock reached. Now charging.');
      } else {
        simCoordinates.x += (dx / dist) * 10;
        simCoordinates.y += (dy / dist) * 10;
        simCoordinates.angle = Math.atan2(dy, dx) * (180 / Math.PI);
      }
    } else if (robotState.status === 'charging') {
      if (robotState.battery < 100) {
        robotState.battery = Math.min(100, +(robotState.battery + 0.4).toFixed(1));
      } else {
        robotState.isDocked = true;
      }
    }

    robotState.lastUpdated = new Date().toISOString();
    broadcastTelemetry();
  }, 1000);
}

function simulateMovement() {
  const currentMap = maps[0] || DEFAULT_MAPS[0];
  let target = simTargetRoom;

  if (!target && currentMap && currentMap.rooms && currentMap.rooms.length > 0) {
    // Pick first or current active room
    target = currentMap.rooms[0];
    simTargetRoom = target;
  }

  if (target) {
    robotState.activeRoom = target.name;
    // Zig-zag / bounce inside room bounds
    const minX = target.x + 20;
    const maxX = target.x + target.width - 20;
    const minY = target.y + 20;
    const maxY = target.y + target.height - 20;

    let step = 8;
    let rad = (simCoordinates.angle * Math.PI) / 180;
    let nextX = simCoordinates.x + Math.cos(rad) * step;
    let nextY = simCoordinates.y + Math.sin(rad) * step;

    // Bounce off walls
    if (nextX <= minX || nextX >= maxX) {
      simCoordinates.angle = 180 - simCoordinates.angle + (Math.random() * 20 - 10);
      nextX = Math.max(minX, Math.min(maxX, nextX));
    }
    if (nextY <= minY || nextY >= maxY) {
      simCoordinates.angle = -simCoordinates.angle + (Math.random() * 20 - 10);
      nextY = Math.max(minY, Math.min(maxY, nextY));
    }

    simCoordinates.x = nextX;
    simCoordinates.y = nextY;

    // Record trail point (keep last 120 points)
    simTrail.push({ x: Math.round(nextX), y: Math.round(nextY) });
    if (simTrail.length > 150) simTrail.shift();
  }
}

function handleSimulatedCommand(command, value) {
  switch (command) {
    case 'power':
    case 'start':
      robotState.power = true;
      robotState.status = value === 'edge' ? 'wall_clean' : (value === 'spot' ? 'spot_clean' : 'smart_clean');
      robotState.isCharging = false;
      robotState.isDocked = false;
      if (value) robotState.mode = value;
      break;
    case 'pause':
      robotState.status = 'paused';
      break;
    case 'stop':
      robotState.power = false;
      robotState.status = 'standby';
      break;
    case 'dock':
      robotState.status = 'docking';
      robotState.power = false;
      break;
    case 'setMode':
      robotState.mode = value;
      if (robotState.status === 'smart_clean' || robotState.status === 'wall_clean' || robotState.status === 'spot_clean') {
        robotState.status = value === 'edge' ? 'wall_clean' : (value === 'spot' ? 'spot_clean' : 'smart_clean');
      }
      break;
    case 'setFanSpeed':
      robotState.fanSpeed = value;
      break;
    case 'drive':
      // Manual drive coordinates adjustment
      handleManualDrive(value);
      break;
    case 'locate':
      console.log('[Simulation] Robot beeps: "Ding-ding! I am here!"');
      break;
    default:
      break;
  }

  broadcastState();
  return { success: true, simulated: true, command, value };
}

function handleManualDrive(direction) {
  const step = 15;
  switch (direction) {
    case 'forward':
      simCoordinates.y -= step;
      simCoordinates.angle = -90;
      break;
    case 'backward':
      simCoordinates.y += step;
      simCoordinates.angle = 90;
      break;
    case 'turn_left':
      simCoordinates.x -= step;
      simCoordinates.angle = 180;
      break;
    case 'turn_right':
      simCoordinates.x += step;
      simCoordinates.angle = 0;
      break;
    case 'stop':
      break;
  }
  simTrail.push({ x: Math.round(simCoordinates.x), y: Math.round(simCoordinates.y) });
  if (simTrail.length > 150) simTrail.shift();
  broadcastTelemetry();
}

// ---------------------------------------------------------------------
// WebSocket Telemetry Broadcaster
// ---------------------------------------------------------------------
function broadcastState() {
  const payload = JSON.stringify({
    type: 'state',
    data: robotState
  });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function broadcastTelemetry() {
  const payload = JSON.stringify({
    type: 'telemetry',
    data: {
      ...robotState,
      coordinates: simCoordinates,
      trail: simTrail
    }
  });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

wss.on('connection', (ws) => {
  // Immediately send current state and maps on connect
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      state: robotState,
      coordinates: simCoordinates,
      trail: simTrail,
      maps: maps,
      schedules: schedules,
      config: {
        ip: config.ip,
        id: config.id,
        version: config.version,
        simulationMode: robotState.simulationMode
      }
    }
  }));

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.action === 'command') {
        const res = await sendTuyaCommand(msg.command, msg.value);
        ws.send(JSON.stringify({ type: 'command_ack', success: true, result: res }));
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
    }
  });
});

// ---------------------------------------------------------------------
// Background Smart Schedule Runner (Runs every 30 seconds)
// ---------------------------------------------------------------------
setInterval(() => {
  const now = new Date();
  const currentDay = now.getDay(); // 0 = Sun, 1 = Mon ...
  const currentHour = String(now.getHours()).padStart(2, '0');
  const currentMinute = String(now.getMinutes()).padStart(2, '0');
  const currentTimeString = `${currentHour}:${currentMinute}`;
  const todayDateString = now.toISOString().slice(0, 10);

  schedules.forEach(async (sched) => {
    if (!sched.enabled) return;
    if (!sched.days.includes(currentDay)) return;
    if (sched.time !== currentTimeString) return;
    if (sched.lastRun === todayDateString) return; // Prevent duplicate trigger in the same minute

    console.log(`[Scheduler] Triggering schedule: "${sched.name}" at ${currentTimeString}`);

    // Check battery gatekeeper
    if (sched.batteryThreshold && robotState.battery < sched.batteryThreshold) {
      console.warn(`[Scheduler] Aborting "${sched.name}": Battery (${robotState.battery}%) is below minimum safe threshold (${sched.batteryThreshold}%).`);
      return;
    }

    sched.lastRun = todayDateString;
    saveJson(SCHEDULES_FILE, schedules);

    try {
      if (sched.fanSpeed) {
        await sendTuyaCommand('setFanSpeed', sched.fanSpeed);
      }
      await sendTuyaCommand('start', sched.mode || 'smart');
      console.log(`[Scheduler] Successfully started clean for schedule: "${sched.name}"`);
    } catch (err) {
      console.error(`[Scheduler] Error running schedule "${sched.name}":`, err.message);
    }
  });
}, 30000);

// ---------------------------------------------------------------------
// REST API Endpoints
// ---------------------------------------------------------------------

// GET current status
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    state: robotState,
    coordinates: simCoordinates
  });
});

// POST commands (start, pause, stop, dock, setMode, setFanSpeed, drive, locate)
app.post('/api/command', async (req, res) => {
  try {
    const { command, value, roomTarget } = req.body;
    if (roomTarget) {
      const currentMap = maps[0] || DEFAULT_MAPS[0];
      const foundRoom = currentMap.rooms.find(r => r.id === roomTarget);
      if (foundRoom) {
        simTargetRoom = foundRoom;
        robotState.activeRoom = foundRoom.name;
      }
    }
    const result = await sendTuyaCommand(command, value);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET & POST configuration
app.get('/api/config', (req, res) => {
  res.json({
    ip: config.ip,
    id: config.id,
    version: config.version,
    simulationMode: robotState.simulationMode,
    name: config.name,
    hasKey: Boolean(config.key)
  });
});

app.post('/api/config', (req, res) => {
  try {
    const { ip, id, key, version, simulationMode } = req.body;
    if (ip !== undefined) config.ip = ip.trim();
    if (id !== undefined) config.id = id.trim();
    if (key !== undefined && key.trim()) config.key = key.trim();
    if (version !== undefined) config.version = version;
    if (simulationMode !== undefined) config.simulationMode = Boolean(simulationMode);

    saveJson(CONFIG_FILE, config);
    initTuya();

    res.json({
      success: true,
      message: 'Configuration saved and connection re-initialized.',
      config: {
        ip: config.ip,
        id: config.id,
        version: config.version,
        simulationMode: config.simulationMode
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Scan local network for Tuya devices via UDP
app.post('/api/scan-network', (req, res) => {
  console.log('[BG700] Scanning local network for Tuya devices via UDP broadcast...');
  const foundDevices = [];
  const client = dgram.createSocket('udp4');

  client.on('error', (err) => {
    console.warn('[UDP Scan] Error:', err.message);
    try { client.close(); } catch(e){}
    res.json({ success: true, devices: foundDevices });
  });

  client.on('message', (msg, rinfo) => {
    try {
      const str = msg.toString('utf8');
      foundDevices.push({
        ip: rinfo.address,
        port: rinfo.port,
        rawSnippet: str.substring(0, 80)
      });
    } catch(e){}
  });

  try {
    client.bind(() => {
      client.setBroadcast(true);
      setTimeout(() => {
        try { client.close(); } catch(e){}
        res.json({ success: true, devices: foundDevices });
      }, 2500);
    });
  } catch (e) {
    res.json({ success: true, devices: foundDevices });
  }
});

// GET & POST schedules
app.get('/api/schedules', (req, res) => {
  res.json({ schedules });
});

app.post('/api/schedules', (req, res) => {
  try {
    const { id, name, enabled, time, days, mode, fanSpeed, rooms, batteryThreshold } = req.body;
    const existingIndex = schedules.findIndex(s => s.id === id);

    const scheduleObj = {
      id: id || `sched-${Date.now()}`,
      name: name || 'Custom Cleaning',
      enabled: enabled !== undefined ? Boolean(enabled) : true,
      time: time || '09:00',
      days: Array.isArray(days) ? days : [1, 2, 3, 4, 5],
      mode: mode || 'smart',
      fanSpeed: fanSpeed || 'normal',
      rooms: Array.isArray(rooms) ? rooms : [],
      batteryThreshold: batteryThreshold || 30,
      lastRun: null
    };

    if (existingIndex >= 0) {
      schedules[existingIndex] = { ...schedules[existingIndex], ...scheduleObj };
    } else {
      schedules.push(scheduleObj);
    }

    saveJson(SCHEDULES_FILE, schedules);
    res.json({ success: true, schedules });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/schedules/:id', (req, res) => {
  schedules = schedules.filter(s => s.id !== req.params.id);
  saveJson(SCHEDULES_FILE, schedules);
  res.json({ success: true, schedules });
});

// GET & POST Maps & Optimization profiles
app.get('/api/maps', (req, res) => {
  res.json({ maps });
});

app.post('/api/maps', (req, res) => {
  try {
    const updatedMaps = req.body.maps;
    if (Array.isArray(updatedMaps)) {
      maps = updatedMaps;
      saveJson(MAPS_FILE, maps);
      res.json({ success: true, maps });
    } else {
      res.status(400).json({ error: 'maps array required' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Algorithm: Smart Battery & Path Optimizer
// Calculates the optimal traversal sequence, estimated runtime, and battery consumption
app.post('/api/maps/optimize', (req, res) => {
  try {
    const { mapId, selectedRoomIds, globalSpeed } = req.body;
    const currentMap = maps.find(m => m.id === mapId) || maps[0];
    if (!currentMap) return res.status(404).json({ error: 'Map not found' });

    const roomsToClean = currentMap.rooms.filter(r => 
      !selectedRoomIds || selectedRoomIds.length === 0 || selectedRoomIds.includes(r.id)
    );

    const dock = currentMap.dock || { x: 90, y: 340 };
    const scale = currentMap.scaleMetersPerPixel || 0.02;

    // Nearest Neighbor Room Sequencing from Dock to minimize travel distance
    let unvisited = [...roomsToClean];
    let orderedRooms = [];
    let currentPoint = { x: dock.x, y: dock.y };
    let totalTransitDistancePx = 0;
    let totalRoomAreaM2 = 0;

    while (unvisited.length > 0) {
      let nearestIdx = 0;
      let minDistance = Infinity;

      for (let i = 0; i < unvisited.length; i++) {
        const room = unvisited[i];
        const roomCenter = {
          x: room.x + room.width / 2,
          y: room.y + room.height / 2
        };
        const dist = Math.hypot(roomCenter.x - currentPoint.x, roomCenter.y - currentPoint.y);
        if (dist < minDistance) {
          minDistance = dist;
          nearestIdx = i;
        }
      }

      const nextRoom = unvisited.splice(nearestIdx, 1)[0];
      orderedRooms.push(nextRoom);
      totalTransitDistancePx += minDistance;
      currentPoint = {
        x: nextRoom.x + nextRoom.width / 2,
        y: nextRoom.y + nextRoom.height / 2
      };

      const areaM2 = (nextRoom.width * scale) * (nextRoom.height * scale);
      totalRoomAreaM2 += areaM2;
    }

    // Add return-to-dock transit
    totalTransitDistancePx += Math.hypot(dock.x - currentPoint.x, dock.y - currentPoint.y);
    const transitDistanceMeters = totalTransitDistancePx * scale;

    // Bagotte BG700 Cleaning Speed: ~0.8 minutes per m² for methodical zigzag
    const cleaningMinutes = Math.round(totalRoomAreaM2 * 0.75);
    const transitMinutes = Math.max(1, Math.round(transitDistanceMeters / 0.25 / 60)); // 0.25 m/s transit speed
    const totalMinutes = cleaningMinutes + transitMinutes;

    // Battery Drain Model for 2600mAh battery (~100 mins in Eco, ~80 in Normal, ~50 in Boost):
    // Base travel motor + suction motor adjusted by floor friction:
    // Tile (low friction) with Gentle suction: ~0.9% battery per minute
    // Hardwood (med friction) with Normal suction: ~1.2% battery per minute
    // Carpet (high friction) with Boost suction: ~1.8% battery per minute
    let estimatedBatteryUsed = 0;
    orderedRooms.forEach(r => {
      const roomArea = (r.width * scale) * (r.height * scale);
      const roomMins = roomArea * 0.75;
      let rate = 1.2;
      if (r.floorType === 'tile') rate = 0.9;
      else if (r.floorType === 'carpet') rate = 1.7;
      estimatedBatteryUsed += roomMins * rate;
    });
    estimatedBatteryUsed += transitMinutes * 0.8;
    estimatedBatteryUsed = Math.min(95, Math.max(8, Math.round(estimatedBatteryUsed)));

    // Unoptimized random bounce cleans redundantly (+55% more time and battery)
    const unoptimizedBattery = Math.min(100, Math.round(estimatedBatteryUsed * 1.58));
    const batterySavedPercentage = Math.round(((unoptimizedBattery - estimatedBatteryUsed) / unoptimizedBattery) * 100);

    const safeReserve = 15; // 15% reserve required to safely dock
    const isBatterySufficient = robotState.battery >= (estimatedBatteryUsed + safeReserve);

    res.json({
      success: true,
      optimizedPlan: {
        orderedRooms: orderedRooms.map((r, idx) => ({
          order: idx + 1,
          id: r.id,
          name: r.name,
          floorType: r.floorType,
          friction: r.friction,
          recommendedSpeed: r.recommendedSpeed,
          areaM2: +((r.width * scale) * (r.height * scale)).toFixed(1)
        })),
        totalAreaM2: +totalRoomAreaM2.toFixed(1),
        estimatedMinutes: totalMinutes,
        estimatedBatteryUsed,
        unoptimizedBattery,
        batterySavedPercentage,
        currentRobotBattery: robotState.battery,
        isBatterySufficient,
        recommendation: isBatterySufficient 
          ? `Safe to start clean! Robot has ${Math.round(robotState.battery)}% (estimated drain: ${estimatedBatteryUsed}%).` 
          : `Recommend charging robot to at least ${estimatedBatteryUsed + safeReserve}% before starting to prevent exhaustion mid-cleaning.`
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Start Server & Initialize Tuya
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 BG700 Control Web Server listening on port ${PORT}`);
  console.log(`👉 Access URL: http://localhost:${PORT}`);
  console.log(`=======================================================`);
  initTuya();
});
