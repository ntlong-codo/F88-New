window.appState = {
  months: [],
  allData: [],
  filteredData: [],
  gpsFilterEnabled: false,
  apFilterEnabled: false,
  selectedMonth: '',
  pendingFocus: null,
  currentLocation: null
};

window.F88_AUTH_KEY = 'f88_auth_session';
window.F88_AUTH_PASS = '124985';
window.F88_AUTH_TTL = 24 * 60 * 60 * 1000;

function normalizeMonthKey(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const noSpace = text.replace(/tháng/gi, '').replace(/\s+/g, '');
  const matchSlash = noSpace.match(/(\d{1,2})[\/\-.](\d{4})/);
  if (matchSlash) return matchSlash[1].padStart(2, '0') + matchSlash[2];
  const matchReverse = noSpace.match(/(\d{4})[\/\-.](\d{1,2})/);
  if (matchReverse) return matchReverse[2].padStart(2, '0') + matchReverse[1];
  const compact = noSpace.match(/(\d{1,2})(\d{4})/);
  if (compact) return compact[1].padStart(2, '0') + compact[2];
  return noSpace;
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
  if (document.getElementById('filterMonth').value) count += 1;
  if (document.getElementById('filterCheck').value) count += 1;
  if (document.getElementById('filterGpsType').value && document.getElementById('filterGpsType').value !== 'all') count += 1;
  if (document.getElementById('filterThanhToan').value) count += 1;
  if (document.getElementById('filterTrangThaiHd').value) count += 1;
  if (document.getElementById('filterTimNha').value) count += 1;
  if (document.getElementById('filterDoKho').value) count += 1;
  if (document.getElementById('filterThuongTru').value.trim()) count += 1;
  document.getElementById('activeFilterCount').textContent = String(count);
}

async function initApp() {
  try {
    const monthsResult = await window.F88_API.fetch('getMonths');
    const months = Array.isArray(monthsResult.months) ? monthsResult.months : [];
    const validMonths = months.filter((m) => String(m).trim() && String(m).toLowerCase() !== 'ap_new' && String(m).toLowerCase() !== 'ap_old');

    window.appState.months = validMonths;

    const monthSelects = [document.getElementById('filterMonth'), document.getElementById('gpsFilterMonth')];
    monthSelects.forEach((select) => {
      if (!select) return;
      select.innerHTML = '<option value="">-- Tất cả tháng --</option>';
      validMonths.forEach((month) => {
        const monthKey = normalizeMonthKey(month);
        const option = document.createElement('option');
        option.value = monthKey;
        option.textContent = 'Kỳ ' + (monthKey ? formatMonthLabel(monthKey) : month);
        select.appendChild(option);
      });
    });

    const currentDate = new Date();
    const currentMonthKey = normalizeMonthKey(String(currentDate.getMonth() + 1).padStart(2, '0') + String(currentDate.getFullYear()));
    const defaultMonth = validMonths
      .map((month) => normalizeMonthKey(month))
      .find((monthKey) => monthKey === currentMonthKey) || normalizeMonthKey(validMonths[0] || '');

    const filterMonth = document.getElementById('filterMonth');
    const gpsMonth = document.getElementById('gpsFilterMonth');
    if (filterMonth) filterMonth.value = defaultMonth;
    if (gpsMonth) gpsMonth.value = defaultMonth;
    window.appState.selectedMonth = defaultMonth;

    setLoadingStatus('Đang tải dữ liệu khách hàng...', 'Bước 2/2: tải dữ liệu từ Google Sheets...');
    await loadCustomerData();
  } catch (error) {
    console.error(error);
    setLoadingStatus('Lỗi kết nối API', 'Không thể tải dữ liệu từ Google Apps Script.');
    showToast('Không thể kết nối API. Kiểm tra lại script URL hoặc quyền truy cập.', 'danger');
  }
}

async function loadCustomerData() {
  try {
    const month = normalizeMonthKey(window.appState.selectedMonth || '');
    const result = await window.F88_API.fetch('getData', { month });
    const rows = Array.isArray(result.data) ? result.data : [];

    window.appState.allData = rows;
    filterData();

    const loadedCount = rows.length;
    setLoadingStatus('Đã tải dữ liệu', 'Tổng khách hàng: ' + loadedCount);
    showToast('Đã tải ' + loadedCount + ' khách hàng.', 'success');
  } catch (error) {
    console.error(error);
    setLoadingStatus('Lỗi tải dữ liệu', 'Đã xảy ra lỗi khi đọc dữ liệu từ Google Sheets.');
    showToast('Lỗi khi tải dữ liệu.', 'danger');
  }
}

function syncMonthAndReload(month) {
  const normalizedMonth = normalizeMonthKey(month || '');
  window.appState.selectedMonth = normalizedMonth;
  document.getElementById('filterMonth').value = normalizedMonth;
  document.getElementById('gpsFilterMonth').value = normalizedMonth;
  loadCustomerData();
  showToast('Đã chọn kỳ ' + (normalizedMonth ? formatMonthLabel(normalizedMonth) : 'tất cả tháng') + '.', 'info');
}

function filterData() {
  const selectedMonth = normalizeMonthKey(document.getElementById('filterMonth').value || '');
  const selectedCheck = document.getElementById('filterCheck').value || '';
  const selectedGpsType = document.getElementById('filterGpsType').value || 'all';
  const selectedThanhToan = document.getElementById('filterThanhToan').value || '';
  const selectedTrangThaiHd = document.getElementById('filterTrangThaiHd').value || '';
  const selectedTimNha = document.getElementById('filterTimNha').value || '';
  const selectedDoKho = document.getElementById('filterDoKho').value || '';
  const keyword = (document.getElementById('searchKeyword') || {}).value || '';
  const thuongTru = (document.getElementById('filterThuongTru') || {}).value || '';
  const gpsFilterType = document.getElementById('gpsFilterType')?.value || 'all';
  const gpsFilterAp = window.appState.apFilterEnabled ? (document.getElementById('gpsFilterAp')?.value || 'all') : 'all';
  const isRegularFilterActive = !window.appState.gpsFilterEnabled;

  const normalizedKeyword = keyword.trim().toLowerCase();
  let filtered = window.appState.allData.filter((customer) => {
    const rowMonthValue = normalizeMonthKey(customer.month || customer['month'] || customer['Kỳ'] || customer['Ky'] || '');
    const monthMatch = !selectedMonth || rowMonthValue === selectedMonth || normalizeMonthKey(customer['Kỳ'] || customer['Ky'] || '') === selectedMonth;
    if (!monthMatch) return false;

    if (isRegularFilterActive) {
      if (selectedCheck) {
        const checkValue = String(customer.Check_GPS || customer['Check_GPS'] || '').trim();
        const checkAoValue = String(customer.Check_Ao || customer['Check_Ao'] || '').trim();
        if (selectedCheck === 'ChuaCheck' && (checkValue !== '' || checkAoValue !== '')) return false;
        if (selectedCheck === 'DaCheckGps' && checkValue.toLowerCase().indexOf('gps') === -1) return false;
        if (selectedCheck === 'DaCheckAo' && checkAoValue.toLowerCase().indexOf('áo') === -1 && checkAoValue.toLowerCase().indexOf('ao') === -1) return false;
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
        if (haystack.indexOf(thuongTru.toLowerCase()) === -1) return false;
      }
    }

    if (window.appState.gpsFilterEnabled || (gpsFilterType && gpsFilterType !== 'all')) {
      if (!hasAnyValidCustomerGps(customer)) return false;
    }

    if (gpsFilterType && gpsFilterType !== 'all') {
      const gpsValue = String(customer[gpsFilterType] || customer[gpsFilterType.toLowerCase()] || '').trim();
      if (!gpsValue) return false;
    }

    if (normalizedKeyword) {
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
      if (haystack.indexOf(normalizedKeyword) === -1) return false;
    }

    return true;
  });

  if (gpsFilterAp === 'nearest_ap' && window.appState.currentLocation) {
    const apGroups = {};
    filtered.forEach((customer) => {
      const apNew = String(customer.WARD_HO_KHAU_AP_NEW || customer['WARD_HO_KHAU_AP_NEW'] || '').trim();
      const apOld = String(customer.WARD_HO_KHAU_AP_OLD || customer['WARD_HO_KHAU_AP_OLD'] || '').trim();
      const apKey = apNew || apOld;
      if (!apKey) return;
      const coord = getCustomerCoord(customer);
      if (!coord) return;
      apGroups[apKey] = apGroups[apKey] || { key: apKey, coords: [], members: [] };
      apGroups[apKey].coords.push(coord);
      apGroups[apKey].members.push(customer);
    });

    const nearestApKey = Object.keys(apGroups)
      .map((key) => ({
        key,
        avgLat: apGroups[key].coords.reduce((sum, coord) => sum + coord.lat, 0) / apGroups[key].coords.length,
        avgLng: apGroups[key].coords.reduce((sum, coord) => sum + coord.lng, 0) / apGroups[key].coords.length
      }))
      .sort((a, b) => haversineKm(window.appState.currentLocation.lat, window.appState.currentLocation.lng, a.avgLat, a.avgLng) - haversineKm(window.appState.currentLocation.lat, window.appState.currentLocation.lng, b.avgLat, b.avgLng))[0]?.key;

    if (nearestApKey) {
      filtered = filtered.filter((customer) => {
        const apNew = String(customer.WARD_HO_KHAU_AP_NEW || customer['WARD_HO_KHAU_AP_NEW'] || '').trim();
        const apOld = String(customer.WARD_HO_KHAU_AP_OLD || customer['WARD_HO_KHAU_AP_OLD'] || '').trim();
        return (apNew && apNew === nearestApKey) || (apOld && apOld === nearestApKey);
      });
    }
  }

  if ((window.appState.gpsFilterEnabled || gpsFilterAp === 'nearest_ap') && window.appState.currentLocation) {
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

function updateStats(data) {
  const total = data.length;
  const unchecked = data.filter((customer) => {
    const gps = String(customer.Check_GPS || customer['Check_GPS'] || '').trim().toLowerCase();
    const ao = String(customer.Check_Ao || customer['Check_Ao'] || '').trim().toLowerCase();
    return gps === '' && ao === '';
  }).length;

  const todayCheck = data.filter((customer) => {
    const checkTime = String(customer.Check_Time || customer['Check_Time'] || '').trim();
    return checkTime !== '';
  }).length;

  document.getElementById('statTotalCust').textContent = String(total);
  document.getElementById('statUnchecked').textContent = String(unchecked);
  document.getElementById('statTodayCheck').textContent = String(todayCheck);
  document.getElementById('statTotalCheck').textContent = String(total - unchecked);
  document.getElementById('statMonthName').textContent = formatMonthLabel(window.appState.selectedMonth || '');
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

function buildCustomerCardHtml(customer, index) {
  const name = customer.Ten_khach_hang || customer['Ten_khach_hang'] || 'Khách hàng';
  const soHd = customer.so_hd || customer['so_hd'] || '---';
  const phone = customer.sdt || customer['sdt'] || '---';
  const rowIndex = getCustomerRowKey(customer) || Number(customer.rowIndex || customer['rowIndex'] || index + 2);
  const paidStr = customer.So_tien_thanh_toan ? Number(customer.So_tien_thanh_toan).toLocaleString() + ' VNĐ' : 'Chưa';
  const ngayQuaHan = customer.Ngay_qua_han !== undefined && customer.Ngay_qua_han !== '' ? customer.Ngay_qua_han : '---';
  const checkCount = Number(customer.So_lan_check) || (customer.Check_GPS === 'Đã Check GPS' || customer.Check_Ao === 'Đã Check Áo' ? 1 : 0);
  const checkGps = String(customer.Check_GPS || customer['Check_GPS'] || '').trim();
  const checkAo = String(customer.Check_Ao || customer['Check_Ao'] || '').trim();
  const nearestKm = getCustomerDistanceKm(customer);
  const apNearText = nearestKm !== null ? `📍 ${nearestKm.toFixed(1)} km` : '📍 Không có GPS';
  const currentMonth = window.appState.selectedMonth || document.getElementById('filterMonth')?.value || document.getElementById('gpsFilterMonth')?.value || 'Tất cả';
  const nearestApFilterValue = window.appState.apFilterEnabled ? (document.getElementById('gpsFilterAp')?.value || 'all') : 'all';
  const summaryAddress = [customer.WARD_HO_KHAU || customer['WARD_HO_KHAU'], customer.WARD_TAM_TRU || customer['WARD_TAM_TRU']].filter(Boolean).join(' • ') || 'Chưa có địa chỉ';
  const categoryBadges = getCustomerCategoryBadges(customer);
  const noteText = String(customer.Ghi_chu || customer['Ghi_chu'] || '').trim();
  const noteBadgeHtml = noteText ? `<div class="mt-1"><span class="badge bg-success-subtle text-success border border-success-subtle">📝 ${escapeHtml(noteText.length > 38 ? noteText.slice(0, 38) + '...' : noteText)}</span></div>` : '';
  let rowClass = '';
  if (checkAo.toLowerCase().indexOf('ao') !== -1 || checkAo.toLowerCase().indexOf('áo') !== -1) rowClass = 'row-check-ao';
  if (checkGps.toLowerCase().indexOf('gps') !== -1) rowClass = 'row-check-gps';
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
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <div class="fw-bold text-primary mb-0">${escapeHtml(name)}</div>
          </div>
          ${categoryBadges.length ? `<div class="customer-badges">${categoryBadges.map((badge) => `<span class="customer-badge ${badge.className}">${escapeHtml(badge.label)}</span>`).join('')}</div>` : ''}
          ${noteBadgeHtml}
          <div class="customer-address text-truncate">${escapeHtml(summaryAddress)}</div>
        </div>
        <div class="card-action-group">
          <button class="btn btn-sm btn-outline-primary card-action-btn" type="button" title="Check" onclick="toggleCardSection('${checkCollapseId}', ['${checkCollapseId}', '${infoCollapseId}', '${categoryCollapseId}', '${paymentCollapseId}'])"><span class="btn-label">✔ Check</span><span class="d-inline d-sm-none">✔</span></button>
          <button class="btn btn-sm btn-outline-success card-action-btn" type="button" title="Thanh toán" onclick="toggleCardSection('${paymentCollapseId}', ['${checkCollapseId}', '${infoCollapseId}', '${categoryCollapseId}', '${paymentCollapseId}'])"><span class="btn-label">💰 Thanh toán</span><span class="d-inline d-sm-none">💰</span></button>
          <button class="btn btn-sm btn-outline-warning card-action-btn" type="button" title="Phân loại" onclick="toggleCardSection('${categoryCollapseId}', ['${checkCollapseId}', '${infoCollapseId}', '${categoryCollapseId}', '${paymentCollapseId}'])"><span class="btn-label">🏷 Phân loại</span><span class="d-inline d-sm-none">🏷</span></button>
          <button class="btn btn-sm btn-outline-secondary card-action-btn" type="button" title="Thông tin" onclick="toggleCardSection('${infoCollapseId}', ['${checkCollapseId}', '${infoCollapseId}', '${categoryCollapseId}', '${paymentCollapseId}'])"><span class="btn-label">ℹ Thông tin</span><span class="d-inline d-sm-none">ℹ</span></button>
        </div>
      </div>

      <div class="collapse mt-3 pt-2 border-top d-none" id="${infoCollapseId}">
          <div class="d-flex justify-content-between align-items-start mb-2 gap-2">
            <div>
              <small class="text-muted">HĐ: <code>${escapeHtml(soHd)}</code></small>
              <button class="btn btn-sm btn-link p-0 ms-1" onclick="navigator.clipboard.writeText('${String(soHd).replace(/'/g, "\\'")}').then(() => showToast('Đã copy: ${String(soHd).replace(/'/g, "\\'")}', 'success'))">📋</button>
            </div>
          </div>

          <div class="row g-2 mb-2">
            <div class="col-12 text-secondary small">
              📞 SĐT: <b>${escapeHtml(phone)}</b> | Kỳ: <b>${escapeHtml(currentMonth)}</b><br>
              ⏰ Quá hạn: <b class="text-danger">${escapeHtml(ngayQuaHan)} ngày</b> | 📊 Lượt check: <b class="text-success">${checkCount} lần</b> | ${apNearText}
            </div>
          </div>

          <div class="d-flex justify-content-between align-items-center mt-2 mb-2">
            <span class="badge bg-light text-dark">${nearestKm !== null ? `${nearestKm.toFixed(1)} km` : 'Không có GPS'}</span>
          </div>

          <div class="sub-section mb-2 text-secondary small">
            <b>📍 Địa chỉ gốc:</b> ${escapeHtml(customer.WARD_HO_KHAU || '---')}<br>
            <div class="mt-1">
              <b class="text-dark">📍 Ấp New:</b> <span id="text_new_${rowIndex}">${escapeHtml(customer.WARD_HO_KHAU_AP_NEW || '---')}</span>
              <button class="btn btn-sm p-0 ms-1 text-primary" onclick="toggleEdit(${rowIndex}, 'apnew')">✏️</button>
              <div id="box_apnew_${rowIndex}" class="d-none mt-1">
                <div class="input-group input-group-sm">
                  <input type="text" id="input_apnew_${rowIndex}" class="form-control" value="${escapeHtml(customer.WARD_HO_KHAU_AP_NEW || '')}">
                  <button class="btn btn-success" onclick="saveInlineEdit(${rowIndex}, 'WARD_HO_KHAU_AP_NEW', 'input_apnew_${rowIndex}', 'apnew')">Lưu</button>
                  <button class="btn btn-secondary" onclick="toggleEdit(${rowIndex}, 'apnew')">Hủy</button>
                </div>
              </div>
            </div>
            <div class="mt-1">
              <b class="text-dark">📍 Ấp Old:</b> <span id="text_old_${rowIndex}">${escapeHtml(customer.WARD_HO_KHAU_AP_OLD || '---')}</span>
              <button class="btn btn-sm p-0 ms-1 text-primary" onclick="toggleEdit(${rowIndex}, 'apold')">✏️</button>
              <div id="box_apold_${rowIndex}" class="d-none mt-1">
                <div class="input-group input-group-sm">
                  <input type="text" id="input_apold_${rowIndex}" class="form-control" value="${escapeHtml(customer.WARD_HO_KHAU_AP_OLD || '')}">
                  <button class="btn btn-success" onclick="saveInlineEdit(${rowIndex}, 'WARD_HO_KHAU_AP_OLD', 'input_apold_${rowIndex}', 'apold')">Lưu</button>
                  <button class="btn btn-secondary" onclick="toggleEdit(${rowIndex}, 'apold')">Hủy</button>
                </div>
              </div>
            </div>
          </div>

          <div class="my-2 pt-2 border-top small">
            <div class="mb-1">
              <span class="fw-bold text-success">📝 Ghi chú:</span> <span id="text_note_${rowIndex}">${escapeHtml(customer.Ghi_chu || '---')}</span>
              <button class="btn btn-sm p-0 ms-1 text-primary" onclick="toggleEdit(${rowIndex}, 'note')">✏️</button>
              <div id="box_note_${rowIndex}" class="d-none mt-1">
                <div class="input-group input-group-sm">
                  <input type="text" id="input_note_${rowIndex}" class="form-control" value="${escapeHtml(customer.Ghi_chu || '')}">
                  <button class="btn btn-success" onclick="saveInlineEdit(${rowIndex}, 'Ghi_chu', 'input_note_${rowIndex}', 'note')">Lưu</button>
                  <button class="btn btn-secondary" onclick="toggleEdit(${rowIndex}, 'note')">Hủy</button>
                </div>
              </div>
            </div>

            <div class="mb-1">
              <span class="fw-bold text-danger">👤 Liên hệ:</span> <span id="text_contact_${rowIndex}">${escapeHtml(customer.Nguoi_lien_he || '---')}</span>
              <button class="btn btn-sm p-0 ms-1 text-primary" onclick="toggleEdit(${rowIndex}, 'contact')">✏️</button>
              <div id="box_contact_${rowIndex}" class="d-none mt-1">
                <div class="input-group input-group-sm">
                  <input type="text" id="input_contact_${rowIndex}" class="form-control" value="${escapeHtml(customer.Nguoi_lien_he || '')}">
                  <button class="btn btn-danger" onclick="saveInlineEdit(${rowIndex}, 'Nguoi_lien_he', 'input_contact_${rowIndex}', 'contact')">Lưu</button>
                  <button class="btn btn-secondary" onclick="toggleEdit(${rowIndex}, 'contact')">Hủy</button>
                </div>
              </div>
            </div>

          </div>

        </div>
      </div>

      <div class="collapse mt-2 d-none" id="${categoryCollapseId}">
        <div class="p-2 bg-light rounded border">
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
          <div class="small fw-bold text-success mb-2">💰 Thanh toán:</div>
          <div class="mb-2">
            <label class="small text-muted fw-bold mb-1">Số tiền đã thanh toán:</label>
            <input type="number" class="form-control form-control-sm" id="input_paid_${rowIndex}" value="${escapeHtml(customer.So_tien_thanh_toan || '')}">
          </div>
          <button class="btn btn-sm btn-success w-100" onclick="savePaidAmountInline(${rowIndex})">Lưu thanh toán</button>
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

function renderCards(data) {
  const container = document.getElementById('customerCardContainer');
  if (!container) return;

  if (!data || !data.length) {
    container.innerHTML = '<div class="text-center py-5 text-muted bg-white rounded shadow-sm">Không có dữ liệu phù hợp với bộ lọc.</div>';
    return;
  }

  container.innerHTML = data.map((customer, index) => buildCustomerCardHtml(customer, index)).join('');
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
    updateCustomerState(rowIndex, {
      Check_Ao: 'Đã Check Áo',
      Check_Time: new Date().toLocaleDateString('vi-VN')
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
      updateCustomerState(rowIndex, {
        Check_GPS: 'Đã Check GPS',
        Check_Time: new Date().toLocaleDateString('vi-VN'),
        GPS_Chinh: gps
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
    loadCustomerData();
  }
}

function closeNestedGpsDetailsForRow(rowIndex) {
  const details = document.getElementById(`gpsDetails_${rowIndex}`);
  const toggleButton = document.getElementById(`gpsToggle_${rowIndex}`);
  if (details) details.classList.add('d-none');
  if (toggleButton) toggleButton.classList.remove('d-none');
}

function toggleCardSection(activeId, allIds) {
  const ids = Array.isArray(allIds) ? allIds : [allIds];
  const rowMatch = activeId.match(/_(\d+)$/);
  const rowIndex = rowMatch ? rowMatch[1] : null;

  if (rowIndex) {
    closeNestedGpsDetailsForRow(rowIndex);
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
  if (box) box.classList.toggle('d-none');
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

function toggleGpsFilterMode() {
  const box = document.getElementById('gpsFilterControlBox');
  const button = document.getElementById('gpsFilterToggleBtn');
  window.appState.gpsFilterEnabled = !window.appState.gpsFilterEnabled;
  box.classList.toggle('d-none', !window.appState.gpsFilterEnabled);
  button.textContent = window.appState.gpsFilterEnabled ? '📍 Lọc GPS: BẬT' : '📍 Lọc GPS: TẮT';
  if (window.appState.gpsFilterEnabled) {
    locateCurrentPosition().then(() => filterData());
  }
  showToast(window.appState.gpsFilterEnabled ? 'Bộ lọc GPS đã bật.' : 'Bộ lọc GPS đã tắt.', 'info');
}

function toggleApFilterMode() {
  const button = document.getElementById('gpsFilterApToggleBtn');
  if (!button) return;

  window.appState.apFilterEnabled = !window.appState.apFilterEnabled;
  button.textContent = window.appState.apFilterEnabled ? '🏡 Tắt' : '🏡 Bật';
  button.classList.toggle('btn-warning', window.appState.apFilterEnabled);
  button.classList.toggle('btn-outline-warning', !window.appState.apFilterEnabled);

  filterData();
  showToast(window.appState.apFilterEnabled ? 'Đã bật lọc ấp: ấp gần nhất.' : 'Đã tắt lọc ấp.', 'info');
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
window.syncMonthAndReload = syncMonthAndReload;
window.filterData = filterData;
window.updateFilterCount = updateFilterCount;
window.resetFilters = function () {
  document.getElementById('filterMonth').value = '';
  document.getElementById('filterCheck').value = '';
  document.getElementById('filterGpsType').value = 'all';
  document.getElementById('filterThanhToan').value = '';
  document.getElementById('filterTrangThaiHd').value = '';
  document.getElementById('filterTimNha').value = '';
  document.getElementById('filterDoKho').value = '';
  document.getElementById('filterThuongTru').value = '';
  document.getElementById('searchKeyword').value = '';
  document.getElementById('gpsFilterMonth').value = '';
  document.getElementById('gpsFilterCheckState').value = 'ChuaCheck';
  document.getElementById('gpsFilterType').value = 'all';
  window.appState.selectedMonth = '';
  filterData();
  showToast('Đã đặt lại bộ lọc.', 'secondary');
};
