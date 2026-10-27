/* ==========================================================================
   CodeQuest — Insights
   Turns the raw contest feeds into answers a competitive programmer can act
   on. Everything is computed in the browser from live API data:
     - Codeforces' full finished-contest history (contest.list)
     - every upcoming contest across Codeforces, LeetCode and CodeChef
   Times are always shown in the viewer's own timezone.
   ========================================================================== */
(function () {
  const DAY = 86400000;
  const MAX_CLASH_DURATION = DAY; // ignore multi-day "long" contests for clashes
  const SITE = {
    codeforces: { label: 'Codeforces', color: 'var(--cf-color)' },
    leetcode: { label: 'LeetCode', color: 'var(--lc-color)' },
    codechef: { label: 'CodeChef', color: 'var(--cc-color)' },
  };
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const TYPES = ['Div 2', 'Div 3', 'Div 4', 'Educational', 'Div 1 + 2', 'Global', 'Div 1'];

  const $ = (id) => document.getElementById(id);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtDateTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const fmtMonth = new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' });
  const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const fmtHour = (h) => `${String(h).padStart(2, '0')}:00`;

  let latest = null;
  let rendered = false;

  /* ------------------------------------------------------------ helpers */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const mondayIndex = (d) => (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const median = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  function cfType(name) {
    const n = name.replace(/\s+/g, ' ');
    if (/Div\. ?1 ?\+ ?Div\. ?2/i.test(n)) return 'Div 1 + 2';
    if (/Educational/i.test(n)) return 'Educational';
    if (/Global Round/i.test(n)) return 'Global';
    if (/Div\. ?4/i.test(n)) return 'Div 4';
    if (/Div\. ?3/i.test(n)) return 'Div 3';
    if (/Div\. ?2/i.test(n)) return 'Div 2';
    if (/Div\. ?1/i.test(n)) return 'Div 1';
    return 'Other';
  }

  /* --------------------------------------------------------- analysis */
  function analyse({ upcoming, cfHistory }) {
    const now = Date.now();
    const yearAgo = now - 365 * DAY;

    // Regular rounds only (skip multi-day / unusual events) for timing stats.
    const history = cfHistory.filter((c) => c.durationMs <= 5 * 3600000);
    const last12 = history.filter((c) => c.startTime >= yearAgo);
    // Parallel Div 1 / Div 2 rounds share a start time — count each slot once.
    const slots12 = [...new Map(last12.map((c) => [c.startTime, c])).values()];

    // 1. Clashes in the next 14 days
    const horizon = now + 14 * DAY;
    const soon = upcoming
      .filter((c) => c.startTime < horizon && c.endTime > now && c.durationMs <= MAX_CLASH_DURATION)
      .sort((a, b) => a.startTime - b.startTime);
    const clashes = [];
    for (let i = 0; i < soon.length; i++) {
      for (let j = i + 1; j < soon.length; j++) {
        const a = soon[i], b = soon[j];
        if (b.startTime >= a.endTime) break;
        if (a.site === b.site && a.startTime === b.startTime) continue; // parallel divisions, same event
        if (a.name === b.name) continue; // same contest listed twice by a feed
        const overlap = Math.min(a.endTime, b.endTime) - b.startTime;
        if (overlap > 0) clashes.push({ a, b, overlapMin: Math.round(overlap / 60000) });
      }
    }
    // Parallel rounds (e.g. Div. 1 and Div. 2 at the same time) clashing with the
    // same contest are one decision for the user — merge them into one row.
    const merged = new Map();
    clashes.forEach((c) => {
      const key = [c.a, c.b].map((x) => `${x.site}@${x.startTime}`).sort().join('|');
      const prev = merged.get(key);
      if (!prev) { merged.set(key, { ...c, a: { ...c.a }, b: { ...c.b } }); return; }
      ['a', 'b'].forEach((side) => {
        const names = prev[side].name.split(' / ');
        if (!names.includes(c[side].name)) prev[side].name = [...names, c[side].name].join(' / ');
      });
      prev.overlapMin = Math.max(prev.overlapMin, c.overlapMin);
    });
    clashes.length = 0;
    clashes.push(...merged.values());

    // 2. Load over the next 14 days
    const today = startOfDay(now);
    const days = Array.from({ length: 14 }, (_, i) => ({ t: today + i * DAY, codeforces: 0, leetcode: 0, codechef: 0 }));
    upcoming.forEach((c) => {
      const idx = Math.floor((startOfDay(c.startTime) - today) / DAY);
      if (idx >= 0 && idx < 14 && days[idx][c.site] !== undefined) days[idx][c.site]++;
    });

    // 3. Heatmap (weekday x hour, local time)
    const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
    slots12.forEach((c) => { const d = new Date(c.startTime); heat[mondayIndex(d)][d.getHours()]++; });
    let peak = { d: 0, h: 0, n: 0 };
    heat.forEach((row, d) => row.forEach((n, h) => { if (n > peak.n) peak = { d, h, n }; }));
    const weekend = heat[5].reduce((a, b) => a + b, 0) + heat[6].reduce((a, b) => a + b, 0);
    const byHour = Array(24).fill(0);
    heat.forEach((row) => row.forEach((n, h) => (byHour[h] += n)));
    const eveningShare = pct(byHour.slice(17, 24).reduce((a, b) => a + b, 0), slots12.length);

    // 4. Monthly trend (36 months)
    const months = [];
    const cur = new Date(); cur.setDate(1); cur.setHours(0, 0, 0, 0);
    for (let i = 35; i >= 0; i--) {
      const d = new Date(cur); d.setMonth(cur.getMonth() - i);
      months.push({ t: d.getTime(), n: 0, partial: i === 0 });
    }
    const slotsAll = [...new Map(history.map((c) => [c.startTime, c])).values()];
    slotsAll.forEach((c) => {
      const d = new Date(c.startTime); d.setDate(1); d.setHours(0, 0, 0, 0);
      const m = months.find((x) => x.t === d.getTime());
      if (m) m.n++;
    });
    const prevYear = slotsAll.filter((c) => c.startTime >= now - 730 * DAY && c.startTime < yearAgo).length;
    const thisYear = slots12.length;
    const yoy = prevYear ? Math.round(((thisYear - prevYear) / prevYear) * 100) : null;

    // 5. Division mix + typical duration
    const mix = {};
    last12.forEach((c) => {
      const t = cfType(c.name);
      (mix[t] = mix[t] || { n: 0, dur: [] }).n++;
      mix[t].dur.push(c.durationMs);
    });
    const mixRows = Object.entries(mix)
      .map(([type, v]) => ({ type, n: v.n, share: pct(v.n, last12.length), med: median(v.dur) }))
      .sort((a, b) => b.n - a.n);

    // 6. Cadence forecast
    const cfUpcoming = upcoming.filter((c) => c.site === 'codeforces');
    const cadence = TYPES.map((type) => {
      const runs = last12.filter((c) => cfType(c.name) === type).map((c) => c.startTime).sort((a, b) => a - b);
      const uniq = [...new Set(runs)];
      if (uniq.length < 4) return null; // too few rounds to forecast honestly
      const gaps = uniq.slice(1).map((t, i) => (t - uniq[i]) / DAY);
      const gap = median(gaps);
      const last = uniq[uniq.length - 1];
      const scheduled = cfUpcoming.filter((c) => cfType(c.name) === type).sort((a, b) => a.startTime - b.startTime)[0];
      const expected = last + gap * DAY;
      return { type, count: uniq.length, gap, last, scheduled, expected, overdue: !scheduled && expected < now };
    }).filter(Boolean);

    const next7 = upcoming.filter((c) => c.startTime >= now && c.startTime < now + 7 * DAY).length;

    return {
      now, clashes, days, heat, peak, weekend, eveningShare, slots12, months, thisYear, prevYear, yoy,
      mixRows, last12, cadence, next7, upcomingCount: upcoming.length, historyCount: cfHistory.length,
    };
  }

  /* ---------------------------------------------------------- render */
  function renderKpis(a) {
    const avg = (a.thisYear / 12).toFixed(1);
    const yoyTxt = a.yoy === null ? '' : `<em class="${a.yoy >= 0 ? 'up' : 'down'}">${a.yoy >= 0 ? '▲' : '▼'} ${Math.abs(a.yoy)}% YoY</em>`;
    const peak = a.peak.n ? `${WEEKDAYS[a.peak.d]} ${fmtHour(a.peak.h)}` : '–';
    $('insKpis').innerHTML = [
      ['Clashes ahead', a.clashes.length, 'next 14 days'],
      ['Contests this week', a.next7, 'all platforms'],
      ['CF rounds / month', avg, yoyTxt || 'last 12 months'],
      ['Peak start slot', peak, 'your timezone'],
    ].map(([k, v, s]) => `<div class="kpi"><span>${k}</span><b>${v}</b><small>${s}</small></div>`).join('');
  }

  function renderClashes(a) {
    if (!a.clashes.length) {
      $('clashTake').textContent = 'No overlaps in the next two weeks — you can enter every contest on the board.';
      $('clashList').innerHTML = '';
      return;
    }
    const worst = a.clashes.reduce((m, c) => (c.overlapMin > m.overlapMin ? c : m));
    $('clashTake').textContent =
      `${a.clashes.length} ${a.clashes.length === 1 ? 'clash' : 'clashes'} ahead. The biggest is ${worst.overlapMin} minutes on ${fmtDay.format(new Date(worst.b.startTime))} — decide which one you're entering before the day.`;
    const side = (c) => `
          <span class="clash-side">
            <span class="clash-plat" style="--c:${SITE[c.site].color}">${SITE[c.site].label}</span>
            <span class="clash-name">${esc(c.name)}</span>
            <span class="clash-time">${fmtTime.format(new Date(c.startTime))} – ${fmtTime.format(new Date(c.endTime))}</span>
          </span>`;
    $('clashList').innerHTML = a.clashes.slice(0, 8).map(({ a: x, b: y, overlapMin }) => `
      <li>
        <span class="clash-when">${fmtDay.format(new Date(y.startTime))}</span>
        <span class="clash-pair">${side(x)}<span class="vs">vs</span>${side(y)}</span>
        <span class="clash-min">${overlapMin}<small>min overlap</small></span>
      </li>`).join('') + (a.clashes.length > 8 ? `<li class="clash-more">+ ${a.clashes.length - 8} more</li>` : '');
  }

  function renderLoad(a) {
    const W = 1000, H = 230, P = { l: 28, r: 8, t: 12, b: 36 };
    const max = Math.max(1, ...a.days.map((d) => d.codeforces + d.leetcode + d.codechef));
    const bw = (W - P.l - P.r) / a.days.length;
    const y = (n) => P.t + (H - P.t - P.b) * (1 - n / max);
    let bars = '', labels = '';
    a.days.forEach((d, i) => {
      let acc = 0;
      ['codeforces', 'leetcode', 'codechef'].forEach((s) => {
        if (!d[s]) return;
        const y0 = y(acc), y1 = y(acc + d[s]);
        bars += `<rect x="${P.l + i * bw + 4}" y="${y1}" width="${bw - 8}" height="${y0 - y1}" rx="3" fill="${SITE[s].color}"><title>${fmtDay.format(new Date(d.t))}: ${d[s]} ${SITE[s].label}</title></rect>`;
        acc += d[s];
      });
      const dt = new Date(d.t);
      const wk = mondayIndex(dt) >= 5;
      labels += `<text x="${P.l + i * bw + bw / 2}" y="${H - 18}" text-anchor="middle" class="${wk ? 'wk' : ''}">${WEEKDAYS[mondayIndex(dt)].slice(0, 2)}</text>
                 <text x="${P.l + i * bw + bw / 2}" y="${H - 5}" text-anchor="middle" class="faint">${dt.getDate()}</text>`;
    });
    let grid = '';
    for (let n = 0; n <= max; n += Math.max(1, Math.ceil(max / 4))) {
      grid += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(n)}" y2="${y(n)}" class="gl"/><text x="${P.l - 6}" y="${y(n) + 4}" text-anchor="end" class="faint">${n}</text>`;
    }
    $('loadChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Contests per day for the next 14 days">${grid}${bars}${labels}</svg>
      <div class="legend">${Object.values(SITE).map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('')}</div>`;

    const totals = a.days.map((d) => d.codeforces + d.leetcode + d.codechef);
    const busiest = totals.indexOf(Math.max(...totals));
    const free = totals.filter((n) => n === 0).length;
    $('loadTake').textContent = totals[busiest]
      ? `${totals.reduce((x, y2) => x + y2, 0)} contests start in the next 14 days. Busiest: ${fmtDay.format(new Date(a.days[busiest].t))} with ${totals[busiest]}. ${free ? `${plural(free, 'day')} with nothing scheduled — good for upsolving.` : ''}`
      : 'Nothing scheduled in the next 14 days yet — platforms usually announce rounds about a week ahead.';
  }

  function renderHeatmap(a) {
    const max = Math.max(1, ...a.heat.flat());
    let html = '<div class="hm-row hm-head"><span></span>' +
      Array.from({ length: 24 }, (_, h) => `<span>${h % 3 === 0 ? String(h).padStart(2, '0') : ''}</span>`).join('') + '</div>';
    a.heat.forEach((row, d) => {
      html += `<div class="hm-row"><span class="hm-day">${WEEKDAYS[d]}</span>` +
        row.map((n, h) => `<span class="hm-cell${n ? ' on' : ''}" style="--v:${n ? Math.round((0.25 + 0.75 * (n / max)) * 100) : 0}%" title="${WEEKDAYS[d]} ${fmtHour(h)} — ${plural(n, 'round')}">${n && n / max >= 0.35 ? n : ''}</span>`).join('') +
        '</div>';
    });
    html += `<div class="hm-legend"><span>fewer</span><i style="--v:25%"></i><i style="--v:50%"></i><i style="--v:75%"></i><i style="--v:100%"></i><span>more rounds</span></div>`;
    $('heatmap').innerHTML = html;
    // On narrow screens the grid scrolls — start it at the busiest hour.
    requestAnimationFrame(() => {
      const wrap = document.querySelector('.heatmap-wrap');
      const cell = $('heatmap').querySelectorAll('.hm-row')[a.peak.d + 1]?.children[a.peak.h + 1];
      if (wrap && cell && wrap.scrollWidth > wrap.clientWidth) {
        wrap.scrollLeft = Math.max(0, cell.offsetLeft - wrap.clientWidth / 2);
      }
    });
    if (!a.slots12.length) { $('heatTake').textContent = 'Not enough Codeforces history loaded to map start times.'; return; }
    $('heatTake').textContent =
      `${pct(a.weekend, a.slots12.length)}% of Codeforces rounds start on a weekend, and ${a.eveningShare}% start after 5 PM your time. ` +
      `The single most common slot is ${WEEKDAYS[a.peak.d]} ${fmtHour(a.peak.h)}–${fmtHour((a.peak.h + 1) % 24)} (${plural(a.peak.n, 'round')} in the last year) — block it in your calendar.`;
  }

  function renderTrend(a) {
    const W = 340, H = 180, P = { l: 24, r: 6, t: 10, b: 24 };
    const max = Math.max(1, ...a.months.map((m) => m.n));
    const bw = (W - P.l - P.r) / a.months.length;
    const y = (n) => P.t + (H - P.t - P.b) * (1 - n / max);
    const bars = a.months.map((m, i) =>
      `<rect x="${P.l + i * bw + 1}" y="${y(m.n)}" width="${bw - 2}" height="${H - P.b - y(m.n)}" rx="2" class="${m.partial ? 'partial' : i >= 24 ? 'recent' : 'older'}"><title>${fmtMonth.format(new Date(m.t))}: ${m.n}${m.partial ? ' (so far)' : ''}</title></rect>`).join('');
    const ticks = [0, 12, 24, 35].map((i) => `<text x="${P.l + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle" class="faint">${fmtMonth.format(new Date(a.months[i].t))}</text>`).join('');
    const step = Math.max(1, Math.ceil(max / 4));
    let grid = '';
    for (let n = 0; n <= max; n += step) grid += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(n)}" y2="${y(n)}" class="gl"/><text x="${P.l - 5}" y="${y(n) + 3.5}" text-anchor="end" class="faint">${n}</text>`;
    const avgPrev = a.prevYear / 12, avgThis = a.thisYear / 12;
    const avgLines = `<line x1="${P.l + 12 * bw}" x2="${P.l + 24 * bw}" y1="${y(avgPrev)}" y2="${y(avgPrev)}" class="avg"/><line x1="${P.l + 24 * bw}" x2="${W - P.r}" y1="${y(avgThis)}" y2="${y(avgThis)}" class="avg"/>`;
    $('trendChart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Codeforces rounds per month">${grid}${bars}${avgLines}${ticks}</svg>
      <div class="legend"><span><i style="background:var(--cf-color)"></i>Last 12 months</span><span><i style="background:color-mix(in srgb, var(--cf-color) 45%, transparent)"></i>Earlier</span><span><i class="dash"></i>12-month average</span></div>`;
    if (a.yoy === null) { $('trendTake').textContent = `${a.thisYear} rounds in the last 12 months.`; return; }
    const dir = a.yoy > 5 ? 'more' : a.yoy < -5 ? 'fewer' : 'about the same number of';
    $('trendTake').textContent = `${a.thisYear} rounds in the last 12 months vs ${a.prevYear} the year before — ${dir === 'about the same number of' ? dir : `${Math.abs(a.yoy)}% ${dir}`} chances to practise under contest pressure.`;
  }

  function renderMix(a) {
    const rows = a.mixRows.filter((r) => r.type !== 'Other').slice(0, 6);
    const other = a.mixRows.find((r) => r.type === 'Other');
    const all = other ? [...rows, other] : rows;
    const max = Math.max(1, ...all.map((r) => r.share));
    $('mixChart').innerHTML = all.map((r) => `
      <div class="mix-row">
        <span class="mix-label">${r.type}</span>
        <span class="mix-bar"><i style="width:${(r.share / max) * 100}%"></i></span>
        <span class="mix-val">${r.share}%</span>
        <span class="mix-dur">${r.med ? `${(r.med / 3600000).toFixed(r.med % 3600000 ? 1 : 0)}h` : ''}</span>
      </div>`).join('') + '<div class="mix-note">bar = share of rounds · right = typical duration</div>';
    const beginner = a.mixRows.filter((r) => r.type === 'Div 3' || r.type === 'Div 4').reduce((s, r) => s + r.n, 0);
    $('mixTake').textContent = rows.length
      ? `${rows[0].type} is the most common format (${rows[0].share}%). Beginner-friendly Div 3 + Div 4 rounds: ${beginner} in the last year, about ${(beginner / 12).toFixed(1)} a month.`
      : 'Not enough history to break down by division.';
  }

  function renderCadence(a) {
    if (!a.cadence.length) { $('cadTake').textContent = 'Not enough history to estimate cadence.'; $('cadTable').innerHTML = ''; return; }
    const rows = a.cadence.map((c) => {
      let next;
      if (c.scheduled) next = `<b class="ok">Scheduled · ${fmtDateTime.format(new Date(c.scheduled.startTime))}</b>`;
      else if (c.overdue) next = `<b class="warn">Overdue — likely announced soon</b>`;
      else next = `Expected ~ ${fmtDay.format(new Date(c.expected))}`;
      return `<div class="cad-row"><span class="cad-type">${c.type}</span><span>${c.count}</span><span>every ~${Math.round(c.gap)} days</span><span>${fmtDay.format(new Date(c.last))}</span><span>${next}</span></div>`;
    }).join('');
    $('cadTable').innerHTML = `<div class="cad-row cad-head"><span>Type</span><span>Rounds (12 mo)</span><span>Typical gap</span><span>Last held</span><span>Next</span></div>${rows}`;
    const d3 = a.cadence.find((c) => c.type === 'Div 3');
    const soonest = a.cadence.filter((c) => !c.scheduled && !c.overdue).sort((x, y) => x.expected - y.expected)[0];
    $('cadTake').textContent = d3
      ? `Div 3 rounds land roughly every ${Math.round(d3.gap)} days. ${soonest ? `Next unannounced round likely: ${soonest.type}, around ${fmtDay.format(new Date(soonest.expected))}.` : ''}`
      : soonest ? `Next unannounced round likely: ${soonest.type}, around ${fmtDay.format(new Date(soonest.expected))}.` : '';
  }

  function render() {
    if (!latest) return;
    const a = analyse(latest);
    renderKpis(a);
    renderClashes(a);
    renderLoad(a);
    renderHeatmap(a);
    renderTrend(a);
    renderMix(a);
    renderCadence(a);
    $('heatSub').textContent = `Codeforces start times · last 12 months · ${tz}`;
    $('insFoot').textContent =
      `Computed in your browser from ${a.historyCount.toLocaleString()} historical Codeforces contests and ${a.upcomingCount} upcoming contests across 3 platforms. Times in ${tz}.`;
    $('insLoading').hidden = true;
    $('insBody').hidden = false;
    rendered = true;
  }

  /* --------------------------------------------------------- wiring */
  const insightsEl = $('insights');
  const contestEls = [document.querySelector('.controls'), document.getElementById('banner'), document.querySelector('.grid-wrap')];
  let bannerWasHidden = true;

  document.querySelectorAll('.view-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.view;
      document.querySelectorAll('.view-tab').forEach((t) => {
        const on = t === tab;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', String(on));
      });
      const showInsights = view === 'insights';
      if (showInsights) bannerWasHidden = contestEls[1].hidden;
      contestEls.forEach((el, i) => {
        if (i === 1) el.hidden = showInsights ? true : bannerWasHidden;
        else el.style.display = showInsights ? 'none' : '';
      });
      insightsEl.hidden = !showInsights;
      document.body.classList.toggle('view-insights', showInsights);
      if (showInsights && !rendered) render();
      try { history.replaceState(null, '', showInsights ? '#insights' : '#'); } catch { /* file:// */ }
    });
  });

  document.addEventListener('cq:data', (e) => {
    latest = e.detail;
    rendered = false;
    if (!insightsEl.hidden) {
      bannerWasHidden = contestEls[1].hidden; // index.js may have just shown/hidden it
      contestEls[1].hidden = true;
      render();
    }
  });

  if (location.hash === '#insights') document.querySelector('.view-tab[data-view="insights"]').click();
})();
