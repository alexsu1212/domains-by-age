// Service worker: whois lookups (no page CORS/CSP in the way), a cache shared
// across every site, and opening domains in new tabs.

const API = 'https://whois.freeaiapi.xyz/';
const TTL_OK = 180 * 24 * 3600 * 1000;
const TTL_FAIL = 10 * 60 * 1000;

chrome.action.onClicked.addListener((tab) => {
  chrome.scripting
    .executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
    .catch((e) => console.warn('[dba] cannot run on this page', e));
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'whois') {
    whois(msg).then((ym) => sendResponse({ ym }));
    return true;
  }
  if (msg.type === 'open') {
    chrome.tabs.create({ url: msg.url, active: false, openerTabId: sender.tab && sender.tab.id });
  }
});

async function whois({ key, name, suffix }) {
  const ck = 'w:' + key;
  const hit = (await chrome.storage.local.get(ck))[ck];
  if (hit && Date.now() - hit.t < (hit.v ? TTL_OK : TTL_FAIL)) {
    return hit.v;
  }
  let ym = null;
  try {
    const url = API + '?name=' + encodeURIComponent(name) + '&suffix=' + encodeURIComponent(suffix) + '&c=1';
    const data = await (await fetch(url)).json();
    ym = data && data.status === 'ok' ? toYM(data.creation_datetime) : null;
  } catch (e) {
    console.warn('[dba] query failed', key, e);
  }
  await chrome.storage.local.set({ [ck]: { v: ym, t: Date.now() } });
  return ym;
}

function toYM(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{4})[-/.]?(\d{2})/);
  if (m) return m[1] + '.' + m[2];
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  if (y < 1985 || y > 2100) return null;
  return y + '.' + String(d.getUTCMonth() + 1).padStart(2, '0');
}
