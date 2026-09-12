// Injected on toolbar-icon click. Clicking again closes the panel; clicking
// once more rescans the page.
(() => {
  if (window.__dba) {
    window.__dba.toggle();
    return;
  }

  const SUFFIXES = ['com','box','net','org','me','xyz','im','info','io','co','ai','biz','us','app','sg','cafe','now','shop','life','cn','uk','chat','design','fun','website','link','site','online','cards','fr','sk','it','new','video','tw','jp','dev','tools','pro','vip','top','cc'];
  const MULTI = ['co.uk','org.uk','com.cn','net.cn','org.cn','gov.cn','edu.cn','co.jp','ne.jp','or.jp','com.tw','org.tw','com.hk','com.sg','com.au','co.nz','com.br','co.kr','co.in'];
  const CONCURRENCY = 5;
  const PATTERN = '\\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\\.)+(?:' + SUFFIXES.join('|') + ')\\b';

  const PAGE_CSS = '.dba-date{color:#2e7d32;font-weight:700;background:#e8f5e8;padding:1px 3px;border-radius:2px;font-size:.9em;margin-right:2px}.dba-flash{outline:2px solid #ff9800;outline-offset:2px}';

  const PANEL_CSS = `
    .panel{position:fixed;top:12px;right:12px;width:380px;max-height:88vh;display:flex;flex-direction:column;background:#1e1e1e;color:#f5f5f5;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.4);z-index:2147483647;overflow:hidden}
    .head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px 8px;font-weight:700;font-size:15px}
    .close{all:unset;cursor:pointer;font-size:20px;line-height:1;opacity:.7;padding:0 4px}
    .close:hover{opacity:1}
    .status{padding:0 14px 8px;color:#ffca28;font-size:12px}
    .list{overflow-y:auto;padding:0 6px 10px}
    .row{display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:4px;cursor:pointer}
    .row:hover{background:#2e2e2e}
    .name{flex:1 1 auto;min-width:0;color:#9ecbff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .date{flex:0 0 auto;color:#e0e0e0;font-variant-numeric:tabular-nums}
    .date.none{color:#777}
    .btn{all:unset;flex:0 0 auto;box-sizing:border-box;min-width:40px;text-align:center;padding:1px 7px;border:1px solid #444;border-radius:4px;background:#2a2a2a;color:#ccc;font-size:11px;line-height:18px;cursor:pointer}
    .btn:hover{background:#3a3a3a;color:#fff;border-color:#666}
    .btn.ok{color:#81c784;border-color:#81c784}
  `;

  let run = null; // the active scan: { host, cancelled }

  function registrable(domain) {
    const parts = domain.split('.');
    if (parts.length < 2) return null;
    const last2 = parts.slice(-2).join('.');
    if (parts.length >= 3 && MULTI.includes(last2)) {
      return { key: parts.slice(-3).join('.'), name: parts[parts.length - 3], suffix: last2 };
    }
    return { key: last2, name: parts[parts.length - 2], suffix: parts[parts.length - 1] };
  }

  async function lookup(p) {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'whois', ...p });
      return res ? res.ym : null;
    } catch (e) {
      return null;
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // http pages or unfocused documents: fall back to execCommand
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  // "name@outlook.com" is a mailbox, not a site worth checking.
  function isEmail(text, index) {
    return index > 0 && text[index - 1] === '@';
  }

  function collect() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    const re = new RegExp(PATTERN, 'gi');
    const textNodes = [];
    const domains = [];
    const seen = new Set();
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentNode;
      const tag = parent && parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'NOSCRIPT') continue;
      if (parent && parent.closest && parent.closest('[contenteditable="true"]')) continue;
      const text = node.textContent;
      re.lastIndex = 0;
      let m, hasHit = false;
      while ((m = re.exec(text))) {
        if (isEmail(text, m.index)) continue;
        hasHit = true;
        const d = m[0].toLowerCase();
        if (!seen.has(d)) {
          seen.add(d);
          domains.push(d);
        }
      }
      if (hasHit) textNodes.push(node);
    }
    return { textNodes, domains };
  }

  // Insert "(YYYY.MM)" before each dated domain on the page.
  function decorate(textNodes, map, spanMap) {
    const re = new RegExp(PATTERN, 'gi');
    textNodes.forEach((node) => {
      if (!node.parentNode) return;
      const text = node.textContent;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0, m, changed = false;
      while ((m = re.exec(text))) {
        if (isEmail(text, m.index)) continue;
        const d = m[0].toLowerCase();
        const ym = map[d];
        if (!ym) continue;
        changed = true;
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const span = document.createElement('span');
        span.className = 'dba-date';
        span.textContent = '(' + ym + ')';
        frag.appendChild(span);
        frag.appendChild(document.createTextNode(m[0]));
        last = m.index + m[0].length;
        (spanMap[d] = spanMap[d] || []).push(span);
      }
      if (!changed) return;
      frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  }

  function makeButton(label, onClick) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = label;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(b);
    });
    return b;
  }

  function makeRow(item, spanMap) {
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.domain;
    name.title = item.domain;
    const date = document.createElement('span');
    date.className = 'date' + (item.ym ? '' : ' none');
    date.textContent = item.ym || '—';
    const open = makeButton('open', () => {
      chrome.runtime.sendMessage({ type: 'open', url: 'https://' + item.domain });
    });
    const copy = makeButton('copy', async (b) => {
      const ok = await copyText(item.domain);
      b.textContent = ok ? '✓' : '✗';
      b.classList.toggle('ok', ok);
      setTimeout(() => {
        b.textContent = 'copy';
        b.classList.remove('ok');
      }, 1200);
    });
    row.append(name, date, open, copy);
    // Clicking the row itself jumps to the domain's spot on the page.
    row.addEventListener('click', () => {
      const targets = spanMap[item.domain];
      if (!targets || !targets.length) return;
      const el = targets[0];
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('dba-flash');
      setTimeout(() => el.classList.remove('dba-flash'), 1600);
    });
    return row;
  }

  function byAge(a, b) {
    if (a.ym && b.ym) return a.ym < b.ym ? 1 : a.ym > b.ym ? -1 : a.domain.localeCompare(b.domain);
    if (a.ym) return -1;
    if (b.ym) return 1;
    return a.domain.localeCompare(b.domain);
  }

  function buildPanel(onClose) {
    const host = document.createElement('div');
    host.id = 'dba-host';
    host.style.cssText = 'all:initial';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' + PANEL_CSS + '</style>' +
      '<div class="panel"><div class="head"><span>Domains by Age</span>' +
      '<button class="close" title="Close">×</button></div>' +
      '<div class="status"></div><div class="list"></div></div>';
    root.querySelector('.close').addEventListener('click', onClose);
    return { host, status: root.querySelector('.status'), list: root.querySelector('.list') };
  }

  function close() {
    if (!run) return;
    run.cancelled = true;
    run.host.remove();
    run = null;
  }

  async function start() {
    // Drop dates left by a previous scan so they aren't doubled.
    document.querySelectorAll('.dba-date').forEach((s) => s.remove());

    const { textNodes, domains } = collect();

    const ui = buildPanel(close);
    const self = { host: ui.host, cancelled: false };
    run = self;
    document.body.appendChild(ui.host);

    if (!domains.length) {
      ui.status.textContent = '页面上没有找到域名';
      return;
    }

    if (!document.getElementById('dba-style')) {
      const style = document.createElement('style');
      style.id = 'dba-style';
      style.textContent = PAGE_CSS;
      document.head.appendChild(style);
    }

    const total = domains.length;
    const results = [];
    const rows = new Map();
    const spanMap = {};
    const map = {};
    let done = 0;
    let idx = 0;
    ui.status.textContent = '共 ' + total + ' 个域名，查询中…';

    // Rows are created once and re-ordered, so button feedback survives updates.
    const render = () => {
      results.sort(byAge);
      results.forEach((item) => {
        let row = rows.get(item.domain);
        if (!row) {
          row = makeRow(item, spanMap);
          rows.set(item.domain, row);
        }
        ui.list.appendChild(row);
      });
    };

    const worker = async () => {
      while (idx < total && !self.cancelled) {
        const domain = domains[idx++];
        const p = registrable(domain);
        const ym = p ? await lookup(p) : null;
        if (self.cancelled) return;
        if (ym) map[domain] = ym;
        results.push({ domain, ym });
        done++;
        ui.status.textContent = '已处理 ' + done + '/' + total;
        render();
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (self.cancelled) return;
    decorate(textNodes, map, spanMap);
    ui.status.textContent = 'Done! ' + total + ' domains total';
  }

  window.__dba = {
    toggle() {
      if (run) close();
      else start();
    },
  };
  start();
})();
