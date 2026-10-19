/** AzuraCast API access shared by the radio syncs. */
const BASE_URL = (process.env.AZURACAST_BASE_URL || 'https://radio1.avventomedia.org').replace(/\/$/, '');
const STATION = process.env.AZURACAST_STATION || 'avventoradio';

/** GET {BASE_URL}/api/station/{STATION}{path}; [auth] sends AZURACAST_APIKEY. */
async function azuracastGet(path, { auth = false } = {}) {
  const headers = {};
  if (auth) {
    const key = process.env.AZURACAST_APIKEY;
    if (!key) throw new Error('🚨 AZURACAST_APIKEY is missing');
    headers['X-API-Key'] = key.trim();
  }
  const res = await fetch(`${BASE_URL}/api/station/${STATION}${path}`, { headers });
  if (!res.ok) throw new Error(`AzuraCast ${path}: HTTP ${res.status}`);
  return res.json();
}

module.exports = { azuracastGet, BASE_URL, STATION };
