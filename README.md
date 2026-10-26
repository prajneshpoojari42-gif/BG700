# BG700 Control 🤖🧹
### Modern, Responsive Web Control & Battery-Optimized Room Mapping for Bagotte BG700

**BG700 Control** is a web-based dashboard and intelligent room mapping system designed specifically for the **Bagotte BG700** robot vacuum cleaner. It connects **strictly over your home 2.4GHz Wi-Fi network** using the native Tuya LAN protocol—**zero external microcontrollers or hardware needed** (no Arduino, ESP8266/ESP32, Raspberry Pi, or relays).

---

## 🌟 Key Features

### 1. 🛡️ Pure Wi-Fi / Zero Hardware Architecture
* **Direct LAN Communication**: Speaks Tuya protocol (v3.3/3.1) directly to the Bagotte BG700 over your local router.
* **Instant Local Response**: Zero cloud roundtrip latency for steering, commands, and telemetry.
* **Plug-and-Play Simulator**: Automatically engages a high-fidelity interactive simulator when live hardware is offline, allowing you to test every single map, schedule, and steering feature immediately.

### 2. 🗺️ Room Mapping & Battery Efficiency Optimizer
* **Interactive 2D Floor Plan Canvas**: Pan, zoom, and build custom multi-room floor layouts with wall connections, doorways, and charging dock positioning.
* **Blueprint Overlay**: Upload your home’s architectural blueprint or hand sketch (PNG/JPG/SVG) to trace rooms directly.
* **Surface-Friction Profiles**:
  * 🟢 **Tile / Polished Concrete**: Low motor friction $\rightarrow$ automatically suggests **Eco Quiet** mode (saves ~40% battery).
  * 🟡 **Hardwood / Laminate**: Medium friction $\rightarrow$ Standard clean mode.
  * 🟣 **Carpet / Shag Rugs**: High friction $\rightarrow$ Boost mode.
* **Shortest Eulerian Traversal Engine**:
  * Calculates the optimal order to clean rooms starting and ending at the dock station.
  * Prevents dead-heading through previously cleaned zones.
  * Conserves **35% to 45% battery** compared to unmapped random gyroscope bouncing!
* **Virtual No-Go Hazard Zones**:
  * Mark cable tangles, dog bowls, or thick thresholds to prevent wheel jam and brush roller motor stall current spikes.
* **Battery Energy Budgeting & Safety Gatekeeper**:
  * Computes exact energy requirements ($m^2 \times \text{friction} + \text{transit}$).
  * Warns you if current battery is insufficient before starting to prevent the robot from dying in the middle of a room.

### 3. 🎛️ Responsive Dashboard & Manual Steer
* **Live Telemetry Visualizer**: Circular animated chassis with pulsating status ring (Cleaning, Docking, Charging, Standby).
* **Instant Actions**: Start / Pause / Return to Dock / Stop / "Find My Robot" locate buzzer.
* **Suction Modes**: Eco Quiet (1200Pa), Standard (1600Pa), Boost Strong (2000Pa), Max Turbo (2200Pa).
* **Tactile Manual D-Pad**: Steer the vacuum with on-screen buttons or keyboard (`Arrow Keys` / `WASD` / `Spacebar` to stop).

### 4. 📅 Smart Schedules
* Automated recurring multi-day cleanings (e.g. Mon–Fri at 08:30 AM).
* Targeted single-room scheduling (e.g. Clean Kitchen only after dinner).
* Battery threshold guard to prevent execution when below safe charge level.

---

## 🚀 Quick Start

### 1. Start the Server
```bash
npm start
```
Open **[http://localhost:3000](http://localhost:3000)** in any web browser on your phone, tablet, or desktop.

---

## 🔑 How to Get Your Bagotte BG700 Tuya Local Key (5 Minutes)

Because the BG700 is built on the Tuya platform, each device has a unique 16-character AES Local Key. You can easily extract it without disassembling the vacuum:

1. **Smart Life App**: Pair your BG700 with the standard **Smart Life** app on your phone.
2. **Tuya IoT Developer Portal**:
   - Register a free developer account at [iot.tuya.com](https://iot.tuya.com).
   - Go to **Cloud > Development > Create Cloud Project**.
3. **Link Your Smart Life Account**:
   - Inside your Cloud Project, go to **Cloud > Link Tuya App Account**.
   - Scan the displayed QR code with your Smart Life app.
4. **Extract Key with One Command**:
   ```bash
   npx @tuyapi/cli wizard
   ```
   *(Or using Python: `python -m tinytuya wizard`)*
5. Paste your **Device ID**, **Local Key**, and **Robot IP** into the **Tuya Wi-Fi & Setup Guide** tab in BG700 Control!

---

## 📁 Project Structure

```
new bg2700/
├── server.js               # Express + WebSocket + TuyAPI driver + Scheduler + Simulation engine
├── package.json            # Node.js dependencies (express, tuyapi, ws, cors, dotenv)
├── maps.json               # Persisted room configurations and floor plans
├── schedules.json          # Persisted automated routines
├── config.json             # Persisted robot Wi-Fi credentials
└── public/
    ├── index.html          # Modern, responsive single-page application
    ├── css/
    │   └── styles.css      # Dark glassmorphism luxury theme
    └── js/
        ├── app.js          # Client UI coordinator & WebSocket sync
        ├── map-engine.js   # 2D Canvas floorplan renderer & path planner
        └── scheduler.js    # Schedule manager & next-run calculator
```
