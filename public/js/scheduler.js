/**
 * BG700 Control - Smart Scheduler Management
 */

class SchedulerManager {
  constructor() {
    this.schedules = [];
    this.daysMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  }

  setSchedules(schedules) {
    this.schedules = schedules || [];
    this.render();
  }

  render() {
    const container = document.getElementById('schedulesList');
    if (!container) return;

    if (this.schedules.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2.5rem; color: var(--text-dim);">
          <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">⏰</div>
          <p>No active schedules configured yet.</p>
          <p style="font-size: 0.8rem;">Create a schedule on the right to automate energy-efficient cleaning routines.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.schedules.map(sched => {
      const daysHtml = [0, 1, 2, 3, 4, 5, 6].map(day => {
        const isActive = sched.days.includes(day);
        return `<span class="day-pill ${isActive ? 'active' : ''}">${this.daysMap[day].charAt(0)}</span>`;
      }).join('');

      const roomsLabel = (sched.rooms && sched.rooms.length > 0)
        ? `${sched.rooms.length} Room(s)`
        : 'Whole House';

      const speedBadge = sched.fanSpeed === 'gentle' ? '🌱 Eco Quiet' : (sched.fanSpeed === 'strong' ? '⚡ Boost' : '🌀 Standard');

      return `
        <div class="schedule-card" id="sched-card-${sched.id}">
          <div style="display: flex; align-items: center; gap: 1.25rem;">
            <div class="schedule-time">${sched.time}</div>
            <div>
              <div class="schedule-name">${sched.name}</div>
              <div class="schedule-meta">
                <div class="schedule-days-pill">${daysHtml}</div>
                <span>•</span>
                <span>${roomsLabel}</span>
                <span>•</span>
                <span>${speedBadge}</span>
                <span>•</span>
                <span title="Battery safety reserve">🔋 ≥${sched.batteryThreshold || 30}%</span>
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 1rem;">
            <label class="switch">
              <input type="checkbox" ${sched.enabled ? 'checked' : ''} onchange="window.scheduler.toggleSchedule('${sched.id}', this.checked)">
              <span class="slider"></span>
            </label>
            <button class="btn btn-secondary btn-sm" onclick="window.scheduler.runScheduleNow('${sched.id}')" title="Run Now">
              ▶ Run
            </button>
            <button class="btn btn-secondary btn-sm" style="color: var(--danger);" onclick="window.scheduler.deleteSchedule('${sched.id}')" title="Delete Schedule">
              🗑
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  async toggleSchedule(id, enabled) {
    const sched = this.schedules.find(s => s.id === id);
    if (!sched) return;
    sched.enabled = enabled;

    try {
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sched)
      });
      const data = await res.json();
      if (data.success) {
        window.showToast(`Schedule "${sched.name}" ${enabled ? 'enabled' : 'disabled'}.`, 'success');
      }
    } catch (e) {
      window.showToast(`Failed to update schedule: ${e.message}`, 'danger');
    }
  }

  async runScheduleNow(id) {
    const sched = this.schedules.find(s => s.id === id);
    if (!sched) return;

    window.showToast(`Triggering "${sched.name}" now...`, 'info');
    try {
      if (sched.fanSpeed) {
        await fetch('/api/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'setFanSpeed', value: sched.fanSpeed })
        });
      }
      await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'start', value: sched.mode || 'smart' })
      });
      window.showToast(`Schedule "${sched.name}" initiated!`, 'success');
    } catch (e) {
      window.showToast(`Execution error: ${e.message}`, 'danger');
    }
  }

  async deleteSchedule(id) {
    if (!confirm('Are you sure you want to delete this scheduled routine?')) return;
    try {
      const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        this.schedules = data.schedules;
        this.render();
        window.showToast('Schedule deleted successfully.', 'success');
      }
    } catch (e) {
      window.showToast(`Failed to delete: ${e.message}`, 'danger');
    }
  }
}

window.SchedulerManager = SchedulerManager;
