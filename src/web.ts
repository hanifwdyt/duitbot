import { Hono } from "hono";
import { cors } from "hono/cors";
import { PrismaClient } from "@prisma/client";
import {
  format,
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
} from "date-fns";
import { id } from "date-fns/locale";

const prisma = new PrismaClient();

export function createWeb() {
  const app = new Hono();
  app.use("/*", cors());

  app.get("/health", (c) => c.json({ status: "ok" }));

  // Login page
  app.get("/", (c) => {
    return c.html(LOGIN_HTML);
  });

  // Dashboard
  app.get("/dashboard", (c) => {
    return c.html(DASHBOARD_HTML);
  });

  // API: Auth
  app.post("/api/auth", async (c) => {
    const { tgId, password } = await c.req.json();
    const user = await prisma.user.findUnique({ where: { tgId } });

    if (!user || user.password !== password) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    return c.json({ success: true, name: user.name, theme: user.theme });
  });

  // API: Dashboard data
  app.get("/api/data/:tgId", async (c) => {
    const tgId = c.req.param("tgId");
    const now = new Date();

    const [todayExp, weekExp, monthExp, recent] = await Promise.all([
      prisma.expense.findMany({
        where: { tgId, date: { gte: startOfDay(now), lte: endOfDay(now) } },
      }),
      prisma.expense.findMany({
        where: { tgId, date: { gte: startOfWeek(now, { weekStartsOn: 1 }), lte: endOfWeek(now, { weekStartsOn: 1 }) } },
      }),
      prisma.expense.findMany({
        where: { tgId, date: { gte: startOfMonth(now), lte: endOfMonth(now) } },
      }),
      prisma.expense.findMany({
        where: { tgId },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);

    const byCategory: Record<string, { total: number; count: number }> = {};
    const byMood: Record<string, number> = {};

    for (const e of monthExp) {
      if (!byCategory[e.category]) byCategory[e.category] = { total: 0, count: 0 };
      byCategory[e.category].total += e.amount;
      byCategory[e.category].count++;
      if (e.mood) byMood[e.mood] = (byMood[e.mood] || 0) + 1;
    }

    return c.json({
      today: { total: todayExp.reduce((s, e) => s + e.amount, 0), count: todayExp.length },
      week: { total: weekExp.reduce((s, e) => s + e.amount, 0), count: weekExp.length },
      month: { total: monthExp.reduce((s, e) => s + e.amount, 0), count: monthExp.length },
      byCategory,
      byMood,
      recent,
    });
  });

  // API: Update theme
  app.post("/api/theme/:tgId", async (c) => {
    const tgId = c.req.param("tgId");
    const { theme } = await c.req.json();
    await prisma.user.update({ where: { tgId }, data: { theme } });
    return c.json({ success: true });
  });

  return app;
}

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>DuitBot</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0a0a0b; --bg2: #141416; --bg3: #1c1c1f;
      --text: #fafafa; --text2: #a1a1aa; --text3: #71717a;
      --accent: #10b981; --accent2: #059669;
      --border: #27272a; --error: #ef4444;
    }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .login-card {
      width: 100%;
      max-width: 380px;
      background: var(--bg2);
      border-radius: 24px;
      padding: 40px 32px;
      border: 1px solid var(--border);
    }
    .logo {
      font-size: 48px;
      text-align: center;
      margin-bottom: 8px;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      text-align: center;
      margin-bottom: 8px;
    }
    .subtitle {
      color: var(--text2);
      text-align: center;
      font-size: 14px;
      margin-bottom: 32px;
    }
    .input-group {
      margin-bottom: 16px;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: var(--text2);
      margin-bottom: 8px;
    }
    input {
      width: 100%;
      padding: 14px 16px;
      background: var(--bg3);
      border: 1px solid var(--border);
      border-radius: 12px;
      color: var(--text);
      font-size: 15px;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus {
      border-color: var(--accent);
    }
    input::placeholder {
      color: var(--text3);
    }
    .btn {
      width: 100%;
      padding: 14px;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s, transform 0.1s;
      margin-top: 8px;
    }
    .btn:hover { background: var(--accent2); }
    .btn:active { transform: scale(0.98); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .error {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid var(--error);
      color: var(--error);
      padding: 12px;
      border-radius: 10px;
      font-size: 13px;
      margin-bottom: 16px;
      display: none;
    }
    .help {
      margin-top: 24px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
      text-align: center;
      font-size: 13px;
      color: var(--text3);
    }
    .help a {
      color: var(--accent);
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="login-card">
    <div class="logo">💰</div>
    <h1>DuitBot</h1>
    <p class="subtitle">Expense tracker via Telegram</p>

    <div class="error" id="error"></div>

    <form id="loginForm">
      <div class="input-group">
        <label>Telegram ID</label>
        <input type="text" id="tgId" placeholder="123456789" required>
      </div>
      <div class="input-group">
        <label>Password</label>
        <input type="password" id="password" placeholder="••••••••" required>
      </div>
      <button type="submit" class="btn" id="submitBtn">Login</button>
    </form>

    <div class="help">
      Belum punya password?<br>
      Chat <a href="https://t.me/ayo_hemat_bot" target="_blank">@ayo_hemat_bot</a> lalu ketik /setpassword
    </div>
  </div>

  <script>
    const form = document.getElementById('loginForm');
    const errorEl = document.getElementById('error');
    const btn = document.getElementById('submitBtn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.style.display = 'none';
      btn.disabled = true;
      btn.textContent = 'Loading...';

      try {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tgId: document.getElementById('tgId').value,
            password: document.getElementById('password').value,
          }),
        });

        if (!res.ok) {
          throw new Error('ID atau password salah');
        }

        const data = await res.json();
        localStorage.setItem('tgId', document.getElementById('tgId').value);
        localStorage.setItem('name', data.name || '');
        localStorage.setItem('theme', data.theme || 'dark');
        window.location.href = '/dashboard';
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Login';
      }
    });
  </script>
</body>
</html>`;

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>DuitBot Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0a0a0b; --bg2: #141416; --bg3: #1c1c1f;
      --text: #fafafa; --text2: #a1a1aa; --text3: #71717a;
      --accent: #10b981; --accent2: #059669; --accent-bg: rgba(16, 185, 129, 0.1);
      --border: #27272a;
      --cat-food: #f97316; --cat-coffee: #a78bfa; --cat-transport: #3b82f6;
      --cat-shopping: #ec4899; --cat-entertainment: #8b5cf6; --cat-bills: #6b7280;
      --cat-health: #14b8a6; --cat-groceries: #22c55e;
    }
    .light {
      --bg: #fafafa; --bg2: #ffffff; --bg3: #f4f4f5;
      --text: #18181b; --text2: #52525b; --text3: #a1a1aa;
      --border: #e4e4e7;
    }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100dvh;
      padding-bottom: 100px;
    }

    /* Header */
    .header {
      position: sticky;
      top: 0;
      background: var(--bg);
      border-bottom: 1px solid var(--border);
      padding: 16px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 100;
      backdrop-filter: blur(10px);
    }
    .header h1 {
      font-size: 20px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .header-actions {
      display: flex;
      gap: 8px;
    }
    .icon-btn {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: var(--bg2);
      border: 1px solid var(--border);
      color: var(--text2);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      transition: all 0.2s;
    }
    .icon-btn:hover {
      background: var(--bg3);
      color: var(--text);
    }

    /* Stats Grid */
    .container {
      padding: 20px;
      max-width: 600px;
      margin: 0 auto;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 16px;
      text-align: center;
    }
    .stat-card.highlight {
      background: var(--accent-bg);
      border-color: var(--accent);
    }
    .stat-label {
      font-size: 12px;
      color: var(--text3);
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stat-value {
      font-size: 18px;
      font-weight: 700;
    }
    .stat-card.highlight .stat-value {
      color: var(--accent);
    }
    .stat-count {
      font-size: 11px;
      color: var(--text3);
      margin-top: 2px;
    }

    /* Section */
    .section {
      margin-bottom: 24px;
    }
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .section-title {
      font-size: 16px;
      font-weight: 600;
    }

    /* Category Chart */
    .chart-container {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 20px;
    }
    .chart-wrapper {
      position: relative;
      height: 200px;
    }

    /* Category List */
    .category-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 16px;
    }
    .category-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      background: var(--bg3);
      border-radius: 12px;
    }
    .category-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }
    .category-info {
      flex: 1;
    }
    .category-name {
      font-size: 14px;
      font-weight: 500;
    }
    .category-count {
      font-size: 12px;
      color: var(--text3);
    }
    .category-amount {
      font-size: 14px;
      font-weight: 600;
    }

    /* Transaction List */
    .transaction-list {
      display: flex;
      flex-direction: column;
      gap: 1px;
      background: var(--border);
      border-radius: 16px;
      overflow: hidden;
    }
    .transaction-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px 16px;
      background: var(--bg2);
    }
    .transaction-icon {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: var(--bg3);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      flex-shrink: 0;
    }
    .transaction-info {
      flex: 1;
      min-width: 0;
    }
    .transaction-title {
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 2px;
    }
    .transaction-meta {
      font-size: 12px;
      color: var(--text3);
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .transaction-story {
      font-size: 12px;
      color: var(--text2);
      font-style: italic;
      margin-top: 4px;
    }
    .transaction-amount {
      font-size: 14px;
      font-weight: 600;
      flex-shrink: 0;
    }

    /* Mood Tags */
    .mood-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .mood-tag {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 8px 14px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .mood-count {
      background: var(--bg3);
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--text3);
    }
    .empty-state .icon {
      font-size: 48px;
      margin-bottom: 12px;
    }

    /* Loading */
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 200px;
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Bottom Nav */
    .bottom-nav {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: var(--bg2);
      border-top: 1px solid var(--border);
      padding: 12px 20px;
      padding-bottom: max(12px, env(safe-area-inset-bottom));
      display: flex;
      justify-content: center;
      gap: 8px;
    }
    .nav-btn {
      flex: 1;
      max-width: 120px;
      padding: 10px;
      background: var(--bg3);
      border: 1px solid var(--border);
      border-radius: 12px;
      color: var(--text2);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      text-align: center;
      transition: all 0.2s;
    }
    .nav-btn.active {
      background: var(--accent-bg);
      border-color: var(--accent);
      color: var(--accent);
    }
    .nav-btn:hover:not(.active) {
      background: var(--bg);
    }
  </style>
</head>
<body>
  <header class="header">
    <h1>💰 DuitBot</h1>
    <div class="header-actions">
      <button class="icon-btn" id="themeToggle" title="Toggle theme">🌙</button>
      <button class="icon-btn" id="logoutBtn" title="Logout">🚪</button>
    </div>
  </header>

  <div class="container">
    <div class="stats-grid">
      <div class="stat-card highlight">
        <div class="stat-label">Today</div>
        <div class="stat-value" id="todayTotal">-</div>
        <div class="stat-count" id="todayCount">0 transaksi</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Week</div>
        <div class="stat-value" id="weekTotal">-</div>
        <div class="stat-count" id="weekCount">0 transaksi</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Month</div>
        <div class="stat-value" id="monthTotal">-</div>
        <div class="stat-count" id="monthCount">0 transaksi</div>
      </div>
    </div>

    <div class="section" id="categorySection">
      <div class="section-header">
        <h2 class="section-title">By Category</h2>
      </div>
      <div class="chart-container">
        <div class="chart-wrapper">
          <canvas id="categoryChart"></canvas>
        </div>
        <div class="category-list" id="categoryList"></div>
      </div>
    </div>

    <div class="section" id="moodSection">
      <div class="section-header">
        <h2 class="section-title">Mood</h2>
      </div>
      <div class="mood-grid" id="moodGrid"></div>
    </div>

    <div class="section">
      <div class="section-header">
        <h2 class="section-title">Recent</h2>
      </div>
      <div class="transaction-list" id="transactionList">
        <div class="loading"><div class="spinner"></div></div>
      </div>
    </div>
  </div>

  <nav class="bottom-nav">
    <button class="nav-btn active" data-period="today">Today</button>
    <button class="nav-btn" data-period="week">Week</button>
    <button class="nav-btn" data-period="month">Month</button>
  </nav>

  <script>
    const CAT_EMOJI = { food:'🍔', coffee:'☕', transport:'🚗', shopping:'🛍', entertainment:'🎮', bills:'📄', health:'💊', groceries:'🥬', snack:'🍿', drink:'🥤' };
    const CAT_COLORS = { food:'#f97316', coffee:'#a78bfa', transport:'#3b82f6', shopping:'#ec4899', entertainment:'#8b5cf6', bills:'#6b7280', health:'#14b8a6', groceries:'#22c55e', snack:'#fbbf24', drink:'#06b6d4' };
    const MOOD_EMOJI = { happy:'😊', satisfied:'😌', excited:'🤩', neutral:'😐', reluctant:'😕', regret:'😔', guilty:'😣' };

    const tgId = localStorage.getItem('tgId');
    if (!tgId) window.location.href = '/';

    let theme = localStorage.getItem('theme') || 'dark';
    let chart = null;
    let data = null;

    function applyTheme() {
      document.body.classList.toggle('light', theme === 'light');
      document.getElementById('themeToggle').textContent = theme === 'dark' ? '🌙' : '☀️';
    }
    applyTheme();

    document.getElementById('themeToggle').addEventListener('click', async () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', theme);
      applyTheme();
      await fetch('/api/theme/' + tgId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme }),
      });
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
      localStorage.clear();
      window.location.href = '/';
    });

    const fmt = (n) => 'Rp' + (n || 0).toLocaleString('id-ID');
    const fmtShort = (n) => {
      if (n >= 1000000) return 'Rp' + (n/1000000).toFixed(1) + 'jt';
      if (n >= 1000) return 'Rp' + (n/1000).toFixed(0) + 'k';
      return fmt(n);
    };

    async function loadData() {
      const res = await fetch('/api/data/' + tgId);
      data = await res.json();
      render();
    }

    function render() {
      document.getElementById('todayTotal').textContent = fmtShort(data.today.total);
      document.getElementById('todayCount').textContent = data.today.count + ' transaksi';
      document.getElementById('weekTotal').textContent = fmtShort(data.week.total);
      document.getElementById('weekCount').textContent = data.week.count + ' transaksi';
      document.getElementById('monthTotal').textContent = fmtShort(data.month.total);
      document.getElementById('monthCount').textContent = data.month.count + ' transaksi';

      // Category Chart
      const categories = Object.entries(data.byCategory).sort((a,b) => b[1].total - a[1].total);
      if (categories.length > 0) {
        document.getElementById('categorySection').style.display = 'block';
        const ctx = document.getElementById('categoryChart').getContext('2d');
        if (chart) chart.destroy();
        chart = new Chart(ctx, {
          type: 'doughnut',
          data: {
            labels: categories.map(([c]) => (CAT_EMOJI[c.toLowerCase()]||'💸') + ' ' + c),
            datasets: [{
              data: categories.map(([,v]) => v.total),
              backgroundColor: categories.map(([c]) => CAT_COLORS[c.toLowerCase()] || '#71717a'),
              borderWidth: 0,
            }]
          },
          options: {
            cutout: '65%',
            plugins: {
              legend: { display: false },
            },
          },
        });

        document.getElementById('categoryList').innerHTML = categories.slice(0, 5).map(([cat, val]) => {
          const color = CAT_COLORS[cat.toLowerCase()] || '#71717a';
          return '<div class="category-item"><div class="category-icon" style="background:'+color+'20;color:'+color+'">'+(CAT_EMOJI[cat.toLowerCase()]||'💸')+'</div><div class="category-info"><div class="category-name">'+cat+'</div><div class="category-count">'+val.count+' transaksi</div></div><div class="category-amount">'+fmtShort(val.total)+'</div></div>';
        }).join('');
      } else {
        document.getElementById('categorySection').style.display = 'none';
      }

      // Mood
      const moods = Object.entries(data.byMood);
      if (moods.length > 0) {
        document.getElementById('moodSection').style.display = 'block';
        document.getElementById('moodGrid').innerHTML = moods.map(([mood, count]) =>
          '<div class="mood-tag">'+(MOOD_EMOJI[mood.toLowerCase()]||'')+ ' ' + mood + '<span class="mood-count">'+count+'</span></div>'
        ).join('');
      } else {
        document.getElementById('moodSection').style.display = 'none';
      }

      // Transactions
      if (data.recent.length > 0) {
        document.getElementById('transactionList').innerHTML = data.recent.map(e => {
          const date = new Date(e.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
          const mood = e.mood ? (MOOD_EMOJI[e.mood.toLowerCase()] || '') : '';
          return '<div class="transaction-item"><div class="transaction-icon">'+(CAT_EMOJI[e.category.toLowerCase()]||'💸')+'</div><div class="transaction-info"><div class="transaction-title">'+e.item+'</div><div class="transaction-meta"><span>'+date+'</span>'+(e.place?'<span>📍 '+e.place+'</span>':'')+(mood?'<span>'+mood+'</span>':'')+'</div>'+(e.story?'<div class="transaction-story">"'+e.story+'"</div>':'')+'</div><div class="transaction-amount">'+fmtShort(e.amount)+'</div></div>';
        }).join('');
      } else {
        document.getElementById('transactionList').innerHTML = '<div class="empty-state"><div class="icon">📝</div><div>Belum ada transaksi</div></div>';
      }
    }

    loadData();
  </script>
</body>
</html>`;
