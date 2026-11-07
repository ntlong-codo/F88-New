(function () {
  window.F88_PASSWORD = '124985';
  window.F88_API_URL = window.F88_API_URL || 'https://script.google.com/macros/s/AKfycbzYajvrU_8f3Wkrwqj-ZX24O9p_VvYFyN6tzZbpt-s8sSCBJb4ZI5eMYq5l8vzyM8_-/exec';

  function ensureUrl(value) {
    if (!value || typeof value !== 'string') {
      return window.F88_API_URL;
    }
    return value;
  }

  window.F88_API = {
    baseUrl: ensureUrl(window.F88_API_URL),

    buildUrl(action, params) {
      const url = new URL(this.baseUrl);
      url.searchParams.set('action', action);

      const safeParams = params || {};
      Object.keys(safeParams).forEach((key) => {
        const value = safeParams[key];
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      });

      return url.toString();
    },

    async fetch(action, params, options) {
      const url = this.buildUrl(action, params || {});
      try {
        const response = await fetch(url, {
          method: 'GET',
          ...(options || {})
        });

        if (!response.ok) {
          const text = await response.text();
          if (typeof window.updateSyncStatusUi === 'function') {
            window.updateSyncStatusUi(false, 'API GET thất bại: ' + response.status);
          }
          throw new Error('API request failed: ' + response.status + ' - ' + text);
        }

        if (typeof window.updateSyncStatusUi === 'function') {
          window.updateSyncStatusUi(true, 'Kết nối sheet đang hoạt động.');
        }

        return response.json();
      } catch (error) {
        if (typeof window.updateSyncStatusUi === 'function') {
          window.updateSyncStatusUi(false, 'Mất kết nối sheet, đang dùng cache cũ.');
        }
        throw error;
      }
    },

    async post(action, payload) {
      try {
        const response = await fetch(this.baseUrl, {
          method: 'POST',
          body: JSON.stringify({ action, ...payload })
        });

        if (!response.ok) {
          const text = await response.text();
          if (typeof window.updateSyncStatusUi === 'function') {
            window.updateSyncStatusUi(false, 'API POST thất bại: ' + response.status);
          }
          throw new Error('POST failed: ' + response.status + ' - ' + text);
        }

        if (typeof window.updateSyncStatusUi === 'function') {
          window.updateSyncStatusUi(true, 'Đã lưu dữ liệu trực tiếp lên sheet.');
        }

        return response.json();
      } catch (error) {
        if (typeof window.updateSyncStatusUi === 'function') {
          window.updateSyncStatusUi(false, 'Mất kết nối khi lưu vào sheet.');
        }
        throw error;
      }
    }
  };
})();