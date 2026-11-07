window.mapState = {
  map: null,
  markersLayer: null,
  allData: [],
  filteredData: [],
  months: [],
  selectedMonth: '',
  myLocation: null,
  markerRegistry: {},
  sidebarVisible: true,
  focusedCustomerRow: null,
  mapVisibleCount: 20
};

function toggleMapSidebar(forceVisible) {
  const wrapper = document.getElementById('mainMapWrapper');
  const button = document.getElementById('toggleMapListBtn');
  if (!wrapper) return;

  const nextVisible = typeof forceVisible === 'boolean' ? forceVisible : !window.mapState.sidebarVisible;
  window.mapState.sidebarVisible = nextVisible;
  wrapper.classList.toggle('has-sidebar-hidden', !nextVisible);

  if (button) {
    button.textContent = nextVisible ? '☰ Ẩn danh sách' : '☰ Hiện danh sách';
  }

  if (window.mapState.map) {
    setTimeout(() => {
      window.mapState.map.invalidateSize();
    }, 220);
  }
}

const MAP_DATA_CACHE_TTL_MS = 5 * 60 * 1000;

function buildMapCacheKey(monthKey) {
  return 'f88_map_cache_' + (monthKey || 'all');
}

function readMonthsCache() {
  try {
    const raw = localStorage.getItem('f88_map_months_cache');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed && parsed.months) ? parsed.months : [];
  } catch (error) {
    console.warn('Map months cache read failed:', error);
    return [];
  }
}

function writeMonthsCache(months) {
  try {
    localStorage.setItem('f88_map_months_cache', JSON.stringify({ updatedAt: Date.now(), months: Array.isArray(months) ? months : [] }));
  } catch (error) {
    console.warn('Map months cache write failed:', error);
  }
}

function readMapCache(monthKey) {
  try {
    const raw = localStorage.getItem(buildMapCacheKey(monthKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.data) || !parsed.updatedAt) return null;
    return { data: parsed.data, updatedAt: Number(parsed.updatedAt) || 0 };
  } catch (error) {
    console.warn('Map cache read failed:', error);
    return null;
  }
}

function writeMapCache(monthKey, rows) {
  try {
    localStorage.setItem(buildMapCacheKey(monthKey), JSON.stringify({
      updatedAt: Date.now(),
      data: Array.isArray(rows) ? rows : []
    }));
  } catch (error) {
    console.warn('Map cache write failed:', error);
  }
}

function readLatestMapCacheForSelection() {
  try {
    const selectedMonth = normalizeMonthKey(window.mapState && window.mapState.selectedMonth ? window.mapState.selectedMonth : '');
    const candidates = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('f88_map_cache_')) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.data)) continue;
        const monthKey = key.replace('f88_map_cache_', '');
        const matchesSelection = !selectedMonth || monthKey === selectedMonth || monthKey === 'all';
        if (matchesSelection) {
          candidates.push({ monthKey, rows: parsed.data, updatedAt: Number(parsed.updatedAt) || 0 });
        }
      } catch (error) {
        console.warn('Read cached map entry failed:', error);
      }
    }

    if (!candidates.length) return [];
    candidates.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return candidates[0].rows;
  } catch (error) {
    console.warn('Latest cached map rows read failed:', error);
    return [];
  }
}

function normalizeProvinceNameForCode(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (!normalized) return '';

  return normalized
    .replace(/^(tinh|thanh pho|tp|thanh-pho|city|province)\s+/i, '')
    .replace(/^(xa|xã|phuong|phường|huyen|huyện|quan|quận|ap|ấp|thon|thôn)\s+/gi, '')
    .trim();
}

function buildProvinceCodeFromAddress(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const segments = raw
    .split(/[;,]/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const lastSegment = segments.length ? segments[segments.length - 1] : raw;
  const cleaned = normalizeProvinceNameForCode(lastSegment);
  if (!cleaned) return '';

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (!words.length) return '';

  const firstLetters = words.slice(0, 2).map((word) => word[0] || '').join('').toUpperCase();
  const lastLetter = words[words.length - 1].slice(-1).toUpperCase();
  const code = `${firstLetters}${lastLetter}`;
  return code || '';
}

function getCustomerProvinceCode(customer) {
  const sourceCandidates = [
    customer.WARD_HO_KHAU_AP_OLD || customer['WARD_HO_KHAU_AP_OLD'],
    customer.WARD_HO_KHAU_AP_NEW || customer['WARD_HO_KHAU_AP_NEW'],
    customer.WARD_HO_KHAU || customer['WARD_HO_KHAU'],
    customer.WARD_TAM_TRU || customer['WARD_TAM_TRU'],
    customer.TINHTP || customer['TINHTP'] || customer.tinhtp || customer['tinhtp'],
    customer.tinh_ho_khau || customer['tinh_ho_khau']
  ];

  for (const candidate of sourceCandidates) {
    const code = buildProvinceCodeFromAddress(candidate);
    if (code) return code;
  }

  return '';
}

function getShopProvinceCode(shopName) {
  const text = String(shopName ?? '').trim();
  if (!text) return '';

  const match = text.match(/[A-Za-z]{3}/);
  return match ? match[0].toUpperCase() : '';
}

function getCustomerTamTruStatus(customer) {
  const hoKhau = String(customer.WARD_HO_KHAU || customer['WARD_HO_KHAU'] || '').trim();
  const tamTru = String(customer.WARD_TAM_TRU || customer['WARD_TAM_TRU'] || '').trim();

  if (!tamTru || !hoKhau) return null;
  if (tamTru.toLowerCase() === hoKhau.toLowerCase()) return null;

  return {
    label: 'Tạm Trú',
    kind: 'tam_tru'
  };
}

function getCustomerProvinceLocationStatus(customer) {
  const provinceCode = getCustomerProvinceCode(customer);
  const shopCode = getShopProvinceCode(customer.SHOPNAME || customer['SHOPNAME']);

  if (!provinceCode || !shopCode) return null;
  const isInProvince = provinceCode === shopCode;
  return {
    provinceCode,
    shopCode,
    label: isInProvince ? 'Shop trong tỉnh' : 'Shop ngoại tỉnh',
    isInProvince
  };
}

function scheduleMapBackgroundRefresh() {
  if (window.__f88_mapBackgroundRefreshTimer) return;
  window.__f88_mapBackgroundRefreshTimer = setInterval(() => {
    const selectedMonth = normalizeMonthKey(window.mapState.selectedMonth || '');
    loadMapDataAndRender({ background: true, monthOverride: selectedMonth }).catch(() => {});
  }, 180000);
}

function hydrateMapMonthSelectFromCache() {
  const monthSelect = document.getElementById('mapMonth');
  if (!monthSelect) return '';

  const cachedMonths = readMonthsCache();
  const validMonths = cachedMonths.filter((m) => String(m).trim() && String(m).toLowerCase() !== 'ap_new' && String(m).toLowerCase() !== 'ap_old');
  if (!validMonths.length) return '';

  monthSelect.innerHTML = '<option value="">-- Tất cả tháng --</option>';
  validMonths.forEach((month) => {
    const monthKey = normalizeMonthKey(month);
    const opt = document.createElement('option');
    opt.value = monthKey;
    opt.textContent = 'Kỳ ' + (monthKey ? formatMonthLabel(monthKey) : month);
    monthSelect.appendChild(opt);
  });

  const currentDate = new Date();
  const currentMonthKey = normalizeMonthKey(String(currentDate.getMonth() + 1).padStart(2, '0') + String(currentDate.getFullYear()));
  const defaultMonth = validMonths
    .map((month) => normalizeMonthKey(month))
    .find((monthKey) => monthKey === currentMonthKey) || normalizeMonthKey(validMonths[0] || '');

  monthSelect.value = defaultMonth;
  return defaultMonth;
}

function setMapBackgroundSyncState(isRunning) {
  const icon = document.getElementById('mapSyncMiniDot');
  const root = document.getElementById('mapBackgroundSyncIcon');
  if (!icon || !root) return;

  icon.classList.toggle('sync-running', !!isRunning);
  root.title = isRunning ? 'Đang đồng bộ dữ liệu ngầm...' : 'Dữ liệu đã sẵn sàng';
  root.classList.toggle('bg-light', !isRunning);
  root.classList.toggle('text-secondary', !isRunning);
  root.classList.toggle('bg-warning-subtle', !!isRunning);
  root.classList.toggle('text-warning-emphasis', !!isRunning);
  icon.textContent = isRunning ? '⟳' : '✓';
}

function setMapSyncButtonState(state, message = '') {
  const btn = document.getElementById('mapManualSyncBtn');
  const icon = document.getElementById('mapSyncActionIcon');
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

function updateMapSyncStatusUi(connected, message) {
  const button = document.getElementById('mapManualSyncBtn');
  if (!button) return;

  if (connected) {
    setMapSyncButtonState('success', message || 'Đồng bộ thành công.');
  } else {
    setMapSyncButtonState('error', message || 'Đồng bộ thất bại.');
  }
}

window.updateMapSyncStatusUi = updateMapSyncStatusUi;

async function syncMapSheetAndCacheWithoutUiReload() {
  const selectedMonth = normalizeMonthKey(window.mapState.selectedMonth || '');
  const cacheKey = buildMapCacheKey(selectedMonth);
  const fallbackRows = readMapCache(selectedMonth) && Array.isArray(readMapCache(selectedMonth).data) ? readMapCache(selectedMonth).data : [];

  try {
    const monthsResult = await window.F88_API.fetch('getMonths');
    const months = Array.isArray(monthsResult.months) ? monthsResult.months : [];
    const validMonths = months.filter((m) => String(m).trim() && String(m).toLowerCase() !== 'ap_new' && String(m).toLowerCase() !== 'ap_old');
    if (validMonths.length) writeMonthsCache(validMonths);

    const result = await window.F88_API.fetch('getData', { month: selectedMonth });
    const allDataResult = await window.F88_API.fetch('getData', { month: '' });
    const monthRows = Array.isArray(result.data) ? result.data : [];
    const dataRows = Array.isArray(allDataResult.data) ? allDataResult.data : [];
    const mergedRows = mergeCustomerGpsFromData(monthRows, dataRows);
    if (mergedRows.length) writeMapCache(cacheKey, mergedRows);

    // Sync chỉ cập nhật cache local, không render lại map đang hiển thị.
    // UI sẽ reload lại chỉ khi người dùng nhấn Reload / load local.
    updateMapSyncStatusUi(true, 'Đồng bộ bản đồ thành công.');
    return mergedRows;
  } catch (error) {
    console.error(error);
    updateMapSyncStatusUi(false, 'Đồng bộ bản đồ thất bại.');
    if (fallbackRows.length) {
      // Giữ nguyên dữ liệu đang hiển thị nếu sync thất bại.
      window.mapState.allData = fallbackRows;
      window.mapState.filteredData = fallbackRows;
    }
    throw error;
  }
}

async function triggerMapManualSync() {
  setMapSyncButtonState('running', 'Đang đồng bộ dữ liệu...');
  try {
    showToast('Đang đồng bộ dữ liệu bản đồ...', 'primary');
    await syncMapSheetAndCacheWithoutUiReload();
    updateMapSyncStatusUi(true, 'Đồng bộ bản đồ thành công.');
    showToast('Đồng bộ dữ liệu bản đồ thành công.', 'success');
  } catch (error) {
    console.error(error);
    updateMapSyncStatusUi(false, 'Đồng bộ bản đồ thất bại.');
    showToast('Đồng bộ bản đồ thất bại, vẫn dùng cache cũ.', 'warning');
  }
}

window.triggerMapManualSync = triggerMapManualSync;

function reloadMapData() {
  const month = normalizeMonthKey(window.mapState.selectedMonth || '');
  setMapSyncButtonState('running', 'Đang tải dữ liệu nền...');
  showToast('Đang tải dữ liệu mới ở nền...', 'primary');

  loadMapDataAndRender({ background: false, cacheFirst: true, monthOverride: month });
  setTimeout(() => {
    refreshMapFromSheet({
      selectedMonth: month,
      cacheKey: buildMapCacheKey(month),
      fallbackRows: readMapCache(month) && Array.isArray(readMapCache(month).data) ? readMapCache(month).data : (window.mapState.allData || [])
    }).catch(() => {});
  }, 150);
}

window.reloadMapData = reloadMapData;

function setCustomerFocus(rowIndex, shouldFocus = true) {
  const targetRow = Number(rowIndex);
  if (!Number.isFinite(targetRow) || targetRow <= 0) {
    window.mapState.focusedCustomerRow = null;
    renderMapMarkers(window.mapState.filteredData || []);
    showToast('Đã hiện lại tất cả khách hàng trên bản đồ.', 'info');
    return;
  }

  window.mapState.focusedCustomerRow = shouldFocus ? targetRow : null;
  const renderList = Array.isArray(window.mapState.filteredData) ? window.mapState.filteredData : [];
  const visibleData = window.mapState.focusedCustomerRow === null
    ? renderList
    : renderList.filter((customer) => Number(customer.rowIndex || customer['rowIndex'] || 0) === targetRow);

  renderMapMarkers(visibleData);
  showToast(shouldFocus ? 'Đã chỉ hiển thị khách hàng này trên bản đồ.' : 'Đã hiện lại tất cả khách hàng trên bản đồ.', 'info');
}

window.setCustomerFocus = setCustomerFocus;

function normalizeMonthKey(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const compact = text.replace(/tháng/gi, '').replace(/\s+/g, '');
  const matchSlash = compact.match(/(\d{1,2})[\/\-.](\d{4})/);
  if (matchSlash) return matchSlash[1].padStart(2, '0') + matchSlash[2];
  const matchReverse = compact.match(/(\d{4})[\/\-.](\d{1,2})/);
  if (matchReverse) return matchReverse[2].padStart(2, '0') + matchReverse[1];
  const compactMatch = compact.match(/(\d{1,2})(\d{4})/);
  if (compactMatch) return compactMatch[1].padStart(2, '0') + compactMatch[2];
  return compact;
}

function formatMonthLabel(value) {
  const normalized = normalizeMonthKey(value);
  if (!normalized) return 'Tất cả';
  if (/^\d{6}$/.test(normalized)) return normalized.slice(0, 2) + '/' + normalized.slice(2);
  return normalized;
}

window.addEventListener('DOMContentLoaded', function () {
  initMap();
  toggleMapSidebar(true);

  const cachedDefaultMonth = hydrateMapMonthSelectFromCache();
  const cachedRows = readLatestMapCacheForSelection();
  if (Array.isArray(cachedRows) && cachedRows.length) {
    window.mapState.allData = cachedRows;
    window.mapState.filteredData = cachedRows;
    window.mapState.selectedMonth = normalizeMonthKey(cachedDefaultMonth || window.mapState.selectedMonth || '');
    filterAndRenderMap();
  }

  loadMapDataAndRender({ background: false, cacheFirst: true, monthOverride: cachedDefaultMonth || '' });
  scheduleMapBackgroundRefresh();
  locateMyPosition();
});

function initMap() {
  const map = L.map('map').setView([10.03, 105.77], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  window.mapState.map = map;
  window.mapState.markersLayer = L.layerGroup().addTo(map);
}

function locateMyPosition() {
  if (!navigator.geolocation) {
    showToast('Trình duyệt không hỗ trợ định vị.', 'danger');
    return;
  }
  navigator.geolocation.getCurrentPosition(function (position) {
    window.mapState.myLocation = {
      lat: position.coords.latitude,
      lng: position.coords.longitude
    };

    if (window.mapState.map) {
      const marker = L.marker([window.mapState.myLocation.lat, window.mapState.myLocation.lng], {
        icon: L.divIcon({
          className: 'my-location-marker',
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        })
      }).addTo(window.mapState.map);
      marker.bindPopup('<b>📍 Vị trí của bạn</b>');
      marker.openPopup();
      window.mapState.map.setView([window.mapState.myLocation.lat, window.mapState.myLocation.lng], 14);
    }
    showToast('Đã định vị vị trí của bạn.', 'success');
  }, function () {
    showToast('Không lấy được vị trí hiện tại.', 'danger');
  }, { enableHighAccuracy: true });
}

function getObjectValueByAnyKey(obj, keys) {
  if (!obj) return '';

  for (const key of keys) {
    if (key in obj && obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim() !== '') {
      return String(obj[key]).trim();
    }
  }

  const lowerMap = {};
  Object.keys(obj).forEach((key) => {
    lowerMap[String(key).toLowerCase()] = obj[key];
  });

  for (const key of keys) {
    const normalizedKey = String(key).toLowerCase();
    const value = lowerMap[normalizedKey];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }

  return '';
}

function getGpsFieldsInPriorityOrder() {
  return [
    'GPS_Chinh', 'GPS_1', 'GPS_2', 'GPS_3', 'GPS_4', 'GPS_5',
    'GPS_AP_NEW', 'GPS_AP_OLD', 'Gps_Uu_Tien', 'gps', 'GPS'
  ];
}

function getNearestGpsEntry(customer) {
  const entries = getCustomerGpsEntries(customer);
  if (!entries.length) return null;

  return [...entries].sort((a, b) => {
    if (a.distanceKm == null && b.distanceKm == null) return 0;
    if (a.distanceKm == null) return 1;
    if (b.distanceKm == null) return -1;
    return a.distanceKm - b.distanceKm;
  })[0];
}

function getPreferredGpsValue(customer) {
  const explicitPriorityKey = getObjectValueByAnyKey(customer, ['Gps_Uu_Tien', 'gps_uu_tien', 'GPS_UU_TIEN']) || '';
  if (explicitPriorityKey) {
    const value = getObjectValueByAnyKey(customer, [
      explicitPriorityKey,
      explicitPriorityKey.toLowerCase(),
      explicitPriorityKey.replace(/_/g, ''),
      explicitPriorityKey.replace(/_/g, '').toLowerCase()
    ]);
    if (value) return value;
  }

  const nearestEntry = getNearestGpsEntry(customer);
  if (nearestEntry) return nearestEntry.raw;

  const keys = getGpsFieldsInPriorityOrder();
  for (const key of keys) {
    const value = getObjectValueByAnyKey(customer, [
      key,
      key.toLowerCase(),
      key.replace(/_/g, ''),
      key.replace(/_/g, '').toLowerCase()
    ]);
    if (value) return value;
  }

  return '';
}

function normalizeSoHd(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

function getMapCustomerByRowIndex(rowIndex) {
  const targetRow = Number(rowIndex);
  if (!Number.isFinite(targetRow)) return null;

  const rows = Array.isArray(window.mapState.allData) ? window.mapState.allData : [];
  return rows.find((customer) => Number(customer.rowIndex || customer['rowIndex'] || 0) === targetRow) || null;
}

function getMapCheckCount(rowIndex) {
  const customer = getMapCustomerByRowIndex(rowIndex) || {};
  return Number(customer.So_lan_check ?? customer['So_lan_check'] ?? 0) || 0;
}

function mergeCustomerGpsFromData(monthRows, dataRows) {
  const dataMap = {};

  (dataRows || []).forEach((row) => {
    const soHd = normalizeSoHd(row.so_hd || row.SO_HD || row['so_hd'] || row['SO_HD']);
    if (soHd) {
      dataMap[soHd] = row;
    }
  });

  return (monthRows || []).map((row) => {
    const soHd = normalizeSoHd(row.so_hd || row.SO_HD || row['so_hd'] || row['SO_HD']);
    const source = soHd ? dataMap[soHd] : null;
    if (!source) return row;

    const gpsFromData = getPreferredGpsValue(source);
    const existingGps = getPreferredGpsValue(row);
    if (!existingGps && gpsFromData) {
      row.GPS_Chinh = gpsFromData;
      row['GPS_Chinh'] = gpsFromData;
      row.gps = gpsFromData;
      row.GPS = gpsFromData;
    }

    return row;
  });
}

function parseGpsCoord(rawValue) {
  if (!rawValue) return null;

  const value = String(rawValue)
    .trim()
    .replace(/^gps\s*[:=]\s*/i, '')
    .replace(/lat\s*[:=]/i, '')
    .replace(/lng\s*[:=]/i, '')
    .replace(/[()]/g, '')
    .replace(/[|]/g, ',')
    .replace(/;/g, ',');

  if (!value) return null;

  const match = value.match(/-?\d+(?:\.\d+)?\s*[,;\s]\s*-?\d+(?:\.\d+)?/);
  if (!match) return null;

  const parts = match[0].split(/[\s,;]+/).filter(Boolean);
  if (parts.length < 2) return null;

  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
    return { lat, lng };
  }

  return null;
}

async function loadMapDataAndRender(options = {}) {
  const { background = false, monthOverride = null, cacheFirst = false } = options;
  const btn = document.getElementById('loadMapBtn');
  if (btn && !background) {
    btn.innerText = '⏳ Đang tải...';
    btn.disabled = true;
  }

  const selectedMonth = normalizeMonthKey(monthOverride || (document.getElementById('mapMonth') ? document.getElementById('mapMonth').value : ''));
  const cacheKey = buildMapCacheKey(selectedMonth);
  const cached = readMapCache(selectedMonth);
  const isFreshCache = cached && Array.isArray(cached.data) && cached.data.length && Date.now() - (cached.updatedAt || 0) < MAP_DATA_CACHE_TTL_MS;

  if (isFreshCache && (cacheFirst || !background)) {
    window.mapState.allData = cached.data;
    window.mapState.filteredData = cached.data;
    window.mapState.selectedMonth = selectedMonth;
    const currentPeriodBadge = document.getElementById('currentMapPeriodBadge');
    if (currentPeriodBadge) currentPeriodBadge.textContent = 'Kỳ: ' + (selectedMonth ? formatMonthLabel(selectedMonth) : 'Tất cả');
    filterAndRenderMap();
    updateMapSyncStatusUi(true, 'Dữ liệu cache đang sẵn sàng.');

    if (btn && !background) {
      btn.innerText = '✅ Cache';
      setTimeout(() => {
        btn.innerText = '🔄 Tải Dữ Liệu';
        btn.disabled = false;
      }, 800);
    }

    if (background) {
      setMapBackgroundSyncState(true);
      setTimeout(() => {
        refreshMapFromSheet({ selectedMonth, cacheKey, fallbackRows: cached.data }).catch(() => {});
      }, 250);
      return;
    }

    return;
  }

  if (isFreshCache && background) {
    setMapBackgroundSyncState(true);
    setTimeout(() => {
      refreshMapFromSheet({ selectedMonth, cacheKey, fallbackRows: cached.data }).catch(() => {});
    }, 250);
    return;
  }

  try {
    const monthsResult = await window.F88_API.fetch('getMonths');
    const months = Array.isArray(monthsResult.months) ? monthsResult.months : [];
    const validMonths = months.filter((m) => String(m).trim() && String(m).toLowerCase() !== 'ap_new' && String(m).toLowerCase() !== 'ap_old');

    if (validMonths.length) {
      writeMonthsCache(validMonths);
    }

    const monthSelect = document.getElementById('mapMonth');
    if (monthSelect) {
      monthSelect.innerHTML = '<option value="">-- Tất cả tháng --</option>';
      validMonths.forEach((month) => {
        const monthKey = normalizeMonthKey(month);
        const opt = document.createElement('option');
        opt.value = monthKey;
        opt.textContent = 'Kỳ ' + (monthKey ? formatMonthLabel(monthKey) : month);
        monthSelect.appendChild(opt);
      });

      const currentDate = new Date();
      const currentMonthKey = normalizeMonthKey(String(currentDate.getMonth() + 1).padStart(2, '0') + String(currentDate.getFullYear()));
      const defaultMonth = validMonths
        .map((month) => normalizeMonthKey(month))
        .find((monthKey) => monthKey === currentMonthKey) || normalizeMonthKey(validMonths[0] || '');
      monthSelect.value = selectedMonth || defaultMonth;
    }

    const monthToLoad = normalizeMonthKey(monthOverride || (monthSelect ? monthSelect.value : ''));
    const result = await window.F88_API.fetch('getData', { month: monthToLoad });
    const allDataResult = await window.F88_API.fetch('getData', { month: '' });

    const monthRows = Array.isArray(result.data) ? result.data : [];
    const dataRows = Array.isArray(allDataResult.data) ? allDataResult.data : [];
    const mergedRows = mergeCustomerGpsFromData(monthRows, dataRows);
    if (mergedRows.length) {
      writeMapCache(cacheKey, mergedRows);
    }

    window.mapState.allData = mergedRows;
    window.mapState.filteredData = mergedRows;
    window.mapState.selectedMonth = monthToLoad;
    updateMapSyncStatusUi(true, 'Sheet đang kết nối bình thường.');
    const currentPeriodBadge = document.getElementById('currentMapPeriodBadge');
    if (currentPeriodBadge) currentPeriodBadge.textContent = 'Kỳ: ' + (monthToLoad ? formatMonthLabel(monthToLoad) : 'Tất cả');
    filterAndRenderMap();

    if (btn && !background) {
      btn.innerText = '✅ Xong';
      setTimeout(() => {
        btn.innerText = '🔄 Tải Dữ Liệu';
        btn.disabled = false;
      }, 1000);
    }

    if (!background) {
      showToast('Đã tải dữ liệu bản đồ thành công.', 'success');
    }
  } catch (error) {
    console.error(error);
    updateMapSyncStatusUi(false, 'Mất kết nối sheet, đang dùng cache cũ.');
    const fallbackRows = cached && Array.isArray(cached.data) ? cached.data : [];
    if (fallbackRows.length) {
      window.mapState.allData = fallbackRows;
      window.mapState.filteredData = fallbackRows;
      filterAndRenderMap();
      if (btn && !background) {
        btn.innerText = '⚠️ Dữ liệu cũ';
        setTimeout(() => {
          btn.innerText = '🔄 Tải Dữ Liệu';
          btn.disabled = false;
        }, 1200);
      }
      if (!background) showToast('Kết nối sheet lỗi, đang dùng dữ liệu cache trước đó.', 'warning');
      return;
    }

    if (btn) {
      btn.innerText = '❌ Lỗi';
      btn.disabled = false;
    }
    if (!background) showToast('Không thể tải dữ liệu bản đồ.', 'danger');
  }
}

async function refreshMapFromSheet({ selectedMonth, cacheKey, fallbackRows }) {
  try {
    const monthsResult = await window.F88_API.fetch('getMonths');
    const months = Array.isArray(monthsResult.months) ? monthsResult.months : [];
    const validMonths = months.filter((m) => String(m).trim() && String(m).toLowerCase() !== 'ap_new' && String(m).toLowerCase() !== 'ap_old');
    if (validMonths.length) writeMonthsCache(validMonths);

    const monthSelect = document.getElementById('mapMonth');
    if (monthSelect) {
      monthSelect.innerHTML = '<option value="">-- Tất cả tháng --</option>';
      validMonths.forEach((month) => {
        const monthKey = normalizeMonthKey(month);
        const opt = document.createElement('option');
        opt.value = monthKey;
        opt.textContent = 'Kỳ ' + (monthKey ? formatMonthLabel(monthKey) : month);
        monthSelect.appendChild(opt);
      });
    }

    const result = await window.F88_API.fetch('getData', { month: selectedMonth });
    const allDataResult = await window.F88_API.fetch('getData', { month: '' });
    const monthRows = Array.isArray(result.data) ? result.data : [];
    const dataRows = Array.isArray(allDataResult.data) ? allDataResult.data : [];
    const mergedRows = mergeCustomerGpsFromData(monthRows, dataRows);
    if (mergedRows.length) writeMapCache(cacheKey, mergedRows);
    window.mapState.allData = mergedRows;
    if (!hasOpenMapCustomerFocusForBackgroundSync()) {
      window.mapState.filteredData = mergedRows;
      filterAndRenderMap();
    }
    updateMapSyncStatusUi(true, 'Sheet đang kết nối bình thường.');
    setMapBackgroundSyncState(false);
  } catch (error) {
    console.warn('Background map refresh failed, keeping cache:', error);
    updateMapSyncStatusUi(false, 'Mất kết nối sheet, đang dùng cache cũ.');
    if (fallbackRows && fallbackRows.length) {
      window.mapState.allData = fallbackRows;
      window.mapState.filteredData = fallbackRows;
      filterAndRenderMap();
    }
    setMapBackgroundSyncState(false);
  }
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getCustomerGpsEntries(customer) {
  const entryDefs = [
    { key: 'GPS_Chinh', label: 'GPS chính' },
    { key: 'GPS_1', label: 'GPS 1' },
    { key: 'GPS_2', label: 'GPS 2' },
    { key: 'GPS_3', label: 'GPS 3' },
    { key: 'GPS_4', label: 'GPS 4' },
    { key: 'GPS_5', label: 'GPS 5' },
    { key: 'GPS_AP_NEW', label: 'Ấp New' },
    { key: 'GPS_AP_OLD', label: 'Ấp Old' }
  ];

  return entryDefs
    .map((item) => {
      const raw = getObjectValueByAnyKey(customer, [item.key, item.key.toLowerCase(), item.key.replace(/_/g, ''), item.key.replace(/_/g, '').toLowerCase()]);
      if (!raw) return null;
      const coords = parseGpsCoord(raw);
      if (!coords) return null;
      const distanceKm = window.mapState.myLocation
        ? haversineKm(window.mapState.myLocation.lat, window.mapState.myLocation.lng, coords.lat, coords.lng)
        : null;
      return {
        ...item,
        raw,
        coords,
        distanceKm
      };
    })
    .filter(Boolean);
}

function getCustomerDistanceKm(customer) {
  const gpsEntries = getCustomerGpsEntries(customer);
  if (!gpsEntries.length || !window.mapState.myLocation) return null;
  return Math.min(...gpsEntries.map((entry) => entry.distanceKm || Number.MAX_SAFE_INTEGER));
}

function getCustomerDistanceText(customer) {
  const distanceKm = getCustomerDistanceKm(customer);
  if (distanceKm === null) return 'Không có GPS';
  return `${distanceKm.toFixed(1)} km`;
}

function getStatusToneByValue(value, type) {
  const safeValue = String(value || '').trim();
  if (!safeValue || safeValue === 'Chưa tìm' || safeValue === 'Chưa biết') return null;

  const toneMap = {
    timNha: {
      'Đã tới Ấp': { key: 'tim-nha-1', label: 'Đã tới Ấp', color: '#f59e0b', light: '#fff7e6', text: '#b7791f' },
      'Bỏ địa phương': { key: 'tim-nha-2', label: 'Bỏ địa phương', color: '#dc3545', light: '#ffe4e6', text: '#b42318' },
      'Có người biết': { key: 'tim-nha-3', label: 'Có người biết', color: '#0ea5e9', light: '#e0f2fe', text: '#0369a1' },
      'Gặp người thân': { key: 'tim-nha-4', label: 'Gặp người thân', color: '#8b5cf6', light: '#f3e8ff', text: '#6d28d9' },
      'Gặp khách hàng': { key: 'tim-nha-5', label: 'Gặp khách hàng', color: '#10b981', light: '#d1fae5', text: '#047857' }
    },
    hd: {
      'Ăn Giựt': { key: 'hd-1', label: 'Ăn Giựt', color: '#dc3545', light: '#ffe4e6', text: '#b42318' },
      'Mất khả năng TT': { key: 'hd-2', label: 'Mất khả năng TT', color: '#dc3545', light: '#ffe4e6', text: '#b42318' },
      'Đang kẹt tiền': { key: 'hd-3', label: 'Đang kẹt tiền', color: '#f59e0b', light: '#fff7e6', text: '#b7791f' },
      'Có khả năng': { key: 'hd-4', label: 'Có khả năng', color: '#10b981', light: '#d1fae5', text: '#047857' },
      'Hẹn Thanh Toán': { key: 'hd-5', label: 'Hẹn Thanh Toán', color: '#0ea5e9', light: '#e0f2fe', text: '#0369a1' },
      'Nhiều khả năng(Hẹn)': { key: 'hd-6', label: 'Nhiều khả năng(Hẹn)', color: '#8b5cf6', light: '#f3e8ff', text: '#6d28d9' }
    },
    doKho: {
      'Dễ làm việc': { key: 'do-kho-1', label: 'Dễ làm việc', color: '#10b981', light: '#d1fae5', text: '#047857' },
      'Trung lập': { key: 'do-kho-2', label: 'Trung lập', color: '#f59e0b', light: '#fff7e6', text: '#b7791f' },
      'Khó Tính': { key: 'do-kho-3', label: 'Khó Tính', color: '#f97316', light: '#ffedd5', text: '#c2410c' },
      'Không hợp tác': { key: 'do-kho-4', label: 'Không hợp tác', color: '#dc3545', light: '#ffe4e6', text: '#b42318' },
      'Bạo lực': { key: 'do-kho-5', label: 'Bạo lực', color: '#111827', light: '#e5e7eb', text: '#111827' }
    }
  };

  return toneMap[type]?.[safeValue] || null;
}

function computeCustomerStatusTone(customer) {
  const candidates = [
    { value: getObjectValueByAnyKey(customer, ['Trang_thai_hd', 'trang_thai_hd']), type: 'hd' },
    { value: getObjectValueByAnyKey(customer, ['Muc_do_kho', 'muc_do_kho']), type: 'doKho' }
  ];

  for (const item of candidates) {
    const tone = getStatusToneByValue(item.value, item.type);
    if (tone) return tone;
  }

  return computeCustomerGpsTone(customer);
}

function computeCustomerGpsTone(customer) {
  const entries = getCustomerGpsEntries(customer);
  if (!entries.length) {
    return { key: 'gps-none', label: 'Chưa có GPS', color: '#dc3545', light: '#fff1f2', text: '#b42318' };
  }

  const distanceText = window.mapState.myLocation ? getCustomerDistanceText(customer) : null;
  const firstKey = entries[0].key;
  if (firstKey === 'GPS_Chinh') {
    return { key: 'gps-main', label: distanceText || 'GPS chính', color: '#0d6efd', light: '#edf4ff', text: '#0b4bbf' };
  }
  if (firstKey.startsWith('GPS_')) {
    return { key: 'gps-check', label: distanceText || 'GPS check', color: '#198754', light: '#ebfff4', text: '#12714a' };
  }
  return { key: 'gps-ap', label: distanceText || 'GPS ấp', color: '#f59e0b', light: '#fff7e6', text: '#b7791f' };
}

function normalizeMapCommuneName(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(tx|thi xa|thị xã)\b/gi, '')
    .replace(/\b(phuong|phường|xa|xã|thị trấn|tt|thôn|thon|xom)\b/gi, ' ')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  return normalized || 'khong-ten';
}

function buildMapCommuneLetterMap(data) {
  const communeMap = {};
  const order = [];
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  const getCommuneKey = (customer) => {
    const communeName = getObjectValueByAnyKey(customer, [
      'WARD_HO_KHAU', 'ward_ho_khau',
      'WARD_TAM_TRU', 'ward_tam_tru',
      'Xa', 'xa', 'xaphuong',
      'WARD_HO_KHAU_AP_NEW', 'ward_ho_khau_ap_new',
      'WARD_HO_KHAU_AP_OLD', 'ward_ho_khau_ap_old'
    ]) || '';

    return normalizeMapCommuneName(communeName);
  };

  (Array.isArray(data) ? data : []).forEach((customer) => {
    const key = getCommuneKey(customer);
    if (!(key in communeMap)) {
      communeMap[key] = order.length;
      order.push(key);
    }
  });

  return {
    communeMap,
    alphabet,
    getLetter: (customer) => {
      const key = getCommuneKey(customer);
      const index = communeMap[key] ?? 0;
      return alphabet[index % alphabet.length] || 'A';
    }
  };
}

function hashString(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function getCustomerMarkerColor(customer) {
  const key = [
    getObjectValueByAnyKey(customer, ['so_hd', 'SO_HD', 'So_HD']) || '',
    getObjectValueByAnyKey(customer, ['Ten_khach_hang', 'ten_khach_hang']) || '',
    String(customer.rowIndex || customer['rowIndex'] || 0)
  ].join('|');

  const hue = hashString(key) % 360;
  return `hsl(${hue} 72% 52%)`;
}

function getCustomerMarkerIcon(customer, label) {
  const baseColor = isPlannedTodayPending(customer) ? '#fd8b13' : getCustomerMarkerColor(customer);
  const letter = String(label || 'A').toUpperCase().slice(0, 1);
  return L.divIcon({
    className: 'gps-marker-num',
    html: `<span style="background:${baseColor}; color: white; display:inline-flex; width:22px; height:22px; border-radius:50%; align-items:center; justify-content:center; border:2px solid rgba(255,255,255,0.9); box-shadow:0 4px 12px rgba(0,0,0,0.25); font-weight:700; font-size:10px;">${letter}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });
}

function isPlannedTodayPending(customer) {
  const planValue = String(customer.kehoachngay || customer['kehoachngay'] || customer.KehoachNgay || customer['KehoachNgay'] || '').trim();
  if (!planValue) return false;
  const planDate = new Date(planValue.includes('/') ? planValue.split('/').reverse().join('-') : planValue);
  const today = new Date();
  const sameDay = !Number.isNaN(planDate.getTime()) && planDate.getFullYear() === today.getFullYear() && planDate.getMonth() === today.getMonth() && planDate.getDate() === today.getDate();
  const checkedToday = String(customer.Check_Time || customer['Check_Time'] || '').trim();
  const checkedDate = checkedToday ? new Date(checkedToday.includes('/') ? checkedToday.split('/').reverse().join('-') : checkedToday) : null;
  const alreadyCheckedToday = checkedDate && !Number.isNaN(checkedDate.getTime()) && checkedDate.getFullYear() === today.getFullYear() && checkedDate.getMonth() === today.getMonth() && checkedDate.getDate() === today.getDate();
  return sameDay && !alreadyCheckedToday;
}

function getCustomerMarkerKey(customer) {
  const soHd = getObjectValueByAnyKey(customer, ['so_hd', 'SO_HD', 'So_HD']) || 'unknown';
  const name = getObjectValueByAnyKey(customer, ['Ten_khach_hang', 'ten_khach_hang']) || 'customer';
  return `${String(soHd)}-${String(name)}`.replace(/\s+/g, '_');
}

function buildCustomerPopupHtml(customer) {
  const rowIndex = Number(customer.rowIndex || customer['rowIndex'] || 0) || 0;
  const soHd = getObjectValueByAnyKey(customer, ['so_hd', 'SO_HD', 'So_HD']) || '---';
  const name = getObjectValueByAnyKey(customer, ['Ten_khach_hang', 'ten_khach_hang']) || 'Khách hàng';
  const diaChi = [
    getObjectValueByAnyKey(customer, ['WARD_HO_KHAU', 'ward_ho_khau', 'WARD_TAM_TRU', 'ward_tam_tru']),
    getObjectValueByAnyKey(customer, ['WARD_TAM_TRU', 'ward_tam_tru'])
  ].filter(Boolean).join(' • ') || 'Chưa có địa chỉ';
  const apNew = getObjectValueByAnyKey(customer, ['WARD_HO_KHAU_AP_NEW', 'ward_ho_khau_ap_new']) || '';
  const apOld = getObjectValueByAnyKey(customer, ['WARD_HO_KHAU_AP_OLD', 'ward_ho_khau_ap_old']) || '';
  const note = getObjectValueByAnyKey(customer, ['Ghi_chu', 'ghi_chu']) || '';
  const noteHtml = note ? `<div class="mb-2"><strong>Ghi chú:</strong> ${escapeHtml(note)}</div>` : '';
  const distance = getCustomerDistanceText(customer);
  const provinceStatus = getCustomerProvinceLocationStatus(customer);
  const tamTruStatus = getCustomerTamTruStatus(customer);
  const provinceBadgeHtml = provinceStatus ? `<div class="mb-1"><strong>Vùng:</strong> <span class="badge ${provinceStatus.isInProvince ? 'bg-success-subtle text-success-emphasis' : 'bg-warning-subtle text-warning-emphasis'}">${provinceStatus.label}</span> <span class="text-muted small">(${provinceStatus.provinceCode} / ${provinceStatus.shopCode})</span></div>` : '';
  const tamTruBadgeHtml = tamTruStatus ? `<div class="mb-1"><strong>Tạm Trú:</strong> <span class="badge" style="background-color:#f3e8ff;color:#6d28d9;border:1px solid #d8b4fe;">${tamTruStatus.label}</span></div>` : '';
  const apLines = [
    apNew ? `<div class="mb-1"><strong>Ấp New:</strong> ${escapeHtml(apNew)}</div>` : '',
    apOld ? `<div class="mb-1"><strong>Ấp Old:</strong> ${escapeHtml(apOld)}</div>` : ''
  ].filter(Boolean).join('');

  return `
    <div style="min-width:240px; max-width:290px; position:relative; padding-top:4px;">
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; margin-bottom:6px;">
        <div class="fw-bold text-primary" style="font-size:14px; line-height:1.3;">${escapeHtml(name)}</div>
        <div style="font-size:11px; color:#0d6efd; white-space:nowrap; margin-left:auto;">📍 ${escapeHtml(distance)}</div>
      </div>
      ${noteHtml}
      <div class="mb-1"><strong>HĐ:</strong> ${escapeHtml(soHd)}</div>
      <div class="mb-1"><strong>Địa chỉ:</strong> ${escapeHtml(diaChi)}</div>
      ${provinceBadgeHtml || ''}
      ${tamTruBadgeHtml || ''}
      ${apLines ? `<div class="mb-2">${apLines}</div>` : ''}
      <div class="d-flex flex-wrap gap-2 justify-content-center">
        <button type="button" class="btn btn-sm btn-success" onclick="window.doMapCustomerCheckGps(${rowIndex}, '${escapeHtml(soHd)}')">📍 Check GPS</button>
        <button type="button" class="btn btn-sm btn-warning text-white" onclick="window.doMapCustomerCheckAo(${rowIndex}, '${escapeHtml(soHd)}')">🛡️ Check ảo</button>
        <button type="button" class="btn btn-sm btn-primary" onclick="window.openCustomerDirections(${rowIndex})">🧭 Chỉ đường</button>
      </div>
    </div>
  `;
}

function focusCustomerGps(rowIndex, gpsKey) {
  const customer = (window.mapState.filteredData || []).find((item) => Number(item.rowIndex || item['rowIndex'] || 0) === Number(rowIndex));
  if (!customer) return;

  const rawValue = getObjectValueByAnyKey(customer, [gpsKey, gpsKey.toLowerCase(), gpsKey.replace(/_/g, ''), gpsKey.replace(/_/g, '').toLowerCase()]);
  const coords = parseGpsCoord(rawValue);
  if (!coords) {
    showToast('GPS này không hợp lệ để hiển thị.', 'danger');
    return;
  }

  if (window.mapState.map) {
    window.mapState.map.setView([coords.lat, coords.lng], 16);
    const key = getCustomerMarkerKey(customer);
    const marker = window.mapState.markerRegistry[key];
    if (marker) marker.openPopup();
  }
}

function openCustomerDirections(rowIndex) {
  const customer = (window.mapState.filteredData || []).find((item) => Number(item.rowIndex || item['rowIndex'] || 0) === Number(rowIndex));
  if (!customer) return;
  const coords = parseGpsCoord(getPreferredGpsValue(customer));
  if (!coords) {
    showToast('Khách hàng chưa có GPS để chỉ đường.', 'danger');
    return;
  }

  const lat = coords.lat;
  const lng = coords.lng;
  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  window.open(url, '_blank');
}

function parseMapDeadlineDays(value) {
  if (value === null || value === undefined || value === '') return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric;

  const text = String(value).trim().toLowerCase().replace(/,/g, '.');
  if (!text) return null;

  const monthMatch = text.match(/(\d+(?:\.\d+)?)\s*(tháng|thang|month|months)/i);
  if (monthMatch) return Number(monthMatch[1]) * 30;

  const yearMatch = text.match(/(\d+(?:\.\d+)?)\s*(năm|nam|year|years)/i);
  if (yearMatch) return Number(yearMatch[1]) * 365;

  const directNumber = Number(text.replace(/[^\d.\-]/g, ''));
  return Number.isFinite(directNumber) ? directNumber : null;
}

function matchesMapDeadlineFilter(customer, filterValue) {
  if (!filterValue || filterValue === 'all') return true;

  const values = [
    customer.Ngay_qua_han,
    customer['Ngay_qua_han'],
    customer.Ngay_het_han,
    customer['Ngay_het_han'],
    customer.ngay_qua_han,
    customer['ngay_qua_han'],
    customer.deadline_days,
    customer['deadline_days'],
    customer.han,
    customer['han']
  ];

  const daysValue = values.map((entry) => parseMapDeadlineDays(entry)).find((entry) => entry !== null && Number.isFinite(entry));
  if (daysValue === undefined || daysValue === null) return false;

  if (filterValue === 'duoi_4_thang') return daysValue <= 120;
  if (filterValue === 'duoi_7_thang') return daysValue <= 210;
  if (filterValue === 'duoi_1_nam') return daysValue <= 365;
  return true;
}

function sortCustomersByDistance(customers) {
  if (!window.mapState.myLocation || !Array.isArray(customers)) return customers;

  return [...customers].sort((a, b) => {
    const aGps = parseGpsCoord(getPreferredGpsValue(a));
    const bGps = parseGpsCoord(getPreferredGpsValue(b));
    const aDist = aGps ? haversineKm(window.mapState.myLocation.lat, window.mapState.myLocation.lng, aGps.lat, aGps.lng) : Number.MAX_SAFE_INTEGER;
    const bDist = bGps ? haversineKm(window.mapState.myLocation.lat, window.mapState.myLocation.lng, bGps.lat, bGps.lng) : Number.MAX_SAFE_INTEGER;
    return aDist - bDist;
  });
}

function renderMapLoadMoreControl(totalCount) {
  const listNode = document.getElementById('sidebarCustomerList');
  if (!listNode) return;

  let controls = document.getElementById('mapLoadMoreControls');
  if (!controls) {
    controls = document.createElement('div');
    controls.id = 'mapLoadMoreControls';
    controls.className = 'mt-2';
    listNode.appendChild(controls);
  }

  const visibleCount = Number(window.mapState.mapVisibleCount || 20);
  const remaining = Math.max(0, totalCount - visibleCount);
  if (remaining <= 0) {
    controls.innerHTML = '';
    return;
  }

  controls.innerHTML = `
    <button type="button" class="btn btn-sm btn-primary w-100" onclick="window.mapState.mapVisibleCount = Math.min((window.mapState.mapVisibleCount || 20) + 20, window.mapState.filteredData.length); filterAndRenderMap();">
      Xem thêm ${Math.min(20, remaining)} khách
    </button>
  `;
}

function syncMapDailyPlanButtonState() {
  const checkbox = document.getElementById('mapKehoachFilterToggle');
  const button = document.getElementById('mapDailyPlanActionBtn');
  const enabled = !!(checkbox && checkbox.checked);

  if (button) {
    button.classList.toggle('btn-warning', enabled);
    button.classList.toggle('btn-outline-warning', !enabled);
    button.setAttribute('aria-pressed', String(enabled));
    button.title = enabled ? 'Bỏ lọc kế hoạch ngày hôm nay' : 'Lọc kế hoạch ngày hôm nay';
    const label = button.querySelector('.map-action-label');
    if (label) {
      label.textContent = enabled ? '📅 Kế hoạch ngày: BẬT' : '📅 Kế hoạch ngày';
    }
  }
}

function toggleMapDailyPlanFilter(forceState) {
  const checkbox = document.getElementById('mapKehoachFilterToggle');
  if (!checkbox) return;

  const nextState = typeof forceState === 'boolean' ? forceState : !checkbox.checked;
  checkbox.checked = nextState;
  syncMapDailyPlanButtonState();

  const checkState = document.getElementById('mapCheckState');
  if (checkState && !nextState && checkState.value === 'chua_check') {
    checkState.value = 'chua_check';
  }

  filterAndRenderMap();
  showToast(nextState ? 'Đã bật lọc kế hoạch ngày hôm nay.' : 'Đã tắt lọc kế hoạch ngày.', 'info');
}

function hasOpenMapCustomerFocusForBackgroundSync() {
  return Number.isFinite(window.mapState?.focusedCustomerRow) && Number(window.mapState.focusedCustomerRow) > 0;
}

function filterAndRenderMap() {
  if (!window.mapState.map || !window.mapState.markersLayer) return;

  const checkState = document.getElementById('mapCheckState')?.value || 'chua_check';
  const gpsType = document.getElementById('mapGpsType')?.value || 'all';
  const keyword = (document.getElementById('mapSearch')?.value || '').trim().toLowerCase();
  const paymentFilter = document.getElementById('mapThanhToan')?.value || '';
  const deadlineFilter = document.getElementById('mapDeadlineFilter')?.value || '';
  const dailyPlanOnly = !!document.getElementById('mapKehoachFilterToggle')?.checked;

  const filtered = window.mapState.allData.filter((customer) => {
    const checkValue = String(getObjectValueByAnyKey(customer, ['Check_GPS', 'check_gps']) || '').trim();
    const aoValue = String(getObjectValueByAnyKey(customer, ['Check_Ao', 'check_ao']) || '').trim();
    const gpsCandidate = getPreferredGpsValue(customer);
    const gpsCoord = parseGpsCoord(gpsCandidate);

    if (!gpsCoord) return false;

    if (dailyPlanOnly && !isPlannedTodayPending(customer)) return false;

    if (checkState === 'chua_check') {
      if (checkValue !== '' || aoValue !== '') return false;
    }
    if (checkState === 'da_check') {
      if (checkValue === '' && aoValue === '') return false;
    }

    if (gpsType !== 'all') {
      const gpsKeys = gpsType === 'GPS_CHECK_1_5'
        ? ['GPS_1', 'GPS_2', 'GPS_3', 'GPS_4', 'GPS_5']
        : [gpsType];

      const found = gpsKeys.some((key) => !!getObjectValueByAnyKey(customer, [key, key.toLowerCase(), key.replace(/_/g, ''), key.replace(/_/g, '').toLowerCase()]));
      if (!found) return false;
    }

    if (paymentFilter === 'chua_thanh_toan') {
      const amount = Number(customer.So_tien_thanh_toan || customer['So_tien_thanh_toan'] || 0);
      if (amount >= 500000) return false;
    }

    if (paymentFilter === 'da_thanh_toan_tren_500k') {
      const amount = Number(customer.So_tien_thanh_toan || customer['So_tien_thanh_toan'] || 0);
      if (amount < 500000) return false;
    }

    if (deadlineFilter && !matchesMapDeadlineFilter(customer, deadlineFilter)) return false;

    if (keyword) {
      const haystack = [
        customer.Ten_khach_hang,
        customer.so_hd,
        customer.sdt,
        customer.SHOPNAME,
        customer['Ten_khach_hang'],
        customer['so_hd'],
        customer['sdt'],
        customer['SHOPNAME']
      ].join(' ').toLowerCase();
      if (haystack.indexOf(keyword) === -1) return false;
    }

    return true;
  });

  window.mapState.filteredData = sortCustomersByDistance(filtered);
  const visibleCount = Math.max(20, Number(window.mapState.mapVisibleCount || 20));
  const visibleData = window.mapState.filteredData.slice(0, Math.min(visibleCount, window.mapState.filteredData.length));
  window.mapState.mapVisibleCount = visibleData.length;

  renderMapList(visibleData);
  renderMapLoadMoreControl(window.mapState.filteredData.length);

  renderMapMarkers(window.mapState.filteredData, { fromPage: true });
}

function toggleMapCustomerDetails(panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;

  const isHidden = panel.classList.contains('d-none');
  panel.classList.toggle('d-none', !isHidden);

  const card = panel.closest('.customer-item-card');
  const toggle = card?.querySelector('.map-card-toggle');
  if (toggle) {
    toggle.textContent = isHidden ? '▴' : '▾';
  }
}

async function setMapCustomerPlanToday(rowIndex) {
  const currentMonth = window.mapState?.selectedMonth || document.getElementById('mapMonth')?.value || '';
  if (!currentMonth) {
    showToast('Vui lòng chọn kỳ tháng trước khi gán kế hoạch ngày.', 'danger');
    return;
  }

  const todayValue = new Date().toLocaleDateString('vi-VN');
  try {
    await window.F88_API.post('updateCustomer', {
      rowIndex: Number(rowIndex),
      monthTab: currentMonth,
      data: { kehoachngay: todayValue }
    });

    const customer = (window.mapState?.allData || []).find((item) => Number(item.rowIndex || item['rowIndex'] || 0) === Number(rowIndex));
    if (customer) {
      customer.kehoachngay = todayValue;
      customer['kehoachngay'] = todayValue;
      if (window.mapState?.filteredData) {
        const item = window.mapState.filteredData.find((entry) => Number(entry.rowIndex || entry['rowIndex'] || 0) === Number(rowIndex));
        if (item) {
          item.kehoachngay = todayValue;
          item['kehoachngay'] = todayValue;
        }
      }
    }

    if (typeof window.filterAndRenderMap === 'function') {
      window.filterAndRenderMap();
    }
    showToast('Đã gán kế hoạch ngày hôm nay.', 'success');
  } catch (error) {
    console.error(error);
    showToast('Không thể cập nhật kế hoạch ngày.', 'danger');
  }
}

function renderMapList(data) {
  const listNode = document.getElementById('sidebarCustomerList');
  if (!listNode) return;

  const pageData = Array.isArray(data) ? data : [];
  listNode.innerHTML = pageData.length ? pageData.map((customer, index) => {
    const gpsEntries = getCustomerGpsEntries(customer);
    const gpsText = gpsEntries.length ? gpsEntries.map((entry) => {
      const distLabel = entry.distanceKm !== null ? ` • ${entry.distanceKm.toFixed(1)} km` : '';
      return `<div class="gps-mini-row" role="button" tabindex="0" onclick="event.stopPropagation(); focusCustomerGps(${customer.rowIndex || customer['rowIndex'] || index + 2}, '${entry.key}')" onkeydown="if(event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); focusCustomerGps(${customer.rowIndex || customer['rowIndex'] || index + 2}, '${entry.key}'); }"><span class="gps-mini-label">${escapeHtml(entry.label)}:</span> <span class="gps-mini-value">${escapeHtml(entry.raw)}</span>${distLabel}</div>`;
    }).join('') : '<div class="text-muted small">Chưa có GPS</div>';

    const name = getObjectValueByAnyKey(customer, ['Ten_khach_hang', 'ten_khach_hang', 'TEN_KHACH_HANG']) || 'Khách hàng';
    const ap = getObjectValueByAnyKey(customer, ['WARD_HO_KHAU_AP_NEW', 'WARD_HO_KHAU_AP_OLD', 'ward_ho_khau_ap_new', 'ward_ho_khau_ap_old']) || getObjectValueByAnyKey(customer, ['Ap', 'ap']) || '---';
    const xa = getObjectValueByAnyKey(customer, ['WARD_HO_KHAU', 'WARD_TAM_TRU', 'ward_ho_khau', 'ward_tam_tru', 'Xa', 'xa', 'xaphuong']) || '---';
    const soHd = getObjectValueByAnyKey(customer, ['so_hd', 'SO_HD', 'sohd']) || '---';
    const rowIndex = customer.rowIndex || customer['rowIndex'] || index + 2;
    const kmText = getCustomerDistanceText(customer);
    const tone = computeCustomerStatusTone(customer);
    const detailId = `mapCustomerDetail_${rowIndex}_${index}`;
    const focused = Number(window.mapState.focusedCustomerRow) === Number(rowIndex);
    const focusButtonLabel = focused ? 'Hiện tất cả' : 'Chỉ khách này';
    const focusButtonAction = focused ? `setCustomerFocus(${rowIndex}, false)` : `setCustomerFocus(${rowIndex}, true)`;
    return `
      <div class="customer-item-card" data-index="${index}" data-status="${tone.key}">
        <div class="customer-summary-row" onclick="toggleMapCustomerDetails('${detailId}')">
          <div class="customer-summary-main">
            <p class="customer-name">${escapeHtml(name)}</p>
            <div class="customer-phone">${escapeHtml(ap)} • ${escapeHtml(xa)}</div>
          </div>
          <div class="customer-summary-side">
            <div class="distance-pill">📍 ${escapeHtml(kmText)}</div>
            <div class="map-card-toggle">▾</div>
          </div>
        </div>

        <div id="${detailId}" class="customer-detail-panel d-none">
          <div class="customer-meta">
            <div class="gps-mini-box">${gpsText}</div>
          </div>

          <div class="customer-action-row">
            <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); ${focusButtonAction}">${focused ? '📌' : '👁️'} ${focusButtonLabel}</button>
            <button class="btn btn-sm btn-outline-info" onclick="event.stopPropagation(); setMapCustomerPlanToday(${rowIndex})">📅 Kế hoạch ngày</button>
            <button class="btn btn-sm btn-success" onclick="event.stopPropagation(); doMapCustomerCheckGps(${rowIndex}, '${escapeHtml(soHd)}')">📍 Check GPS</button>
            <button class="btn btn-sm btn-warning text-white" onclick="event.stopPropagation(); doMapCustomerCheckAo(${rowIndex}, '${escapeHtml(soHd)}')">🛡️ Check Áo</button>
            ${isPlannedTodayPending(customer) ? '<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle align-self-center">📅 Kế hoạch hôm nay</span>' : ''}
          </div>
        </div>
      </div>
    `;
  }).join('') : '<div class="text-center text-muted py-4">Không có khách hàng nào trên bản đồ.</div>';
}

function renderMapMarkers(data, options = {}) {
  const { fromPage = false } = options;
  window.mapState.markersLayer.clearLayers();
  window.mapState.markerRegistry = {};

  const visibleData = window.mapState.focusedCustomerRow === null
    ? data
    : data.filter((customer) => Number(customer.rowIndex || customer['rowIndex'] || 0) === Number(window.mapState.focusedCustomerRow));

  const communeLetterMap = buildMapCommuneLetterMap(visibleData);
  const pool = [];
  visibleData.forEach((customer, index) => {
    const gpsEntries = getCustomerGpsEntries(customer);
    if (!gpsEntries.length) return;

    const primaryEntry = getNearestGpsEntry(customer);
    const letter = communeLetterMap.getLetter(customer);
    gpsEntries.forEach((entry) => {
      const markerIcon = getCustomerMarkerIcon(customer, letter);
      const marker = L.marker([entry.coords.lat, entry.coords.lng], {
        icon: markerIcon
      }).addTo(window.mapState.markersLayer);

      const markerKey = `${getCustomerMarkerKey(customer)}-${entry.key}`;
      window.mapState.markerRegistry[markerKey] = marker;
      const note = getObjectValueByAnyKey(customer, ['Ghi_chu', 'ghi_chu']) || '';
      const noteHtml = note ? `<div class="mb-1"><strong>Ghi chú:</strong> ${escapeHtml(note)}</div>` : '';
      const provinceStatus = getCustomerProvinceLocationStatus(customer);
      const provinceBadgeHtml = provinceStatus ? `<div class="mb-1"><strong>Vùng:</strong> <span class="badge ${provinceStatus.isInProvince ? 'bg-success-subtle text-success-emphasis' : 'bg-warning-subtle text-warning-emphasis'}">${provinceStatus.label}</span> <span class="text-muted small">(${provinceStatus.provinceCode} / ${provinceStatus.shopCode})</span></div>` : '';
      const apNew = getObjectValueByAnyKey(customer, ['WARD_HO_KHAU_AP_NEW', 'ward_ho_khau_ap_new']) || '';
      const apOld = getObjectValueByAnyKey(customer, ['WARD_HO_KHAU_AP_OLD', 'ward_ho_khau_ap_old']) || '';
      const apLines = [
        apNew ? `<div class="mb-1"><strong>Ấp New:</strong> ${escapeHtml(apNew)}</div>` : '',
        apOld ? `<div class="mb-1"><strong>Ấp Old:</strong> ${escapeHtml(apOld)}</div>` : ''
      ].filter(Boolean).join('');
      const distanceText = entry.distanceKm !== null ? `${entry.distanceKm.toFixed(1)} km` : 'Không xác định';
      marker.bindPopup(`
        <div style="min-width:240px; max-width:290px; position:relative; padding-top:4px;">
          <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; margin-bottom:6px;">
            <div class="fw-bold text-primary" style="font-size:14px; line-height:1.3;">${escapeHtml(getObjectValueByAnyKey(customer, ['Ten_khach_hang', 'ten_khach_hang']) || 'Khách hàng')}</div>
            <div style="font-size:11px; color:#0d6efd; white-space:nowrap; margin-left:auto;">📍 ${escapeHtml(distanceText)}</div>
          </div>
          ${noteHtml}
          <div class="mb-1"><strong>Địa chỉ:</strong> ${escapeHtml([getObjectValueByAnyKey(customer, ['WARD_HO_KHAU', 'ward_ho_khau']), getObjectValueByAnyKey(customer, ['WARD_TAM_TRU', 'ward_tam_tru'])].filter(Boolean).join(' • ') || 'Chưa có địa chỉ')}</div>
          ${provinceBadgeHtml || ''}
          ${apLines ? `<div class="mb-2">${apLines}</div>` : ''}
          <div class="mt-2 d-flex flex-wrap gap-2 justify-content-center">
            <button type="button" class="btn btn-sm btn-outline-info" onclick="window.setMapCustomerPlanToday && window.setMapCustomerPlanToday(${customer.rowIndex || customer['rowIndex'] || index + 2})">📅 Kế hoạch ngày</button>
            <button type="button" class="btn btn-sm btn-success" onclick="window.doMapCustomerCheckGps(${customer.rowIndex || customer['rowIndex'] || index + 2}, '${escapeHtml(getObjectValueByAnyKey(customer, ['so_hd', 'SO_HD', 'So_HD']) || '---')}')">📍 Check GPS</button>
            <button type="button" class="btn btn-sm btn-warning text-white" onclick="window.doMapCustomerCheckAo(${customer.rowIndex || customer['rowIndex'] || index + 2}, '${escapeHtml(getObjectValueByAnyKey(customer, ['so_hd', 'SO_HD', 'So_HD']) || '---')}')">🛡️ Check ảo</button>
            <button type="button" class="btn btn-sm btn-primary" onclick="window.openCustomerDirections(${customer.rowIndex || customer['rowIndex'] || index + 2})">🧭 Chỉ đường</button>
          </div>
        </div>
      `);
      pool.push({ customer, marker });
    });
  });

  document.getElementById('statCustomers').textContent = String(visibleData.length);
  document.getElementById('statGpsPoints').textContent = String(pool.length);

  if (pool.length) {
    const group = L.featureGroup(pool.map((item) => item.marker));
    window.mapState.map.fitBounds(group.getBounds(), { padding: [24, 24] });
  }
}

function toggleAllCustomerFocus() {
  setCustomerFocus(null);

  if (window.mapState.filteredData.length && window.mapState.map) {
    const group = L.featureGroup(window.mapState.filteredData.map((customer) => {
      const coords = parseGpsCoord(getPreferredGpsValue(customer));
      if (!coords) return null;
      return L.marker([coords.lat, coords.lng]);
    }).filter(Boolean));
    if (group.getLayers().length) {
      window.mapState.map.fitBounds(group.getBounds(), { padding: [20, 20] });
      showToast('Đã hiển thị tất cả khách hàng trên bản đồ.', 'success');
      return;
    }
  }
  showToast('Không có khách hàng nào để hiển thị.', 'warning');
}

function panToMapCustomer(rowIndex) {
  const customer = (window.mapState.filteredData || []).find((item) => Number(item.rowIndex || item['rowIndex'] || 0) === Number(rowIndex));
  if (!customer) return;
  const coords = parseGpsCoord(getPreferredGpsValue(customer));
  if (!coords) {
    showToast('Khách hàng chưa có GPS để xem trên bản đồ.', 'danger');
    return;
  }
  if (window.mapState.map) {
    if (window.innerWidth < 992) {
      toggleMapSidebar(false);
    }
    window.mapState.map.setView([coords.lat, coords.lng], 16);
    const key = getCustomerMarkerKey(customer);
    const marker = window.mapState.markerRegistry[key];
    if (marker) marker.openPopup();
    setTimeout(() => window.mapState.map.invalidateSize(), 250);
    showToast('Đã zoom đến vị trí khách hàng.', 'info');
  }
}

async function doMapCustomerCheckGps(rowIndex, soHd) {
  const currentMonth = window.mapState.selectedMonth || document.getElementById('mapMonth')?.value || '';
  if (!currentMonth) {
    showToast('Vui lòng chọn kỳ tháng trước khi check GPS.', 'danger');
    return;
  }

  if (window.innerWidth < 992) {
    toggleMapSidebar(false);
  }

  if (!navigator.geolocation) {
    showToast('Trình duyệt không hỗ trợ định vị.', 'danger');
    return;
  }

  navigator.geolocation.getCurrentPosition(async (position) => {
    const gps = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
    const nextCount = getMapCheckCount(rowIndex) + 1;
    try {
      await window.F88_API.post('updateCustomer', {
        rowIndex,
        monthTab: currentMonth,
        data: {
          Check_GPS: 'Đã Check GPS',
          Check_Time: new Date().toLocaleDateString('vi-VN'),
          GPS_Chinh: gps,
          So_lan_check: nextCount
        }
      });
      await window.F88_API.post('recordCheckMonth', {
        soHd,
        rowIndex,
        monthTab: currentMonth,
        type: 'GPS'
      });
      showToast('Đã check GPS cho khách hàng');
      loadMapDataAndRender();
    } catch (error) {
      console.error(error);
      showToast('Check GPS thất bại.', 'danger');
    }
  }, () => {
    showToast('Không lấy được vị trí hiện tại.', 'danger');
  }, { enableHighAccuracy: true });
}

async function doMapCustomerCheckAo(rowIndex, soHd) {
  const currentMonth = window.mapState.selectedMonth || document.getElementById('mapMonth')?.value || '';
  if (!currentMonth) {
    showToast('Vui lòng chọn kỳ tháng trước khi check áo.', 'danger');
    return;
  }

  if (window.innerWidth < 992) {
    toggleMapSidebar(false);
  }

  try {
    const nextCount = getMapCheckCount(rowIndex) + 1;
    await window.F88_API.post('updateCustomer', {
      rowIndex,
      monthTab: currentMonth,
      data: {
        Check_Ao: 'Đã Check Áo',
        Check_Time: new Date().toLocaleDateString('vi-VN'),
        So_lan_check: nextCount
      }
    });
    await window.F88_API.post('recordCheckMonth', {
      soHd,
      rowIndex,
      monthTab: currentMonth,
      type: 'AO'
    });
    showToast('Đã check áo cho khách hàng');
    loadMapDataAndRender();
  } catch (error) {
    console.error(error);
    showToast('Check áo thất bại.', 'danger');
  }
}

function resetMapFilters() {
  document.getElementById('mapMonth').value = '';
  document.getElementById('mapCheckState').value = 'chua_check';
  document.getElementById('mapGpsType').value = 'all';
  document.getElementById('mapThanhToan').value = '';
  document.getElementById('mapDeadlineFilter').value = '';
  document.getElementById('mapSearch').value = '';
  const dailyToggle = document.getElementById('mapKehoachFilterToggle');
  if (dailyToggle) dailyToggle.checked = false;
  syncMapDailyPlanButtonState();
  loadMapDataAndRender();
  showToast('Đã đặt lại bộ lọc bản đồ.', 'secondary');
}

function showToast(message, type) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast align-items-center text-white bg-' + type + ' border-0 show';
  toast.setAttribute('role', 'alert');
  toast.innerHTML = '<div class="d-flex"><div class="toast-body">' + escapeHtml(message) + '</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>';
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.loadMapDataAndRender = loadMapDataAndRender;
window.filterAndRenderMap = filterAndRenderMap;
window.setMapCustomerPlanToday = setMapCustomerPlanToday;
window.toggleMapDailyPlanFilter = toggleMapDailyPlanFilter;
window.locateMyPosition = locateMyPosition;
window.toggleMapSidebar = toggleMapSidebar;
window.toggleAllCustomerFocus = toggleAllCustomerFocus;
window.panToMapCustomer = panToMapCustomer;
window.focusCustomerGps = focusCustomerGps;
window.openCustomerDirections = openCustomerDirections;
window.doMapCustomerCheckGps = doMapCustomerCheckGps;
window.doMapCustomerCheckAo = doMapCustomerCheckAo;
window.resetMapFilters = resetMapFilters;
