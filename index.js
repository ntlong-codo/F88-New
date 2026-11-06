window.appState = {
  months: [],
  allData: [],
  filteredData: [],
  gpsFilterEnabled: false,
  apFilterEnabled: false,
  dailyPlanFilterEnabled: false,
  apFilterType: 'ap_old',
  apFilterGroupMode: 'xa',
  expandedApGroupKey: null,
  expandedApChildKey: null,
  selectedMonth: '',
  pendingFocus: null,
  currentLocation: null,
  currentPage: 1,
  pageSize: 20
};

window.F88_AUTH_KEY = 'f88_auth_session';
window.F88_AUTH_PASS = '124985';
window.F88_AUTH_TTL = 24 * 60 * 60 * 1000;

function normalizeMonthKey(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  const lower = text.toLowerCase();
  if (lower === 'all' || lower.includes('f88_sheet_cache_') || lower.includes('cache')) return '';

  const noSpace = text.replace(/tháng/gi, '').replace(/\s+/g, '');
  const matchSlash = noSpace.match(/(\d{1,2})[\/\-.](\d{4})/);
  if (matchSlash) return matchSlash[1].padStart(2, '0') + matchSlash[2];
  const matchReverse = noSpace.match(/(\d{4})[\/\-.](\d{1,2})/);
  if (matchReverse) return matchReverse[2].padStart(2, '0') + matchReverse[1];
  const compact = noSpace.match(/(\d{1,2})(\d{4})/);
  if (compact) return compact[1].padStart(2, '0') + compact[2];
  return noSpace;
}

function normalizeLocationText(value) {
  const text = String(value ?? '')
    .trim()
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();

  if (!text) return '';

  const prefixes = [
    'khu vuc', 'khu vực', 'kv',
    'thi tran', 'thị trấn', 'tt',
    'thi xa', 'thị xã', 'tx',
    'huyen', 'huyện',
    'xa', 'xã',
    'phuong', 'phường', 'p',
    'thon', 'thôn',
    'ap', 'ấp',
    'tinh', 'tỉnh',
    'thanh pho', 'thành phố', 'tp',
    'quan', 'quận',
    'duong', 'đường'
  ];

  let normalized = text;
  for (const prefix of prefixes) {
    normalized = normalized.replace(new RegExp(`^${prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*[-:]*\\s*`, 'i'), '');
  }

  normalized = normalized
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized;
}

function normalizeLocationKey(...parts) {
  const values = parts
    .map((part) => normalizeLocationText(part))
    .filter(Boolean);

  if (!values.length) return 'chua-co';
  return values.join(' || ');
}

function parseApAddressString(value, type) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return {
      ap: 'Chưa có ấp',
      xa: 'Chưa có xã',
      huyen: type === 'ap_old' ? 'Chưa có huyện' : '',
      tinh: 'Chưa có tỉnh'
    };
  }

  const parts = raw
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);

  const normalized = parts.map((part) => normalizeLocationText(part)).filter(Boolean);

  if (!normalized.length) {
    return {
      ap: 'Chưa có ấp',
      xa: 'Chưa có xã',
      huyen: type === 'ap_old' ? 'Chưa có huyện' : '',
      tinh: 'Chưa có tỉnh'
    };
  }

  if (type === 'ap_old') {
    return {
      ap: normalized[0] || 'Chưa có ấp',
      xa: normalized[1] || 'Chưa có xã',
      huyen: normalized[2] || 'Chưa có huyện',
      tinh: normalized[normalized.length - 1] || 'Chưa có tỉnh'
    };
  }

  return {
    ap: normalized[0] || 'Chưa có ấp',
    xa: normalized[1] || 'Chưa có xã',
    huyen: '',
    tinh: normalized[normalized.length - 1] || 'Chưa có tỉnh'
  };
}

function formatMonthLabel(value) {
  const normalized = normalizeMonthKey(value);
  if (!normalized) return 'Tất cả';
  if (normalized.length === 6 && /^\d{6}$/.test(normalized)) {
    return normalized.slice(0, 2) + '/' + normalized.slice(2);
  }
  return normalized;
}

function checkSession() {
  const overlay = document.getElementById('authOverlay');
  const mainContent = document.getElementById('mainContent');
  if (!overlay || !mainContent) {
    initApp();
    return;
  }

  try {
    const raw = localStorage.getItem(window.F88_AUTH_KEY);
    if (!raw) {
      overlay.style.display = 'flex';
      mainContent.classList.add('d-none');
      return;
    }

    const auth = JSON.parse(raw);
    if (auth.pass === window.F88_AUTH_PASS && auth.expiry && Date.now() < auth.expiry) {
      overlay.style.display = 'none';
      mainContent.classList.remove('d-none');
      setLoadingStatus('Đang kết nối API...', 'Bước 1/2: tải danh sách kỳ tháng...');
      initApp();
      return;
    }
  } catch (error) {
    console.error('Auth session error', error);
  }

  overlay.style.display = 'flex';
  mainContent.classList.add('d-none');
}

function checkAuth() {
  const passInput = document.getElementById('passInput');
  const authError = document.getElementById('authError');
  if (!passInput) return;

  if (passInput.value.trim() === window.F88_AUTH_PASS) {
    localStorage.setItem(window.F88_AUTH_KEY, JSON.stringify({
      pass: window.F88_AUTH_PASS,
      expiry: Date.now() + window.F88_AUTH_TTL
    }));
    checkSession();
    if (authError) authError.classList.add('d-none');
    showToast('Đăng nhập thành công.', 'success');
    return;
  }

  if (authError) authError.classList.remove('d-none');
  passInput.value = '';
  showToast('Mật khẩu không chính xác!', 'danger');
}

function logout() {
  localStorage.removeItem(window.F88_AUTH_KEY);
  if (document.getElementById('authOverlay')) {
    document.getElementById('authOverlay').style.display = 'flex';
  }
  if (document.getElementById('mainContent')) {
    document.getElementById('mainContent').classList.add('d-none');
  }
  const passInput = document.getElementById('passInput');
  if (passInput) passInput.value = '';
  showToast('Đã đăng xuất.', 'secondary');
}

window.addEventListener('DOMContentLoaded', function () {
  checkSession();
});

function setLoadingStatus(status, detail) {
  const statusNode = document.getElementById('loadingStatusText');
  const detailNode = document.getElementById('loadingDetailText');
  if (statusNode) statusNode.textContent = status;
  if (detailNode) detailNode.textContent = detail;
}

function setSyncButtonState(state, message = '') {
  const btn = document.getElementById('manualSyncBtn');
  const icon = document.getElementById('syncActionIcon');
  const label = btn ? btn.querySelector('.sync-action-label') : null;

  if (!btn || !icon) return;

  icon.classList.remove('sync-running', 'sync-success', 'sync-error');
  icon.textContent = '🔄';

  if (state === 'running') {
    icon.textContent = '⟳';
    icon.classList.add('sync-running');
    btn.title = message || 'Đang đồng bộ dữ liệu...';
    btn.disabled = true;
    if (label) label.textContent = 'Syncing';
    return;
  }

  if (state === 'success') {
    icon.textContent = '✓';
    icon.classList.add('sync-success');
    btn.title = message || 'Đồng bộ thành công.';
    btn.disabled = false;
    if (label) label.textContent = 'Sync';
    return;
  }

  if (state === 'error') {
    icon.textContent = '✕';
    icon.classList.add('sync-error');
    btn.title = message || 'Đồng bộ thất bại.';
    btn.disabled = false;
    if (label) label.textContent = 'Sync';
    return;
  }

  icon.textContent = '🔄';
  btn.title = message || 'Đồng bộ dữ liệu';
  btn.disabled = false;
  if (label) label.textContent = 'Sync';
}

function updateSyncStatusUi(connected, message) {
  const manualBtn = document.getElementById('manualSyncBtn');
  if (!manualBtn) return;

  if (connected) {
    setSyncButtonState('success', message || 'Đồng bộ thành công.');
  } else {
    setSyncButtonState('error', message || 'Đồng bộ thất bại.');
  }
}

window.updateSyncStatusUi = updateSyncStatusUi;

async function syncSheetAndCacheWithoutUiReload() {
  const month = normalizeMonthKey(window.appState.selectedMonth || '');
  const cacheKey = buildSheetCacheKey(month);
  const fallbackRows = readSheetCache(month) && Array.isArray(readSheetCache(month).data) ? readSheetCache(month).data : [];

  try {
    const result = await window.F88_API.fetch('getData', { month });
    const rows = Array.isArray(result.data) ? result.data : [];
    if (rows.length) {
      writeSheetCache(cacheKey, rows);
      window.appState.allData = rows;
    } else if (fallbackRows.length) {
      window.appState.allData = fallbackRows;
    }

    updateSyncStatusUi(true, 'Đồng bộ thành công.');
    return rows.length ? rows : fallbackRows;
  } catch (error) {
    console.error(error);
    updateSyncStatusUi(false, 'Đồng bộ thất bại, đang dùng cache cũ.');
    if (fallbackRows.length) {
      window.appState.allData = fallbackRows;
    }
    throw error;
  }
}

async function triggerManualSync() {
  const month = normalizeMonthKey(window.appState.selectedMonth || '');
  setSyncButtonState('running', 'Đang đồng bộ dữ liệu...');
  try {
    await syncSheetAndCacheWithoutUiReload();
    showToast('Đồng bộ dữ liệu thành công.', 'success');
  } catch (error) {
    showToast('Đồng bộ thất bại. Dữ liệu cache vẫn đang hoạt động.', 'warning');
  }
}

window.triggerManualSync = triggerManualSync;

const F88_DATA_CACHE_TTL_MS = 5 * 60 * 1000;

function buildSheetCacheKey(monthKey) {
  return 'f88_sheet_cache_' + (monthKey || 'all');
}

function readSheetCache(monthKey) {
  try {
    const storageKey = buildSheetCacheKey(monthKey);
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.data) || !parsed.updatedAt) return null;
    return { data: parsed.data, updatedAt: Number(parsed.updatedAt) || 0 };
  } catch (error) {
    console.warn('Sheet cache read failed:', error);
    return null;
  }
}

function writeSheetCache(monthKey, rows) {
  try {
    const storageKey = buildSheetCacheKey(monthKey);
    const payload = {
      updatedAt: Date.now(),
      data: Array.isArray(rows) ? rows : []
    };
    localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch (error) {
    console.warn('Sheet cache write failed:', error);
  }
}

function readMonthsCache() {
  try {
    const raw = localStorage.getItem('f88_months_cache');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed) return [];

    if (Array.isArray(parsed.months)) return parsed.months;
    if (Array.isArray(parsed.data)) return parsed.data;
    return [];
  } catch (error) {
    console.warn('Months cache read failed:', error);
    return [];
  }
}

function writeMonthsCache(months) {
  try {
    localStorage.setItem('f88_months_cache', JSON.stringify({ updatedAt: Date.now(), months: Array.isArray(months) ? months : [] }));
  } catch (error) {
    console.warn('Months cache write failed:', error);
  }
}

function deriveMonthsFromLocalSheetCache() {
  try {
    const months = [];
    const seen = new Set();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('f88_sheet_cache_')) continue;
      const month = key.replace('f88_sheet_cache_', '').trim();
      const normalized = normalizeMonthKey(month);
      if (!normalized || normalized === 'all' || seen.has(normalized)) continue;
      seen.add(normalized);
      months.push(normalized);
    }
    return months.sort((a, b) => String(b).localeCompare(String(a)));
  } catch (error) {
    console.warn('Derived months from local cache failed:', error);
    return [];
  }
}

function buildMonthOptions(months, defaultMonth = '') {
  const monthSelect = document.getElementById('statMonthSelect');
  if (!monthSelect) return '';

  const validMonths = Array.from(new Set((months || []).map((month) => normalizeMonthKey(month)).filter(Boolean))).sort((a, b) => String(b).localeCompare(String(a)));
  monthSelect.innerHTML = '<option value="">-- Tất cả --</option>';

  validMonths.forEach((monthKey) => {
    const option = document.createElement('option');
    option.value = monthKey;
    option.textContent = 'Kỳ ' + formatMonthLabel(monthKey);
    monthSelect.appendChild(option);
  });

  const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
  const currentYear = String(new Date().getFullYear());
  const currentMonthKey = normalizeMonthKey(currentMonth + currentYear);
  const fallbackMonth = normalizeMonthKey(defaultMonth || validMonths[0] || currentMonthKey || '');
  const selectedMonth = validMonths.includes(fallbackMonth) ? fallbackMonth : '';

  monthSelect.value = selectedMonth;
  window.appState.selectedMonth = selectedMonth;
  window.appState.months = validMonths;
  return selectedMonth;
}

async function refreshMonthOptions({ preserveCurrent = true } = {}) {
  const currentSelection = preserveCurrent ? normalizeMonthKey(window.appState.selectedMonth || document.getElementById('statMonthSelect')?.value || '') : '';
  let months = readMonthsCache();
  if (!months.length) {
    months = deriveMonthsFromLocalSheetCache();
  }

  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const currentMonthKey = normalizeMonthKey(String(currentMonth).padStart(2, '0') + String(currentYear));
  const fallbackMonths = months.length ? months : (currentMonthKey ? [currentMonthKey] : []);

  const merged = Array.from(new Set([...fallbackMonths].map((month) => normalizeMonthKey(month)).filter(Boolean)))
    .sort((a, b) => String(b).localeCompare(String(a)));

  const selectedCandidate = preserveCurrent && currentSelection && merged.includes(currentSelection)
    ? currentSelection
    : (merged[0] || '');

  buildMonthOptions(merged, selectedCandidate);

  try {
    const result = await window.F88_API.fetch('getMonths');
    const remoteMonths = Array.isArray(result && result.months) ? result.months : [];
    const normalizedRemote = remoteMonths.map((month) => normalizeMonthKey(month)).filter(Boolean);
    if (normalizedRemote.length) {
      normalizedRemote.forEach((month) => {
        if (!merged.includes(month)) merged.push(month);
      });
      merged.sort((a, b) => String(b).localeCompare(String(a)));
      writeMonthsCache(merged);
      const nextSelected = preserveCurrent && currentSelection && merged.includes(currentSelection)
        ? currentSelection
        : (merged[0] || '');
      buildMonthOptions(merged, nextSelected);
    }
  } catch (error) {
    console.warn('Failed to refresh month list from sheet:', error);
    if (!merged.length) {
      const fallback = currentMonthKey ? [currentMonthKey] : [];
      writeMonthsCache(fallback);
    }
  }

  return merged;
}

function readLatestCachedRowsForSelection() {
  try {
    const selectedMonth = normalizeMonthKey(window.appState && window.appState.selectedMonth ? window.appState.selectedMonth : '');
    const candidates = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('f88_sheet_cache_')) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.data)) continue;
        const monthKey = key.replace('f88_sheet_cache_', '');
        const matchesSelection = !selectedMonth || monthKey === selectedMonth || monthKey === 'all';
        if (matchesSelection) {
          candidates.push({ monthKey, rows: parsed.data, updatedAt: Number(parsed.updatedAt) || 0 });
        }
      } catch (error) {
        console.warn('Read cached sheet entry failed:', error);
      }
    }

    if (!candidates.length) return [];
    candidates.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return candidates[0].rows;
  } catch (error) {
    console.warn('Latest cached rows read failed:', error);
    return [];
  }
}

function scheduleBackgroundRefresh() {
  if (window.__f88_backgroundRefreshTimer) return;
  window.__f88_backgroundRefreshTimer = null;
}

function parseCoordinate(value) {
  if (!value) return null;
  const str = String(value).trim().replace(/^gps\s*[:=]\s*/i, '').replace(/[()]/g, '').replace(/;/g, ',');
  const match = str.match(/-?\d+(?:\.\d+)?\s*[,\s]\s*-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parts = match[0].split(/[\s,]+/).filter(Boolean);
  if (parts.length < 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function hasAnyValidCustomerGps(customer) {
  const gpsFields = ['GPS_Chinh', 'GPS_1', 'GPS_2', 'GPS_3', 'GPS_4', 'GPS_5', 'GPS_AP_NEW', 'GPS_AP_OLD'];
  for (const field of gpsFields) {
    const value = customer[field] || customer[field.toLowerCase()] || customer[field.replace(/_/g, '')] || '';
    if (parseCoordinate(value)) return true;
  }
  return false;
}

function getCustomerCoord(customer) {
  const gpsFields = ['GPS_Chinh', 'GPS_1', 'GPS_2', 'GPS_3', 'GPS_4', 'GPS_5', 'GPS_AP_NEW', 'GPS_AP_OLD'];
  for (const field of gpsFields) {
    const value = customer[field] || customer[field.toLowerCase()] || customer[field.replace(/_/g, '')] || '';
    const coord = parseCoordinate(value);
    if (coord) return coord;
  }
  return null;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getCustomerDistanceKm(customer) {
  const coord = getCustomerCoord(customer);
  if (!coord || !window.appState.currentLocation) return null;
  return haversineKm(window.appState.currentLocation.lat, window.appState.currentLocation.lng, coord.lat, coord.lng);
}

function getNearestCustomerCoordForGroup(customers) {
  const coords = (customers || [])
    .map((customer) => getCustomerCoord(customer))
    .filter(Boolean);

  if (!coords.length) return null;

  return coords.reduce((nearest, coord) => {
    if (!nearest) return coord;
    return (window.appState.currentLocation)
      ? (haversineKm(window.appState.currentLocation.lat, window.appState.currentLocation.lng, coord.lat, coord.lng) <
         haversineKm(window.appState.currentLocation.lat, window.appState.currentLocation.lng, nearest.lat, nearest.lng)
        ? coord
        : nearest)
      : nearest;
  }, null);
}

function getNearestDistanceForApGroup(customers) {
  const coords = (customers || [])
    .map((customer) => getCustomerCoord(customer))
    .filter(Boolean);

  if (!coords.length || !window.appState.currentLocation) return null;

  return Math.min(...coords.map((coord) => haversineKm(window.appState.currentLocation.lat, window.appState.currentLocation.lng, coord.lat, coord.lng)));
}

function locateCurrentPosition() {
  if (window.appState.currentLocation) return Promise.resolve(window.appState.currentLocation);
  if (!navigator.geolocation) {
    document.getElementById('gpsStatusText').textContent = 'Không hỗ trợ định vị trên trình duyệt';
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        window.appState.currentLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        const gpsStatusText = document.getElementById('gpsStatusText');
        if (gpsStatusText) gpsStatusText.textContent = 'Vị trí hiện tại: ' + window.appState.currentLocation.lat.toFixed(4) + ', ' + window.appState.currentLocation.lng.toFixed(4);
        resolve(window.appState.currentLocation);
      },
      () => {
        const gpsStatusText = document.getElementById('gpsStatusText');
        if (gpsStatusText) gpsStatusText.textContent = 'Không thể lấy vị trí hiện tại';
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  });
}

function updateFilterCount() {
  let count = 0;
  if (window.appState.dailyPlanFilterEnabled) count += 1;
  const monthSelect = document.getElementById('statMonthSelect');
  const filterMonthEl = document.getElementById('filterMonth');
  if (monthSelect && monthSelect.value) count += 1;
  if (filterMonthEl && filterMonthEl.value) count += 1;
  const filterCheckEl = document.getElementById('filterCheck');
  if (filterCheckEl && filterCheckEl.value) count += 1;
  const filterGpsTypeEl = document.getElementById('filterGpsType');
  if (filterGpsTypeEl && filterGpsTypeEl.value && filterGpsTypeEl.value !== 'all') count += 1;
  const filterThanhToanEl = document.getElementById('filterThanhToan');
  if (filterThanhToanEl && filterThanhToanEl.value) count += 1;
  const filterTrangThaiHdEl = document.getElementById('filterTrangThaiHd');
  if (filterTrangThaiHdEl && filterTrangThaiHdEl.value) count += 1;
  const filterTimNhaEl = document.getElementById('filterTimNha');
  if (filterTimNhaEl && filterTimNhaEl.value) count += 1;
  const filterDoKhoEl = document.getElementById('filterDoKho');
  if (filterDoKhoEl && filterDoKhoEl.value) count += 1;
  const filterThuongTruEl = document.getElementById('filterThuongTru');
  if (filterThuongTruEl && filterThuongTruEl.value.trim()) count += 1;
  const activeFilterCountEl = document.getElementById('activeFilterCount');
  if (activeFilterCountEl) activeFilterCountEl.textContent = String(count);
}

async function initApp() {
  try {
    const initialSelectedMonth = normalizeMonthKey(window.appState.selectedMonth || '');
    const cachedData = readLatestCachedRowsForSelection();

    if (Array.isArray(cachedData) && cachedData.length) {
      window.appState.allData = cachedData;
      filterData();
      setLoadingStatus('Đã tải dữ liệu cache', 'Hiển thị dữ liệu local trước, đang đồng bộ sheet sau...');
    } else {
      setLoadingStatus('Đang kiểm tra dữ liệu mới...', 'Hiển thị dữ liệu local trước, đồng bộ sheet sau...');
    }

    refreshMonthOptions({ preserveCurrent: true }).catch(() => {});
    scheduleBackgroundRefresh();

    const startupLoad = loadCustomerData({
      background: false,
      cacheFirst: true,
      monthOverride: initialSelectedMonth || window.appState.selectedMonth || ''
    }).catch(() => {});

    await startupLoad;
  } catch (error) {
    console.error(error);
    setLoadingStatus('Lỗi kết nối API', 'Không thể tải dữ liệu từ Google Apps Script.');
    showToast('Không thể kết nối API. Kiểm tra lại script URL hoặc quyền truy cập.', 'danger');
  }
}

async function loadCustomerData(options = {}) {
  const { background = false, monthOverride = null, cacheFirst = false } = options;
  const month = normalizeMonthKey(monthOverride || window.appState.selectedMonth || '');
  const cacheKey = buildSheetCacheKey(month);
  const cached = readSheetCache(month);
  const isFreshCache = cached && Array.isArray(cached.data) && cached.data.length && Date.now() - (cached.updatedAt || 0) < F88_DATA_CACHE_TTL_MS;

  if (isFreshCache && (cacheFirst || !background)) {
    window.appState.allData = cached.data;
    filterData();
    updateSyncStatusUi(true, 'Dữ liệu local đang sẵn sàng.');
    if (!background) {
      setLoadingStatus('Đã tải dữ liệu cache', 'Hiển thị dữ liệu local trước, đang kiểm tra bản mới...');
    }

    if (background) {
      setTimeout(() => {
        triggerBackgroundFetchFromSheet({ month, cacheKey, fallbackRows: cached.data }).catch(() => {});
      }, 250);
      return;
    }

    return;
  }

  try {
    const result = await window.F88_API.fetch('getData', { month });
    const rows = Array.isArray(result.data) ? result.data : [];
    if (rows.length) {
      writeSheetCache(cacheKey, rows);
    }

    window.appState.allData = rows;

    if (!background || !hasOpenCustomerCardForBackgroundSync()) {
      filterData();
    }
    updateSyncStatusUi(true, 'Sheet đang kết nối bình thường.');

    const loadedCount = rows.length;
    if (!background) {
      setLoadingStatus('Đã tải dữ liệu', 'Tổng khách hàng: ' + loadedCount);
      showToast('Đã tải ' + loadedCount + ' khách hàng.', 'success');
    }

    if (background && rows.length && !hasOpenCustomerCardForBackgroundSync()) {
      showToast('Đã cập nhật dữ liệu nền thành công.', 'secondary');
    }
  } catch (error) {
    console.error(error);
    updateSyncStatusUi(false, 'Mất kết nối sheet, đang dùng cache cũ.');
    const fallbackRows = cached && Array.isArray(cached.data) ? cached.data : [];
    if (fallbackRows.length) {
      window.appState.allData = fallbackRows;
      filterData();
      setLoadingStatus('Đang dùng dữ liệu cũ', 'Kết nối sheet thất bại, dữ liệu cache vẫn đang hiển thị.');
      if (!background) showToast('Mất kết nối sheet. Dữ liệu cũ vẫn đang được phục vụ.', 'warning');
      return;
    }

    setLoadingStatus('Lỗi tải dữ liệu', 'Đã xảy ra lỗi khi đọc dữ liệu từ Google Sheets.');
    if (!background) showToast('Lỗi khi tải dữ liệu.', 'danger');
  }
}

async function triggerBackgroundFetchFromSheet({ month, cacheKey, fallbackRows }) {
  try {
    const result = await window.F88_API.fetch('getData', { month });
    const rows = Array.isArray(result.data) ? result.data : [];
    if (rows.length) {
      writeSheetCache(cacheKey, rows);
    }

    window.appState.allData = rows.length ? rows : fallbackRows;
    if (!hasOpenCustomerCardForBackgroundSync()) {
      filterData();
    }
    updateSyncStatusUi(true, 'Sheet đang kết nối bình thường.');
  } catch (error) {
    console.error(error);
    if (fallbackRows && fallbackRows.length) {
      window.appState.allData = fallbackRows;
      filterData();
    }
    updateSyncStatusUi(false, 'Mất kết nối sheet, đang dùng cache cũ.');
  }
}

function syncMonthAndReload(month) {
  const normalizedMonth = normalizeMonthKey(month || '');
  window.appState.selectedMonth = normalizedMonth;
  const monthSelect = document.getElementById('statMonthSelect');
  if (monthSelect) monthSelect.value = normalizedMonth;
  loadCustomerData();
  showToast('Đã chọn kỳ ' + (normalizedMonth ? formatMonthLabel(normalizedMonth) : 'tất cả tháng') + '.', 'info');
}

function getCurrentRegularFilterState() {
  return {
    selectedMonth: normalizeMonthKey(window.appState.selectedMonth || ''),
    selectedCheck: document.getElementById('filterCheck')?.value || '',
    selectedGpsType: document.getElementById('filterGpsType')?.value || 'all',
    selectedThanhToan: document.getElementById('filterThanhToan')?.value || '',
    selectedTrangThaiHd: document.getElementById('filterTrangThaiHd')?.value || '',
    selectedTimNha: document.getElementById('filterTimNha')?.value || '',
    selectedDoKho: document.getElementById('filterDoKho')?.value || '',
    keyword: (document.getElementById('searchKeyword') || {}).value || '',
    thuongTru: (document.getElementById('filterThuongTru') || {}).value || '',
    gpsFilterType: document.getElementById('gpsFilterType')?.value || 'all',
    gpsFilterCheckState: document.getElementById('gpsFilterCheckState')?.value || ''
  };
}

function applyApFilter(data) {
  const apType = window.appState.apFilterType || 'ap_old';
  const groups = {};

  const recordApEntries = (customer) => {
    const records = [];

    const oldRaw = customer.WARD_HO_KHAU_AP_OLD || customer['WARD_HO_KHAU_AP_OLD'] || '';
    const newRaw = customer.WARD_HO_KHAU_AP_NEW || customer['WARD_HO_KHAU_AP_NEW'] || '';

    if (oldRaw) {
      const parsed = parseApAddressString(oldRaw, 'ap_old');
      records.push({
        source: 'ap_old',
        type: 'ap_old',
        ap: normalizeLocationKey(parsed.ap),
        xa: normalizeLocationKey(parsed.xa),
        huyen: normalizeLocationKey(parsed.huyen),
        tinh: normalizeLocationKey(parsed.tinh),
        raw: oldRaw
      });
    }

    if (newRaw) {
      const parsed = parseApAddressString(newRaw, 'ap_new');
      records.push({
        source: 'ap_new',
        type: 'ap_new',
        ap: normalizeLocationKey(parsed.ap),
        xa: normalizeLocationKey(parsed.xa),
        huyen: normalizeLocationKey(parsed.huyen),
        tinh: normalizeLocationKey(parsed.tinh),
        raw: newRaw
      });
    }

    return records;
  };

  data.forEach((customer) => {
    const entries = recordApEntries(customer);
    if (!entries.length) return;

    if (apType === 'mixed') {
      const oldEntries = entries.filter((entry) => entry.source === 'ap_old');
      const newEntries = entries.filter((entry) => entry.source === 'ap_new');

      if (oldEntries.length) {
        oldEntries.forEach((oldEntry) => {
          const oldBaseKey = `${oldEntry.tinh || 'chua-co'}||${oldEntry.xa || 'chua-co'}`;
          const matchedNewEntries = newEntries.filter((newEntry) => {
            const sameApName = normalizeLocationKey(oldEntry.ap) === normalizeLocationKey(newEntry.ap);
            const sameTinh = !oldEntry.tinh || !newEntry.tinh || oldEntry.tinh === newEntry.tinh;
            const sameXa = !oldEntry.xa || !newEntry.xa || oldEntry.xa === newEntry.xa;
            const newBaseKey = `${newEntry.tinh || 'chua-co'}||${newEntry.xa || 'chua-co'}`;

            const sameBaseLocality = oldBaseKey === newBaseKey;
            return sameApName && sameTinh && sameXa && sameBaseLocality;
          });

          const targetEntries = matchedNewEntries.length ? matchedNewEntries : [oldEntry];
          targetEntries.forEach((targetEntry) => {
            const communeKey = `${oldEntry.tinh || targetEntry.tinh || 'chua-co'}||${oldEntry.huyen || targetEntry.huyen || 'chua-co'}||${oldEntry.xa || targetEntry.xa || 'chua-co'}`;
            const apKey = targetEntry.ap || oldEntry.ap || 'Chưa có ấp';

            if (!groups[communeKey]) {
              groups[communeKey] = {
                key: oldEntry.xa || targetEntry.xa || 'Chưa có xã',
                type: 'xa',
                xaphuong: oldEntry.xa || targetEntry.xa || 'Chưa có xã',
                quanhuyen: oldEntry.huyen || 'Chưa có huyện',
                tinhtp: oldEntry.tinh || targetEntry.tinh || 'Chưa có tỉnh',
                apGroups: {}
              };
            }

            if (!groups[communeKey].apGroups[apKey]) {
              groups[communeKey].apGroups[apKey] = {
                key: apKey,
                type: 'mixed',
                xaphuong: oldEntry.xa || targetEntry.xa || 'Chưa có xã',
                quanhuyen: oldEntry.huyen || 'Chưa có huyện',
                tinhtp: oldEntry.tinh || targetEntry.tinh || 'Chưa có tỉnh',
                customers: []
              };
            }

            groups[communeKey].apGroups[apKey].customers.push(customer);
          });
        });
      }

      newEntries.forEach((newEntry) => {
        const hasMatchingOld = oldEntries.some((oldEntry) => {
          const sameApName = normalizeLocationKey(oldEntry.ap) === normalizeLocationKey(newEntry.ap);
          const sameTinh = !oldEntry.tinh || !newEntry.tinh || oldEntry.tinh === newEntry.tinh;
          const sameXa = !oldEntry.xa || !newEntry.xa || oldEntry.xa === newEntry.xa;
          const oldBaseKey = `${oldEntry.tinh || 'chua-co'}||${oldEntry.xa || 'chua-co'}`;
          const newBaseKey = `${newEntry.tinh || 'chua-co'}||${newEntry.xa || 'chua-co'}`;
          return sameApName && sameTinh && sameXa && oldBaseKey === newBaseKey;
        });

        if (hasMatchingOld) return;

        const communeKey = `${newEntry.tinh || 'chua-co'}||${newEntry.huyen || 'chua-co'}||${newEntry.xa || 'chua-co'}`;
        const apKey = newEntry.ap || 'Chưa có ấp';

        if (!groups[communeKey]) {
          groups[communeKey] = {
            key: newEntry.xa || 'Chưa có xã',
            type: 'xa',
            xaphuong: newEntry.xa || 'Chưa có xã',
            quanhuyen: newEntry.huyen || 'Chưa có huyện',
            tinhtp: newEntry.tinh || 'Chưa có tỉnh',
            apGroups: {}
          };
        }

        if (!groups[communeKey].apGroups[apKey]) {
          groups[communeKey].apGroups[apKey] = {
            key: apKey,
            type: 'mixed',
            xaphuong: newEntry.xa || 'Chưa có xã',
            quanhuyen: newEntry.huyen || 'Chưa có huyện',
            tinhtp: newEntry.tinh || 'Chưa có tỉnh',
            customers: []
          };
        }

        groups[communeKey].apGroups[apKey].customers.push(customer);
      });

      return;
    }

    const apKeyField = apType === 'ap_old' ? 'WARD_HO_KHAU_AP_OLD' : 'WARD_HO_KHAU_AP_NEW';
    const rawApValue = customer[apKeyField] || customer[apKeyField.toLowerCase()] || '';
    const parsed = parseApAddressString(rawApValue, apType);

    const tinhName = normalizeLocationKey(parsed.tinh || customer.TINHTP || customer['TINHTP'] || '');
    const huyenName = normalizeLocationKey(parsed.huyen || customer.WARD_TAM_TRU || customer['WARD_TAM_TRU'] || '');
    const xaName = normalizeLocationKey(parsed.xa || customer.WARD_HO_KHAU || customer['WARD_HO_KHAU'] || '');
    const apName = normalizeLocationKey(parsed.ap || rawApValue || '');

    const communeKey = `${tinhName}||${huyenName}||${xaName}`;
    const apKey = apName;

    if (!groups[communeKey]) {
      groups[communeKey] = {
        key: xaName,
        type: 'xa',
        xaphuong: xaName,
        quanhuyen: huyenName,
        tinhtp: tinhName,
        apGroups: {}
      };
    }

    if (!groups[communeKey].apGroups[apKey]) {
      groups[communeKey].apGroups[apKey] = {
        key: apKey,
        type: apType,
        xaphuong: xaName,
        quanhuyen: huyenName,
        tinhtp: tinhName,
        customers: []
      };
    }

    groups[communeKey].apGroups[apKey].customers.push(customer);
  });

  return Object.values(groups)
    .map((entry) => {
      const apEntries = Object.values(entry.apGroups)
        .map((apEntry) => {
          const coords = apEntry.customers
            .map((customer) => getCustomerCoord(customer))
            .filter(Boolean);
          const nearestKm = getNearestDistanceForApGroup(apEntry.customers);

          return {
            ...apEntry,
            count: apEntry.customers.length,
            coords,
            nearestKm: nearestKm ?? (window.appState.currentLocation && coords.length
              ? Math.min(...coords.map((coord) => haversineKm(window.appState.currentLocation.lat, window.appState.currentLocation.lng, coord.lat, coord.lng)))
              : null)
          };
        })
        .sort((a, b) => (a.nearestKm ?? Number.MAX_SAFE_INTEGER) - (b.nearestKm ?? Number.MAX_SAFE_INTEGER));

      const allCoords = apEntries.flatMap((apEntry) => apEntry.coords);
      const center = allCoords.length ? {
        lat: allCoords.reduce((sum, coord) => sum + coord.lat, 0) / allCoords.length,
        lng: allCoords.reduce((sum, coord) => sum + coord.lng, 0) / allCoords.length
      } : null;
      const nearestKm = window.appState.currentLocation && center
        ? haversineKm(window.appState.currentLocation.lat, window.appState.currentLocation.lng, center.lat, center.lng)
        : null;
      const fallbackNearestKm = getNearestDistanceForApGroup((Object.values(entry.apGroups) || []).flatMap((apGroup) => apGroup.customers || []));

      const totalCustomers = apEntries.reduce((sum, apEntry) => sum + apEntry.count, 0);
      return {
        ...entry,
        count: totalCustomers,
        coords: allCoords,
        center,
        nearestKm: nearestKm ?? fallbackNearestKm,
        apGroups: apEntries
      };
    })
    .sort((a, b) => {
      const left = [a.tinhtp, a.quanhuyen, a.xaphuong].join(' ').localeCompare([b.tinhtp, b.quanhuyen, b.xaphuong].join(' '), 'vi');
      if (left !== 0) return left;
      return (a.nearestKm ?? Number.MAX_SAFE_INTEGER) - (b.nearestKm ?? Number.MAX_SAFE_INTEGER);
    });
}

function renderApGroupCards(entries) {
  const container = document.getElementById('customerCardContainer');
  if (!container) return;

  if (!entries.length) {
    container.innerHTML = '<div class="text-center py-5 text-muted bg-white rounded shadow-sm">Không có xã nào phù hợp với bộ lọc hiện tại.</div>';
    return;
  }

  const expandedKey = window.appState.expandedApGroupKey || null;
  const expandedEntry = expandedKey ? entries.find((entry) => entry.key === expandedKey) : null;

  if (expandedEntry && expandedEntry.apGroups && expandedEntry.apGroups.length) {
    const activeChildKey = window.appState.expandedApChildKey || null;
    const childEntry = activeChildKey ? expandedEntry.apGroups.find((apEntry) => apEntry.key === activeChildKey) : null;

    if (childEntry) {
      const customers = (childEntry.customers || []).map((customer, index) => buildCustomerCardHtml(customer, index)).join('');
      container.innerHTML = `
        <div class="mb-2 d-flex gap-2">
          <button class="btn btn-sm btn-outline-secondary" type="button" id="backToApGroupBtn">← Quay lại danh sách ấp</button>
        </div>
        ${customers}
      `;

      const backBtn = document.getElementById('backToApGroupBtn');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          window.appState.expandedApChildKey = null;
          renderApGroupCards(entries);
        });
      }
      return;
    }

    const sortedApGroups = [...expandedEntry.apGroups].sort((a, b) => (a.nearestKm ?? Number.MAX_SAFE_INTEGER) - (b.nearestKm ?? Number.MAX_SAFE_INTEGER));
    const html = sortedApGroups.map((apEntry, index) => {
      const cardClass = index % 2 === 0 ? 'bg-white' : 'bg-light';
      const locationText = [apEntry.key, apEntry.xaphuong, apEntry.quanhuyen, apEntry.tinhtp].filter(Boolean).join(' - ');
      const distanceText = apEntry.nearestKm != null ? `${apEntry.nearestKm.toFixed(1)} km` : 'Không có GPS';
      return `
        <div class="customer-card ${cardClass} border-0" data-ap-child="${escapeHtml(apEntry.key)}" style="border-left: 4px solid #198754; border-radius: 10px; margin-bottom: 10px; cursor: pointer;">
          <div class="d-flex justify-content-between align-items-center gap-2">
            <div class="flex-grow-1">
              <div class="fw-bold text-dark">${escapeHtml(apEntry.key)}</div>
              <div class="small text-secondary">${escapeHtml(locationText)}</div>
            </div>
            <div class="text-end">
              <div class="badge bg-success-subtle text-success border border-success-subtle fw-bold">${apEntry.count} khách</div>
              <div class="small text-dark fw-bold mt-1">${distanceText}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="mb-2">
        <button class="btn btn-sm btn-outline-secondary" type="button" id="backToXaListBtn">← Quay lại danh sách xã</button>
      </div>
      ${html}
    `;

    const backBtn = document.getElementById('backToXaListBtn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        window.appState.expandedApGroupKey = null;
        window.appState.expandedApChildKey = null;
        renderApGroupCards(entries);
      });
    }

    container.querySelectorAll('[data-ap-child]').forEach((card) => {
      card.addEventListener('click', () => {
        const apKey = card.getAttribute('data-ap-child');
        const item = expandedEntry.apGroups.find((entry) => entry.key === apKey);
        if (!item || !item.customers.length) return;
        window.appState.expandedApChildKey = apKey;
        renderApGroupCards(entries);
      });
    });
    return;
  }

  const sortedEntries = [...entries].sort((a, b) => (a.nearestKm ?? Number.MAX_SAFE_INTEGER) - (b.nearestKm ?? Number.MAX_SAFE_INTEGER));
  const html = sortedEntries.map((entry, index) => {
    const cardClass = index % 2 === 0 ? 'bg-white' : 'bg-light';
    const locationText = [entry.xaphuong, entry.quanhuyen, entry.tinhtp].filter(Boolean).join(' - ');
    const distanceText = entry.nearestKm != null ? `${entry.nearestKm.toFixed(1)} km` : 'Không có GPS';
    return `
      <div class="customer-card ${cardClass} border-0" data-ap-group="${escapeHtml(entry.key)}" style="border-left: 4px solid #0d6efd; border-radius: 10px; margin-bottom: 10px; cursor: pointer;">
        <div class="d-flex justify-content-between align-items-center gap-2">
          <div class="flex-grow-1">
            <div class="fw-bold text-dark">${escapeHtml(entry.key)}</div>
            <div class="small text-secondary">${escapeHtml(locationText)}</div>
          </div>
          <div class="text-end">
            <div class="badge bg-primary-subtle text-primary border border-primary-subtle fw-bold">${entry.count} khách</div>
            <div class="small text-dark fw-bold mt-1">${distanceText}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
  container.querySelectorAll('[data-ap-group]').forEach((card) => {
    card.addEventListener('click', () => {
      const xaKey = card.getAttribute('data-ap-group');
      const item = entries.find((entry) => entry.key === xaKey);
      if (!item || !item.apGroups || !item.apGroups.length) return;
      window.appState.expandedApGroupKey = xaKey;
      window.appState.expandedApChildKey = null;
      renderApGroupCards(entries);
    });
  });
}


function reloadCurrentListUi() {
  const month = normalizeMonthKey(window.appState.selectedMonth || '');
  setSyncButtonState('running', 'Đang tải dữ liệu nền...');
  showToast('Đang tải dữ liệu mới ở nền...', 'primary');

  loadCustomerData({ background: false, cacheFirst: true, monthOverride: month });
  setTimeout(() => {
    triggerBackgroundFetchFromSheet({
      month,
      cacheKey: buildSheetCacheKey(month),
      fallbackRows: readSheetCache(month) && Array.isArray(readSheetCache(month).data) ? readSheetCache(month).data : (window.appState.allData || [])
    }).catch(() => {});
  }, 150);
}

function filterData() {
  window.appState.currentPage = 1;
  const filters = getCurrentRegularFilterState();
  const selectedMonth = filters.selectedMonth;
  const selectedCheck = filters.selectedCheck || '';
  const selectedGpsType = filters.selectedGpsType || 'all';
  const selectedThanhToan = filters.selectedThanhToan || '';
  const selectedTrangThaiHd = filters.selectedTrangThaiHd || '';
  const selectedTimNha = filters.selectedTimNha || '';
  const selectedDoKho = filters.selectedDoKho || '';
  const keyword = filters.keyword.trim().toLowerCase();
  const thuongTru = filters.thuongTru.trim().toLowerCase();
  const gpsFilterType = filters.gpsFilterType || 'all';
  const gpsFilterCheckState = filters.gpsFilterCheckState || '';
  const isRegularFilterActive = !window.appState.gpsFilterEnabled && !window.appState.apFilterEnabled;
  const isGpsFilterActive = window.appState.gpsFilterEnabled && !window.appState.apFilterEnabled;

  let filtered = window.appState.allData.filter((customer) => {
    const rowMonthValue = normalizeMonthKey(customer.month || customer['month'] || customer['Kỳ'] || customer['Ky'] || '');
    const monthMatch = !selectedMonth || rowMonthValue === selectedMonth || normalizeMonthKey(customer['Kỳ'] || customer['Ky'] || '') === selectedMonth;
    if (!monthMatch) return false;

    if (window.appState.dailyPlanFilterEnabled && !isPlannedTodayPending(customer)) return false;

    if (isRegularFilterActive) {
      if (selectedCheck) {
        const checkValue = String(customer.Check_GPS || customer['Check_GPS'] || '').trim();
        const checkAoValue = String(customer.Check_Ao || customer['Check_Ao'] || '').trim();
        const isChecked = checkValue !== '' || checkAoValue !== '';
        const isGpsChecked = checkValue.toLowerCase().indexOf('gps') !== -1;
        const isAoChecked = checkAoValue.toLowerCase().indexOf('áo') !== -1 || checkAoValue.toLowerCase().indexOf('ao') !== -1;

        if (selectedCheck === 'ChuaCheck' && isChecked) return false;
        if (selectedCheck === 'DaCheck' && !isChecked) return false;
        if (selectedCheck === 'DaCheckGps' && !isGpsChecked) return false;
        if (selectedCheck === 'DaCheckAo' && !isAoChecked) return false;
      }

      if (selectedGpsType && selectedGpsType !== 'all') {
        const gpsValue = String(customer[selectedGpsType] || customer[selectedGpsType.toLowerCase()] || '').trim();
        if (!gpsValue) return false;
      }

      if (selectedThanhToan) {
        const amount = Number(customer.So_tien_thanh_toan || customer['So_tien_thanh_toan'] || 0);
        if (selectedThanhToan === 'chua_thanh_toan' && amount >= 500000) return false;
        if (selectedThanhToan === 'da_thanh_toan_tren_500k' && amount < 500000) return false;
      }

      if (selectedTrangThaiHd && String(customer.Trang_thai_hd || customer['Trang_thai_hd'] || '').trim() !== selectedTrangThaiHd) return false;
      if (selectedTimNha && String(customer.Trang_thai_tim_nha || customer['Trang_thai_tim_nha'] || '').trim() !== selectedTimNha) return false;
      if (selectedDoKho && String(customer.Muc_do_kho || customer['Muc_do_kho'] || '').trim() !== selectedDoKho) return false;

      if (thuongTru) {
        const haystack = [customer.WARD_HO_KHAU, customer.WARD_TAM_TRU, customer['WARD_HO_KHAU'], customer['WARD_TAM_TRU']].join(' ').toLowerCase();
        if (haystack.indexOf(thuongTru) === -1) return false;
      }
    }

    if (isGpsFilterActive) {
      const checkValue = String(customer.Check_GPS || customer['Check_GPS'] || '').trim();
      const checkAoValue = String(customer.Check_Ao || customer['Check_Ao'] || '').trim();
      const isChecked = checkValue !== '' || checkAoValue !== '';
      const isGpsChecked = checkValue.toLowerCase().indexOf('gps') !== -1;
      const isAoChecked = checkAoValue.toLowerCase().indexOf('áo') !== -1 || checkAoValue.toLowerCase().indexOf('ao') !== -1;

      if (gpsFilterCheckState === 'ChuaCheck' && isChecked) return false;
      if (gpsFilterCheckState === 'DaCheckGps' && !isGpsChecked) return false;
      if (gpsFilterCheckState === 'DaCheckAo' && !isAoChecked) return false;
      if (gpsFilterCheckState === 'DaCheck' && !isChecked) return false;

      if (gpsFilterType && gpsFilterType !== 'all') {
        const gpsValue = String(customer[gpsFilterType] || customer[gpsFilterType.toLowerCase()] || '').trim();
        if (!gpsValue) return false;
      }

      if (!hasAnyValidCustomerGps(customer)) return false;
    }

    if (keyword) {
      const haystack = [
        customer.Ten_khach_hang,
        customer.so_hd,
        customer['Ten_khach_hang'],
        customer['so_hd'],
        customer.sdt,
        customer['sdt'],
        customer.SHOPNAME,
        customer['SHOPNAME']
      ].join(' ').toLowerCase();
      if (haystack.indexOf(keyword) === -1) return false;
    }

    return true;
  });

  if (window.appState.apFilterEnabled) {
    const apEntries = applyApFilter(filtered);
    renderApGroupCards(apEntries);
    updateStats(filtered);
    updateFilterCount();
    return;
  }

  if ((window.appState.gpsFilterEnabled || window.appState.apFilterEnabled) && window.appState.currentLocation) {
    filtered = [...filtered].sort((a, b) => {
      const distA = getCustomerDistanceKm(a);
      const distB = getCustomerDistanceKm(b);
      if (distA == null && distB == null) return 0;
      if (distA == null) return 1;
      if (distB == null) return -1;
      return distA - distB;
    });
  }

  window.appState.filteredData = filtered;
  renderCards(filtered);
  updateStats(filtered);
  updateFilterCount();
}

function hasOpenCustomerCardForBackgroundSync() {
  const expandedDetails = document.querySelectorAll('.customer-card .collapse:not(.d-none)');
  return expandedDetails.length > 0;
}

function updateStats(data) {
  const selectedMonth = normalizeMonthKey(window.appState.selectedMonth || '');
  const sourceData = Array.isArray(window.appState.allData) ? window.appState.allData.filter((customer) => {
    const rowMonth = normalizeMonthKey(customer.month || customer['month'] || customer['Kỳ'] || customer['Ky'] || '');
    return !selectedMonth || rowMonth === selectedMonth;
  }) : [];

  const total = sourceData.length;
  const unchecked = sourceData.filter((customer) => {
    const gps = String(customer.Check_GPS || customer['Check_GPS'] || '').trim().toLowerCase();
    const ao = String(customer.Check_Ao || customer['Check_Ao'] || '').trim().toLowerCase();
    return gps === '' && ao === '';
  }).length;

  const todayCheck = sourceData.filter((customer) => hasCheckedToday(customer)).length;

  const totalCustEl = document.getElementById('statTotalCust');
  const uncheckedEl = document.getElementById('statUnchecked');
  const todayCheckEl = document.getElementById('statTodayCheck');
  const totalCheckEl = document.getElementById('statTotalCheck');
  const monthNameEl = document.getElementById('statMonthName');

  if (totalCustEl) totalCustEl.textContent = String(total);
  if (uncheckedEl) uncheckedEl.textContent = String(unchecked);
  if (todayCheckEl) todayCheckEl.textContent = String(todayCheck);
  if (totalCheckEl) totalCheckEl.textContent = String(total - unchecked);
  if (monthNameEl) monthNameEl.textContent = formatMonthLabel(window.appState.selectedMonth || '');
}

function getCustomerRowKey(customer) {
  const value = customer && (customer.rowIndex ?? customer['rowIndex']);
  const rowIndex = Number(value ?? 0);
  return Number.isFinite(rowIndex) && rowIndex > 0 ? rowIndex : 0;
}

function findCustomerByRowIndex(rowIndex) {
  const targetRow = Number(rowIndex);
  const lists = [];
  if (Array.isArray(window.appState.filteredData)) lists.push(window.appState.filteredData);
  if (Array.isArray(window.appState.allData)) lists.push(window.appState.allData);

  for (const list of lists) {
    const match = list.find((customer) => getCustomerRowKey(customer) === targetRow);
    if (match) return match;
  }
  return null;
}

function updateCustomerState(rowIndex, patch) {
  const targetRow = Number(rowIndex);
  if (!targetRow) return false;

  let changed = false;
  const applyPatch = (list) => {
    if (!Array.isArray(list)) return false;
    const item = list.find((customer) => getCustomerRowKey(customer) === targetRow);
    if (!item) return false;
    Object.entries(patch).forEach(([key, value]) => {
      item[key] = value;
    });
    changed = true;
    return true;
  };

  applyPatch(window.appState.filteredData);
  applyPatch(window.appState.allData);
  return changed;
}

function getCurrentMonthTabName() {
  const raw = window.appState.selectedMonth || document.getElementById('filterMonth')?.value || document.getElementById('gpsFilterMonth')?.value || '';
  return normalizeMonthKey(raw) || 'data';
}

function refreshSingleCustomerCard(rowIndex) {
  const targetRow = Number(rowIndex);
  const list = Array.isArray(window.appState.filteredData) && window.appState.filteredData.length ? window.appState.filteredData : window.appState.allData;
  const customer = list && list.find((item) => getCustomerRowKey(item) === targetRow);
  if (!customer) return false;

  const card = document.querySelector(`.customer-card[data-customer-row="${targetRow}"]`);
  if (!card) return false;

  const index = list.findIndex((item) => getCustomerRowKey(item) === targetRow);
  card.outerHTML = buildCustomerCardHtml(customer, index >= 0 ? index : 0);
  return true;
}

function getStatusBadgeClass(value, type) {
  const safeValue = String(value || '').trim();
  if (!safeValue || safeValue === 'Chưa tìm' || safeValue === 'Chưa biết') return '';

  const lookup = {
    timNha: {
      'Đã tới Ấp': 'bg-warning-subtle text-warning-emphasis border border-warning-subtle',
      'Bỏ địa phương': 'bg-danger-subtle text-danger-emphasis border border-danger-subtle',
      'Có người biết': 'bg-info-subtle text-info-emphasis border border-info-subtle',
      'Gặp người thân': 'bg-primary-subtle text-primary-emphasis border border-primary-subtle',
      'Gặp khách hàng': 'bg-success-subtle text-success-emphasis border border-success-subtle'
    },
    hd: {
      'Ăn Giựt': 'bg-danger-subtle text-danger-emphasis border border-danger-subtle',
      'Mất khả năng TT': 'bg-danger-subtle text-danger-emphasis border border-danger-subtle',
      'Đang kẹt tiền': 'bg-warning-subtle text-warning-emphasis border border-warning-subtle',
      'Có khả năng': 'bg-success-subtle text-success-emphasis border border-success-subtle',
      'Hẹn Thanh Toán': 'bg-info-subtle text-info-emphasis border border-info-subtle',
      'Nhiều khả năng(Hẹn)': 'bg-primary-subtle text-primary-emphasis border border-primary-subtle'
    },
    doKho: {
      'Dễ làm việc': 'bg-success-subtle text-success-emphasis border border-success-subtle',
      'Trung lập': 'bg-warning-subtle text-warning-emphasis border border-warning-subtle',
      'Khó Tính': 'bg-orange-subtle text-warning-emphasis border border-warning-subtle',
      'Không hợp tác': 'bg-danger-subtle text-danger-emphasis border border-danger-subtle',
      'Bạo lực': 'bg-dark-subtle text-dark-emphasis border border-dark-subtle'
    }
  };

  return (lookup[type] || {})[safeValue] || 'bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle';
}

function getCustomerCategoryBadges(customer) {
  const badges = [];
  const timNha = String(customer.Trang_thai_tim_nha || customer['Trang_thai_tim_nha'] || '').trim();
  const hd = String(customer.Trang_thai_hd || customer['Trang_thai_hd'] || '').trim();
  const doKho = String(customer.Muc_do_kho || customer['Muc_do_kho'] || '').trim();

  if (timNha && timNha !== 'Chưa tìm') badges.push({ label: timNha, className: getStatusBadgeClass(timNha, 'timNha') });
  if (hd && hd !== 'Chưa biết') badges.push({ label: hd, className: getStatusBadgeClass(hd, 'hd') });
  if (doKho && doKho !== 'Chưa biết') badges.push({ label: doKho, className: getStatusBadgeClass(doKho, 'doKho') });

  return badges;
}

function parseSheetDateValue(value) {
  const str = String(value || '').trim();
  if (!str) return null;

  const dayMonthYear = str.match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/);
  if (dayMonthYear) {
    const [, day, month, year] = dayMonthYear;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const yearMonthDay = str.match(/^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/);
  if (yearMonthDay) {
    const [, year, month, day] = yearMonthDay;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hasCheckedToday(customer) {
  const checkTime = String(customer.Check_Time || customer['Check_Time'] || '').trim();
  if (!checkTime) return false;

  const date = parseSheetDateValue(checkTime);
  if (!date) return false;

  const today = new Date();
  return date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
}

function formatDateForDisplay(dateValue) {
  const raw = String(dateValue || '').trim();
  if (!raw) return '';
  const date = parseSheetDateValue(raw);
  if (!date) return raw;
  return date.toLocaleDateString('vi-VN');
}

function isPlannedToday(customer) {
  const planValue = formatDateForDisplay(customer.kehoachngay || customer['kehoachngay'] || customer.KehoachNgay || customer['KehoachNgay'] || '');
  if (!planValue) return false;
  const today = new Date().toLocaleDateString('vi-VN');
  return planValue === today;
}

function isPlannedTodayPending(customer) {
  return isPlannedToday(customer) && !hasCheckedToday(customer);
}

function formatOverdueDays(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return '0D';

  const years = Math.floor(raw / 365);
  const months = Math.floor((raw % 365) / 30);
  const days = raw - (years * 365 + months * 30);

  const parts = [];
  if (years > 0) parts.push(`${years}Y-`);
  if (months > 0 || parts.length > 0) parts.push(`${months}M-`);
  parts.push(`${days}D`);

  return parts.join('');
}

function buildCustomerCardHtml(customer, index) {
  const name = customer.Ten_khach_hang || customer['Ten_khach_hang'] || 'Khách hàng';
  const soHd = customer.so_hd || customer['so_hd'] || '---';
  const phone = customer.sdt || customer['sdt'] || '';
  const rowIndex = getCustomerRowKey(customer) || Number(customer.rowIndex || customer['rowIndex'] || index + 2);
  const paidStr = customer.So_tien_thanh_toan ? Number(customer.So_tien_thanh_toan).toLocaleString() + ' VNĐ' : 'Chưa';
  const overdueRaw = Number(customer.Ngay_qua_han ?? customer['Ngay_qua_han'] ?? 0) || 0;
  const ngayQuaHan = overdueRaw > 0 ? `${overdueRaw} (${formatOverdueDays(overdueRaw)})` : '---';
  const checkCount = Number(customer.So_lan_check ?? customer['So_lan_check'] ?? 0) || 0;
  const checkedToday = hasCheckedToday(customer);
  const planTodayPending = isPlannedTodayPending(customer);
  const checkGps = String(customer.Check_GPS || customer['Check_GPS'] || '').trim();
  const checkAo = String(customer.Check_Ao || customer['Check_Ao'] || '').trim();
  const currentMonth = window.appState.selectedMonth || document.getElementById('filterMonth')?.value || document.getElementById('gpsFilterMonth')?.value || 'Tất cả';
  const nearestApFilterValue = window.appState.apFilterEnabled ? (document.getElementById('gpsFilterAp')?.value || 'all') : 'all';
  const summaryAddress = [customer.WARD_HO_KHAU || customer['WARD_HO_KHAU'], customer.WARD_TAM_TRU || customer['WARD_TAM_TRU']].filter(Boolean).join(' • ');
  const shopName = customer.SHOPNAME || customer['SHOPNAME'] || '';
  const categoryBadges = getCustomerCategoryBadges(customer);
  const planBadgeHtml = planTodayPending ? '<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle">📅 Kế hoạch hôm nay</span>' : (customer.kehoachngay || customer['kehoachngay'] || customer.KehoachNgay || customer['KehoachNgay'] ? `<span class="badge bg-info-subtle text-info-emphasis border border-info-subtle">📅 ${escapeHtml(formatDateForDisplay(customer.kehoachngay || customer['kehoachngay'] || customer.KehoachNgay || customer['KehoachNgay']))}</span>` : '');
  const noteText = String(customer.Ghi_chu || customer['Ghi_chu'] || '').trim();
  const noteBadgeHtml = noteText ? `<div class="mt-1"><span class="badge bg-success-subtle text-success border border-success-subtle">📝 ${escapeHtml(noteText.length > 38 ? noteText.slice(0, 38) + '...' : noteText)}</span></div>` : '';
  let rowClass = '';
  if (checkAo.toLowerCase().indexOf('ao') !== -1 || checkAo.toLowerCase().indexOf('áo') !== -1) rowClass = 'row-check-ao';
  if (checkGps.toLowerCase().indexOf('gps') !== -1) rowClass = 'row-check-gps';
  if (checkedToday) rowClass += ' row-checked-today';
  if (nearestApFilterValue !== 'all' && window.appState.currentLocation) {
    rowClass += ' border border-warning';
  }
  const collapseId = 'collapseCard_' + rowIndex;
  const infoCollapseId = 'infoCard_' + rowIndex;
  const checkCollapseId = 'checkCard_' + rowIndex;
  const categoryCollapseId = 'categoryCard_' + rowIndex;
  const paymentCollapseId = 'paymentCard_' + rowIndex;

  return `
    <div class="customer-card ${rowClass}" data-customer-row="${rowIndex}">
      <div class="d-flex justify-content-between align-items-start gap-2">
        <div class="flex-grow-1 min-w-0">
          <div class="fw-bold text-primary mb-0">${escapeHtml(name)}</div>
          ${categoryBadges.length ? `<div class="customer-badges">${categoryBadges.map((badge) => `<span class="customer-badge ${badge.className}">${escapeHtml(badge.label)}</span>`).join('')}</div>` : ''}
          ${noteBadgeHtml}
          <div class="customer-address text-truncate mt-1">${escapeHtml(summaryAddress)}</div>
          <div class="d-flex align-items-center gap-2 flex-wrap mt-1">
            <span class="badge bg-success text-white border border-success">${checkedToday ? '✓ check hôm nay' : ''}</span>
            <span class="badge bg-info-subtle text-info-emphasis border border-info-subtle">📊 ${checkCount} lần</span>
            ${overdueRaw > 0 ? `<span class="badge bg-danger-subtle text-danger border border-danger-subtle">⏰ ${escapeHtml(ngayQuaHan)}</span>` : '<span class="badge bg-light text-secondary border border-secondary-subtle">⏰ ---</span>'}
            ${planBadgeHtml ? `<span class="d-block mt-1">${planBadgeHtml}</span>` : ''}
          </div>
        </div>
        <div class="card-action-group">
          <button class="btn btn-sm btn-outline-primary card-action-btn" type="button" title="Check" onclick="toggleCardSection('${checkCollapseId}', ['${checkCollapseId}', '${infoCollapseId}', '${categoryCollapseId}', '${paymentCollapseId}'])"><span class="btn-label">✔ Check</span><span class="d-inline d-sm-none">✔</span></button>
          <button class="btn btn-sm btn-outline-success card-action-btn" type="button" title="Thanh toán" onclick="toggleCardSection('${paymentCollapseId}', ['${checkCollapseId}', '${infoCollapseId}', '${categoryCollapseId}', '${paymentCollapseId}'])"><span class="btn-label">💰 Thanh toán</span><span class="d-inline d-sm-none">💰</span></button>
          <button class="btn btn-sm btn-outline-warning card-action-btn" type="button" title="Phân loại" onclick="toggleCardSection('${categoryCollapseId}', ['${checkCollapseId}', '${infoCollapseId}', '${categoryCollapseId}', '${paymentCollapseId}'])"><span class="btn-label">🏷 Phân loại</span><span class="d-inline d-sm-none">🏷</span></button>
          <button class="btn btn-sm btn-outline-secondary card-action-btn" type="button" title="Thông tin" onclick="toggleCardSection('${infoCollapseId}', ['${checkCollapseId}', '${infoCollapseId}', '${categoryCollapseId}', '${paymentCollapseId}'])"><span class="btn-label">ℹ Thông tin</span><span class="d-inline d-sm-none">ℹ</span></button>
        </div>
      </div>

      <div class="collapse mt-3 pt-2 border-top d-none" id="${infoCollapseId}">
          <div class="d-flex justify-content-between align-items-center mb-2 gap-2">
            <div class="d-flex align-items-center gap-1">
              <small class="text-muted">HĐ:</small>
              <code class="small">${escapeHtml(soHd)}</code>
              <button class="btn btn-sm btn-link p-0 ms-1" onclick="navigator.clipboard.writeText('${String(soHd).replace(/'/g, "\\'")}').then(() => showToast('Đã copy: ${String(soHd).replace(/'/g, "\\'")}', 'success'))">📋</button>
            </div>
            ${phone ? `<div class="text-secondary small">📞 <b>${escapeHtml(phone)}</b></div>` : ''}
          </div>

          <div class="sub-section text-secondary small">
            ${[
              summaryAddress ? `<div class="mt-1"><b>📍 Địa chỉ:</b> ${escapeHtml(summaryAddress)}</div>` : '',
              shopName ? `<div class="mt-1"><b>🏪 Shop:</b> ${escapeHtml(shopName)}</div>` : '',
              customer.WARD_HO_KHAU_AP_NEW ? `<div class="mt-1"><b class="text-dark">📍 Ấp New:</b> <span id="text_new_${rowIndex}">${escapeHtml(customer.WARD_HO_KHAU_AP_NEW)}</span><button class="btn btn-sm p-0 ms-1 text-primary" onclick="toggleEdit(${rowIndex}, 'apnew')">✏️</button><div id="box_apnew_${rowIndex}" class="d-none mt-1"><div class="input-group input-group-sm"><input type="text" id="input_apnew_${rowIndex}" class="form-control" value="${escapeHtml(customer.WARD_HO_KHAU_AP_NEW || '')}"><button class="btn btn-success" onclick="saveInlineEdit(${rowIndex}, 'WARD_HO_KHAU_AP_NEW', 'input_apnew_${rowIndex}', 'apnew')">Lưu</button><button class="btn btn-secondary" onclick="toggleEdit(${rowIndex}, 'apnew')">Hủy</button></div></div></div>` : '',
              customer.WARD_HO_KHAU_AP_OLD ? `<div class="mt-1"><b class="text-dark">📍 Ấp Old:</b> <span id="text_old_${rowIndex}">${escapeHtml(customer.WARD_HO_KHAU_AP_OLD)}</span><button class="btn btn-sm p-0 ms-1 text-primary" onclick="toggleEdit(${rowIndex}, 'apold')">✏️</button><div id="box_apold_${rowIndex}" class="d-none mt-1"><div class="input-group input-group-sm"><input type="text" id="input_apold_${rowIndex}" class="form-control" value="${escapeHtml(customer.WARD_HO_KHAU_AP_OLD || '')}"><button class="btn btn-success" onclick="saveInlineEdit(${rowIndex}, 'WARD_HO_KHAU_AP_OLD', 'input_apold_${rowIndex}', 'apold')">Lưu</button><button class="btn btn-secondary" onclick="toggleEdit(${rowIndex}, 'apold')">Hủy</button></div></div></div>` : ''
            ].filter(Boolean).join('') || '<div class="text-muted">Không có thông tin thêm</div>'}
          </div>

        </div>
      </div>

      <div class="collapse mt-2 d-none" id="${categoryCollapseId}">
        <div class="p-2 bg-light rounded border">
          <div class="mb-2">
            <div class="small fw-bold text-success mb-1">📝 Ghi chú:</div>
            <div class="d-flex align-items-center gap-2">
              <span id="text_note_${rowIndex}" class="flex-grow-1 text-secondary small">${escapeHtml(customer.Ghi_chu || '---')}</span>
              <button class="btn btn-sm p-0 ms-1 text-primary" onclick="toggleEdit(${rowIndex}, 'note')">✏️</button>
            </div>
            <div id="box_note_${rowIndex}" class="d-none mt-2">
              <div class="input-group input-group-sm">
                <input type="text" id="input_note_${rowIndex}" class="form-control" value="${escapeHtml(customer.Ghi_chu || '')}">
                <button class="btn btn-success" onclick="saveInlineEdit(${rowIndex}, 'Ghi_chu', 'input_note_${rowIndex}', 'note')">Lưu</button>
                <button class="btn btn-secondary" onclick="toggleEdit(${rowIndex}, 'note')">Hủy</button>
              </div>
            </div>
          </div>
          <div class="row g-2">
            <div class="col-12">
              <label class="small text-muted fw-bold mb-1">Tìm nhà:</label>
              <select class="form-select form-select-sm" onchange="updateFieldAndNotify(${rowIndex}, 'Trang_thai_tim_nha', this.value)">
                <option value="Chưa tìm" ${customer.Trang_thai_tim_nha === 'Chưa tìm' ? 'selected' : ''}>⚪ Chưa tìm</option>
                <option value="Đã tới Ấp" ${customer.Trang_thai_tim_nha === 'Đã tới Ấp' ? 'selected' : ''}>🟢 Đã tới Ấp</option>
                <option value="Bỏ địa phương" ${customer.Trang_thai_tim_nha === 'Bỏ địa phương' ? 'selected' : ''}>🟡 Bỏ địa phương</option>
                <option value="Có người biết" ${customer.Trang_thai_tim_nha === 'Có người biết' ? 'selected' : ''}>🔵 Có người biết</option>
                <option value="Gặp người thân" ${customer.Trang_thai_tim_nha === 'Gặp người thân' ? 'selected' : ''}>🟣 Gặp người thân</option>
                <option value="Gặp khách hàng" ${customer.Trang_thai_tim_nha === 'Gặp khách hàng' ? 'selected' : ''}>🟠 Gặp khách hàng</option>
              </select>
            </div>
            <div class="col-12">
              <label class="small text-muted fw-bold mb-1">Khả năng thanh toán:</label>
              <select class="form-select form-select-sm" onchange="updateFieldAndNotify(${rowIndex}, 'Trang_thai_hd', this.value)">
                <option value="Chưa biết" ${customer.Trang_thai_hd === 'Chưa biết' ? 'selected' : ''}>⚪ Chưa biết</option>
                <option value="Ăn Giựt" ${customer.Trang_thai_hd === 'Ăn Giựt' ? 'selected' : ''}>⛔ Ăn Giựt</option>
                <option value="Mất khả năng TT" ${customer.Trang_thai_hd === 'Mất khả năng TT' ? 'selected' : ''}>🔴 Mất khả năng TT</option>
                <option value="Đang kẹt tiền" ${customer.Trang_thai_hd === 'Đang kẹt tiền' ? 'selected' : ''}>🟠 Đang kẹt tiền</option>
                <option value="Có khả năng" ${customer.Trang_thai_hd === 'Có khả năng' ? 'selected' : ''}>🟢 Có khả năng</option>
                <option value="Hẹn Thanh Toán" ${customer.Trang_thai_hd === 'Hẹn Thanh Toán' ? 'selected' : ''}>🔵 Hẹn Thanh Toán</option>
                <option value="Nhiều khả năng(Hẹn)" ${customer.Trang_thai_hd === 'Nhiều khả năng(Hẹn)' ? 'selected' : ''}>🟣 Nhiều khả năng(Hẹn)</option>
              </select>
            </div>
            <div class="col-12">
              <label class="small text-muted fw-bold mb-1">Độ khó:</label>
              <select class="form-select form-select-sm" onchange="updateFieldAndNotify(${rowIndex}, 'Muc_do_kho', this.value)">
                <option value="Chưa biết" ${customer.Muc_do_kho === 'Chưa biết' ? 'selected' : ''}>⚪ Chưa biết</option>
                <option value="Dễ làm việc" ${customer.Muc_do_kho === 'Dễ làm việc' ? 'selected' : ''}>🟢 Dễ làm việc</option>
                <option value="Trung lập" ${customer.Muc_do_kho === 'Trung lập' ? 'selected' : ''}>🟡 Trung lập</option>
                <option value="Khó Tính" ${customer.Muc_do_kho === 'Khó Tính' ? 'selected' : ''}>🟠 Khó Tính</option>
                <option value="Không hợp tác" ${customer.Muc_do_kho === 'Không hợp tác' ? 'selected' : ''}>🔴 Không hợp tác</option>
                <option value="Bạo lực" ${customer.Muc_do_kho === 'Bạo lực' ? 'selected' : ''}>⛔ Bạo lực</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div class="collapse mt-2 d-none" id="${paymentCollapseId}">
        <div class="p-2 bg-light rounded border">
          <div class="small fw-bold text-danger mb-2">👤 Liên hệ:</div>
          <div class="d-flex align-items-center gap-2 mb-2">
            <span id="text_contact_${rowIndex}" class="flex-grow-1 text-secondary small">${escapeHtml(customer.Nguoi_lien_he || '---')}</span>
            <button class="btn btn-sm p-0 ms-1 text-primary" onclick="toggleEdit(${rowIndex}, 'contact')">✏️</button>
          </div>
          <div id="box_contact_${rowIndex}" class="d-none mt-1">
            <div class="input-group input-group-sm">
              <input type="text" id="input_contact_${rowIndex}" class="form-control" value="${escapeHtml(customer.Nguoi_lien_he || '')}">
              <button class="btn btn-danger" onclick="saveInlineEdit(${rowIndex}, 'Nguoi_lien_he', 'input_contact_${rowIndex}', 'contact')">Lưu</button>
              <button class="btn btn-secondary" onclick="toggleEdit(${rowIndex}, 'contact')">Hủy</button>
            </div>
          </div>

          <div class="small fw-bold text-success mt-3 mb-2">💰 Thanh toán:</div>
          <div class="d-flex align-items-center gap-2 mb-2">
            <span id="text_paid_${rowIndex}" class="flex-grow-1 text-secondary small">${customer.So_tien_thanh_toan ? Number(customer.So_tien_thanh_toan).toLocaleString() + ' VNĐ' : 'Chưa thanh toán'}</span>
            <button class="btn btn-sm p-0 ms-1 text-primary" onclick="toggleEdit(${rowIndex}, 'paid')">✏️</button>
          </div>
          <div id="box_paid_${rowIndex}" class="d-none mt-1">
            <div class="input-group input-group-sm">
              <input type="number" id="input_paid_${rowIndex}" class="form-control" value="${escapeHtml(customer.So_tien_thanh_toan || '')}">
              <button class="btn btn-success" onclick="savePaidAmountInline(${rowIndex})">Lưu</button>
              <button class="btn btn-secondary" onclick="toggleEdit(${rowIndex}, 'paid')">Hủy</button>
            </div>
          </div>
        </div>
      </div>

      <div class="collapse mt-2 d-none" id="${checkCollapseId}">
        <div class="p-2 bg-light rounded border">
          <div class="mb-3">
            <div class="small fw-bold mb-1 text-primary">⚡ Xác thực thực địa:</div>
            <div class="d-flex gap-2">
              <button class="btn btn-sm text-white flex-fill" style="background-color: #6f42c1;" onclick="doQuickCheckAo(${rowIndex}, '${String(soHd).replace(/'/g, "\\'")}')">🛡️ Check Áo</button>
              <button class="btn btn-sm btn-success flex-fill" onclick="doQuickCheckGps(${rowIndex}, '${String(soHd).replace(/'/g, "\\'")}')">📍 Check GPS</button>
            </div>
          </div>

          <div class="mb-3">
            <button class="btn btn-sm btn-outline-info w-100" type="button" onclick="setCustomerPlanToday(${rowIndex})">📅 Kế hoạch ngày</button>
          </div>

          <div id="gpsToggle_${rowIndex}" class="mb-2">
            <button class="btn btn-sm btn-outline-primary w-100" type="button" onclick="toggleCheckGpsDetails(${rowIndex})">Mở GPS & ưu tiên</button>
          </div>

          <div class="sub-section d-none" id="gpsDetails_${rowIndex}">
            <div class="d-flex justify-content-between align-items-center mb-1">
              <div class="small fw-bold text-primary">🌐 Tọa độ GPS & ưu tiên:</div>
              <button class="btn btn-xs btn-outline-secondary px-2 py-0" type="button" onclick="toggleCheckGpsDetails(${rowIndex})">Ẩn</button>
            </div>
            ${renderGpsInputsMobile(customer)}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderPaginationControls(totalItems) {
  const pageControls = document.getElementById('customerPageControls');
  if (!pageControls) return;

  const totalPages = Math.max(1, Math.ceil(totalItems / (Number(window.appState.pageSize) || 20)));
  const currentPage = Math.min(Math.max(1, Number(window.appState.currentPage || 1)), totalPages);
  window.appState.currentPage = currentPage;

  const pages = [];
  for (let i = 1; i <= totalPages; i += 1) {
    pages.push(`
      <button type="button" class="btn btn-sm ${i === currentPage ? 'btn-primary' : 'btn-outline-primary'}" onclick="window.appState.currentPage=${i}; renderCards(window.appState.filteredData || []);">
        ${i}
      </button>
    `);
  }

  if (totalItems <= (Number(window.appState.pageSize) || 20)) {
    pageControls.innerHTML = '';
    return;
  }

  const startItem = (currentPage - 1) * (Number(window.appState.pageSize) || 20) + 1;
  const endItem = Math.min(currentPage * (Number(window.appState.pageSize) || 20), totalItems);

  pageControls.innerHTML = `
    <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap bg-white rounded shadow-sm p-2 mt-2">
      <div class="small text-muted">Hiển thị ${startItem}-${endItem} / ${totalItems} khách</div>
      <div class="btn-group btn-group-sm" role="group">
        <button type="button" class="btn btn-outline-secondary" ${currentPage === 1 ? 'disabled' : ''} onclick="window.appState.currentPage = Math.max(1, window.appState.currentPage - 1); renderCards(window.appState.filteredData || []);">‹</button>
        ${pages.join('')}
        <button type="button" class="btn btn-outline-secondary" ${currentPage === totalPages ? 'disabled' : ''} onclick="window.appState.currentPage = Math.min(${totalPages}, window.appState.currentPage + 1); renderCards(window.appState.filteredData || []);">›</button>
      </div>
    </div>
  `;
}

function renderCards(data) {
  const container = document.getElementById('customerCardContainer');
  if (!container) return;

  if (!data || !data.length) {
    container.innerHTML = '<div class="text-center py-5 text-muted bg-white rounded shadow-sm">Không có dữ liệu phù hợp với bộ lọc.</div>';
    renderPaginationControls(0);
    return;
  }

  const pageSize = Number(window.appState.pageSize) || 20;
  const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
  const currentPage = Math.min(Math.max(1, Number(window.appState.currentPage || 1)), totalPages);
  window.appState.currentPage = currentPage;

  const startIndex = (currentPage - 1) * pageSize;
  const pageData = data.slice(startIndex, startIndex + pageSize);

  container.innerHTML = pageData.map((customer, index) => buildCustomerCardHtml(customer, startIndex + index)).join('');
  renderPaginationControls(data.length);
}

function toggleCheckGpsDetails(rowIndex, forceOpen) {
  const box = document.getElementById(`gpsDetails_${rowIndex}`);
  const toggleButton = document.getElementById(`gpsToggle_${rowIndex}`);
  if (!box) return;

  const isHidden = box.classList.contains('d-none');
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : isHidden;

  box.classList.toggle('d-none', !shouldOpen);

  if (toggleButton) {
    toggleButton.classList.toggle('d-none', shouldOpen);
  }
}

function renderGpsInputsMobile(item) {
  let html = '';
  const gpsFields = ['GPS_Chinh', 'GPS_1', 'GPS_2', 'GPS_3', 'GPS_4', 'GPS_5', 'GPS_AP_NEW', 'GPS_AP_OLD'];
  const labels = ['Chính', 'GPS 1', 'GPS 2', 'GPS 3', 'GPS 4', 'GPS 5', 'GPS New', 'GPS Old'];
  const priorityKeys = ['GPS_Chinh', 'GPS_1', 'GPS_2', 'GPS_3', 'GPS_4', 'GPS_5'];
  const activePriorityKey = item.Gps_Uu_Tien || '';

  gpsFields.forEach((key, idx) => {
    const val = item[key] || '';
    const hasData = String(val).includes(',');
    const mapUrl = hasData ? 'https://www.google.com/maps?q=' + encodeURIComponent(String(val)) : '#';
    const mapBtnClass = hasData ? 'btn-danger' : 'btn-outline-secondary disabled';
    const rowIndex = item.rowIndex || item['rowIndex'] || 0;

    let priorityCheckboxHtml = '';
    if (priorityKeys.includes(key)) {
      const isChecked = activePriorityKey === key;
      const isDisabled = activePriorityKey !== '' && !isChecked;
      priorityCheckboxHtml = `
        <div class="input-group-text bg-white" title="Chọn làm vị trí ưu tiên">
          <input class="form-check-input mt-0" type="checkbox" ${isChecked ? 'checked' : ''} ${isDisabled ? 'disabled' : ''} onchange="togglePriorityGps(${rowIndex}, '${key}', this.checked)">
          <span class="ms-1 small text-danger fw-bold" style="font-size:10px">Ưu tiên</span>
        </div>
      `;
    }

    html += `
      <div class="input-group input-group-sm mb-1">
        <span class="input-group-text" style="font-size:11px; width:75px;">${labels[idx]}</span>
        <input type="text" id="input_${rowIndex}_${key}" class="form-control" value="${escapeHtml(val)}" placeholder="Lat, Lng">
        ${priorityCheckboxHtml}
        <button class="btn btn-outline-secondary" type="button" onclick="captureGpsForCustomer(${rowIndex}, 'input_${rowIndex}_${key}')">📍</button>
        <button class="btn btn-primary" type="button" onclick="saveGpsField(${rowIndex}, '${key}')">Lưu</button>
        <a href="${mapUrl}" target="_blank" class="btn ${mapBtnClass}">🗺️</a>
      </div>
    `;
  });

  return html;
}

async function quickUpdateCustomer(rowIndex, fieldName, value) {
  const currentMonth = getCurrentMonthTabName();
  showToast('Đang lưu thông tin...', 'primary');
  try {
    await window.F88_API.post('updateCustomer', {
      rowIndex: Number(rowIndex),
      monthTab: currentMonth,
      data: { [fieldName]: value }
    });
    updateCustomerState(rowIndex, { [fieldName]: value });
    return true;
  } catch (error) {
    console.error(error);
    showToast('Không thể cập nhật khách hàng.', 'danger');
    return false;
  }
}

async function setCustomerPlanToday(rowIndex) {
  const currentMonth = getCurrentMonthTabName();
  if (!currentMonth || currentMonth === 'data') {
    showToast('Vui lòng chọn kỳ tháng trước khi gán kế hoạch ngày.', 'danger');
    return;
  }

  const currentCustomer = findCustomerByRowIndex(rowIndex) || {};
  const todayValue = new Date().toLocaleDateString('vi-VN');
  const todayPlanValue = String(currentCustomer.kehoachngay || currentCustomer['kehoachngay'] || currentCustomer.KehoachNgay || currentCustomer['KehoachNgay'] || '').trim();
  const isAlreadyToday = todayPlanValue === todayValue;
  const nextValue = isAlreadyToday ? '' : todayValue;

  const saved = await quickUpdateCustomer(rowIndex, 'kehoachngay', nextValue);
  if (saved) {
    closeAllCardSectionsForRow(rowIndex);
    updateCustomerState(rowIndex, { kehoachngay: nextValue });
    if (window.appState.dailyPlanFilterEnabled) filterData();
    showToast(isAlreadyToday ? 'Đã xóa kế hoạch ngày hôm nay.' : 'Đã gán kế hoạch ngày hôm nay.', 'success');
    refreshSingleCustomerCard(rowIndex);
  }
}

async function doQuickCheckAo(rowIndex, soHd) {
  const currentMonth = getCurrentMonthTabName();
  if (!currentMonth || currentMonth === 'data') {
    showToast('Vui lòng chọn kỳ tháng trước khi check.', 'danger');
    return;
  }

  showToast('Đang check áo...', 'primary');

  try {
    await window.F88_API.post('updateCustomer', {
      rowIndex: Number(rowIndex),
      monthTab: currentMonth,
      data: {
        Check_Ao: 'Đã Check Áo',
        Check_Time: new Date().toLocaleDateString('vi-VN')
      }
    });
    const currentCustomer = findCustomerByRowIndex(rowIndex);
    const nextCount = (Number(currentCustomer?.So_lan_check ?? currentCustomer?.['So_lan_check'] ?? 0) || 0) + 1;
    updateCustomerState(rowIndex, {
      Check_Ao: 'Đã Check Áo',
      Check_Time: new Date().toLocaleDateString('vi-VN'),
      So_lan_check: nextCount
    });
    await window.F88_API.post('recordCheckMonth', {
      soHd,
      rowIndex,
      monthTab: currentMonth,
      type: 'AO'
    });
    showToast('Đã check áo thành công', 'success');
    refreshSingleCustomerCard(rowIndex);
  } catch (error) {
    console.error(error);
    showToast('Check áo thất bại.', 'danger');
  }
}

async function doQuickCheckGps(rowIndex, soHd) {
  const currentMonth = getCurrentMonthTabName();
  if (!currentMonth || currentMonth === 'data') {
    showToast('Vui lòng chọn kỳ tháng trước khi check.', 'danger');
    return;
  }

  if (!navigator.geolocation) {
    showToast('Trình duyệt không hỗ trợ định vị.', 'danger');
    return;
  }

  showToast('Đang lấy vị trí GPS...', 'primary');

  navigator.geolocation.getCurrentPosition(async (position) => {
    const gps = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
    showToast('Đang lưu check GPS...', 'primary');
    try {
      await window.F88_API.post('updateCustomer', {
        rowIndex: Number(rowIndex),
        monthTab: currentMonth,
        data: {
          Check_GPS: 'Đã Check GPS',
          Check_Time: new Date().toLocaleDateString('vi-VN'),
          GPS_Chinh: gps
        }
      });
      const currentCustomer = findCustomerByRowIndex(rowIndex);
      const nextCount = (Number(currentCustomer?.So_lan_check ?? currentCustomer?.['So_lan_check'] ?? 0) || 0) + 1;
      updateCustomerState(rowIndex, {
        Check_GPS: 'Đã Check GPS',
        Check_Time: new Date().toLocaleDateString('vi-VN'),
        GPS_Chinh: gps,
        So_lan_check: nextCount
      });
      await window.F88_API.post('recordCheckMonth', {
        soHd,
        rowIndex,
        monthTab: currentMonth,
        type: 'GPS'
      });
      showToast('Đã check GPS thành công', 'success');
      refreshSingleCustomerCard(rowIndex);
    } catch (error) {
      console.error(error);
      showToast('Check GPS thất bại.', 'danger');
    }
  }, () => {
    showToast('Không lấy được vị trí hiện tại.', 'danger');
  }, { enableHighAccuracy: true });
}

function captureGpsForCustomer(rowIndex, inputId) {
  if (!navigator.geolocation) {
    showToast('Trình duyệt không hỗ trợ định vị.', 'danger');
    return;
  }

  navigator.geolocation.getCurrentPosition((position) => {
    const value = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
    const input = document.getElementById(inputId);
    if (input) input.value = value;
    showToast('Đã lấy GPS hiện tại');
  }, () => {
    showToast('Không lấy được vị trí hiện tại.', 'danger');
  }, { enableHighAccuracy: true });
}

async function saveQuickGps(rowIndex, inputId, fieldName) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const value = input.value.trim();
  const saved = await quickUpdateCustomer(rowIndex, fieldName, value);
  if (saved) {
    showToast('Đã lưu GPS thành công');
    refreshSingleCustomerCard(rowIndex);
    if (window.appState.filteredData && window.appState.filteredData.length) {
      filterData();
    }
  }
}

function closeNestedGpsDetailsForRow(rowIndex) {
  const details = document.getElementById(`gpsDetails_${rowIndex}`);
  const toggleButton = document.getElementById(`gpsToggle_${rowIndex}`);
  if (details) details.classList.add('d-none');
  if (toggleButton) toggleButton.classList.remove('d-none');
}

function closeAllInlineEditBoxesForRow(rowIndex) {
  const rowTypes = ['apnew', 'apold', 'note', 'contact', 'paid'];
  rowTypes.forEach((type) => {
    const box = document.getElementById(`box_${type}_${rowIndex}`);
    if (box) box.classList.add('d-none');
  });
}

function closeAllCardSectionsForRow(rowIndex) {
  const sectionIds = [
    `checkCard_${rowIndex}`,
    `paymentCard_${rowIndex}`,
    `categoryCard_${rowIndex}`,
    `infoCard_${rowIndex}`,
    `gpsDetails_${rowIndex}`
  ];

  sectionIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add('d-none');
  });

  const toggleButton = document.getElementById(`gpsToggle_${rowIndex}`);
  if (toggleButton) toggleButton.classList.remove('d-none');

  closeAllInlineEditBoxesForRow(rowIndex);
}

function toggleCardSection(activeId, allIds) {
  const ids = Array.isArray(allIds) ? allIds : [allIds];
  const rowMatch = activeId.match(/_(\d+)$/);
  const rowIndex = rowMatch ? rowMatch[1] : null;

  if (rowIndex) {
    closeNestedGpsDetailsForRow(rowIndex);
    closeAllInlineEditBoxesForRow(rowIndex);
  }

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const instance = window.bootstrap && window.bootstrap.Collapse ? window.bootstrap.Collapse.getOrCreateInstance(el) : null;
    const isOpen = !el.classList.contains('d-none') || el.classList.contains('show');

    if (id === activeId) {
      if (isOpen) {
        el.classList.add('d-none');
        if (instance) instance.hide();
      } else {
        el.classList.remove('d-none');
        if (instance) instance.show();
      }
      return;
    }

    el.classList.add('d-none');
    if (instance) instance.hide();
  });
}

function toggleEdit(rowIndex, type) {
  const box = document.getElementById(`box_${type}_${rowIndex}`);
  if (!box) return;

  const rowTypes = ['apnew', 'apold', 'note', 'contact', 'paid'];
  rowTypes.forEach((itemType) => {
    if (itemType === type) return;
    const otherBox = document.getElementById(`box_${itemType}_${rowIndex}`);
    if (otherBox) otherBox.classList.add('d-none');
  });

  box.classList.toggle('d-none');
}

async function saveInlineEdit(rowIndex, fieldName, inputId, type) {
  const inputEl = document.getElementById(inputId);
  if (!inputEl) return;
  const value = inputEl.value.trim();
  toggleEdit(rowIndex, type);
  const saved = await quickUpdateCustomer(rowIndex, fieldName, value);
  if (saved) {
    showToast('Đã lưu thông tin khách hàng thành công!', 'success');
    refreshSingleCustomerCard(rowIndex);
  }
}

async function savePaidAmountInline(rowIndex) {
  const inputEl = document.getElementById(`input_paid_${rowIndex}`);
  if (!inputEl) return;
  const value = inputEl.value.trim();
  toggleEdit(rowIndex, 'paid');
  const saved = await quickUpdateCustomer(rowIndex, 'So_tien_thanh_toan', value);
  if (saved) {
    showToast('Đã lưu số tiền thanh toán!', 'success');
    refreshSingleCustomerCard(rowIndex);
  }
}

async function updateFieldAndNotify(rowIndex, fieldName, value) {
  const saved = await quickUpdateCustomer(rowIndex, fieldName, value);
  if (saved) {
    showToast('Đã cập nhật thông tin khách hàng!', 'success');
    refreshSingleCustomerCard(rowIndex);
  }
}

async function saveGpsField(rowIndex, key) {
  const input = document.getElementById(`input_${rowIndex}_${key}`);
  if (!input) return;
  const saved = await quickUpdateCustomer(rowIndex, key, input.value.trim());
  if (saved) {
    showToast(`Đã lưu ${key}!`, 'success');
    refreshSingleCustomerCard(rowIndex);
  }
}

async function togglePriorityGps(rowIndex, key, isChecked) {
  const saved = await quickUpdateCustomer(rowIndex, 'Gps_Uu_Tien', isChecked ? key : '');
  if (saved) {
    showToast(isChecked ? `Đã đặt ${key} làm vị trí ưu tiên!` : 'Đã hủy ưu tiên.', 'success');
    refreshSingleCustomerCard(rowIndex);
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setApFilterType(type) {
  window.appState.apFilterType = type === 'ap_new' ? 'ap_new' : type === 'mixed' ? 'mixed' : 'ap_old';
  window.appState.expandedApGroupKey = null;
  const oldBtn = document.getElementById('apFilterTypeOldBtn');
  const newBtn = document.getElementById('apFilterTypeNewBtn');
  const mixedBtn = document.getElementById('apFilterTypeMixedBtn');

  if (oldBtn) {
    oldBtn.classList.toggle('btn-primary', window.appState.apFilterType === 'ap_old');
    oldBtn.classList.toggle('btn-outline-primary', window.appState.apFilterType !== 'ap_old');
  }
  if (newBtn) {
    newBtn.classList.toggle('btn-primary', window.appState.apFilterType === 'ap_new');
    newBtn.classList.toggle('btn-outline-primary', window.appState.apFilterType !== 'ap_new');
  }
  if (mixedBtn) {
    mixedBtn.classList.toggle('btn-primary', window.appState.apFilterType === 'mixed');
    mixedBtn.classList.toggle('btn-outline-primary', window.appState.apFilterType !== 'mixed');
  }

  filterData();
}

function setApGroupMode(mode) {
  window.appState.apFilterGroupMode = 'xa';
  window.appState.expandedApGroupKey = null;
  window.appState.expandedApChildKey = null;
  filterData();
}

function toggleGpsFilterMode() {
  const box = document.getElementById('gpsFilterControlBox');
  const button = document.getElementById('gpsFilterToggleBtn');
  const nextState = !window.appState.gpsFilterEnabled;

  window.appState.gpsFilterEnabled = nextState;
  window.appState.expandedApGroupKey = null;
  if (nextState) {
    window.appState.apFilterEnabled = false;
    const apToggleBtn = document.getElementById('apFilterToggleBtn');
    if (apToggleBtn) {
      apToggleBtn.textContent = '🏡 Ấp: TẮT';
      apToggleBtn.classList.remove('btn-warning');
      apToggleBtn.classList.add('btn-outline-warning');
    }
    const apSwitch = document.getElementById('apFilterModeSwitch');
    if (apSwitch) apSwitch.classList.add('d-none');
  }

  box.classList.toggle('d-none', !nextState);
  button.textContent = nextState ? '📍 Lọc GPS: BẬT' : '📍 Lọc GPS: TẮT';
  button.classList.toggle('btn-danger', nextState);
  button.classList.toggle('btn-outline-danger', !nextState);

  if (nextState) {
    locateCurrentPosition().then(() => filterData());
  } else {
    filterData();
  }

  showToast(nextState ? 'Bộ lọc GPS đã bật, lọc thường tắt tạm.' : 'Bộ lọc GPS đã tắt, áp dụng lại lọc thường.', 'info');
}

function toggleApFilterMode() {
  const button = document.getElementById('apFilterToggleBtn');
  if (!button) return;

  const nextState = !window.appState.apFilterEnabled;
  window.appState.apFilterEnabled = nextState;
  window.appState.expandedApGroupKey = null;
  window.appState.expandedApChildKey = null;
  const switchBox = document.getElementById('apFilterModeSwitch');
  if (switchBox) switchBox.classList.toggle('d-none', !nextState);

  button.textContent = nextState ? '🏡 Ấp: BẬT' : '🏡 Ấp: TẮT';
  button.classList.toggle('btn-primary', nextState);
  button.classList.toggle('btn-outline-primary', !nextState);

  if (nextState) {
    window.appState.gpsFilterEnabled = false;
    const gpsBox = document.getElementById('gpsFilterControlBox');
    const gpsButton = document.getElementById('gpsFilterToggleBtn');
    if (gpsBox) gpsBox.classList.add('d-none');
    if (gpsButton) {
      gpsButton.textContent = '📍 Lọc GPS: TẮT';
      gpsButton.classList.remove('btn-danger');
      gpsButton.classList.add('btn-outline-danger');
    }
  }

  filterData();
  showToast(nextState ? 'Đã bật lọc ấp. Lọc thường sẽ tắt.' : 'Đã tắt lọc ấp, quay lại lọc thường.', 'info');
}

function toggleDailyPlanFilterMode() {
  const button = document.getElementById('dailyPlanFilterToggleBtn');
  if (!button) return;

  const nextState = !window.appState.dailyPlanFilterEnabled;
  window.appState.dailyPlanFilterEnabled = nextState;

  button.textContent = nextState ? '📅 Kế hoạch ngày: BẬT' : '📅 Kế hoạch ngày: TẮT';
  button.classList.toggle('btn-info', nextState);
  button.classList.toggle('btn-outline-info', !nextState);

  filterData();
  showToast(nextState ? 'Đã bật lọc kế hoạch ngày hôm nay.' : 'Đã tắt lọc kế hoạch ngày.', 'info');
}

function showToast(message, type) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast align-items-center text-white bg-' + type + ' border-0 show';
  toast.setAttribute('role', 'alert');
  toast.innerHTML = '<div class="d-flex"><div class="toast-body">' + escapeHtml(message) + '</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>';
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 2600);
}

window.toggleGpsFilterMode = toggleGpsFilterMode;
window.toggleApFilterMode = toggleApFilterMode;
window.toggleDailyPlanFilterMode = toggleDailyPlanFilterMode;
window.setCustomerPlanToday = setCustomerPlanToday;
window.setApFilterType = setApFilterType;
window.setApGroupMode = setApGroupMode;
window.syncMonthAndReload = syncMonthAndReload;
window.filterData = filterData;
window.updateFilterCount = updateFilterCount;
window.resetFilters = function () {
  const monthSelect = document.getElementById('statMonthSelect');
  if (monthSelect) monthSelect.value = '';
  document.getElementById('filterCheck').value = '';
  document.getElementById('filterGpsType').value = 'all';
  document.getElementById('filterThanhToan').value = '';
  document.getElementById('filterTrangThaiHd').value = '';
  document.getElementById('filterTimNha').value = '';
  document.getElementById('filterDoKho').value = '';
  document.getElementById('filterThuongTru').value = '';
  document.getElementById('searchKeyword').value = '';
  document.getElementById('gpsFilterCheckState').value = 'ChuaCheck';
  document.getElementById('gpsFilterType').value = 'all';
  window.appState.selectedMonth = '';
  window.appState.gpsFilterEnabled = false;
  window.appState.apFilterEnabled = false;
  window.appState.dailyPlanFilterEnabled = false;
  window.appState.apFilterGroupMode = 'xa';
  window.appState.expandedApGroupKey = null;
  window.appState.expandedApChildKey = null;
  const gpsBox = document.getElementById('gpsFilterControlBox');
  const gpsButton = document.getElementById('gpsFilterToggleBtn');
  const apButton = document.getElementById('apFilterToggleBtn');
  const dailyButton = document.getElementById('dailyPlanFilterToggleBtn');
  const apSwitch = document.getElementById('apFilterModeSwitch');
  if (gpsBox) gpsBox.classList.add('d-none');
  if (gpsButton) { gpsButton.textContent = '📍 Lọc GPS: TẮT'; gpsButton.classList.remove('btn-danger'); gpsButton.classList.add('btn-outline-danger'); }
  if (apButton) { apButton.textContent = '🏡 Ấp: TẮT'; apButton.classList.remove('btn-primary'); apButton.classList.add('btn-outline-primary'); }
  if (dailyButton) { dailyButton.textContent = '📅 Kế hoạch ngày: TẮT'; dailyButton.classList.remove('btn-info'); dailyButton.classList.add('btn-outline-info'); }
  if (apSwitch) apSwitch.classList.add('d-none');
  filterData();
  showToast('Đã đặt lại bộ lọc.', 'secondary');
};
