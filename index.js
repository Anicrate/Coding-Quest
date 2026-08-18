/* ==========================================================================
   CodeQuest — live contest tracker
   Data sources:
     - Codeforces official API      (https://codeforces.com/apiHelp)
     - LeetCode contest feed        via competeapi (https://competeapi.vercel.app)
     - CodeChef contest feed        via competeapi (adds CORS on top of CodeChef's own API)
   ========================================================================== */

const CF_API = 'https://codeforces.com/api/contest.list?gym=false';
const LC_API = 'https://competeapi.vercel.app/contests/upcoming/';
const CC_API = 'https://competeapi.vercel.app/contests/codechef/';

const els = {
  grid: document.getElementById('grid'),
  banner: document.getElementById('banner'),
  search: document.getElementById('searchInput'),
  siteFilter: document.getElementById('siteFilter'),
  sortSelect: document.getElementById('sortSelect'),
  refreshBtn: document.getElementById('refreshBtn'),
  themeToggle: document.getElementById('themeToggle'),
  lastUpdated: document.getElementById('lastUpdated'),
  statTotal: document.getElementById('statTotal'),
  statLive: document.getElementById('statLive'),
  statPlatforms: document.getElementById('statPlatforms'),
};

const state = {
  contests: [],
  query: '',
  site: 'all',
  sort: 'soonest',
  loading: true,
};

/* --------------------------------------------------------------------------
   Theme
   -------------------------------------------------------------------------- */
(function initTheme() {
  const saved = localStorage.getItem('codequest-theme');
  const theme = saved || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
})();

els.themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('codequest-theme', next);
});

/* --------------------------------------------------------------------------
   Fetch + normalize
   -------------------------------------------------------------------------- */
async function fetchCodeforces() {
  const res = await fetch(CF_API);
  if (!res.ok) throw new Error('Codeforces API error ' + res.status);
  const json = await res.json();
  if (json.status !== 'OK') throw new Error('Codeforces API returned an error');

  return json.result
    .filter((c) => c.phase === 'BEFORE' || c.phase === 'CODING')
    .map((c) => ({
      id: `cf-${c.id}`,
      site: 'codeforces',
      siteLabel: 'Codeforces',
      name: c.name,
      url: `https://codeforces.com/contests/${c.id}`,
      startTime: c.startTimeSeconds * 1000,
      endTime: (c.startTimeSeconds + c.durationSeconds) * 1000,
      durationMs: c.durationSeconds * 1000,
    }));
}

async function fetchLeetCode() {
  const res = await fetch(LC_API);
  if (!res.ok) throw new Error('LeetCode feed error ' + res.status);
  const json = await res.json();
  const now = Date.now();

  return json
    .filter((c) => c.endTime > now)
    .map((c, i) => ({
      id: `lc-${c.title}-${i}`,
      site: 'leetcode',
      siteLabel: 'LeetCode',
      name: c.title,
      url: c.url || 'https://leetcode.com/contest/',
      startTime: c.startTime,
      endTime: c.endTime,
      durationMs: c.duration,
    }));
}

async function fetchCodeChef() {
  const res = await fetch(CC_API);
  if (!res.ok) throw new Error('CodeChef feed error ' + res.status);
  const json = await res.json();
  if (json.status !== 'success') throw new Error('CodeChef feed returned an error');
  const now = Date.now();

  const raw = [...(json.present_contests || []), ...(json.future_contests || [])];
  return raw
    .map((c) => {
      const startTime = Date.parse(c.contest_start_date_iso);
      const endTime = Date.parse(c.contest_end_date_iso);
      return {
        id: `cc-${c.contest_code}`,
        site: 'codechef',
        siteLabel: 'CodeChef',
        name: c.contest_name,
        url: `https://www.codechef.com/${c.contest_code}`,
        startTime,
        endTime,
        durationMs: Number(c.contest_duration) * 60000,
      };
    })
    .filter((c) => Number.isFinite(c.startTime) && Number.isFinite(c.endTime) && c.endTime > now);
}

const SOURCES = [
  { label: 'Codeforces', fetcher: fetchCodeforces },
  { label: 'LeetCode', fetcher: fetchLeetCode },
  { label: 'CodeChef', fetcher: fetchCodeChef },
];

async function loadContests({ silent = false } = {}) {
  if (!silent) {
    state.loading = true;
    renderSkeleton();
  }

  const results = await Promise.allSettled(SOURCES.map((s) => s.fetcher()));

  const contests = [];
  results.forEach((result) => {
    if (result.status === 'fulfilled') contests.push(...result.value);
  });

  state.contests = contests;
  state.loading = false;

  updateBanner(results);
  updateStats();
  applyAndRender();

  els.lastUpdated.textContent = contests.length
    ? `Last updated ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date())}`
    : 'No data available right now';
}

function updateBanner(results) {
  const failed = results
    .map((result, i) => (result.status === 'rejected' ? SOURCES[i].label : null))
    .filter(Boolean);

  if (failed.length === 0) {
    els.banner.hidden = true;
    els.banner.innerHTML = '';
    return;
  }

  els.banner.hidden = false;
  const inner = document.createElement('div');
  inner.className = 'banner-inner';

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.innerHTML = '<path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke-linecap="round" stroke-linejoin="round"/>';

  const text = document.createElement('span');
  text.textContent =
    failed.length === SOURCES.length
      ? "Couldn't load live contest data right now. Please try again shortly."
      : `Couldn't reach ${failed.join(' & ')} right now — showing other sources only.`;

  const retry = document.createElement('button');
  retry.textContent = 'Retry';
  retry.addEventListener('click', () => loadContests());

  inner.append(icon, text, retry);
  els.banner.innerHTML = '';
  els.banner.appendChild(inner);
}

function updateStats() {
  const now = Date.now();
  const live = state.contests.filter((c) => c.startTime <= now && c.endTime > now).length;
  const platforms = new Set(state.contests.map((c) => c.site)).size;

  els.statTotal.textContent = state.contests.length;
  els.statLive.textContent = live;
  els.statPlatforms.textContent = platforms || '–';
}

/* --------------------------------------------------------------------------
   Filtering / sorting
   -------------------------------------------------------------------------- */
function getFilteredSorted() {
  let list = state.contests.filter((c) => {
    const matchesSite = state.site === 'all' || c.site === state.site;
    const matchesQuery = c.name.toLowerCase().includes(state.query.toLowerCase());
    return matchesSite && matchesQuery;
  });

  const sorters = {
    soonest: (a, b) => a.startTime - b.startTime,
    latest: (a, b) => b.startTime - a.startTime,
    shortest: (a, b) => a.durationMs - b.durationMs,
    longest: (a, b) => b.durationMs - a.durationMs,
  };
  list.sort(sorters[state.sort] || sorters.soonest);
  return list;
}

function applyAndRender() {
  if (state.loading) return;
  const list = getFilteredSorted();
  renderGrid(list);
}

/* --------------------------------------------------------------------------
   Rendering
   -------------------------------------------------------------------------- */
function renderSkeleton() {
  els.grid.innerHTML = '';
  for (let i = 0; i < 6; i++) {
    const sk = document.createElement('div');
    sk.className = 'skeleton-card';
    els.grid.appendChild(sk);
  }
}

function renderGrid(list) {
  els.grid.innerHTML = '';

  if (list.length === 0) {
    els.grid.appendChild(buildStatePanel());
    return;
  }

  const frag = document.createDocumentFragment();
  list.forEach((contest, idx) => {
    frag.appendChild(buildCard(contest, idx));
  });
  els.grid.appendChild(frag);
  tickCountdowns();
}

function buildStatePanel() {
  const panel = document.createElement('div');
  panel.className = 'state-panel';

  const noData = state.contests.length === 0;
  panel.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="7"></circle>
      <path d="M21 21l-4.3-4.3"></path>
    </svg>
    <h3>${noData ? 'No contests available' : 'No matches found'}</h3>
    <p>${noData ? 'We could not load any contest data. Check your connection and try again.' : 'Try a different search term or clear the platform filter.'}</p>
  `;

  if (noData) {
    const btn = document.createElement('button');
    btn.textContent = 'Retry';
    btn.addEventListener('click', () => loadContests());
    panel.appendChild(btn);
  }
  return panel;
}

function buildCard(contest, idx) {
  const card = document.createElement('article');
  card.className = 'card';
  card.style.animationDelay = `${Math.min(idx * 35, 400)}ms`;

  const initialsMap = { codeforces: 'CF', leetcode: 'LC', codechef: 'CC' };
  const initials = initialsMap[contest.site] || contest.site.slice(0, 2).toUpperCase();

  const top = document.createElement('div');
  top.className = 'card-top';

  const badge = document.createElement('div');
  badge.className = 'platform-badge';
  badge.dataset.site = contest.site;
  badge.innerHTML = `<span class="platform-mono">${initials}</span> ${contest.siteLabel}`;

  const status = document.createElement('span');
  const now = Date.now();
  const isLive = contest.startTime <= now && contest.endTime > now;
  status.className = `status-pill ${isLive ? 'live' : 'upcoming'}`;
  status.innerHTML = isLive ? '<span class="dot"></span> Live' : 'Upcoming';

  top.append(badge, status);

  const title = document.createElement('h3');
  title.textContent = contest.name;

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  meta.innerHTML = `
    <div class="row">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18"></path></svg>
      ${formatDateTime(contest.startTime)}
    </div>
    <div class="row">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 3"></path></svg>
      ${formatDuration(contest.durationMs)}
    </div>
  `;

  const countdownWrap = document.createElement('div');
  countdownWrap.className = 'countdown-wrap';
  countdownWrap.innerHTML = `
    <span class="countdown-label">${isLive ? 'Ends in' : 'Starts in'}</span>
    <span class="countdown" data-start="${contest.startTime}" data-end="${contest.endTime}">–</span>
  `;

  const cta = document.createElement('a');
  cta.className = 'card-cta';
  cta.href = contest.url;
  cta.target = '_blank';
  cta.rel = 'noopener';
  cta.innerHTML = `Open contest
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M7 7h10v10"></path></svg>`;

  card.append(top, title, meta, countdownWrap, cta);
  return card;
}

/* --------------------------------------------------------------------------
   Formatting helpers
   -------------------------------------------------------------------------- */
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function formatDateTime(ms) {
  return dateFormatter.format(new Date(ms));
}

function formatDuration(ms) {
  const totalMinutes = Math.round(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes && !days) parts.push(`${minutes}m`);
  return parts.length ? parts.join(' ') : '< 1m';
}

function formatCountdown(diffMs) {
  const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n) => String(n).padStart(2, '0');
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/* --------------------------------------------------------------------------
   Live countdown tick
   -------------------------------------------------------------------------- */
function tickCountdowns() {
  const now = Date.now();
  document.querySelectorAll('.countdown').forEach((el) => {
    const start = Number(el.dataset.start);
    const end = Number(el.dataset.end);

    if (now < start) {
      el.textContent = formatCountdown(start - now);
      el.classList.remove('live');
    } else if (now < end) {
      el.textContent = `${formatCountdown(end - now)} left`;
      el.classList.add('live');
    } else {
      el.textContent = 'Ended';
      el.closest('.card')?.remove();
    }
  });
}

setInterval(tickCountdowns, 1000);

/* --------------------------------------------------------------------------
   Event wiring
   -------------------------------------------------------------------------- */
let searchDebounce;
els.search.addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    state.query = e.target.value.trim();
    applyAndRender();
  }, 150);
});

els.siteFilter.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  state.site = btn.dataset.site;
  [...els.siteFilter.children].forEach((c) => c.classList.toggle('active', c === btn));
  applyAndRender();
});

els.sortSelect.addEventListener('change', (e) => {
  state.sort = e.target.value;
  applyAndRender();
});

els.refreshBtn.addEventListener('click', () => {
  els.refreshBtn.style.transform = 'rotate(180deg)';
  setTimeout(() => (els.refreshBtn.style.transform = ''), 300);
  loadContests();
});

/* Auto-refresh data every 5 minutes to keep the list current */
setInterval(() => loadContests({ silent: true }), 5 * 60 * 1000);

/* --------------------------------------------------------------------------
   Init
   -------------------------------------------------------------------------- */
loadContests();
