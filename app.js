/* StackTrack v2 — suivi de stack Bitcoin (sats / ₿ uniquement, données locales) */
(function () {
  'use strict';

  // ---------- Constantes ----------
  var STORE_KEY = 'stacktrack.v2';
  var NET_KEY = 'stacktrack.net';
  var LEGACY_KEY = 'transactions'; // clé de l'ancienne version (montants en ₿)
  var POPULATION = 8200000000;
  var MAX_BTC = 21000000;
  var MAX_SATS = 2100000000000000;
  var FAIR_SATS = MAX_SATS / POPULATION; // ≈ 256 098 sats
  var HALVING = 210000;
  var TYPES = ['DCA', 'Ponctuel', 'Reçu'];
  var TYPE_LABEL = { 'DCA': 'DCA', 'Ponctuel': 'Achat ponctuel', 'Reçu': 'Reçu', 'Retrait': 'Retrait' };
  var PERIODS = [['1M', 1], ['3M', 3], ['6M', 6], ['1A', 12], ['Tout', 0]];
  var NBSP = ' ';
  var API = 'https://mempool.space/api';

  // Repères connus [hauteur, horodatage ms] pour estimer bloc <-> date
  var ANCHORS = [
    [0, Date.UTC(2009, 0, 3, 18, 15, 5)],
    [210000, Date.UTC(2012, 10, 28, 15, 24, 38)],
    [420000, Date.UTC(2016, 6, 9, 16, 46, 13)],
    [630000, Date.UTC(2020, 4, 11, 19, 23, 43)],
    [840000, Date.UTC(2024, 3, 20, 0, 9, 27)]
  ];
  var ERA_YEARS = { 1: '2009 → 2012', 2: '2012 → 2016', 3: '2016 → 2020', 4: '2020 → 2024', 5: '2024 → 2028', 6: '2028 → 2032', 7: '2032 → 2036' };

  // ---------- Stockage ----------
  var state = { entries: [], prefs: { unit: 'sats', period: '1A' } };
  var net = readJSON(NET_KEY) || null;

  function readJSON(key) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ version: 2, entries: state.entries, prefs: state.prefs }));
    } catch (e) { toast('Impossible d’enregistrer sur cet appareil'); }
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function guessType(note) {
    return /re[çc]u|cadeau|gift|don\b|paiement|salaire/i.test(note || '') ? 'Reçu' : 'DCA';
  }

  // Accepte une entrée de l'ancienne version ({amount en ₿, blockHeight, description, type add/remove})
  // ou de la nouvelle ({sats, block, note, type}).
  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var sats;
    if (raw.sats != null && isFinite(Number(raw.sats))) sats = Math.round(Number(raw.sats));
    else if (raw.amount != null && isFinite(Number(raw.amount))) sats = Math.round(Number(raw.amount) * 1e8);
    else return null;
    var isOut = raw.type === 'remove' || raw.type === 'Retrait' || sats < 0;
    sats = isOut ? -Math.abs(sats) : Math.abs(sats);
    if (!sats) return null;
    var note = String(raw.note != null ? raw.note : (raw.description || '')).slice(0, 200);
    var type = isOut ? 'Retrait' : (TYPES.indexOf(raw.type) >= 0 ? raw.type : (raw.type === 'Achat ponctuel' ? 'Ponctuel' : guessType(note)));
    var date = String(raw.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(parseD(date))) {
      var d = new Date(raw.date);
      if (isNaN(d)) return null;
      date = toISO(d);
    }
    var block = raw.block != null ? raw.block : raw.blockHeight;
    block = block === '' || block == null ? null : parseInt(block, 10);
    if (!isFinite(block) || block < 0) block = null;
    return { id: String(raw.id != null ? raw.id : uid()), sats: sats, type: type, date: date, block: block, note: note };
  }

  function normalizeList(list) {
    var out = [], seen = {};
    (list || []).forEach(function (r) {
      var e = normalize(r);
      if (!e) return;
      if (seen[e.id]) e.id = uid();
      seen[e.id] = 1;
      out.push(e);
    });
    return out;
  }

  function load() {
    var data = readJSON(STORE_KEY);
    if (data && Array.isArray(data.entries)) {
      state.entries = normalizeList(data.entries);
      if (data.prefs) {
        if (data.prefs.unit === 'btc' || data.prefs.unit === 'sats') state.prefs.unit = data.prefs.unit;
        if (PERIODS.some(function (p) { return p[0] === data.prefs.period; })) state.prefs.period = data.prefs.period;
      }
      return;
    }
    // Première ouverture de la v2 : reprise automatique des données de l'ancienne version.
    var legacy = readJSON(LEGACY_KEY);
    if (Array.isArray(legacy) && legacy.length) {
      state.entries = normalizeList(legacy);
      save();
      setTimeout(function () { toast(state.entries.length + ' opérations reprises de l’ancienne version'); }, 600);
    }
  }

  // ---------- Formats ----------
  function grp(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP); }
  function fmtInt(n) { return (n < 0 ? '−' : '') + grp(String(Math.round(Math.abs(n)))); }
  function fmtBTC(sats) {
    var a = Math.abs(Math.round(sats));
    var ip = Math.floor(a / 1e8);
    var fp = String(a % 1e8).padStart(8, '0').replace(/0+$/, '');
    return (sats < 0 ? '−' : '') + grp(String(ip)) + (fp ? ',' + fp : '');
  }
  function isSats() { return state.prefs.unit === 'sats'; }
  function fmtU(sats) { return isSats() ? fmtInt(sats) : fmtBTC(sats); }
  function unitL() { return isSats() ? 'sats' : '₿'; }
  function signed(sats, f) { return (sats >= 0 ? '+' : '') + (f || fmtU)(sats); }
  var nfCache = {};
  function nf(x, max, min) {
    var k = max + '-' + (min || 0);
    if (!nfCache[k]) nfCache[k] = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: max, minimumFractionDigits: min || 0 });
    return nfCache[k].format(x).replace(/ /g, NBSP);
  }
  function abbr(n) {
    if (!isFinite(n)) return '∞';
    if (n >= 1e9) return nf(n / 1e9, 1) + NBSP + 'Md';
    if (n >= 1e6) return nf(n / 1e6, 1) + NBSP + 'M';
    return fmtInt(n);
  }
  function pct(x, d) { return nf(x, d == null ? 1 : d) + NBSP + '%'; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function parseD(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function toISO(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function todayISO() { return toISO(new Date()); }
  function fmtDay(s, withYear) {
    var d = typeof s === 'string' ? parseD(s) : s;
    var o = { day: 'numeric', month: 'short' };
    if (withYear || d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
    return d.toLocaleDateString('fr-FR', o);
  }
  function fmtMonth(d, short) {
    var s = d.toLocaleDateString('fr-FR', short ? { month: 'short', year: 'numeric' } : { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ---------- Calculs ----------
  function sorted() {
    return state.entries.map(function (e, i) { return [e, i]; }).sort(function (a, b) {
      return a[0].date < b[0].date ? -1 : a[0].date > b[0].date ? 1 : a[1] - b[1];
    }).map(function (x) { return x[0]; });
  }
  function totalSats() { return state.entries.reduce(function (s, e) { return s + e.sats; }, 0); }
  function monthNet() {
    var m = todayISO().slice(0, 7);
    return state.entries.reduce(function (s, e) { return e.date.slice(0, 7) === m ? s + e.sats : s; }, 0);
  }
  function isBuy(e) { return e.type === 'DCA' || e.type === 'Ponctuel'; }

  function dcaStreak() {
    var months = {};
    state.entries.forEach(function (e) { if (e.type === 'DCA') months[e.date.slice(0, 7)] = 1; });
    var d = new Date(); d.setDate(1);
    var key = function () { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
    if (!months[key()]) d.setMonth(d.getMonth() - 1); // le mois en cours n'est pas encore « raté »
    var n = 0;
    while (months[key()]) { n++; d.setMonth(d.getMonth() - 1); }
    return n;
  }

  function anchorsNow() {
    var a = ANCHORS.slice();
    var tip = netTip();
    if (tip.height > 840000) a.push([tip.height, tip.at]);
    return a;
  }
  function estimateBlock(ms) {
    var a = anchorsNow();
    for (var i = 1; i < a.length; i++) {
      if (ms <= a[i][1] || i === a.length - 1) {
        var p = a[i - 1], q = a[i];
        var rate = (q[0] - p[0]) / (q[1] - p[1]);
        return Math.max(0, Math.round(p[0] + (ms - p[1]) * rate));
      }
    }
    return 0;
  }
  function blockForDate(iso) {
    var d = parseD(iso);
    d.setHours(12, 0, 0, 0);
    return Math.min(estimateBlock(Math.min(d.getTime(), Date.now())), netTip().height);
  }
  function eraOf(block) { return Math.floor(block / HALVING) + 1; }
  function rewardSats(era) { return Math.floor(5e9 / Math.pow(2, era - 1)); }
  function supplyAt(h) {
    var total = 0, era = 1, remaining = h + 1;
    while (remaining > 0 && era < 64) {
      var b = Math.min(remaining, HALVING);
      total += b * rewardSats(era);
      remaining -= b; era++;
    }
    return total;
  }
  function netTip() {
    var avg = (net && net.timeAvg) || 600000;
    if (net && net.height) {
      var h = net.height + Math.floor(Math.max(0, Date.now() - net.at) / avg);
      return { height: h, at: Date.now(), live: Date.now() - net.at < 5 * 60000, avg: avg };
    }
    var last = ANCHORS[ANCHORS.length - 1];
    return { height: Math.round(last[0] + (Date.now() - last[1]) / 600000), at: Date.now(), live: false, avg: 600000 };
  }

  function eraBreakdown() {
    var map = {};
    state.entries.forEach(function (e) {
      var est = e.block == null;
      var era = eraOf(est ? blockForDate(e.date) : e.block);
      var m = map[era] || (map[era] = { era: era, sats: 0, count: 0, est: 0 });
      m.sats += e.sats; m.count++; if (est) m.est++;
    });
    return map;
  }

  function seriesFor(period) {
    var es = sorted();
    if (!es.length) return null;
    var now = new Date(); now.setHours(23, 59, 59, 0);
    var months = PERIODS.filter(function (p) { return p[0] === period; })[0][1];
    var start;
    if (months) { start = new Date(); start.setHours(0, 0, 0, 0); start.setMonth(start.getMonth() - months); }
    else { start = parseD(es[0].date); if (start >= now) start = new Date(now.getTime() - 86400000); }
    var v = 0, pts = [], i = 0;
    for (; i < es.length && parseD(es[i].date) < start; i++) v += es[i].sats;
    var v0 = v;
    pts.push([start.getTime(), v]);
    for (; i < es.length; i++) {
      var t = parseD(es[i].date).getTime();
      if (t > now.getTime()) break;
      pts.push([t, v]); v += es[i].sats; pts.push([t, v]);
    }
    pts.push([now.getTime(), v]);
    return { start: start.getTime(), end: now.getTime(), v0: v0, v1: v, pts: pts };
  }

  // ---------- Réseau ----------
  function fetchJSON(url, ms) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 8000);
    return fetch(url, ctrl ? { signal: ctrl.signal, cache: 'no-store' } : { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .finally(function () { clearTimeout(timer); });
  }
  var netLoading = null;
  function refreshNet() {
    if (netLoading) return netLoading;
    netLoading = Promise.all([
      fetchJSON(API + '/blocks/tip/height'),
      fetchJSON(API + '/v1/difficulty-adjustment').catch(function () { return null; }),
      fetchJSON(API + '/v1/fees/recommended').catch(function () { return null; })
    ]).then(function (r) {
      net = { height: Number(r[0]), at: Date.now(), diff: r[1], fees: r[2], timeAvg: r[1] && r[1].timeAvg ? r[1].timeAvg : 600000 };
      try { localStorage.setItem(NET_KEY, JSON.stringify(net)); } catch (e) { /* ignore */ }
      return net;
    }).finally(function () { netLoading = null; });
    return netLoading;
  }
  function blockAtDateExact(iso) {
    var d = parseD(iso); d.setHours(12, 0, 0, 0);
    var ts = Math.floor(Math.min(d.getTime(), Date.now()) / 1000);
    return fetchJSON(API + '/v1/mining/blocks/timestamp/' + ts, 6000).then(function (r) { return Number(r.height); });
  }

  // ---------- UI de base ----------
  var view = document.getElementById('view');
  var tabbar = document.getElementById('tabbar');
  var toastEl = document.getElementById('toast');
  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  var HALOS = {
    stack: [{ w: 340, left: -120, top: 120, c: '#f7931a', o: 0.22 }, { w: 260, right: -110, top: 470, c: '#ff6a00', o: 0.16 }],
    historique: [{ w: 320, left: -130, top: 40, c: '#f7931a', o: 0.2 }, { w: 280, right: -120, top: 560, c: '#ff6a00', o: 0.15 }],
    rarete: [{ w: 360, right: -140, top: 60, c: '#f7931a', o: 0.22 }, { w: 240, left: -100, top: 520, c: '#ff6a00', o: 0.14 }],
    reseau: [{ w: 340, right: -120, top: 150, c: '#f7931a', o: 0.2 }, { w: 260, left: -110, top: 540, c: '#ff6a00', o: 0.15 }],
    ajout: [{ w: 380, center: true, top: 90, c: '#f7931a', o: 0.2, blur: 100 }, { w: 200, right: -100, top: 600, c: '#ff6a00', o: 0 }]
  };
  function setHalos(route) {
    (HALOS[route] || HALOS.stack).forEach(function (h, i) {
      var el = document.getElementById('halo' + (i + 1));
      el.style.cssText = 'width:' + h.w + 'px;height:' + h.w + 'px;top:' + h.top + 'px;background:' + h.c + ';opacity:' + h.o +
        ';filter:blur(' + (h.blur || 90) + 'px);' +
        (h.center ? 'left:50%;margin-left:' + (-h.w / 2) + 'px;' : h.left != null ? 'left:' + h.left + 'px;' : 'right:' + h.right + 'px;');
    });
  }

  var ICON = {
    close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>',
    check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>',
    down: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>',
    up: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>',
    trash: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>',
    plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    export: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"/></svg>',
    import: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"/></svg>',
    chevron: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>'
  };

  function unitToggle() {
    return '<div class="glass seg" role="group" aria-label="Unité">' +
      '<button data-unit="sats" aria-pressed="' + isSats() + '">sats</button>' +
      '<button data-unit="btc" aria-pressed="' + !isSats() + '">₿</button></div>';
  }
  function bindUnit(rerender) {
    view.querySelectorAll('[data-unit]').forEach(function (b) {
      b.onclick = function () { state.prefs.unit = b.dataset.unit; save(); rerender(); };
    });
  }

  // ---------- Écran : Stack ----------
  var scrub = null;
  function renderStack() {
    var total = totalSats();
    var month = monthNet();
    var btc = total / 1e8;
    var people = btc > 0 ? MAX_BTC / btc : Infinity;
    var multiple = total / FAIR_SATS;
    var es = sorted();
    var lastBuy = null;
    for (var i = es.length - 1; i >= 0; i--) { if (es[i].sats > 0) { lastBuy = es[i]; break; } }
    var streak = dcaStreak();

    var html = '' +
      '<div class="page-head"><div class="stack-col"><span class="eyebrow">Mon stack</span><span class="title">Stack</span></div>' + unitToggle() + '</div>' +

      '<div class="glass card big">' +
        '<div class="stack-col" style="gap:6px"><span style="font-size:13px;color:var(--muted)">Total accumulé</span>' +
          '<div class="total-row"><span class="mono total">' + fmtU(total) + '</span><span class="unit">' + unitL() + '</span></div>' +
          '<span class="mono" style="font-size:13px;color:' + (month >= 0 ? 'var(--orange)' : 'var(--muted-2)') + '">' + signed(month) + ' ' + unitL() + ' ce mois-ci</span>' +
        '</div>' +
        '<div class="delta-row" id="deltaRow"></div>' +
        '<div class="chart-wrap" id="chart"></div>' +
        '<div class="periods" role="group" aria-label="Période">' + PERIODS.map(function (p) {
          return '<button data-period="' + p[0] + '" aria-pressed="' + (state.prefs.period === p[0]) + '">' + p[0] + '</button>';
        }).join('') + '</div>' +
      '</div>' +

      '<div class="grid2">' +
        '<a href="#/rarete" class="glass card"><span class="k">Personnes pouvant avoir autant que toi</span>' +
          '<span class="mono v">' + abbr(people) + '</span><span class="sub">sur 21 M ₿ max</span></a>' +
        '<div class="glass card"><span class="k">Ta part équitable par humain</span>' +
          '<span class="mono v">×' + nf(multiple, multiple >= 100 ? 0 : 1) + '</span><span class="sub">' + fmtInt(FAIR_SATS) + ' sats / hab.</span></div>' +
      '</div>' +

      '<div class="glass row-split">' +
        '<div><span class="k">' + (lastBuy ? 'Dernière entrée · ' + fmtDay(lastBuy.date) : 'Dernière entrée') + '</span>' +
          '<span class="mono v17">' + (lastBuy ? signed(lastBuy.sats) + ' ' + unitL() : '—') + '</span></div>' +
        '<div><span class="k">Série DCA</span><span class="mono v17 acc">' + streak + ' mois</span></div>' +
      '</div>' +

      renderEras(total);

    view.innerHTML = html;
    bindUnit(renderStack);
    view.querySelectorAll('[data-period]').forEach(function (b) {
      b.onclick = function () { state.prefs.period = b.dataset.period; save(); renderStack(); };
    });
    drawChart();
  }

  function renderEras(total) {
    if (!state.entries.length) return '';
    var map = eraBreakdown();
    var eras = Object.keys(map).map(Number);
    var cur = eraOf(netTip().height);
    var minEra = Math.min.apply(null, eras);
    var maxEra = Math.max(cur, Math.max.apply(null, eras));
    var maxPos = 1;
    for (var e = minEra; e <= maxEra; e++) if (map[e] && map[e].sats > maxPos) maxPos = map[e].sats;
    var rows = '';
    for (e = maxEra; e >= minEra; e--) {
      var m = map[e] || { sats: 0, count: 0, est: 0 };
      var share = total > 0 ? m.sats / total * 100 : 0;
      var startB = (e - 1) * HALVING, endB = e * HALVING - 1;
      rows += '<div class="era-row">' +
        '<div class="era-top"><span class="era-name">' + (e === cur ? '<span class="dot"></span>' : '') + 'Ère ' + e +
          ' <span class="era-meta">' + (ERA_YEARS[e] || '') + '</span>' + (e === cur ? ' <span class="tag">Actuelle</span>' : '') + '</span>' +
          '<span class="mono" style="font-size:15px;font-weight:500;color:' + (m.sats > 0 ? 'var(--orange)' : 'var(--muted-2)') + '">' + (m.sats ? signed(m.sats) : '0') + '</span></div>' +
        '<div class="bar"><div style="width:' + Math.max(0, m.sats / maxPos * 100).toFixed(2) + '%"></div></div>' +
        '<div class="era-top"><span class="era-meta">Blocs ' + fmtInt(startB) + ' – ' + fmtInt(endB) + ' · ' + nf(rewardSats(e) / 1e8, 8) + ' ₿/bloc</span>' +
          '<span class="era-meta">' + m.count + ' entrée' + (m.count > 1 ? 's' : '') + (m.count ? ' · ' + pct(share) : '') + '</span></div>' +
        (m.est ? '<span class="era-meta" style="color:var(--faint)">' + m.est + ' sans bloc, ère déduite de la date</span>' : '') +
      '</div>';
    }
    return '<span class="section-label">Accumulation par ère (' + unitL() + ')</span>' +
      '<div class="glass card list" style="padding:4px 16px">' + rows + '</div>';
  }

  function setDeltaRow(s) {
    var row = document.getElementById('deltaRow');
    if (!row) return;
    if (scrub) {
      row.innerHTML = '<span class="muted">' + fmtDay(new Date(scrub.t), true) + '</span><span class="mono">' + fmtU(scrub.v) + ' ' + unitL() + '</span>';
      return;
    }
    if (!s) { row.innerHTML = ''; return; }
    var d = s.v1 - s.v0;
    var p = s.v0 > 0 ? d / s.v0 * 100 : null;
    var label = state.prefs.period === 'Tout' ? 'Depuis le début' : 'Sur ' + ({ '1M': '1 mois', '3M': '3 mois', '6M': '6 mois', '1A': '1 an' })[state.prefs.period];
    row.innerHTML = '<span class="muted">' + label + '</span><span class="mono ' + (d < 0 ? 'neg' : 'acc') + '">' + signed(d) + ' ' + unitL() +
      (p != null ? ' · ' + (p >= 0 ? '+' : '') + pct(p) : '') + '</span>';
  }

  function drawChart() {
    var wrap = document.getElementById('chart');
    if (!wrap) return;
    var s = seriesFor(state.prefs.period);
    setDeltaRow(s);
    if (!s) {
      wrap.innerHTML = '<div class="chart-empty">Ajoute ta première entrée avec le bouton + pour voir la courbe de ton stack.</div>';
      return;
    }
    var W = Math.max(200, wrap.clientWidth), H = 150, top = 14, bot = 4;
    var vals = s.pts.map(function (p) { return p[1]; });
    var hi = Math.max.apply(null, vals), lo = Math.min.apply(null, vals);
    if (state.prefs.period === 'Tout') lo = Math.min(0, lo);
    var range = hi - lo || Math.abs(hi) * 0.2 || 1;
    var y0 = lo === 0 ? 0 : lo - range * 0.15, y1 = hi + range * 0.04;
    if (lo >= 0 && y0 < 0) y0 = 0;
    var span = s.end - s.start || 1;
    var X = function (t) { return (t - s.start) / span * W; };
    var Y = function (v) { return top + (1 - (v - y0) / (y1 - y0 || 1)) * (H - top - bot); };
    var line = s.pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join(' ');
    var last = s.pts[s.pts.length - 1];
    var lx = X(last[0]), ly = Y(last[1]);
    wrap.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Évolution du stack">' +
      '<defs><linearGradient id="fillG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f7931a" stop-opacity="0.38"/><stop offset="100%" stop-color="#f7931a" stop-opacity="0"/></linearGradient></defs>' +
      '<line x1="0" y1="45" x2="' + W + '" y2="45" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3 5"/>' +
      '<line x1="0" y1="95" x2="' + W + '" y2="95" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3 5"/>' +
      '<path d="' + line + ' L' + W + ',' + H + ' L0,' + H + ' Z" fill="url(#fillG)"/>' +
      '<path d="' + line + '" fill="none" stroke="#f7931a" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" style="filter:drop-shadow(0 0 6px rgba(247,147,26,0.7))"/>' +
      '<g id="endDot"><circle cx="' + lx + '" cy="' + ly + '" r="9" fill="#f7931a" opacity="0.25"/><circle cx="' + lx + '" cy="' + ly + '" r="4.5" fill="#f7931a" stroke="#050505" stroke-width="2"/></g>' +
      '<g id="cursor" style="display:none"><line id="cLine" y1="0" y2="' + H + '" stroke="rgba(245,242,236,0.25)" stroke-dasharray="2 4"/><circle id="cDot" r="5" fill="#f7931a" stroke="#050505" stroke-width="2"/></g>' +
      '</svg>';

    var svg = wrap.querySelector('svg');
    var cursor = svg.querySelector('#cursor'), cLine = svg.querySelector('#cLine'), cDot = svg.querySelector('#cDot');
    function valueAt(t) {
      var v = s.pts[0][1];
      for (var i = 0; i < s.pts.length; i++) { if (s.pts[i][0] <= t) v = s.pts[i][1]; else break; }
      return v;
    }
    function move(ev) {
      var r = svg.getBoundingClientRect();
      var fx = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      var t = s.start + fx * span;
      var v = valueAt(t);
      scrub = { t: t, v: v };
      cursor.style.display = '';
      cLine.setAttribute('x1', fx * W); cLine.setAttribute('x2', fx * W);
      cDot.setAttribute('cx', fx * W); cDot.setAttribute('cy', Y(v));
      setDeltaRow(s);
    }
    function end() { scrub = null; cursor.style.display = 'none'; setDeltaRow(s); }
    svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointermove', function (ev) { if (ev.pointerType === 'mouse' || ev.buttons || ev.pressure) move(ev); });
    svg.addEventListener('pointerup', function (ev) { if (ev.pointerType !== 'mouse') end(); });
    svg.addEventListener('pointerleave', end);
    svg.addEventListener('pointercancel', end);
  }

  // ---------- Écran : Historique ----------
  function renderHistory() {
    var es = sorted().reverse();
    var buys = es.filter(isBuy);
    var others = es.length - buys.length;
    var avg = buys.length ? buys.reduce(function (s, e) { return s + e.sats; }, 0) / buys.length : 0;
    var big = buys.reduce(function (b, e) { return !b || e.sats > b.sats ? e : b; }, null);

    var html = '<div class="page-head"><div class="stack-col"><span class="eyebrow">' + buys.length + ' achat' + (buys.length > 1 ? 's' : '') +
      (others ? ' · ' + others + ' autre' + (others > 1 ? 's' : '') : '') + '</span><span class="title">Historique</span></div>' + unitToggle() + '</div>';

    if (!es.length) {
      html += '<div class="glass empty"><p>Aucune entrée pour l’instant.<br>Ajoute ton premier achat, ou importe une sauvegarde (.json).</p>' +
        '<div class="btn-row" style="width:100%"><a href="#/ajout" class="glass-orange pill-btn">' + ICON.plus + ' Ajouter</a>' +
        '<button class="glass pill-btn" data-backup="import">' + ICON.import + ' Importer</button></div></div>';
      view.innerHTML = html; bindUnit(renderHistory); bindBackup(); return;
    }

    html += '<div class="grid2">' +
      '<div class="glass card" style="border-radius:24px;padding:14px 16px;gap:6px"><span class="k">Moyenne / achat</span><span class="mono v20">' + (buys.length ? fmtU(avg) : '—') + '</span><span class="sub">' + unitL() + '</span></div>' +
      '<div class="glass card" style="border-radius:24px;padding:14px 16px;gap:6px"><span class="k">Plus gros achat</span><span class="mono v20">' + (big ? fmtU(big.sats) : '—') + '</span><span class="sub">' + unitL() + (big ? ' · ' + fmtMonth(parseD(big.date), true).toLowerCase() : '') + '</span></div>' +
      '</div>' +
      '<div class="btn-row"><button class="glass pill-btn" data-backup="export">' + ICON.export + ' Exporter .json</button>' +
        '<button class="glass pill-btn" data-backup="import">' + ICON.import + ' Importer .json</button></div>';

    var groups = [], cur = null;
    es.forEach(function (e) {
      var k = e.date.slice(0, 7);
      if (!cur || cur.k !== k) { cur = { k: k, items: [] }; groups.push(cur); }
      cur.items.push(e);
    });
    groups.forEach(function (g) {
      html += '<span class="section-label">' + fmtMonth(parseD(g.k + '-01')) + '</span><div class="glass card list">';
      g.items.forEach(function (e) {
        var ico = isBuy(e) ? '<span class="tx-ico btc">₿</span>' : '<span class="tx-ico grey">' + (e.type === 'Retrait' ? ICON.up : ICON.down) + '</span>';
        var title = e.type === 'DCA' ? 'Achat DCA' : TYPE_LABEL[e.type];
        var sub = [fmtDay(e.date)];
        if (e.block != null) sub.push('bloc ' + fmtInt(e.block));
        if (e.note) sub.push(esc(e.note));
        var color = isBuy(e) ? 'var(--orange)' : e.sats < 0 ? 'var(--muted-2)' : 'var(--text)';
        html += '<button class="tx" data-edit="' + esc(e.id) + '" aria-label="Modifier">' + ico +
          '<span class="tx-mid"><span class="tx-title">' + title + '</span><span class="tx-sub">' + sub.join(' · ') + '</span></span>' +
          '<span class="mono tx-amt" style="color:' + color + '">' + signed(e.sats) + '</span></button>';
      });
      html += '</div>';
    });
    view.innerHTML = html;
    bindUnit(renderHistory);
    bindBackup();
    view.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () { location.hash = '#/ajout/' + encodeURIComponent(b.dataset.edit); };
    });
  }

  // ---------- Écran : Rareté ----------
  function renderRarity() {
    var total = totalSats();
    var btc = total / 1e8;
    var head = '<div class="page-head end"><div class="stack-col"><span class="eyebrow">Limite 21' + NBSP + '000' + NBSP + '000 ₿</span><span class="title">Rareté</span></div>';
    if (total <= 0) {
      view.innerHTML = head + '</div><div class="glass empty"><p>Ajoute des sats à ton stack pour voir combien de personnes, au maximum, pourraient en détenir autant que toi.</p>' +
        '<a href="#/ajout" class="glass-orange pill-btn">' + ICON.plus + ' Ajouter</a></div>';
      return;
    }
    var people = MAX_BTC / btc;
    var share = people / POPULATION * 100;
    var ppb = btc / MAX_BTC * 1e9;
    var tiers = [
      { sats: 1e8, label: '1 ₿' },
      { sats: 1e7, label: '0,1 ₿' },
      { sats: 1e6, label: '0,01 ₿' },
      { sats: FAIR_SATS, label: fmtBTC(Math.round(FAIR_SATS / 1000) * 1000) + ' ₿', sub: fmtInt(FAIR_SATS) + ' sats · part par humain' }
    ];
    if (total > 1e8 * 10) tiers.unshift({ sats: 1e9, label: '10 ₿' });
    tiers.push({ sats: total, me: true });
    tiers.sort(function (a, b) { return b.sats - a.sats || (a.me ? -1 : 1); });

    var rows = '';
    var prevMe = false;
    tiers.forEach(function (t) {
      var n = MAX_SATS / t.sats;
      if (t.me) {
        rows += '<div class="tier me"><span style="display:flex;align-items:center;gap:8px"><span class="dot"></span><span class="mono">Toi · ' + fmtBTC(total) + ' ₿</span></span><span class="mono r">' + abbr(n) + '</span></div>';
      } else {
        rows += '<div class="tier' + (prevMe ? ' after-me' : '') + '">' +
          (t.sub ? '<span style="display:flex;flex-direction:column;gap:2px"><span class="mono">' + t.label + '</span><span style="font-size:11px;color:var(--muted)">' + t.sub + '</span></span>' : '<span class="mono">' + t.label + '</span>') +
          '<span class="mono r">' + abbr(n) + '</span></div>';
      }
      prevMe = !!t.me;
    });

    var supply = supplyAt(netTip().height);
    var peopleMined = supply / total;

    view.innerHTML = head + '<span class="glass mono badge">' + nf(ppb, ppb < 10 ? 3 : 1) + ' ppb de l’offre</span></div>' +
      '<div class="glass card big" style="padding:22px;gap:16px">' +
        '<div class="stack-col" style="gap:6px"><span style="font-size:14px;color:var(--muted);line-height:1.35">Au maximum, seules ces personnes peuvent détenir autant que toi</span>' +
          '<span class="mono hero-num">' + fmtInt(people) + '</span>' +
          '<span class="mono" style="font-size:12px;color:var(--muted)">21' + NBSP + '000' + NBSP + '000 ₿ ÷ ' + fmtBTC(total) + ' ₿</span></div>' +
        '<div class="stack-col" style="gap:8px"><div class="bar thick"><div style="width:' + Math.min(100, share).toFixed(2) + '%"></div></div>' +
          '<div style="display:flex;justify-content:space-between;font-size:12px;gap:8px"><span><span class="mono acc">' + (share > 100 ? '> 100' + NBSP + '%' : pct(share, share < 1 ? 2 : 1)) + '</span> de l’humanité</span><span class="muted">≈ ' + abbr(POPULATION) + ' d’humains</span></div></div>' +
      '</div>' +
      '<div class="glass card" style="border-radius:28px;padding:16px 16px 8px 16px;gap:4px">' +
        '<div class="tier-head"><span>Palier</span><span>Personnes max.</span></div>' + rows +
      '</div>' +
      '<div class="grid2">' +
        '<div class="glass card"><span class="k">Avec les ₿ déjà émis</span><span class="mono v">' + abbr(peopleMined) + '</span><span class="sub">personnes max. aujourd’hui</span></div>' +
        '<div class="glass card"><span class="k">Ta part équitable par humain</span><span class="mono v">×' + nf(total / FAIR_SATS, total / FAIR_SATS >= 100 ? 0 : 1) + '</span><span class="sub">' + fmtInt(FAIR_SATS) + ' sats / hab.</span></div>' +
      '</div>';
  }

  // ---------- Écran : Réseau ----------
  var netTimer = null;
  function renderNetwork() {
    var tip = netTip();
    var h = tip.height;
    var era = eraOf(h);
    var supply = supplyAt(h);
    var minedPct = supply / MAX_SATS * 100;
    var next = era * HALVING;
    var left = next - h;
    var eraProg = (h % HALVING) / HALVING * 100;
    // sur le long terme la difficulté ramène le rythme à ~10 min / bloc
    var halvingDate = new Date(Date.now() + left * 600000);
    var days = Math.round(left * 600000 / 86400000);
    var d = net && net.diff, f = net && net.fees;

    var html = '<div class="page-head end"><div class="stack-col"><span class="eyebrow">Bitcoin</span><span class="title">Réseau</span></div>' +
      '<span class="glass live" id="liveBadge"><span class="dot' + (tip.live ? '' : ' off') + '"></span>' + (tip.live ? 'En direct' : (net ? 'Hors ligne · estimé' : 'Estimation')) + '</span></div>' +

      '<div class="glass card big" style="padding:22px;gap:14px">' +
        '<div class="stack-col" style="gap:6px"><span style="font-size:13px;color:var(--muted)">Hauteur du bloc actuel</span>' +
          '<span class="mono hero-num">' + fmtInt(h) + '</span>' +
          '<span class="mono" style="font-size:12px;color:var(--muted)">Ère ' + era + ' · récompense ' + nf(rewardSats(era) / 1e8, 8) + ' ₿ / bloc</span></div>' +
      '</div>' +

      '<div class="glass card big" style="padding:22px;gap:14px">' +
        '<div class="stack-col" style="gap:6px"><span style="font-size:13px;color:var(--muted)">Prochain halving dans</span>' +
          '<div class="total-row"><span class="mono total">' + fmtInt(left) + '</span><span class="unit">blocs</span></div>' +
          '<span class="mono" style="font-size:13px;color:var(--orange)">≈ ' + fmtInt(days) + ' jours · ' + fmtDay(halvingDate, true) + '</span></div>' +
        '<div class="stack-col" style="gap:8px"><div class="bar thick"><div style="width:' + eraProg.toFixed(2) + '%"></div></div>' +
          '<div style="display:flex;justify-content:space-between;font-size:12px;gap:8px"><span><span class="mono acc">' + pct(eraProg) + '</span> de l’ère ' + era + '</span><span class="muted">Bloc ' + fmtInt(next) + ' → ' + nf(rewardSats(era + 1) / 1e8, 8) + ' ₿</span></div></div>' +
      '</div>' +

      '<div class="glass card big" style="padding:22px;gap:14px">' +
        '<div class="stack-col" style="gap:6px"><span style="font-size:13px;color:var(--muted)">Bitcoin émis</span>' +
          '<div class="total-row"><span class="mono" style="font-size:32px;font-weight:500;letter-spacing:-0.04em;line-height:1">' + fmtInt(Math.floor(supply / 1e8)) + '</span><span class="unit">₿</span></div>' +
          '<span class="mono" style="font-size:12px;color:var(--muted)">' + fmtBTC(supply) + ' ₿</span></div>' +
        '<div class="stack-col" style="gap:8px"><div class="bar thick"><div style="width:' + minedPct.toFixed(3) + '%"></div></div>' +
          '<div style="display:flex;justify-content:space-between;font-size:12px;gap:8px"><span><span class="mono acc">' + pct(minedPct, 2) + '</span> des 21 M</span><span class="muted">reste ' + fmtInt(Math.ceil((MAX_SATS - supply) / 1e8)) + ' ₿</span></div></div>' +
      '</div>' +

      '<div class="glass card list" style="padding:4px 18px">' +
        '<div class="kv"><span class="l">Temps moyen par bloc</span><span class="r mono">' + nf(tip.avg / 60000, 1) + ' min</span></div>' +
        (d ? '<div class="kv"><span class="l">Ajustement de difficulté</span><span class="r mono">' + (d.difficultyChange >= 0 ? '+' : '') + pct(d.difficultyChange, 2) + '<br><span class="muted" style="font-size:12px">dans ' + fmtInt(d.remainingBlocks) + ' blocs</span></span></div>' : '') +
        (f ? '<div class="kv"><span class="l">Frais (sat/vB)</span><span class="r mono">' + f.fastestFee + ' · ' + f.halfHourFee + ' · ' + f.hourFee + '<br><span class="muted" style="font-size:12px">rapide · 30 min · 1 h</span></span></div>' : '') +
        '<div class="kv"><span class="l">Blocs restants à miner</span><span class="r mono">≈ ' + abbr(Math.max(0, 6930000 - h)) + '</span></div>' +
      '</div>' +

      '<span class="section-label">Mes données</span>' +
      '<div class="glass card" style="gap:12px">' +
        '<p class="small-note">' + state.entries.length + ' entrée' + (state.entries.length > 1 ? 's' : '') + ' enregistrée' + (state.entries.length > 1 ? 's' : '') +
          ' uniquement sur cet appareil. Exporte une sauvegarde de temps en temps.</p>' +
        '<div class="btn-row"><button class="glass pill-btn" data-backup="export">' + ICON.export + ' Exporter .json</button><button class="glass pill-btn" data-backup="import">' + ICON.import + ' Importer .json</button></div>' +
        '<p class="small-note">L’import accepte les sauvegardes JSON de cette app et de l’ancienne version de StackTrack.</p>' +
        '<div class="btn-row"><a class="glass pill-btn" href="v1/" style="color:var(--muted-2)">Ancienne version</a><button class="glass pill-btn danger" id="btnReset">Tout effacer</button></div>' +
      '</div>' +
      '<p class="small-note" style="text-align:center">Données réseau : mempool.space</p>';

    view.innerHTML = html;
    bindBackup();
    document.getElementById('btnReset').onclick = function () {
      if (!state.entries.length) return toast('Rien à effacer');
      if (confirm('Effacer définitivement tes ' + state.entries.length + ' entrées de cet appareil ?\n\nPense à exporter une sauvegarde avant.') &&
          confirm('Dernière confirmation : tout effacer ?')) {
        state.entries = []; save(); toast('Données effacées'); renderNetwork();
      }
    };
  }

  function startNetPolling() {
    stopNetPolling();
    var tick = function () {
      refreshNet().then(function () { if (currentRoute() === 'reseau') renderNetwork(); })
        .catch(function () { var b = document.getElementById('liveBadge'); if (b) b.innerHTML = '<span class="dot off"></span>' + (net ? 'Hors ligne · estimé' : 'Estimation'); });
    };
    tick();
    netTimer = setInterval(tick, 60000);
  }
  function stopNetPolling() { if (netTimer) clearInterval(netTimer); netTimer = null; }

  // ---------- Export / import ----------
  function bindBackup() {
    view.querySelectorAll('[data-backup]').forEach(function (b) {
      b.onclick = b.dataset.backup === 'export'
        ? function () { if (!state.entries.length) return toast('Rien à exporter'); exportData(); }
        : function () { document.getElementById('importFile').click(); };
    });
  }
  function exportData() {
    var json = JSON.stringify({ app: 'StackTrack', version: 2, exportDate: new Date().toISOString(), entries: state.entries }, null, 2);
    var name = 'stacktrack-' + todayISO() + '.json';
    var file;
    try { file = new File([json], name, { type: 'application/json' }); } catch (e) { file = new Blob([json], { type: 'application/json' }); }
    var touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && file instanceof File && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Sauvegarde StackTrack' }).catch(function (e) { if (e && e.name !== 'AbortError') download(file, name); });
      return;
    }
    download(file, name);
  }
  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast('Sauvegarde exportée');
  }
  document.getElementById('importFile').addEventListener('change', function (ev) {
    var file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); } catch (e) { return toast('Fichier JSON invalide'); }
      var list = Array.isArray(data) ? data : (data && (data.entries || data.transactions)) || [];
      var entries = normalizeList(list);
      if (!entries.length) return toast('Aucune entrée trouvée dans ce fichier');
      var msg = state.entries.length
        ? 'Remplacer tes ' + state.entries.length + ' entrées actuelles par les ' + entries.length + ' entrées du fichier ?'
        : 'Importer ' + entries.length + ' entrées ?';
      if (!confirm(msg)) return;
      state.entries = entries;
      save();
      toast(entries.length + ' entrées importées');
      render();
    };
    reader.readAsText(file);
  });

  // ---------- Écran : Ajout / modification ----------
  function parseAmount(txt) {
    txt = String(txt || '').replace(/[\s  ]/g, '');
    if (!txt) return 0;
    if (/[.,]/.test(txt)) { // saisi en ₿
      var x = parseFloat(txt.replace(',', '.').replace(/[^\d.]/g, ''));
      return isFinite(x) ? Math.round(x * 1e8) : 0;
    }
    var n = parseInt(txt.replace(/\D/g, ''), 10);
    return isFinite(n) ? n : 0;
  }

  function renderAdd(editId) {
    var existing = editId ? state.entries.filter(function (e) { return e.id === editId; })[0] : null;
    if (editId && !existing) { location.replace('#/historique'); return; }
    var f = existing ? {
      mode: existing.sats < 0 ? 'remove' : 'add', type: existing.sats < 0 ? 'DCA' : existing.type, amount: Math.abs(existing.sats),
      date: existing.date, block: existing.block, blockTouched: existing.block != null, note: existing.note
    } : { mode: 'add', type: 'DCA', amount: 0, date: todayISO(), block: null, blockTouched: false, note: '' };

    view.classList.add('sheet');
    view.innerHTML = '' +
      '<div class="sheet-head"><a href="#" id="btnClose" aria-label="Fermer" class="glass icon-btn">' + ICON.close + '</a>' +
        '<span style="font-size:17px;font-weight:600" id="sheetTitle"></span><span style="width:44px"></span></div>' +
      '<div style="display:flex;justify-content:center"><div class="glass seg" role="group" aria-label="Sens">' +
        '<button data-mode="add">Ajouter</button><button data-mode="remove">Retirer</button></div></div>' +
      '<div class="amount-hero"><span style="font-size:13px;color:var(--muted)" id="amtLabel"></span>' +
        '<div style="display:flex;align-items:baseline;gap:8px"><span class="mono amount-big" id="amtBig"></span><span style="font-size:20px;font-weight:600;color:var(--orange)">sats</span></div>' +
        '<span class="mono" style="font-size:13px;color:var(--muted)" id="amtBtc"></span></div>' +
      '<div class="chips">' + [10000, 50000, 100000].map(function (v) { return '<button class="glass" data-add="' + v + '">+' + (v / 1000) + 'k</button>'; }).join('') +
        '<button class="glass" data-add="0">Effacer</button></div>' +
      '<div class="glass types" id="types">' + TYPES.map(function (t) { return '<button data-type="' + t + '">' + TYPE_LABEL[t] + '</button>'; }).join('') + '</div>' +
      '<div class="glass fields">' +
        '<div class="field"><label for="fAmount"><span>Sats</span><span class="muted">ou en ₿ avec une virgule</span></label>' +
          '<input id="fAmount" class="mono" type="text" inputmode="decimal" autocomplete="off" placeholder="0"></div>' +
        '<div class="field"><label for="fDate">Date</label><input id="fDate" type="date" required></div>' +
        '<div class="field"><label for="fBlock"><span>Bloc</span><span class="hint" id="blockHint"></span></label>' +
          '<input id="fBlock" class="mono" type="text" inputmode="numeric" autocomplete="off" placeholder="Hauteur du bloc"></div>' +
        '<div class="field"><label for="fNote">Note</label><input id="fNote" type="text" maxlength="200" placeholder="Plateforme, portefeuille…"></div>' +
      '</div>' +
      '<p class="err" id="err"></p>' +
      '<div class="sheet-foot">' + (existing ? '<button class="glass icon-btn danger" id="btnDelete" aria-label="Supprimer">' + ICON.trash + '</button>' : '') +
        '<button class="glass-orange primary" id="btnSave">' + ICON.check + '<span id="saveLabel"></span></button></div>';

    var $ = function (id) { return document.getElementById(id); };
    var amountIn = $('fAmount'), dateIn = $('fDate'), blockIn = $('fBlock'), noteIn = $('fNote');
    dateIn.value = f.date;
    noteIn.value = f.note || '';
    amountIn.value = f.amount ? fmtInt(f.amount) : '';
    blockIn.value = f.block != null ? fmtInt(f.block) : '';
    var blockReq = 0;

    function paint() {
      $('sheetTitle').textContent = existing ? 'Modifier' : (f.mode === 'add' ? 'Nouvel achat' : 'Nouveau retrait');
      $('amtLabel').textContent = f.mode === 'add' ? (f.type === 'Reçu' ? 'Montant reçu' : 'Montant acheté') : 'Montant retiré';
      $('amtBig').textContent = fmtInt(f.amount);
      $('amtBtc').textContent = fmtBTC(f.amount) + ' ₿';
      $('saveLabel').textContent = existing ? 'Enregistrer' : (f.mode === 'add' ? 'Ajouter au stack' : 'Retirer du stack');
      $('types').style.display = f.mode === 'add' ? '' : 'none';
      view.querySelectorAll('[data-mode]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.mode === f.mode)); });
      view.querySelectorAll('[data-type]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.type === f.type)); });
      var hint = '';
      if (f.block != null) hint = 'Ère ' + eraOf(f.block) + (f.blockAuto ? ' · ' + f.blockAuto : '');
      else if (f.date) hint = 'vide : ère ' + eraOf(blockForDate(f.date)) + ' d’après la date';
      $('blockHint').textContent = hint;
    }

    function autoBlock() {
      if (f.blockTouched || !f.date) return;
      f.block = blockForDate(f.date);
      f.blockAuto = 'estimé';
      blockIn.value = fmtInt(f.block);
      paint();
      var req = ++blockReq;
      blockAtDateExact(f.date).then(function (h) {
        if (req !== blockReq || f.blockTouched || !isFinite(h)) return;
        f.block = h; f.blockAuto = 'mempool.space';
        blockIn.value = fmtInt(h);
        paint();
      }).catch(function () { /* hors ligne : on garde l'estimation */ });
    }

    view.querySelectorAll('[data-mode]').forEach(function (b) { b.onclick = function () { f.mode = b.dataset.mode; paint(); }; });
    view.querySelectorAll('[data-type]').forEach(function (b) { b.onclick = function () { f.type = b.dataset.type; paint(); }; });
    view.querySelectorAll('[data-add]').forEach(function (b) {
      b.onclick = function () {
        var v = +b.dataset.add;
        f.amount = v ? f.amount + v : 0;
        amountIn.value = f.amount ? fmtInt(f.amount) : '';
        paint();
      };
    });
    amountIn.addEventListener('input', function () { f.amount = parseAmount(amountIn.value); paint(); });
    amountIn.addEventListener('blur', function () { amountIn.value = f.amount ? fmtInt(f.amount) : ''; });
    dateIn.addEventListener('change', function () { f.date = dateIn.value; autoBlock(); paint(); });
    blockIn.addEventListener('input', function () {
      var raw = blockIn.value.replace(/\D/g, '');
      f.blockTouched = true; f.blockAuto = null; blockReq++;
      f.block = raw ? parseInt(raw, 10) : null;
      paint();
    });
    blockIn.addEventListener('blur', function () { blockIn.value = f.block != null ? fmtInt(f.block) : ''; });
    noteIn.addEventListener('input', function () { f.note = noteIn.value; });

    $('btnClose').onclick = function (ev) { ev.preventDefault(); goBack(); };
    $('btnSave').onclick = function () {
      f.amount = parseAmount(amountIn.value);
      f.date = dateIn.value;
      var err = '';
      if (!f.amount || f.amount <= 0) err = 'Indique un montant en sats.';
      else if (f.amount > MAX_SATS) err = 'Montant trop grand.';
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) err = 'Indique une date.';
      if (err) { $('err').textContent = err; return; }
      var entry = {
        id: existing ? existing.id : uid(),
        sats: f.mode === 'remove' ? -f.amount : f.amount,
        type: f.mode === 'remove' ? 'Retrait' : f.type,
        date: f.date,
        block: f.block,
        note: (f.note || '').trim()
      };
      if (existing) {
        state.entries = state.entries.map(function (e) { return e.id === existing.id ? entry : e; });
      } else {
        state.entries.push(entry);
      }
      save();
      toast(existing ? 'Entrée modifiée' : (f.mode === 'add' ? signed(entry.sats, fmtInt) + ' sats ajoutés' : fmtInt(f.amount) + ' sats retirés'));
      location.hash = existing ? '#/historique' : '#/stack';
    };
    if (existing) {
      $('btnDelete').onclick = function () {
        if (!confirm('Supprimer cette entrée (' + signed(existing.sats, fmtInt) + ' sats, ' + fmtDay(existing.date, true) + ') ?')) return;
        state.entries = state.entries.filter(function (e) { return e.id !== existing.id; });
        save();
        toast('Entrée supprimée');
        location.hash = '#/historique';
      };
    }
    if (!existing) autoBlock();
    paint();
  }

  // ---------- Barre d'onglets Liquid Glass ----------
  // La sélection est une « goutte » : on peut la glisser au doigt d'un onglet à l'autre (elle grossit comme une loupe),
  // elle s'étire selon sa vitesse puis reprend sa forme, et s'aimante sur l'onglet au lâcher. Un simple toucher marche aussi.
  var TabBar = (function () {
    var bar = document.getElementById('tabs');
    var wrap = document.getElementById('pillWrap');
    var pill = document.getElementById('pill');
    var links = Array.prototype.slice.call(bar.querySelectorAll('[data-tab]'));
    var PAD = 8;
    var width = 0, seg = 0, pillW = 0;
    var x = 0, v = 0, target = 0, placed = false;
    var activeIdx = 0, hoverIdx = null;
    var drag = null, dragging = false, suppressClick = false;
    var raf = null, last = 0, lastDragX = 0, lastDragT = 0;

    function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
    function centerOf(i) { return PAD + seg * (i + 0.5); }
    function idxAt(px) { return clamp(Math.floor((px - PAD) / seg), 0, links.length - 1); }

    function measure() {
      width = bar.offsetWidth;
      seg = width ? (width - PAD * 2) / links.length : 0;
      pillW = Math.max(0, seg - 6);
      pill.parentNode.style.width = pillW + 'px';
      if (seg && !dragging) { target = centerOf(activeIdx); if (!placed) { x = target; v = 0; placed = true; } }
      paint();
      kick();
    }
    function paint() {
      var stretch = 1 + Math.min(Math.abs(v) / 2600, 0.3);
      wrap.style.left = (x - pillW / 2) + 'px';
      pill.style.transform = 'scale(' + stretch.toFixed(3) + ',' + (1 / Math.sqrt(stretch)).toFixed(3) + ')';
      var lit = dragging && hoverIdx !== null ? hoverIdx : activeIdx;
      links.forEach(function (a, i) { a.classList.toggle('lit', i === lit); });
    }
    // Ressort (raideur 360, amortissement 28, masse 0,9) — même réglage que Verdex
    function step(now) {
      raf = null;
      var dt = Math.min(0.032, (now - (last || now)) / 1000) || 0.016;
      last = now;
      if (dragging) {
        v *= 0.85; // la vitesse retombe si le doigt s'arrête
      } else {
        var a = (360 * (target - x) - 28 * v) / 0.9;
        v += a * dt; x += v * dt;
        if (Math.abs(target - x) < 0.3 && Math.abs(v) < 4) { x = target; v = 0; }
      }
      paint();
      if (dragging || x !== target || v !== 0) kick(); else last = 0;
    }
    function kick() { if (!raf) raf = requestAnimationFrame(step); }

    function light(cx, cy) {
      var r = bar.getBoundingClientRect();
      bar.style.setProperty('--lx', (cx - r.left) + 'px');
      bar.style.setProperty('--ly', (cy - r.top) + 'px');
    }
    function localX(cx) {
      var r = bar.getBoundingClientRect();
      return (cx - r.left) * (width / r.width); // corrige le léger agrandissement pendant l'appui
    }
    function tick() { if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { /* ignore */ } } }
    function go(i) {
      var route = links[i].dataset.tab;
      if (route === currentRoute()) window.scrollTo({ top: 0, behavior: 'smooth' });
      else location.hash = '#/' + route;
    }

    bar.addEventListener('pointerdown', function (e) {
      if (!seg) measure();
      if (!seg) return;
      drag = { startX: e.clientX, lastX: e.clientX, active: false };
      bar.classList.add('pressed');
      light(e.clientX, e.clientY);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    });
    function move(ev) {
      if (!drag) return;
      drag.lastX = ev.clientX;
      light(ev.clientX, ev.clientY);
      if (!drag.active && Math.abs(ev.clientX - drag.startX) > 6) {
        drag.active = true; dragging = true;
        wrap.classList.add('dragging');
        lastDragX = x; lastDragT = performance.now();
      }
      if (drag.active) {
        var nx = clamp(localX(ev.clientX), centerOf(0), centerOf(links.length - 1));
        var now = performance.now(), dt = Math.max(1, now - lastDragT) / 1000;
        v = v * 0.5 + ((nx - lastDragX) / dt) * 0.5;
        lastDragX = nx; lastDragT = now;
        x = nx;
        var i = idxAt(nx);
        if (hoverIdx !== null && hoverIdx !== i) tick();
        hoverIdx = i;
        kick();
      }
    }
    function end(ev) {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      bar.classList.remove('pressed');
      var d = drag; drag = null;
      if (d && d.active) {
        suppressClick = true;
        setTimeout(function () { suppressClick = false; }, 0);
        // pointercancel n'a pas de coordonnées fiables : on garde la dernière position du doigt
        var cx = ev.type === 'pointerup' ? ev.clientX : d.lastX;
        var i = idxAt(clamp(localX(cx), centerOf(0), centerOf(links.length - 1)));
        dragging = false; hoverIdx = null;
        wrap.classList.remove('dragging');
        activeIdx = i; target = centerOf(i);
        kick();
        go(i);
      }
    }
    links.forEach(function (a, i) {
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        if (suppressClick) return;
        go(i);
      });
      a.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
      a.setAttribute('draggable', 'false');
      a.addEventListener('dragstart', function (ev) { ev.preventDefault(); });
    });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(bar);
    window.addEventListener('resize', measure);

    return {
      setActive: function (route) {
        var i = links.findIndex(function (a) { return a.dataset.tab === route; });
        if (i < 0) return;
        activeIdx = i;
        if (!dragging) { target = centerOf(i); }
        if (!width) measure();
        kick();
      }
    };
  })();

  // ---------- Routage ----------
  var lastMainRoute = 'stack';
  function currentRoute() {
    var h = location.hash.replace(/^#\/?/, '');
    return h.split('/')[0] || 'stack';
  }
  function goBack() { location.hash = '#/' + lastMainRoute; }

  function render() {
    var parts = location.hash.replace(/^#\/?/, '').split('/');
    var route = parts[0] || 'stack';
    if (['stack', 'historique', 'rarete', 'reseau', 'ajout'].indexOf(route) < 0) route = 'stack';
    view.classList.remove('sheet');
    scrub = null;
    setHalos(route);
    tabbar.classList.toggle('hidden', route === 'ajout');
    tabbar.querySelectorAll('[data-tab]').forEach(function (a) {
      if (a.dataset.tab === route) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    TabBar.setActive(route);
    if (route !== 'reseau') stopNetPolling();
    if (route !== 'ajout') lastMainRoute = route;

    if (route === 'stack') renderStack();
    else if (route === 'historique') renderHistory();
    else if (route === 'rarete') renderRarity();
    else if (route === 'reseau') { renderNetwork(); startNetPolling(); }
    else if (route === 'ajout') renderAdd(parts[1] ? decodeURIComponent(parts[1]) : null);
    window.scrollTo(0, 0);
  }

  var resizeT;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () { if (currentRoute() === 'stack') drawChart(); }, 120);
  });
  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      if (currentRoute() === 'reseau') startNetPolling();
      else refreshNet().catch(function () {});
    }
  });
  // Les autres onglets du navigateur restent synchronisés
  window.addEventListener('storage', function (ev) { if (ev.key === STORE_KEY) { load(); if (currentRoute() !== 'ajout') render(); } });

  load();
  render();
  refreshNet().then(function () { if (currentRoute() === 'stack') renderStack(); }).catch(function () {});

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
