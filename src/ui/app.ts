import { MockClock, SystemClock, Clock } from '../clock.js';
import { SlidingWindowRateLimiter } from '../sliding-window-limiter.js';
import { TokenBucketRateLimiter } from '../token-bucket-limiter.js';
import { InMemoryStore } from '../store.js';

interface RequestLog {
  id: string;
  timeStr: string;
  timestamp: number;
  key: string;
  policy: 'Sliding Window' | 'Token Bucket';
  allowed: boolean;
  statusText: string;
  tokensOrQuota: string;
  latencyMs: number;
}

interface TimeBin {
  timestamp: number;
  allowed: number;
  blocked: number;
}

interface UserMetrics {
  allowed: number;
  blocked: number;
  total: number;
  lastSeen: number;
}

let currentPolicy: 'sliding-window' | 'token-bucket' = 'sliding-window';
let isMockClock = false;
let mockClock = new MockClock(Date.now());
let systemClock = new SystemClock();

function getActiveClock(): Clock {
  return isMockClock ? mockClock : systemClock;
}

let inMemoryStore = new InMemoryStore();
let slidingLimiter = new SlidingWindowRateLimiter({
  maxRequests: 5,
  windowSeconds: 10,
  clock: getActiveClock(),
  store: inMemoryStore,
});

let tokenLimiter = new TokenBucketRateLimiter({
  capacity: 10,
  refillRatePerSecond: 2,
  clock: getActiveClock(),
});

let totalAllowedCount = 0;
let totalBlockedCount = 0;
const logs: RequestLog[] = [];
const userAnalytics = new Map<string, UserMetrics>();

const NUM_BINS = 65;
const timeBins: TimeBin[] = [];
const BIN_SIZE_MS = 1000;

const initialNow = Date.now();
for (let i = NUM_BINS - 1; i >= 0; i--) {
  timeBins.push({
    timestamp: initialNow - i * BIN_SIZE_MS,
    allowed: 0,
    blocked: 0,
  });
}

let spamIntervalId: number | null = null;
let currentFilter: 'all' | 'allowed' | 'blocked' | 'current-client' = 'all';
let searchQuery = '';

function seedInitialData() {
  const seedUsers = ['client_alpha', 'client_beta', '192.168.1.104', 'api_gateway', 'user_checkout'];
  seedUsers.forEach((user, idx) => {
    const baseAllowed = (5 - idx) * 18 + 5;
    const baseBlocked = idx === 0 ? 12 : idx === 2 ? 8 : 2;
    userAnalytics.set(user, {
      allowed: baseAllowed,
      blocked: baseBlocked,
      total: baseAllowed + baseBlocked,
      lastSeen: Date.now() - idx * 12000,
    });
    totalAllowedCount += baseAllowed;
    totalBlockedCount += baseBlocked;
  });

  timeBins.forEach((bin, idx) => {
    if (idx > 5 && idx % 2 === 0) {
      bin.allowed = Math.floor(Math.sin(idx * 0.3) * 4) + 6;
      bin.blocked = idx % 4 === 0 ? Math.floor(Math.random() * 5) + 3 : 0;
    }
  });
}

seedInitialData();

const teamSelect = document.getElementById('team-select') as HTMLSelectElement;
const filterSelect = document.getElementById('filter-select') as HTMLSelectElement | null;
const inputSearchLogs = document.getElementById('input-search-logs') as HTMLInputElement | null;
const btnClearLogs = document.getElementById('btn-clear-logs') as HTMLButtonElement | null;
const btnExportLogs = document.getElementById('btn-export-logs') as HTMLButtonElement | null;
const toastContainer = document.getElementById('toast-container') as HTMLElement | null;

const statAllowed = document.getElementById('stat-allowed') as HTMLElement;
const statBlocked = document.getElementById('stat-blocked') as HTMLElement;
const statTotal = document.getElementById('stat-total') as HTMLElement;
const pagePolicyDesc = document.getElementById('page-policy-desc') as HTMLElement | null;
const activePolicyTag = document.getElementById('active-policy-tag') as HTMLElement | null;

const btnSendRequest = document.getElementById('btn-send-request') as HTMLButtonElement;
const btnBurst5 = document.getElementById('btn-burst-5') as HTMLButtonElement;
const btnBurst10 = document.getElementById('btn-burst-10') as HTMLButtonElement;
const btnAutoSpam = document.getElementById('btn-auto-spam') as HTMLButtonElement;
const btnStepClock = document.getElementById('btn-step-clock') as HTMLButtonElement;
const btnCleanup = document.getElementById('btn-cleanup') as HTMLButtonElement;
const btnRefresh = document.getElementById('btn-refresh') as HTMLButtonElement;

const chartBarsContainer = document.getElementById('chart-bars-container') as HTMLElement;
const chartYMax = document.getElementById('chart-y-max') as HTMLElement;
const chartYMid = document.getElementById('chart-y-mid') as HTMLElement;

const listTopAllowed = document.getElementById('list-top-allowed') as HTMLElement;
const listTopBlocked = document.getElementById('list-top-blocked') as HTMLElement;
const auditTableBody = document.getElementById('audit-table-body') as HTMLElement;

const navSliding = document.getElementById('nav-sliding') as HTMLElement;
const navBucket = document.getElementById('nav-bucket') as HTMLElement;
const navSysDesign = document.getElementById('nav-sys-design') as HTMLElement;

const modalSettings = document.getElementById('modal-settings') as HTMLElement;
const btnOpenSettings = document.getElementById('btn-open-settings') as HTMLElement;
const btnCloseSettings = document.getElementById('btn-close-settings') as HTMLElement;
const btnSaveSettings = document.getElementById('btn-save-settings') as HTMLElement;

const inputMaxReq = document.getElementById('modal-max-req') as HTMLInputElement;
const inputWindowSec = document.getElementById('modal-win-sec') as HTMLInputElement;
const inputCapacity = document.getElementById('modal-capacity') as HTMLInputElement;
const inputRefillRate = document.getElementById('modal-refill-rate') as HTMLInputElement;

const modalSysDesign = document.getElementById('modal-sys-design') as HTMLElement;
const btnCloseSysDesign = document.getElementById('btn-close-sys-design') as HTMLElement;

function showToast(message: string, type: 'success' | 'warning' | 'info' = 'info') {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast-message toast-${type}`;
  toast.innerText = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

function getSelectedKey(): string {
  return teamSelect.value || 'client_alpha';
}

function reloadLimiter() {
  const clock = getActiveClock();
  const maxReq = Math.max(1, parseInt(inputMaxReq.value, 10) || 5);
  const winSec = Math.max(1, parseInt(inputWindowSec.value, 10) || 10);
  const cap = Math.max(1, parseInt(inputCapacity.value, 10) || 10);
  const refill = Math.max(0.1, parseFloat(inputRefillRate.value) || 2);

  slidingLimiter = new SlidingWindowRateLimiter({
    maxRequests: maxReq,
    windowSeconds: winSec,
    clock,
    store: inMemoryStore,
  });

  tokenLimiter = new TokenBucketRateLimiter({
    capacity: cap,
    refillRatePerSecond: refill,
    clock,
  });
}

function executeRequest(key: string, count: number = 1) {
  const t0 = performance.now();

  for (let i = 0; i < count; i++) {
    const clockNow = getActiveClock().now();
    let isAllowed = false;
    let quotaInfo = '';

    if (currentPolicy === 'sliding-window') {
      isAllowed = slidingLimiter.allow(key);
      const maxReq = parseInt(inputMaxReq.value, 10) || 5;
      const winSec = parseInt(inputWindowSec.value, 10) || 10;
      const valid = (inMemoryStore.get(key) ?? []).filter((t) => t > clockNow - winSec * 1000);
      quotaInfo = `${valid.length}/${maxReq} used`;
    } else {
      isAllowed = tokenLimiter.allow(key);
      const avail = tokenLimiter.getAvailableTokens(key);
      const cap = parseInt(inputCapacity.value, 10) || 10;
      quotaInfo = `${avail.toFixed(1)}/${cap} tokens`;
    }

    if (isAllowed) {
      totalAllowedCount++;
    } else {
      totalBlockedCount++;
    }

    const uStats = userAnalytics.get(key) || { allowed: 0, blocked: 0, total: 0, lastSeen: clockNow };
    if (isAllowed) {
      uStats.allowed++;
    } else {
      uStats.blocked++;
    }
    uStats.total++;
    uStats.lastSeen = clockNow;
    userAnalytics.set(key, uStats);

    const currentBin = timeBins[timeBins.length - 1];
    if (currentBin) {
      if (isAllowed) {
        currentBin.allowed++;
      } else {
        currentBin.blocked++;
      }
    }

    const tEnd = performance.now();
    const latency = Math.max(0.1, parseFloat((tEnd - t0).toFixed(2)));

    const now = new Date(clockNow);
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;

    logs.unshift({
      id: Math.random().toString(36).substring(2, 9),
      timeStr,
      timestamp: clockNow,
      key,
      policy: currentPolicy === 'sliding-window' ? 'Sliding Window' : 'Token Bucket',
      allowed: isAllowed,
      statusText: isAllowed ? '200 OK' : '429 BLOCKED',
      tokensOrQuota: quotaInfo,
      latencyMs: latency,
    });

    if (logs.length > 200) {
      logs.pop();
    }
  }

  updateUI();
}

function updateUI() {
  statAllowed.innerText = formatNumber(totalAllowedCount);
  statBlocked.innerText = formatNumber(totalBlockedCount);
  statTotal.innerText = formatNumber(totalAllowedCount + totalBlockedCount);

  if (pagePolicyDesc && activePolicyTag) {
    if (currentPolicy === 'sliding-window') {
      const maxReq = inputMaxReq?.value || '5';
      const winSec = inputWindowSec?.value || '10';
      pagePolicyDesc.innerHTML = `Active Algorithm: <strong>Sliding Window Log</strong> &bull; Window: ${winSec}s &bull; Max: ${maxReq} reqs`;
      activePolicyTag.innerText = 'Sliding Window Log';
    } else {
      const cap = inputCapacity?.value || '10';
      const refill = inputRefillRate?.value || '2';
      pagePolicyDesc.innerHTML = `Active Algorithm: <strong>Token Bucket</strong> &bull; Capacity: ${cap} tokens &bull; Refill: ${refill}/sec`;
      activePolicyTag.innerText = 'Token Bucket';
    }
  }

  renderChart();
  renderTopUsers();
  renderAuditLogs();
}

function renderChart() {
  let maxBar = 10;
  timeBins.forEach((bin) => {
    const total = bin.allowed + bin.blocked;
    if (total > maxBar) maxBar = total;
  });

  const yMaxRounded = Math.ceil(maxBar / 5) * 5;
  chartYMax.innerText = yMaxRounded.toString();
  chartYMid.innerText = Math.round(yMaxRounded / 2).toString();

  chartBarsContainer.innerHTML = '';

  timeBins.forEach((bin) => {
    const slot = document.createElement('div');
    slot.className = 'chart-bar-slot';
    slot.title = `Time: ${new Date(bin.timestamp).toLocaleTimeString()}\nAllowed: ${bin.allowed}\nBlocked: ${bin.blocked}`;

    const totalInBin = bin.allowed + bin.blocked;
    if (totalInBin > 0) {
      const allowedHeightPct = Math.min(100, (bin.allowed / yMaxRounded) * 100);
      const blockedHeightPct = Math.min(100, (bin.blocked / yMaxRounded) * 100);

      const allowedSeg = document.createElement('div');
      allowedSeg.className = 'bar-segment-allowed';
      allowedSeg.style.height = `${allowedHeightPct}%`;

      const blockedSeg = document.createElement('div');
      blockedSeg.className = 'bar-segment-blocked';
      blockedSeg.style.height = `${blockedHeightPct}%`;

      slot.appendChild(allowedSeg);
      if (bin.blocked > 0) {
        slot.appendChild(blockedSeg);
      }
    } else {
      const emptyLine = document.createElement('div');
      emptyLine.style.width = '100%';
      emptyLine.style.height = '2px';
      emptyLine.style.backgroundColor = '#F3F4F6';
      slot.appendChild(emptyLine);
    }

    chartBarsContainer.appendChild(slot);
  });
}

function renderTopUsers() {
  const usersArray = Array.from(userAnalytics.entries()).map(([key, data]) => ({ key, ...data }));
  const activeKey = getSelectedKey();

  const topAllowed = [...usersArray].filter((u) => u.allowed > 0).sort((a, b) => b.allowed - a.allowed);
  if (topAllowed.length === 0) {
    listTopAllowed.innerHTML = '<div class="empty-user-state">No allowed requests yet.</div>';
  } else {
    listTopAllowed.innerHTML = topAllowed
      .slice(0, 5)
      .map(
        (u, idx) => `
      <div class="top-user-item ${u.key === activeKey ? 'top-user-active' : ''}" onclick="window.switchActiveClient('${escapeHtml(u.key)}')" style="cursor:pointer;" title="Click to select ${escapeHtml(u.key)}">
        <div class="user-identity">
          <span style="color:var(--text-light);font-size:0.75rem;">#${idx + 1}</span>
          <span style="${u.key === activeKey ? 'font-weight:700;color:var(--uncommon-blue);' : ''}">${escapeHtml(u.key)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:0.75rem;">
          <span class="user-stat-badge allowed-tag">${formatNumber(u.allowed)} Allowed</span>
        </div>
      </div>
    `
      )
      .join('');
  }

  const topBlocked = [...usersArray].filter((u) => u.blocked > 0).sort((a, b) => b.blocked - a.blocked);
  if (topBlocked.length === 0) {
    listTopBlocked.innerHTML = '<div class="empty-user-state">No blocked requests recorded.</div>';
  } else {
    listTopBlocked.innerHTML = topBlocked
      .slice(0, 5)
      .map(
        (u, idx) => `
      <div class="top-user-item ${u.key === activeKey ? 'top-user-active' : ''}" onclick="window.switchActiveClient('${escapeHtml(u.key)}')" style="cursor:pointer;" title="Click to select ${escapeHtml(u.key)}">
        <div class="user-identity">
          <span style="color:var(--text-light);font-size:0.75rem;">#${idx + 1}</span>
          <span style="${u.key === activeKey ? 'font-weight:700;color:var(--uncommon-blue);' : ''}">${escapeHtml(u.key)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:0.75rem;">
          <span class="user-stat-badge blocked-tag">${formatNumber(u.blocked)} Blocked</span>
        </div>
      </div>
    `
      )
      .join('');
  }
}

function renderAuditLogs() {
  const activeKey = getSelectedKey();
  const filtered = logs.filter((log) => {
    if (currentFilter === 'allowed' && !log.allowed) return false;
    if (currentFilter === 'blocked' && log.allowed) return false;
    if (currentFilter === 'current-client' && log.key !== activeKey) return false;
    if (searchQuery && !log.key.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  if (filtered.length === 0) {
    auditTableBody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center;padding:2rem;color:var(--text-muted);">
          No matching requests found in log.
        </td>
      </tr>
    `;
    return;
  }

  auditTableBody.innerHTML = filtered
    .map(
      (log) => `
    <tr>
      <td><code style="font-family:var(--font-mono);font-size:0.75rem;">${log.timeStr}</code></td>
      <td><strong>${escapeHtml(log.key)}</strong></td>
      <td>${log.policy}</td>
      <td>
        <span style="display:inline-block;padding:0.15rem 0.5rem;border-radius:4px;font-size:0.75rem;font-weight:700;font-family:var(--font-mono);background:${
          log.allowed ? '#ECFDF5;color:#047857' : '#FEF2F2;color:#DC2626'
        }">
          ${log.statusText}
        </span>
      </td>
      <td><small style="color:var(--text-secondary);">${log.tokensOrQuota}</small></td>
    </tr>
  `
    )
    .join('');
}

function escapeHtml(str: string) {
  return str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m] || m));
}

setInterval(() => {
  const clockNow = getActiveClock().now();
  const lastBin = timeBins[timeBins.length - 1];

  if (!lastBin || clockNow - lastBin.timestamp >= BIN_SIZE_MS) {
    timeBins.shift();
    timeBins.push({
      timestamp: clockNow,
      allowed: 0,
      blocked: 0,
    });
    renderChart();
  }
}, BIN_SIZE_MS);

btnSendRequest.addEventListener('click', () => {
  executeRequest(getSelectedKey(), 1);
});

btnBurst5.addEventListener('click', () => {
  executeRequest(getSelectedKey(), 5);
  showToast(`Executed 5x Burst for ${getSelectedKey()}`, 'info');
});

btnBurst10.addEventListener('click', () => {
  executeRequest(getSelectedKey(), 10);
  showToast(`Executed 10x Burst for ${getSelectedKey()}`, 'warning');
});

const ICON_AUTO_SPAM = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg><span>Auto-Spam</span>`;
const ICON_STOP_SPAM = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg><span>Stop Spam</span>`;

btnAutoSpam.addEventListener('click', () => {
  if (spamIntervalId !== null) {
    window.clearInterval(spamIntervalId);
    spamIntervalId = null;
    btnAutoSpam.innerHTML = ICON_AUTO_SPAM;
    btnAutoSpam.classList.remove('btn-upstash-danger');
    showToast('Auto-spam generator halted', 'info');
  } else {
    btnAutoSpam.innerHTML = ICON_STOP_SPAM;
    btnAutoSpam.classList.add('btn-upstash-danger');
    showToast('Continuous auto-spam generator active', 'warning');
    spamIntervalId = window.setInterval(() => {
      executeRequest(getSelectedKey(), 1);
    }, 150);
  }
});

btnStepClock.addEventListener('click', () => {
  if (!isMockClock) {
    isMockClock = true;
    mockClock = new MockClock(Date.now());
    reloadLimiter();
  }
  mockClock.advance(5000);
  showToast('Advanced clock by +5000ms', 'info');
  updateUI();
});

btnCleanup.addEventListener('click', () => {
  const purgedSliding = slidingLimiter.cleanup(1000);
  const purgedBucket = tokenLimiter.cleanup(1000);
  showToast(`Memory Cleanup: Purged ${purgedSliding} sliding keys & ${purgedBucket} token buckets.`, 'success');
  updateUI();
});

btnRefresh.addEventListener('click', () => {
  if (spamIntervalId !== null) {
    window.clearInterval(spamIntervalId);
    spamIntervalId = null;
    btnAutoSpam.innerHTML = ICON_AUTO_SPAM;
    btnAutoSpam.classList.remove('btn-upstash-danger');
  }
  inMemoryStore = new InMemoryStore();
  isMockClock = false;
  reloadLimiter();
  showToast('Store and limiter reset', 'success');
  updateUI();
});

declare global {
  interface Window {
    switchActiveClient: (key: string) => void;
  }
}

window.switchActiveClient = (key: string) => {
  if (!teamSelect) return;
  let exists = false;
  for (let i = 0; i < teamSelect.options.length; i++) {
    const opt = teamSelect.options[i];
    if (opt && opt.value === key) {
      exists = true;
      break;
    }
  }
  if (!exists) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.text = key;
    teamSelect.appendChild(opt);
  }
  teamSelect.value = key;
  showToast(`Active client switched to: ${key}`, 'info');
  updateUI();
};

const teamSwitcherBox = document.querySelector('.minimal-team-switcher') as HTMLElement | null;
if (teamSwitcherBox) {
  teamSwitcherBox.addEventListener('click', (e) => {
    if (e.target !== teamSelect) {
      teamSelect.focus();
      if (typeof (teamSelect as HTMLSelectElement & { showPicker?: () => void }).showPicker === 'function') {
        try {
          (teamSelect as HTMLSelectElement & { showPicker?: () => void }).showPicker?.();
        } catch {
        }
      }
    }
  });
}

teamSelect.addEventListener('change', () => {
  showToast(`Active client switched to: ${getSelectedKey()}`, 'info');
  updateUI();
});

if (filterSelect) {
  filterSelect.addEventListener('change', () => {
    currentFilter = filterSelect.value as typeof currentFilter;
    renderAuditLogs();
  });
}

if (inputSearchLogs) {
  inputSearchLogs.addEventListener('input', () => {
    searchQuery = inputSearchLogs.value.trim();
    renderAuditLogs();
  });
}

if (btnClearLogs) {
  btnClearLogs.addEventListener('click', () => {
    logs.length = 0;
    renderAuditLogs();
    showToast('Audit stream logs cleared', 'info');
  });
}

if (btnExportLogs) {
  btnExportLogs.addEventListener('click', () => {
    if (logs.length === 0) {
      showToast('No logs to export', 'warning');
      return;
    }
    const headers = ['Timestamp', 'ClientKey', 'Policy', 'Status', 'QuotaInfo', 'LatencyMs'];
    const rows = logs.map((l) => [l.timeStr, l.key, l.policy, l.statusText, `"${l.tokensOrQuota}"`, l.latencyMs]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `rate_limiter_logs_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Logs exported as CSV', 'success');
  });
}

navSliding.addEventListener('click', () => {
  currentPolicy = 'sliding-window';
  navSliding.classList.add('active');
  navBucket.classList.remove('active');
  reloadLimiter();
  showToast('Switched to Sliding Window Log', 'info');
  updateUI();
});

navBucket.addEventListener('click', () => {
  currentPolicy = 'token-bucket';
  navBucket.classList.add('active');
  navSliding.classList.remove('active');
  reloadLimiter();
  showToast('Switched to Token Bucket', 'info');
  updateUI();
});

navSysDesign.addEventListener('click', () => {
  modalSysDesign.classList.add('open');
});

btnCloseSysDesign.addEventListener('click', () => {
  modalSysDesign.classList.remove('open');
});

modalSysDesign.addEventListener('click', (e) => {
  if (e.target === modalSysDesign) {
    modalSysDesign.classList.remove('open');
  }
});

btnOpenSettings.addEventListener('click', () => {
  modalSettings.classList.add('open');
});

btnCloseSettings.addEventListener('click', () => {
  modalSettings.classList.remove('open');
});

btnSaveSettings.addEventListener('click', () => {
  reloadLimiter();
  modalSettings.classList.remove('open');
  showToast('Settings saved and reloaded', 'success');
  updateUI();
});

modalSettings.addEventListener('click', (e) => {
  if (e.target === modalSettings) {
    modalSettings.classList.remove('open');
  }
});

reloadLimiter();
updateUI();
