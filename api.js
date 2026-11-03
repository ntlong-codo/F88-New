(function () {
  window.F88_PASSWORD = '124985';
  window.F88_API_URL = window.F88_API_URL || 'https://script.google.com/macros/s/AKfycbyCXcEvpmsa_-AzCpddOrfQXovj-Bc3bg7IMMop3dcRr2zORx3pbMIs--v_XkwjRrl4/exec';

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
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        ...(options || {})
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error('API request failed: ' + response.status + ' - ' + text);
      }

      return response.json();
    },

    async post(action, payload) {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload })
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error('POST failed: ' + response.status + ' - ' + text);
      }

      return response.json();
    }
  };
})();
