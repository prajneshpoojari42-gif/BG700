/**
 * BG700 Control - 2D Interactive Map & Battery Optimization Engine
 */

class MapEngine {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    // Map data
    this.mapData = null;
    this.selectedRoomIds = new Set();
    this.activeRoomId = null;

    // Viewport transform
    this.scale = 1.0;
    this.panX = 40;
    this.panY = 30;
    this.isPanning = false;
    this.startPan = { x: 0, y: 0 };

    // Robot state
    this.robotPos = { x: 90, y: 340, angle: 0 };
    this.robotTrail = [];
    this.optimizedPath = null;
    this.brushAngle = 0;

    // Background floorplan image
    this.bgImage = null;
    this.bgImageOpacity = 0.4;

    this.initEvents();
    this.resizeCanvas();
    this.animate();
  }

  resizeCanvas() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    this.canvas.width = parent.clientWidth || 800;
    this.canvas.height = parent.clientHeight || 520;
    this.draw();
  }

  setMapData(map) {
    this.mapData = map;
    if (map && map.dock) {
      this.robotPos = { ...map.dock };
    }
    // Select all rooms by default for optimization
    if (map && map.rooms) {
      this.selectedRoomIds = new Set(map.rooms.map(r => r.id));
    }
    this.draw();
  }

  updateRobotTelemetry(telemetry) {
    if (!telemetry) return;
    if (telemetry.coordinates) {
      this.robotPos = telemetry.coordinates;
    }
    if (telemetry.trail && Array.isArray(telemetry.trail)) {
      this.robotTrail = telemetry.trail;
    }
    this.draw();
  }

  initEvents() {
    window.addEventListener('resize', () => this.resizeCanvas());

    // Mouse / Touch Pan
    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Check if clicked inside a room
      const worldPos = this.screenToWorld(mouseX, mouseY);
      const clickedRoom = this.findRoomAt(worldPos.x, worldPos.y);

      if (e.shiftKey && clickedRoom) {
        // Toggle room selection with shift-click
        if (this.selectedRoomIds.has(clickedRoom.id)) {
          this.selectedRoomIds.delete(clickedRoom.id);
        } else {
          this.selectedRoomIds.add(clickedRoom.id);
        }
        this.onSelectionChange();
        this.draw();
        return;
      }

      if (clickedRoom) {
        this.activeRoomId = clickedRoom.id;
        if (window.onRoomClicked) window.onRoomClicked(clickedRoom);
      }

      this.isPanning = true;
      this.startPan = { x: mouseX - this.panX, y: mouseY - this.panY };
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isPanning) return;
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      this.panX = mouseX - this.startPan.x;
      this.panY = mouseY - this.startPan.y;
      this.draw();
    });

    window.addEventListener('mouseup', () => {
      this.isPanning = false;
    });

    // Zoom with wheel
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Zoom centered on cursor
      const newScale = Math.min(Math.max(this.scale * zoomFactor, 0.4), 3.0);
      this.panX = mouseX - (mouseX - this.panX) * (newScale / this.scale);
      this.panY = mouseY - (mouseY - this.panY) * (newScale / this.scale);
      this.scale = newScale;

      this.draw();
    }, { passive: false });
  }

  screenToWorld(screenX, screenY) {
    return {
      x: (screenX - this.panX) / this.scale,
      y: (screenY - this.panY) / this.scale
    };
  }

  worldToScreen(worldX, worldY) {
    return {
      x: worldX * this.scale + this.panX,
      y: worldY * this.scale + this.panY
    };
  }

  findRoomAt(x, y) {
    if (!this.mapData || !this.mapData.rooms) return null;
    return this.mapData.rooms.find(r => 
      x >= r.x && x <= r.x + r.width &&
      y >= r.y && y <= r.y + r.height
    );
  }

  zoomIn() {
    this.scale = Math.min(this.scale * 1.2, 3.0);
    this.draw();
  }

  zoomOut() {
    this.scale = Math.max(this.scale / 1.2, 0.4);
    this.draw();
  }

  resetView() {
    this.scale = 1.0;
    this.panX = 40;
    this.panY = 30;
    this.draw();
  }

  onSelectionChange() {
    if (window.onMapSelectionUpdated) {
      window.onMapSelectionUpdated(Array.from(this.selectedRoomIds));
    }
  }

  setOptimizedPath(pathData) {
    this.optimizedPath = pathData;
    this.draw();
  }

  loadBackgroundImage(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        this.bgImage = img;
        this.draw();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // Animation Loop for spinning side brushes & glowing effects
  animate() {
    this.brushAngle = (this.brushAngle + 0.15) % (Math.PI * 2);
    this.draw();
    requestAnimationFrame(() => this.animate());
  }

  // Master Render Method
  draw() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.scale, this.scale);

    // 1. Draw uploaded blueprint overlay if present
    if (this.bgImage) {
      ctx.save();
      ctx.globalAlpha = this.bgImageOpacity;
      ctx.drawImage(this.bgImage, 0, 0, 750, 560);
      ctx.restore();
    }

    if (this.mapData) {
      // 2. Draw Rooms
      if (this.mapData.rooms) {
        this.mapData.rooms.forEach(room => this.drawRoom(room));
      }

      // 3. Draw Doors / Connections
      if (this.mapData.rooms) {
        this.mapData.rooms.forEach(room => {
          if (room.doors) {
            room.doors.forEach(door => this.drawDoor(door));
          }
        });
      }

      // 4. Draw No-Go / Hazard Zones
      if (this.mapData.noGoZones) {
        this.mapData.noGoZones.forEach(zone => this.drawNoGoZone(zone));
      }

      // 5. Draw Optimized Eulerian Transit Path (The Battery Saver Trajectory)
      if (this.optimizedPath && this.optimizedPath.orderedRooms) {
        this.drawOptimizedTrajectory();
      }

      // 6. Draw Charging Dock Station
      if (this.mapData.dock) {
        this.drawDock(this.mapData.dock);
      }
    }

    // 7. Draw Live Clean Trail (Breadcrumbs)
    this.drawCleaningTrail();

    // 8. Draw Robotic Vacuum Cleaner (Bagotte BG700)
    this.drawRobot();

    ctx.restore();
  }

  drawRoom(room) {
    const ctx = this.ctx;
    const isSelected = this.selectedRoomIds.has(room.id);
    const isActive = this.activeRoomId === room.id;

    ctx.save();

    // Floor Type Background & Patterns
    let floorFill = 'rgba(255, 255, 255, 0.04)';
    let floorBorder = 'rgba(255, 255, 255, 0.2)';

    if (room.floorType === 'tile') {
      floorFill = isSelected ? 'rgba(16, 185, 129, 0.12)' : 'rgba(16, 185, 129, 0.05)';
      floorBorder = '#10b981';
    } else if (room.floorType === 'hardwood') {
      floorFill = isSelected ? 'rgba(245, 158, 11, 0.12)' : 'rgba(245, 158, 11, 0.05)';
      floorBorder = '#f59e0b';
    } else if (room.floorType === 'carpet') {
      floorFill = isSelected ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.05)';
      floorBorder = '#8b5cf6';
    }

    ctx.fillStyle = floorFill;
    ctx.fillRect(room.x, room.y, room.width, room.height);

    // Wall Outline
    ctx.lineWidth = isActive ? 3 : 2;
    ctx.strokeStyle = isActive ? '#38bdf8' : floorBorder;
    ctx.strokeRect(room.x, room.y, room.width, room.height);

    // Subtle Floor Texture
    this.drawFloorTexture(room);

    // Room Label & Area Badge
    const scale = this.mapData.scaleMetersPerPixel || 0.02;
    const areaM2 = ((room.width * scale) * (room.height * scale)).toFixed(1);

    ctx.fillStyle = '#f9fafb';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(room.name, room.x + room.width / 2, room.y + 24);

    // Floor type + area tag
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = '#9ca3af';
    ctx.fillText(`${areaM2} m² • ${room.floorType.toUpperCase()}`, room.x + room.width / 2, room.y + 40);

    // Selection Indicator
    if (isSelected) {
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(room.x + 18, room.y + 18, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  drawFloorTexture(room) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
    ctx.lineWidth = 1;

    if (room.floorType === 'tile') {
      // Tile Grid
      const step = 25;
      for (let x = room.x + step; x < room.x + room.width; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, room.y);
        ctx.lineTo(x, room.y + room.height);
        ctx.stroke();
      }
      for (let y = room.y + step; y < room.y + room.height; y += step) {
        ctx.beginPath();
        ctx.moveTo(room.x, y);
        ctx.lineTo(room.x + room.width, y);
        ctx.stroke();
      }
    } else if (room.floorType === 'hardwood') {
      // Hardwood Planks
      const step = 16;
      for (let y = room.y + step; y < room.y + room.height; y += step) {
        ctx.beginPath();
        ctx.moveTo(room.x, y);
        ctx.lineTo(room.x + room.width, y);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  drawDoor(door) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = '#090d16';
    ctx.fillRect(door.x - 2, door.y - door.width / 2, 4, door.width);
    ctx.strokeStyle = '#0ea5e9';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(door.x, door.y - door.width / 2);
    ctx.lineTo(door.x, door.y + door.width / 2);
    ctx.stroke();
    ctx.restore();
  }

  drawNoGoZone(zone) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
    ctx.fillRect(zone.x, zone.y, zone.width, zone.height);

    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);

    // Hazard Stripes
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
    ctx.lineWidth = 1;
    for (let i = -zone.height; i < zone.width; i += 12) {
      ctx.beginPath();
      ctx.moveTo(zone.x + Math.max(0, i), zone.y);
      ctx.lineTo(zone.x + Math.min(zone.width, i + zone.height), zone.y + zone.height);
      ctx.stroke();
    }

    // Label
    ctx.fillStyle = '#fca5a5';
    ctx.font = 'bold 9px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('NO-GO', zone.x + zone.width / 2, zone.y + zone.height / 2 + 3);

    ctx.restore();
  }

  drawDock(dock) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(dock.x, dock.y);

    // Dock Base
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-16, -14, 32, 28, 6);
    ctx.fill();
    ctx.stroke();

    // Charging Contact Pins
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(-8, -12, 4, 3);
    ctx.fillRect(4, -12, 4, 3);

    // Dock Beacon Light
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();

    // Label
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 9px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('DOCK', 0, 24);

    ctx.restore();
  }

  drawOptimizedTrajectory() {
    const ctx = this.ctx;
    const rooms = this.optimizedPath.orderedRooms;
    if (!rooms || rooms.length === 0) return;

    const dock = this.mapData.dock || { x: 90, y: 340 };
    ctx.save();
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 6]);

    ctx.beginPath();
    ctx.moveTo(dock.x, dock.y);

    rooms.forEach((r, idx) => {
      const room = this.mapData.rooms.find(rm => rm.id === r.id);
      if (room) {
        const cx = room.x + room.width / 2;
        const cy = room.y + room.height / 2;
        ctx.lineTo(cx, cy);

        // Sequence badge
        ctx.save();
        ctx.fillStyle = '#06b6d4';
        ctx.beginPath();
        ctx.arc(cx, cy, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#090d16';
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(idx + 1), cx, cy);
        ctx.restore();
      }
    });

    // Return line to dock
    ctx.lineTo(dock.x, dock.y);
    ctx.stroke();
    ctx.restore();
  }

  drawCleaningTrail() {
    if (!this.robotTrail || this.robotTrail.length < 2) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 1; i < this.robotTrail.length; i++) {
      const p1 = this.robotTrail[i - 1];
      const p2 = this.robotTrail[i];
      const alpha = (i / this.robotTrail.length) * 0.25;

      ctx.strokeStyle = `rgba(14, 165, 233, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawRobot() {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.robotPos.x, this.robotPos.y);
    ctx.rotate((this.robotPos.angle * Math.PI) / 180);

    const radius = 18;

    // Spinning Side Brushes (Bagotte BG700 Dual Whisker Brushes)
    ctx.save();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.5;

    // Left brush
    ctx.translate(radius * 0.7, -radius * 0.85);
    ctx.rotate(this.brushAngle);
    for (let b = 0; b < 3; b++) {
      ctx.rotate((Math.PI * 2) / 3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(10, 0);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    // Right brush
    ctx.translate(radius * 0.7, radius * 0.85);
    ctx.rotate(-this.brushAngle);
    for (let b = 0; b < 3; b++) {
      ctx.rotate((Math.PI * 2) / 3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(10, 0);
      ctx.stroke();
    }
    ctx.restore();

    // Robot Chassis (Circular Jet Black Body)
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#0ea5e9';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Front Bumper Arc
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(0, 0, radius - 1, -Math.PI / 3, Math.PI / 3);
    ctx.lineTo(radius * 0.4, 0);
    ctx.closePath();
    ctx.fill();

    // Center Power Ring & Button
    ctx.fillStyle = '#0ea5e9';
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();

    // Direction Heading Pointer
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(radius * 0.6, 0);
    ctx.lineTo(radius * 0.2, -4);
    ctx.lineTo(radius * 0.2, 4);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
}

// Global instance attached to window
window.MapEngine = MapEngine;
