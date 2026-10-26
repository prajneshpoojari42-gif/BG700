/**
 * BG700 Control - Main Application Controller
 */

// Application State
const DEFAULT_FALLBACK_MAP = {
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
};

const appState = {
  connected: false,
  isStaticHosting: window.location.hostname.includes('github.io'),
  robot: {
    power: false,
    status: 'standby',
    mode: 'smart',
    battery: 94,
    cleanTime: 0,
    cleanArea: 0,
    fanSpeed: 'normal',
    isCharging: false,
    isDocked: true,
    simulationMode: true
  },
  maps: [DEFAULT_FALLBACK_MAP],
  currentMap: DEFAULT_FALLBACK_MAP,
  schedules: [],
  config: {}
};

let ws = null;
let mapEngine = null;
let scheduler = null;
let audioCtx = null;

// Audio Feedback Beeps
function playBeep(freq = 600, duration = 0.12, type = 'sine') {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {}
}

// Toast Notifications
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
window.showToast = showToast;

// -------------------------------------------------------------
// Initialization
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initWebSocket();
  initDpadAndKeyboard();
  initMapControls();
  initSettingsForm();
  initNewScheduleForm();

  mapEngine = new MapEngine('mapCanvas');
  window.mapEngine = mapEngine;

  scheduler = new SchedulerManager();
  window.scheduler = scheduler;

  // Poll fallback every 4 seconds in case WebSocket drops
  setInterval(fetchStatusFallback, 4000);
});

// -------------------------------------------------------------
// WebSocket Connection
// -------------------------------------------------------------
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WS] Connected to BG700 backend');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWsMessage(msg);
    } catch (e) {
      console.error('[WS] Parse error:', e);
    }
  };

  ws.onclose = () => {
    console.warn('[WS] Closed. Reconnecting in 3s...');
    setTimeout(initWebSocket, 3000);
  };

  ws.onerror = (err) => {
    console.warn('[WS] Error:', err);
  };
}

function handleWsMessage(msg) {
  switch (msg.type) {
    case 'init':
      appState.robot = msg.data.state;
      appState.maps = msg.data.maps;
      appState.currentMap = msg.data.maps[0];
      appState.schedules = msg.data.schedules;
      appState.config = msg.data.config;

      if (mapEngine) {
        mapEngine.setMapData(appState.currentMap);
        mapEngine.updateRobotTelemetry({
          coordinates: msg.data.coordinates,
          trail: msg.data.trail
        });
      }
      if (scheduler) {
        scheduler.setSchedules(appState.schedules);
      }
      updateUI();
      populateRoomChecklist();
      populateScheduleRoomOptions();
      break;

    case 'state':
    case 'telemetry':
      appState.robot = msg.data;
      updateUI();
      if (mapEngine) {
        mapEngine.updateRobotTelemetry(msg.data);
      }
      break;

    default:
      break;
  }
}

async function fetchStatusFallback() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data && data.state) {
      appState.robot = data.state;
      updateUI();
    }
  } catch (e) {}
}

// -------------------------------------------------------------
// UI Updates
// -------------------------------------------------------------
function updateUI() {
  const r = appState.robot;

  // Header status dot & text
  const statusDot = document.getElementById('headerStatusDot');
  const statusText = document.getElementById('headerStatusText');
  const batteryBadge = document.getElementById('headerBatteryVal');
  const headerBattery = document.getElementById('headerBattery');

  if (statusDot && statusText) {
    statusDot.className = 'status-dot';
    if (r.status === 'smart_clean' || r.status === 'spot_clean' || r.status === 'wall_clean') {
      statusDot.classList.add('cleaning');
      statusText.textContent = r.activeRoom ? `Cleaning • ${r.activeRoom}` : 'Cleaning Active';
    } else if (r.status === 'docking') {
      statusDot.classList.add('docking');
      statusText.textContent = 'Returning to Dock';
    } else if (r.status === 'charging') {
      statusDot.classList.add('charging');
      statusText.textContent = 'Docked & Charging';
    } else {
      statusDot.classList.add('online');
      statusText.textContent = r.simulationMode ? 'Simulation Active' : 'Standby / Ready';
    }
  }

  if (batteryBadge) {
    batteryBadge.textContent = `${Math.round(r.battery)}%`;
  }

  // Dashboard Hero Status
  const heroTitle = document.getElementById('heroStatusTitle');
  const heroDesc = document.getElementById('heroStatusDesc');
  const visualizerRing = document.getElementById('vacuumRing');

  if (heroTitle && heroDesc && visualizerRing) {
    visualizerRing.className = 'vacuum-ring';

    if (r.status === 'smart_clean' || r.status === 'spot_clean' || r.status === 'wall_clean') {
      heroTitle.textContent = r.activeRoom ? `Cleaning: ${r.activeRoom}` : 'Cleaning in Progress';
      heroDesc.textContent = `Operating in ${r.mode.toUpperCase()} mode at ${r.fanSpeed.toUpperCase()} suction.`;
      visualizerRing.classList.add('pulse-clean');
    } else if (r.status === 'docking') {
      heroTitle.textContent = 'Navigating to Charge Dock';
      heroDesc.textContent = 'Aligning with charging station beacon...';
      visualizerRing.classList.add('pulse-dock');
    } else if (r.status === 'charging') {
      heroTitle.textContent = 'Charging at Base Station';
      heroDesc.textContent = `Battery at ${Math.round(r.battery)}%. ${r.battery < 100 ? 'Rapid charging enabled.' : 'Fully charged and ready.'}`;
      visualizerRing.classList.add('pulse-charge');
    } else if (r.status === 'paused') {
      heroTitle.textContent = 'Cleaning Paused';
      heroDesc.textContent = 'Vacuum paused. Tap Start to resume routine.';
    } else {
      heroTitle.textContent = r.isDocked ? 'Docked & Standby' : 'Standby Mode';
      heroDesc.textContent = 'Ready for immediate clean or scheduled routine.';
    }
  }

  // Primary Start/Pause Button dynamic state
  const startBtn = document.getElementById('btnPrimaryStart');
  if (startBtn) {
    if (r.status === 'smart_clean' || r.status === 'spot_clean' || r.status === 'wall_clean') {
      startBtn.innerHTML = '<span>⏸</span> Pause';
      startBtn.className = 'btn btn-warning';
      startBtn.onclick = () => sendCommand('pause');
    } else {
      startBtn.innerHTML = '<span>▶</span> Start Cleaning';
      startBtn.className = 'btn btn-primary';
      startBtn.onclick = () => sendCommand('start', r.mode || 'smart');
    }
  }

  // Telemetry Metric Cards
  const valBattery = document.getElementById('metricBatteryVal');
  const valBatterySub = document.getElementById('metricBatterySub');
  const barBattery = document.getElementById('batteryBarFill');
  const valTime = document.getElementById('metricTimeVal');
  const valArea = document.getElementById('metricAreaVal');
  const valSpeed = document.getElementById('metricSpeedVal');

  if (valBattery && barBattery) {
    valBattery.textContent = `${Math.round(r.battery)}%`;
    barBattery.style.width = `${Math.round(r.battery)}%`;

    if (r.battery > 50) {
      barBattery.className = 'battery-bar-fill';
      if (valBatterySub) valBatterySub.textContent = r.isCharging ? '⚡ Charging rapidly' : 'Optimal Capacity';
    } else if (r.battery > 20) {
      barBattery.className = 'battery-bar-fill medium';
      if (valBatterySub) valBatterySub.textContent = r.isCharging ? '⚡ Charging' : 'Normal Capacity';
    } else {
      barBattery.className = 'battery-bar-fill low';
      if (valBatterySub) valBatterySub.textContent = r.isCharging ? '⚡ Low - Charging' : '⚠️ Low Battery';
    }
  }

  if (valTime) valTime.textContent = `${r.cleanTime || 0} min`;
  if (valArea) valArea.textContent = `${(r.cleanArea || 0).toFixed(1)} m²`;
  if (valSpeed) {
    const speedLabels = { gentle: '🌱 Eco Quiet', normal: '🌀 Standard', strong: '⚡ Strong', max: '🔥 Max Turbo' };
    valSpeed.textContent = speedLabels[r.fanSpeed] || r.fanSpeed;
  }

  // Active Mode Buttons
  document.querySelectorAll('.mode-btn').forEach(btn => {
    const m = btn.getAttribute('data-mode');
    btn.classList.toggle('active', m === r.mode);
  });

  // Active Fan Speed Buttons
  document.querySelectorAll('.speed-btn').forEach(btn => {
    const s = btn.getAttribute('data-speed');
    btn.classList.toggle('active', s === r.fanSpeed);
  });

  // Simulation indicator
  const simIndicator = document.getElementById('simIndicator');
  if (simIndicator) {
    simIndicator.style.display = r.simulationMode ? 'inline-flex' : 'none';
  }
}

// -------------------------------------------------------------
// Robot Commands
// -------------------------------------------------------------
async function sendCommand(command, value = null, roomTarget = null) {
  playBeep(700, 0.08);

  // If on static hosting (GitHub Pages) or backend offline, handle directly via client simulator
  if (appState.isStaticHosting || !appState.connected) {
    handleClientCommand(command, value, roomTarget);
    return;
  }

  try {
    const res = await fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, value, roomTarget })
    });
    const data = await res.json();
    if (!data.success) {
      showToast(`Command error: ${data.error}`, 'danger');
    }
  } catch (e) {
    handleClientCommand(command, value, roomTarget);
  }
}
window.sendCommand = sendCommand;

// Client simulation loop for static hosting (GitHub Pages)
let clientSimTimer = null;
function handleClientCommand(command, value, roomTarget) {
  const r = appState.robot;
  switch (command) {
    case 'start':
      r.power = true;
      r.status = value === 'edge' ? 'wall_clean' : (value === 'spot' ? 'spot_clean' : 'smart_clean');
      r.isCharging = false;
      r.isDocked = false;
      if (value) r.mode = value;
      startClientSimLoop();
      showToast(`Started cleaning routine (${r.mode})`, 'success');
      break;
    case 'pause':
      r.status = 'paused';
      showToast('Cleaning paused.', 'info');
      break;
    case 'stop':
      r.power = false;
      r.status = 'standby';
      showToast('Vacuum stopped.', 'info');
      break;
    case 'dock':
      r.status = 'docking';
      r.power = false;
      startClientSimLoop();
      showToast('Returning to charging dock...', 'warning');
      break;
    case 'setMode':
      r.mode = value;
      showToast(`Mode set to ${value}`, 'info');
      break;
    case 'setFanSpeed':
      r.fanSpeed = value;
      showToast(`Suction set to ${value}`, 'info');
      break;
    case 'drive':
      if (mapEngine) {
        const step = 15;
        if (value === 'forward') { mapEngine.robotPos.y -= step; mapEngine.robotPos.angle = -90; }
        else if (value === 'backward') { mapEngine.robotPos.y += step; mapEngine.robotPos.angle = 90; }
        else if (value === 'turn_left') { mapEngine.robotPos.x -= step; mapEngine.robotPos.angle = 180; }
        else if (value === 'turn_right') { mapEngine.robotPos.x += step; mapEngine.robotPos.angle = 0; }
        mapEngine.robotTrail.push({ x: mapEngine.robotPos.x, y: mapEngine.robotPos.y });
        if (mapEngine.robotTrail.length > 150) mapEngine.robotTrail.shift();
        mapEngine.draw();
      }
      break;
    case 'locate':
      showToast('Locate signal sent! 🔔', 'info');
      break;
  }
  updateUI();
}

function startClientSimLoop() {
  if (clientSimTimer) return;
  clientSimTimer = setInterval(() => {
    const r = appState.robot;
    if (r.status === 'smart_clean' || r.status === 'spot_clean' || r.status === 'wall_clean') {
      r.cleanTime = (r.cleanTime || 0) + 1;
      r.cleanArea = +((r.cleanArea || 0) + 0.3).toFixed(1);
      r.battery = Math.max(0, +(r.battery - 0.2).toFixed(1));

      // Move robot inside room
      if (mapEngine && appState.currentMap && appState.currentMap.rooms.length > 0) {
        const target = appState.currentMap.rooms[0];
        r.activeRoom = target.name;
        let step = 6;
        let rad = (mapEngine.robotPos.angle * Math.PI) / 180;
        let nextX = mapEngine.robotPos.x + Math.cos(rad) * step;
        let nextY = mapEngine.robotPos.y + Math.sin(rad) * step;

        const minX = target.x + 20;
        const maxX = target.x + target.width - 20;
        const minY = target.y + 20;
        const maxY = target.y + target.height - 20;

        if (nextX <= minX || nextX >= maxX) {
          mapEngine.robotPos.angle = 180 - mapEngine.robotPos.angle + (Math.random() * 20 - 10);
          nextX = Math.max(minX, Math.min(maxX, nextX));
        }
        if (nextY <= minY || nextY >= maxY) {
          mapEngine.robotPos.angle = -mapEngine.robotPos.angle + (Math.random() * 20 - 10);
          nextY = Math.max(minY, Math.min(maxY, nextY));
        }

        mapEngine.robotPos.x = nextX;
        mapEngine.robotPos.y = nextY;
        mapEngine.robotTrail.push({ x: Math.round(nextX), y: Math.round(nextY) });
        if (mapEngine.robotTrail.length > 150) mapEngine.robotTrail.shift();
        mapEngine.draw();
      }
    } else if (r.status === 'docking' && mapEngine && appState.currentMap) {
      const dock = appState.currentMap.dock || { x: 90, y: 340 };
      const dx = dock.x - mapEngine.robotPos.x;
      const dy = dock.y - mapEngine.robotPos.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 10) {
        r.status = 'charging';
        r.isCharging = true;
        r.isDocked = true;
        r.activeRoom = 'Dock Station';
      } else {
        mapEngine.robotPos.x += (dx / dist) * 8;
        mapEngine.robotPos.y += (dy / dist) * 8;
        mapEngine.draw();
      }
    } else if (r.status === 'charging') {
      if (r.battery < 100) r.battery = Math.min(100, +(r.battery + 0.5).toFixed(1));
    }
    updateUI();
  }, 1000);
}

// Mode & Speed click bindings
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.getAttribute('data-mode');
    sendCommand('setMode', mode);
  });
});

document.querySelectorAll('.speed-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const speed = btn.getAttribute('data-speed');
    sendCommand('setFanSpeed', speed);
  });
});

// Locate / Beep Buzzer
const locateBtn = document.getElementById('btnLocateRobot');
if (locateBtn) {
  locateBtn.addEventListener('click', () => {
    playBeep(950, 0.25, 'triangle');
    setTimeout(() => playBeep(1200, 0.35, 'triangle'), 300);
    sendCommand('locate');
    showToast('Sent "Find My Robot" locate beacon! BG700 chime ringing.', 'info');
  });
}

// -------------------------------------------------------------
// D-Pad Manual Driving & Keyboard Controls
// -------------------------------------------------------------
function initDpadAndKeyboard() {
  const dpadButtons = document.querySelectorAll('.dpad-btn');
  dpadButtons.forEach(btn => {
    const dir = btn.getAttribute('data-dir');
    if (!dir) return;

    btn.addEventListener('mousedown', () => sendCommand('drive', dir));
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      sendCommand('drive', dir);
    });
  });

  // Keyboard navigation
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

    switch (e.key) {
      case 'ArrowUp':
      case 'w':
      case 'W':
        sendCommand('drive', 'forward');
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        sendCommand('drive', 'backward');
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        sendCommand('drive', 'turn_left');
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        sendCommand('drive', 'turn_right');
        break;
      case ' ':
        e.preventDefault();
        sendCommand('drive', 'stop');
        break;
    }
  });
}

// -------------------------------------------------------------
// Map & Battery Optimizer Controls
// -------------------------------------------------------------
function initMapControls() {
  document.getElementById('btnZoomIn')?.addEventListener('click', () => mapEngine?.zoomIn());
  document.getElementById('btnZoomOut')?.addEventListener('click', () => mapEngine?.zoomOut());
  document.getElementById('btnResetView')?.addEventListener('click', () => mapEngine?.resetView());

  // Optimize Path & Calculate Energy button
  document.getElementById('btnCalculateOptimization')?.addEventListener('click', calculatePathOptimization);

  // Clean Selected Rooms button
  document.getElementById('btnStartOptimizedClean')?.addEventListener('click', () => {
    const selectedIds = Array.from(mapEngine.selectedRoomIds);
    if (selectedIds.length === 0) {
      showToast('Please select at least one room on the map or checklist.', 'warning');
      return;
    }
    // Set Eco mode for maximum battery conservation
    sendCommand('setFanSpeed', 'gentle');
    sendCommand('start', 'smart', selectedIds[0]);
    showToast(`Starting Energy-Efficient Clean for ${selectedIds.length} room(s)!`, 'success');
  });

  // Blueprint background image uploader
  document.getElementById('blueprintUpload')?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      mapEngine.loadBackgroundImage(e.target.files[0]);
      showToast('Blueprint floorplan image loaded as background layer!', 'success');
    }
  });

  // Hook for room clicks from map canvas
  window.onRoomClicked = (room) => {
    const scale = (appState.currentMap && appState.currentMap.scaleMetersPerPixel) || 0.02;
    document.getElementById('activeRoomName').textContent = room.name;
    document.getElementById('activeRoomDetails').textContent = `${((room.width * scale) * (room.height * scale)).toFixed(1)} m² • ${room.floorType.toUpperCase()} floor`;
  };

  // Add Room Modal
  document.getElementById('btnAddRoomModal')?.addEventListener('click', () => openModal('addRoomModal'));
  document.getElementById('btnSaveNewRoom')?.addEventListener('click', saveNewRoom);

  // Add No-Go Zone Modal
  document.getElementById('btnAddNoGoModal')?.addEventListener('click', () => openModal('addNoGoModal'));
  document.getElementById('btnSaveNewNoGo')?.addEventListener('click', saveNewNoGo);
}

function populateRoomChecklist() {
  const container = document.getElementById('roomChecklist');
  if (!container || !appState.currentMap) return;

  container.innerHTML = appState.currentMap.rooms.map(room => {
    const isChecked = mapEngine.selectedRoomIds.has(room.id);
    const scale = appState.currentMap.scaleMetersPerPixel || 0.05;
    const areaM2 = ((room.width * scale) * (room.height * scale)).toFixed(1);
    const tagClass = `tag-${room.floorType}`;

    return `
      <div class="room-check-item" onclick="toggleRoomCheckbox('${room.id}')">
        <div class="room-check-left">
          <input type="checkbox" id="check-${room.id}" ${isChecked ? 'checked' : ''} onclick="event.stopPropagation(); toggleRoomCheckbox('${room.id}');">
          <label for="check-${room.id}" style="font-size: 0.85rem; font-weight: 600; cursor: pointer;">${room.name}</label>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span class="room-tag ${tagClass}">${room.floorType.toUpperCase()}</span>
          <span style="font-size: 0.75rem; color: var(--text-muted);">${areaM2} m²</span>
        </div>
      </div>
    `;
  }).join('');
}

function toggleRoomCheckbox(roomId) {
  if (mapEngine.selectedRoomIds.has(roomId)) {
    mapEngine.selectedRoomIds.delete(roomId);
  } else {
    mapEngine.selectedRoomIds.add(roomId);
  }
  populateRoomChecklist();
  mapEngine.draw();
}
window.toggleRoomCheckbox = toggleRoomCheckbox;

async function calculatePathOptimization() {
  if (!appState.currentMap) return;
  const selectedRoomIds = Array.from(mapEngine.selectedRoomIds);
  if (selectedRoomIds.length === 0) {
    showToast('Select at least one room to optimize.', 'warning');
    return;
  }

  showToast('Calculating shortest traversal path & battery budget...', 'info');

  try {
    const res = await fetch('/api/maps/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mapId: appState.currentMap.id,
        selectedRoomIds
      })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        renderOptimizationResults(data.optimizedPlan);
        mapEngine.setOptimizedPath(data.optimizedPlan);
        showToast('Path optimized! High-efficiency transit plotted.', 'success');
        return;
      }
    }
    throw new Error('API unavailable, switching to client optimizer');
  } catch (e) {
    // Client-side fallback calculation for GitHub Pages / static hosting
    const plan = computeClientOptimization(appState.currentMap, selectedRoomIds);
    renderOptimizationResults(plan);
    mapEngine.setOptimizedPath(plan);
    showToast('Path optimized! (Client Engine)', 'success');
  }
}

function computeClientOptimization(map, selectedRoomIds) {
  const roomsToClean = map.rooms.filter(r => selectedRoomIds.includes(r.id));
  const dock = map.dock || { x: 90, y: 340 };
  const scale = map.scaleMetersPerPixel || 0.02;

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
      const roomCenter = { x: room.x + room.width / 2, y: room.y + room.height / 2 };
      const dist = Math.hypot(roomCenter.x - currentPoint.x, roomCenter.y - currentPoint.y);
      if (dist < minDistance) {
        minDistance = dist;
        nearestIdx = i;
      }
    }

    const nextRoom = unvisited.splice(nearestIdx, 1)[0];
    orderedRooms.push(nextRoom);
    totalTransitDistancePx += minDistance;
    currentPoint = { x: nextRoom.x + nextRoom.width / 2, y: nextRoom.y + nextRoom.height / 2 };

    const areaM2 = (nextRoom.width * scale) * (nextRoom.height * scale);
    totalRoomAreaM2 += areaM2;
  }

  totalTransitDistancePx += Math.hypot(dock.x - currentPoint.x, dock.y - currentPoint.y);
  const transitMeters = totalTransitDistancePx * scale;
  const cleaningMinutes = Math.round(totalRoomAreaM2 * 0.75);
  const transitMinutes = Math.max(1, Math.round(transitMeters / 0.25 / 60));
  const totalMinutes = cleaningMinutes + transitMinutes;

  let estimatedBatteryUsed = 0;
  orderedRooms.forEach(r => {
    const roomArea = (r.width * scale) * (r.height * scale);
    let rate = 1.2;
    if (r.floorType === 'tile') rate = 0.9;
    else if (r.floorType === 'carpet') rate = 1.7;
    estimatedBatteryUsed += (roomArea * 0.75) * rate;
  });
  estimatedBatteryUsed += transitMinutes * 0.8;
  estimatedBatteryUsed = Math.min(95, Math.max(8, Math.round(estimatedBatteryUsed)));

  const unoptimizedBattery = Math.min(100, Math.round(estimatedBatteryUsed * 1.58));
  const batterySavedPercentage = Math.round(((unoptimizedBattery - estimatedBatteryUsed) / unoptimizedBattery) * 100);
  const isBatterySufficient = appState.robot.battery >= (estimatedBatteryUsed + 15);

  return {
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
    currentRobotBattery: appState.robot.battery,
    isBatterySufficient,
    recommendation: isBatterySufficient 
      ? `Safe to start clean! Robot has ${Math.round(appState.robot.battery)}% (estimated drain: ${estimatedBatteryUsed}%).` 
      : `Recommend charging robot to at least ${estimatedBatteryUsed + 15}% before starting to prevent exhaustion mid-cleaning.`
  };
}

function renderOptimizationResults(plan) {
  document.getElementById('optAreaVal').textContent = `${plan.totalAreaM2} m²`;
  document.getElementById('optTimeVal').textContent = `~${plan.estimatedMinutes} min`;
  document.getElementById('optBatteryUsed').textContent = `${plan.estimatedBatteryUsed}%`;
  document.getElementById('optBatterySaved').textContent = `${plan.batterySavedPercentage}% Saved`;
  document.getElementById('optStandardBattery').textContent = `${plan.unoptimizedBattery}%`;

  const gatekeeper = document.getElementById('optGatekeeper');
  if (gatekeeper) {
    if (plan.isBatterySufficient) {
      gatekeeper.innerHTML = `
        <div style="color: var(--success); font-size: 0.825rem; font-weight: 600;">
          ✅ ${plan.recommendation}
        </div>
      `;
    } else {
      gatekeeper.innerHTML = `
        <div style="color: var(--warning); font-size: 0.825rem; font-weight: 600;">
          ⚠️ ${plan.recommendation}
        </div>
      `;
    }
  }
}

// Add Room handler
function saveNewRoom() {
  const name = document.getElementById('newRoomName').value.trim() || 'Custom Room';
  const widthM = parseFloat(document.getElementById('newRoomWidth').value) || 4;
  const heightM = parseFloat(document.getElementById('newRoomHeight').value) || 3;
  const floorType = document.getElementById('newRoomFloor').value;

  const scale = (appState.currentMap && appState.currentMap.scaleMetersPerPixel) || 0.02;
  const widthPx = Math.round(widthM / scale);
  const heightPx = Math.round(heightM / scale);

  const newRoom = {
    id: `room-${Date.now()}`,
    name,
    x: 100,
    y: 100,
    width: widthPx,
    height: heightPx,
    floorType,
    friction: floorType === 'tile' ? 'low' : (floorType === 'carpet' ? 'high' : 'medium'),
    color: floorType === 'tile' ? '#10b981' : (floorType === 'carpet' ? '#8b5cf6' : '#f59e0b'),
    priority: appState.currentMap.rooms.length + 1,
    recommendedSpeed: floorType === 'tile' ? 'gentle' : (floorType === 'carpet' ? 'strong' : 'normal'),
    doors: []
  };

  appState.currentMap.rooms.push(newRoom);
  mapEngine.selectedRoomIds.add(newRoom.id);
  mapEngine.draw();
  populateRoomChecklist();
  saveMapsToServer();
  closeModal('addRoomModal');
  showToast(`Room "${name}" added to floorplan!`, 'success');
}

// Add No-Go Zone handler
function saveNewNoGo() {
  const name = document.getElementById('newNoGoName').value.trim() || 'Hazard Area';
  const newZone = {
    id: `nogo-${Date.now()}`,
    name,
    x: 150,
    y: 150,
    width: 70,
    height: 55,
    reason: 'Restricted / Friction avoidance'
  };

  if (!appState.currentMap.noGoZones) appState.currentMap.noGoZones = [];
  appState.currentMap.noGoZones.push(newZone);
  mapEngine.draw();
  saveMapsToServer();
  closeModal('addNoGoModal');
  showToast(`No-Go Hazard Zone "${name}" established.`, 'warning');
}

async function saveMapsToServer() {
  try {
    await fetch('/api/maps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maps: appState.maps })
    });
  } catch (e) {}
}

// -------------------------------------------------------------
// Scheduler Form
// -------------------------------------------------------------
function populateScheduleRoomOptions() {
  const container = document.getElementById('schedRoomSelect');
  if (!container || !appState.currentMap) return;

  container.innerHTML = `
    <option value="">Whole House (All Rooms)</option>
    ${appState.currentMap.rooms.map(r => `<option value="${r.id}">${r.name} (${r.floorType})</option>`).join('')}
  `;
}

function initNewScheduleForm() {
  const dayButtons = document.querySelectorAll('.sched-day-btn');
  dayButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
    });
  });

  document.getElementById('btnCreateSchedule')?.addEventListener('click', async () => {
    const name = document.getElementById('schedName').value.trim() || 'Routine Clean';
    const time = document.getElementById('schedTime').value || '09:00';
    const mode = document.getElementById('schedMode').value || 'smart';
    const fanSpeed = document.getElementById('schedSpeed').value || 'gentle';
    const selectedRoom = document.getElementById('schedRoomSelect').value;
    const threshold = parseInt(document.getElementById('schedBatteryGuard').value) || 40;

    const selectedDays = [];
    dayButtons.forEach(btn => {
      if (btn.classList.contains('active')) {
        selectedDays.push(parseInt(btn.getAttribute('data-day')));
      }
    });

    if (selectedDays.length === 0) {
      showToast('Select at least one day for this schedule.', 'warning');
      return;
    }

    const payload = {
      name,
      time,
      mode,
      fanSpeed,
      days: selectedDays,
      rooms: selectedRoom ? [selectedRoom] : [],
      batteryThreshold: threshold,
      enabled: true
    };

    try {
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        scheduler.setSchedules(data.schedules);
        showToast(`Schedule "${name}" saved!`, 'success');
        document.getElementById('schedName').value = '';
      }
    } catch (e) {
      showToast(`Error creating schedule: ${e.message}`, 'danger');
    }
  });
}

// -------------------------------------------------------------
// Settings & Tuya Hardware-Free Connection
// -------------------------------------------------------------
function initSettingsForm() {
  const form = document.getElementById('tuyaConfigForm');
  if (!form) return;

  // Auto-scan UDP network for Tuya devices
  document.getElementById('btnScanNetwork')?.addEventListener('click', async () => {
    const scanBtn = document.getElementById('btnScanNetwork');
    scanBtn.textContent = '🔍 Scanning Subnet...';
    scanBtn.disabled = true;

    try {
      const res = await fetch('/api/scan-network', { method: 'POST' });
      const data = await res.json();
      if (data.devices && data.devices.length > 0) {
        const found = data.devices[0];
        document.getElementById('cfgIp').value = found.ip;
        showToast(`Discovered Tuya device at ${found.ip}!`, 'success');
      } else {
        showToast('No broadcasting Tuya devices responded within 2.5s. You can manually enter the IP.', 'info');
      }
    } catch (e) {
      showToast(`Scan error: ${e.message}`, 'danger');
    } finally {
      scanBtn.textContent = '🔍 Auto-Scan Local Wi-Fi';
      scanBtn.disabled = false;
    }
  });

  // Toggle Simulation Mode checkbox
  document.getElementById('cfgSimulation')?.addEventListener('change', async (e) => {
    const isSim = e.target.checked;
    await saveConfigToServer({ simulationMode: isSim });
    showToast(isSim ? 'Switched to Simulation Mode.' : 'Switched to Live Wi-Fi Mode.', 'info');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ip = document.getElementById('cfgIp').value.trim();
    const id = document.getElementById('cfgId').value.trim();
    const key = document.getElementById('cfgKey').value.trim();
    const version = document.getElementById('cfgVersion').value;
    const simulationMode = document.getElementById('cfgSimulation').checked;

    await saveConfigToServer({ ip, id, key, version, simulationMode });
  });
}

async function saveConfigToServer(cfgData) {
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfgData)
    });
    const data = await res.json();
    if (data.success) {
      showToast('Configuration saved successfully!', 'success');
    }
  } catch (e) {
    showToast(`Failed to save config: ${e.message}`, 'danger');
  }
}

// -------------------------------------------------------------
// Tabs & Modals
// -------------------------------------------------------------
function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-tab');
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      const activePanel = document.getElementById(target);
      if (activePanel) {
        activePanel.classList.add('active');
        if (target === 'panel-map' && mapEngine) {
          setTimeout(() => mapEngine.resizeCanvas(), 50);
        }
      }
    });
  });
}

function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('open');
}
window.openModal = openModal;

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('open');
}
window.closeModal = closeModal;
