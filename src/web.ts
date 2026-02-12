import { Hono } from "hono";
import { cors } from "hono/cors";
import { PrismaClient } from "@prisma/client";
import { getCredits } from "./ai.js";
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
    // Try finding by tgId first, then by customId
    let user = await prisma.user.findUnique({ where: { tgId } });
    if (!user) {
      user = await prisma.user.findUnique({ where: { customId: tgId } });
    }

    if (!user || user.password !== password) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    return c.json({ success: true, name: user.name, theme: user.theme, tgId: user.tgId });
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

  // ==================== ADMIN ROUTES ====================

  // Admin Login page
  app.get("/admin", (c) => {
    return c.html(ADMIN_LOGIN_HTML);
  });

  // Admin Dashboard page
  app.get("/admin/dashboard", (c) => {
    return c.html(ADMIN_DASHBOARD_HTML);
  });

  // Admin User Detail page
  app.get("/admin/user/:tgId", (c) => {
    return c.html(ADMIN_DETAIL_HTML);
  });

  // API: Admin Credits
  app.get("/api/admin/credits", async (c) => {
    const credits = await getCredits();
    if (!credits) return c.json({ error: "Failed to fetch credits" }, 500);
    return c.json(credits);
  });

  // API: Admin Auth
  app.post("/api/admin/auth", async (c) => {
    const { password } = await c.req.json();
    if (password !== "admin123") {
      return c.json({ error: "Invalid admin password" }, 401);
    }
    return c.json({ success: true });
  });

  // API: Admin - Get all users
  app.get("/api/admin/users", async (c) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
    });
    const result = await Promise.all(
      users.map(async (u) => {
        const expenseCount = await prisma.expense.count({ where: { tgId: u.tgId } });
        return {
          tgId: u.tgId,
          customId: u.customId,
          name: u.name,
          password: u.password,
          createdAt: u.createdAt,
          expenseCount,
        };
      })
    );
    return c.json(result);
  });

  // API: Admin - Get user detail + all expenses
  app.get("/api/admin/users/:tgId", async (c) => {
    const tgId = c.req.param("tgId");
    const user = await prisma.user.findUnique({ where: { tgId } });
    if (!user) return c.json({ error: "User not found" }, 404);

    const expenses = await prisma.expense.findMany({
      where: { tgId },
      orderBy: { date: "desc" },
    });

    const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);
    const byCategory: Record<string, { total: number; count: number }> = {};
    const byMood: Record<string, number> = {};

    for (const e of expenses) {
      if (!byCategory[e.category]) byCategory[e.category] = { total: 0, count: 0 };
      byCategory[e.category].total += e.amount;
      byCategory[e.category].count++;
      if (e.mood) byMood[e.mood] = (byMood[e.mood] || 0) + 1;
    }

    return c.json({
      user: {
        tgId: user.tgId,
        customId: user.customId,
        name: user.name,
        password: user.password,
        createdAt: user.createdAt,
      },
      stats: { totalSpent, count: expenses.length, byCategory, byMood },
      expenses,
    });
  });

  return app;
}

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>AturUang</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0a0a0b; --bg2: #141416; --bg3: #1c1c1f;
      --text: #fafafa; --text2: #a1a1aa; --text3: #71717a;
      --accent: #F59E0B; --accent2: #D97706;
      --border: #27272a; --error: #ef4444;
    }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
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
    <h1>AturUang</h1>
    <p class="subtitle">SatuRuang untuk atur keuanganmu</p>

    <div class="error" id="error"></div>

    <form id="loginForm">
      <div class="input-group">
        <label>Telegram ID / Custom ID</label>
        <input type="text" id="tgId" placeholder="123456789 atau custom_id" required>
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
        localStorage.setItem('tgId', data.tgId || document.getElementById('tgId').value);
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
  <title>AturUang</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0a0a0b; --bg2: #141416; --bg3: #1c1c1f;
      --text: #fafafa; --text2: #a1a1aa; --text3: #71717a;
      --accent: #F59E0B; --accent2: #D97706; --accent-bg: rgba(245, 158, 11, 0.1);
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
      font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
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
    <h1>💰 AturUang</h1>
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

// ==================== ADMIN HTML TEMPLATES ====================

const ADMIN_LOGIN_HTML = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>AturUang Admin</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0a0a0b; --bg2: #141416; --bg3: #1c1c1f;
      --text: #fafafa; --text2: #a1a1aa; --text3: #71717a;
      --accent: #F59E0B; --accent2: #D97706;
      --border: #27272a; --error: #ef4444;
    }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
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
    .logo { font-size: 48px; text-align: center; margin-bottom: 8px; }
    h1 { font-size: 24px; font-weight: 600; text-align: center; margin-bottom: 8px; }
    .subtitle { color: var(--text2); text-align: center; font-size: 14px; margin-bottom: 32px; }
    .input-group { margin-bottom: 16px; }
    label { display: block; font-size: 13px; font-weight: 500; color: var(--text2); margin-bottom: 8px; }
    input {
      width: 100%; padding: 14px 16px; background: var(--bg3);
      border: 1px solid var(--border); border-radius: 12px; color: var(--text);
      font-size: 15px; outline: none; transition: border-color 0.2s;
    }
    input:focus { border-color: var(--accent); }
    input::placeholder { color: var(--text3); }
    .btn {
      width: 100%; padding: 14px; background: var(--accent); color: white;
      border: none; border-radius: 12px; font-size: 15px; font-weight: 600;
      cursor: pointer; transition: background 0.2s, transform 0.1s; margin-top: 8px;
    }
    .btn:hover { background: var(--accent2); }
    .btn:active { transform: scale(0.98); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .error {
      background: rgba(239, 68, 68, 0.1); border: 1px solid var(--error);
      color: var(--error); padding: 12px; border-radius: 10px;
      font-size: 13px; margin-bottom: 16px; display: none;
    }
  </style>
</head>
<body>
  <div class="login-card">
    <div class="logo">🔐</div>
    <h1>AturUang Admin</h1>
    <p class="subtitle">Admin panel access</p>
    <div class="error" id="error"></div>
    <form id="loginForm">
      <div class="input-group">
        <label>Admin Password</label>
        <input type="password" id="password" placeholder="Enter admin password" required>
      </div>
      <button type="submit" class="btn" id="submitBtn">Login</button>
    </form>
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
        const res = await fetch('/api/admin/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: document.getElementById('password').value }),
        });
        if (!res.ok) throw new Error('Password salah');
        localStorage.setItem('isAdmin', 'true');
        window.location.href = '/admin/dashboard';
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

const ADMIN_DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>AturUang Admin</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0a0a0b; --bg2: #141416; --bg3: #1c1c1f;
      --text: #fafafa; --text2: #a1a1aa; --text3: #71717a;
      --accent: #F59E0B; --accent2: #D97706; --accent-bg: rgba(245, 158, 11, 0.1);
      --border: #27272a;
    }
    .light {
      --bg: #fafafa; --bg2: #ffffff; --bg3: #f4f4f5;
      --text: #18181b; --text2: #52525b; --text3: #a1a1aa;
      --border: #e4e4e7;
    }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
      background: var(--bg); color: var(--text); min-height: 100dvh;
    }
    .header {
      position: sticky; top: 0; background: var(--bg);
      border-bottom: 1px solid var(--border); padding: 16px 20px;
      display: flex; justify-content: space-between; align-items: center;
      z-index: 100; backdrop-filter: blur(10px);
    }
    .header h1 { font-size: 20px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .header-actions { display: flex; gap: 8px; }
    .icon-btn {
      width: 40px; height: 40px; border-radius: 12px; background: var(--bg2);
      border: 1px solid var(--border); color: var(--text2); cursor: pointer;
      display: flex; align-items: center; justify-content: center; font-size: 18px;
      transition: all 0.2s;
    }
    .icon-btn:hover { background: var(--bg3); color: var(--text); }
    .container { padding: 20px; max-width: 900px; margin: 0 auto; }
    .search-bar {
      width: 100%; padding: 12px 16px; background: var(--bg2);
      border: 1px solid var(--border); border-radius: 12px; color: var(--text);
      font-size: 14px; outline: none; margin-bottom: 20px; transition: border-color 0.2s;
    }
    .search-bar:focus { border-color: var(--accent); }
    .search-bar::placeholder { color: var(--text3); }
    .stats-row {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px;
    }
    .stat-card {
      background: var(--bg2); border: 1px solid var(--border); border-radius: 16px;
      padding: 16px; text-align: center;
    }
    .stat-card.highlight { background: var(--accent-bg); border-color: var(--accent); }
    .stat-label { font-size: 12px; color: var(--text3); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-value { font-size: 22px; font-weight: 700; }
    .stat-card.highlight .stat-value { color: var(--accent); }
    table {
      width: 100%; border-collapse: collapse; background: var(--bg2);
      border-radius: 16px; overflow: hidden; border: 1px solid var(--border);
    }
    th {
      background: var(--bg3); padding: 12px 16px; text-align: left;
      font-size: 12px; font-weight: 600; color: var(--text2);
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    td { padding: 12px 16px; border-top: 1px solid var(--border); font-size: 14px; }
    tr:hover td { background: var(--bg3); }
    .detail-btn {
      padding: 6px 14px; background: var(--accent); color: white;
      border: none; border-radius: 8px; font-size: 13px; font-weight: 500;
      cursor: pointer; transition: background 0.2s;
    }
    .detail-btn:hover { background: var(--accent2); }
    .loading { display: flex; align-items: center; justify-content: center; height: 200px; }
    .spinner {
      width: 32px; height: 32px; border: 3px solid var(--border);
      border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .empty { text-align: center; padding: 40px; color: var(--text3); }
    .mono { font-family: monospace; font-size: 13px; color: var(--text2); }
    @media (max-width: 640px) {
      .table-wrap { overflow-x: auto; }
      table { min-width: 600px; }
    }
  </style>
</head>
<body>
  <header class="header">
    <h1>🔐 AturUang Admin</h1>
    <div class="header-actions">
      <button class="icon-btn" id="themeToggle" title="Toggle theme">🌙</button>
      <button class="icon-btn" id="logoutBtn" title="Logout">🚪</button>
    </div>
  </header>
  <div class="container">
    <div class="stats-row">
      <div class="stat-card highlight">
        <div class="stat-label">Total Users</div>
        <div class="stat-value" id="totalUsers">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Expenses</div>
        <div class="stat-value" id="totalExpenses">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">AI Credits</div>
        <div class="stat-value" id="aiCredits">-</div>
      </div>
    </div>
    <input type="text" class="search-bar" id="searchBar" placeholder="Search by Telegram ID, Custom ID, or Name...">
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Telegram ID</th>
            <th>Custom ID</th>
            <th>Name</th>
            <th>Password</th>
            <th>Expenses</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody id="userTable">
          <tr><td colspan="6"><div class="loading"><div class="spinner"></div></div></td></tr>
        </tbody>
      </table>
    </div>
  </div>
  <script>
    if (localStorage.getItem('isAdmin') !== 'true') window.location.href = '/admin';

    let theme = localStorage.getItem('adminTheme') || 'dark';
    function applyTheme() {
      document.body.classList.toggle('light', theme === 'light');
      document.getElementById('themeToggle').textContent = theme === 'dark' ? '🌙' : '☀️';
    }
    applyTheme();
    document.getElementById('themeToggle').addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('adminTheme', theme);
      applyTheme();
    });
    document.getElementById('logoutBtn').addEventListener('click', () => {
      localStorage.removeItem('isAdmin');
      window.location.href = '/admin';
    });

    let allUsers = [];

    async function loadUsers() {
      const res = await fetch('/api/admin/users');
      allUsers = await res.json();
      document.getElementById('totalUsers').textContent = allUsers.length;
      document.getElementById('totalExpenses').textContent = allUsers.reduce((s, u) => s + u.expenseCount, 0).toLocaleString('id-ID');
      renderTable(allUsers);
    }

    function renderTable(users) {
      const tbody = document.getElementById('userTable');
      if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty">No users found</td></tr>';
        return;
      }
      tbody.innerHTML = users.map(u =>
        '<tr>' +
        '<td class="mono">' + esc(u.tgId) + '</td>' +
        '<td class="mono">' + esc(u.customId || '-') + '</td>' +
        '<td>' + esc(u.name || '-') + '</td>' +
        '<td class="mono">' + esc(u.password || '-') + '</td>' +
        '<td>' + u.expenseCount + '</td>' +
        '<td><button class="detail-btn" onclick="viewUser(\\'' + esc(u.tgId) + '\\')">Detail</button></td>' +
        '</tr>'
      ).join('');
    }

    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    function viewUser(tgId) {
      window.location.href = '/admin/user/' + encodeURIComponent(tgId);
    }

    document.getElementById('searchBar').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = allUsers.filter(u =>
        u.tgId.toLowerCase().includes(q) ||
        (u.customId || '').toLowerCase().includes(q) ||
        (u.name || '').toLowerCase().includes(q)
      );
      renderTable(filtered);
    });

    loadUsers();

    async function loadCredits() {
      try {
        const res = await fetch('/api/admin/credits');
        if (!res.ok) throw new Error();
        const data = await res.json();
        document.getElementById('aiCredits').textContent = '$' + data.remaining.toFixed(2);
        document.getElementById('aiCredits').title = 'Used: $' + data.total_usage.toFixed(2) + ' / Total: $' + data.total_credits.toFixed(2);
      } catch {
        document.getElementById('aiCredits').textContent = 'N/A';
      }
    }
    loadCredits();
  </script>
</body>
</html>`;

const ADMIN_DETAIL_HTML = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>AturUang Admin - User Detail</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0a0a0b; --bg2: #141416; --bg3: #1c1c1f;
      --text: #fafafa; --text2: #a1a1aa; --text3: #71717a;
      --accent: #F59E0B; --accent2: #D97706; --accent-bg: rgba(245, 158, 11, 0.1);
      --border: #27272a;
    }
    .light {
      --bg: #fafafa; --bg2: #ffffff; --bg3: #f4f4f5;
      --text: #18181b; --text2: #52525b; --text3: #a1a1aa;
      --border: #e4e4e7;
    }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
      background: var(--bg); color: var(--text); min-height: 100dvh;
    }
    .header {
      position: sticky; top: 0; background: var(--bg);
      border-bottom: 1px solid var(--border); padding: 16px 20px;
      display: flex; justify-content: space-between; align-items: center;
      z-index: 100; backdrop-filter: blur(10px);
    }
    .header h1 { font-size: 20px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .back-btn {
      padding: 8px 16px; background: var(--bg2); border: 1px solid var(--border);
      border-radius: 10px; color: var(--text2); cursor: pointer; font-size: 14px;
      transition: all 0.2s; text-decoration: none; display: flex; align-items: center; gap: 6px;
    }
    .back-btn:hover { background: var(--bg3); color: var(--text); }
    .container { padding: 20px; max-width: 900px; margin: 0 auto; }

    .user-card {
      background: var(--bg2); border: 1px solid var(--border); border-radius: 16px;
      padding: 24px; margin-bottom: 20px;
    }
    .user-card h2 { font-size: 18px; margin-bottom: 16px; }
    .user-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
    .user-field label { display: block; font-size: 11px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .user-field span { font-size: 14px; font-family: monospace; color: var(--text2); }

    .stats-grid {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px;
    }
    .stat-card {
      background: var(--bg2); border: 1px solid var(--border); border-radius: 16px;
      padding: 16px; text-align: center;
    }
    .stat-card.highlight { background: var(--accent-bg); border-color: var(--accent); }
    .stat-label { font-size: 12px; color: var(--text3); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-value { font-size: 18px; font-weight: 700; }
    .stat-card.highlight .stat-value { color: var(--accent); }

    .section { margin-bottom: 24px; }
    .section-title { font-size: 16px; font-weight: 600; margin-bottom: 12px; }

    .category-list { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
    .cat-tag {
      background: var(--bg2); border: 1px solid var(--border); border-radius: 20px;
      padding: 8px 14px; font-size: 13px; display: flex; align-items: center; gap: 6px;
    }
    .cat-amount { font-weight: 600; color: var(--accent); }

    .mood-list { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
    .mood-tag {
      background: var(--bg2); border: 1px solid var(--border); border-radius: 20px;
      padding: 8px 14px; font-size: 13px; display: flex; align-items: center; gap: 6px;
    }
    .mood-count { background: var(--bg3); padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }

    table {
      width: 100%; border-collapse: collapse; background: var(--bg2);
      border-radius: 16px; overflow: hidden; border: 1px solid var(--border);
    }
    th {
      background: var(--bg3); padding: 12px 16px; text-align: left;
      font-size: 12px; font-weight: 600; color: var(--text2);
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    td { padding: 10px 16px; border-top: 1px solid var(--border); font-size: 13px; }
    tr:hover td { background: var(--bg3); }
    .story-text { font-style: italic; color: var(--text2); max-width: 200px; }
    .loading { display: flex; align-items: center; justify-content: center; height: 200px; }
    .spinner {
      width: 32px; height: 32px; border: 3px solid var(--border);
      border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 640px) {
      .table-wrap { overflow-x: auto; }
      table { min-width: 700px; }
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <header class="header">
    <h1>🔐 User Detail</h1>
    <a class="back-btn" href="/admin/dashboard">← Back</a>
  </header>
  <div class="container">
    <div id="content">
      <div class="loading"><div class="spinner"></div></div>
    </div>
  </div>
  <script>
    if (localStorage.getItem('isAdmin') !== 'true') window.location.href = '/admin';

    const CAT_EMOJI = { food:'🍔', coffee:'☕', transport:'🚗', shopping:'🛍', entertainment:'🎮', bills:'📄', health:'💊', groceries:'🥬', snack:'🍿', drink:'🥤' };
    const MOOD_EMOJI = { happy:'😊', satisfied:'😌', excited:'🤩', neutral:'😐', reluctant:'😕', regret:'😔', guilty:'😣' };

    const theme = localStorage.getItem('adminTheme') || 'dark';
    document.body.classList.toggle('light', theme === 'light');

    const tgId = window.location.pathname.split('/').pop();
    const fmt = (n) => 'Rp' + (n || 0).toLocaleString('id-ID');
    const fmtShort = (n) => {
      if (n >= 1000000) return 'Rp' + (n/1000000).toFixed(1) + 'jt';
      if (n >= 1000) return 'Rp' + (n/1000).toFixed(0) + 'k';
      return fmt(n);
    };
    function esc(s) { const d = document.createElement('div'); d.textContent = s || '-'; return d.innerHTML; }

    async function load() {
      const res = await fetch('/api/admin/users/' + encodeURIComponent(tgId));
      if (!res.ok) {
        document.getElementById('content').innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)">User not found</div>';
        return;
      }
      const data = await res.json();
      const u = data.user;
      const s = data.stats;
      const joined = new Date(u.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

      const topCat = Object.entries(s.byCategory).sort((a,b) => b[1].total - a[1].total)[0];

      let html = '';

      // User info card
      html += '<div class="user-card"><h2>' + esc(u.name || u.tgId) + '</h2><div class="user-fields">';
      html += '<div class="user-field"><label>Telegram ID</label><span>' + esc(u.tgId) + '</span></div>';
      html += '<div class="user-field"><label>Custom ID</label><span>' + esc(u.customId) + '</span></div>';
      html += '<div class="user-field"><label>Password</label><span>' + esc(u.password) + '</span></div>';
      html += '<div class="user-field"><label>Joined</label><span>' + joined + '</span></div>';
      html += '</div></div>';

      // Stats
      html += '<div class="stats-grid">';
      html += '<div class="stat-card highlight"><div class="stat-label">Total Spent</div><div class="stat-value">' + fmtShort(s.totalSpent) + '</div></div>';
      html += '<div class="stat-card"><div class="stat-label">Transactions</div><div class="stat-value">' + s.count + '</div></div>';
      html += '<div class="stat-card"><div class="stat-label">Top Category</div><div class="stat-value">' + (topCat ? (CAT_EMOJI[topCat[0].toLowerCase()] || '💸') + ' ' + topCat[0] : '-') + '</div></div>';
      html += '</div>';

      // Category breakdown
      const cats = Object.entries(s.byCategory).sort((a,b) => b[1].total - a[1].total);
      if (cats.length > 0) {
        html += '<div class="section"><div class="section-title">Categories</div><div class="category-list">';
        cats.forEach(([cat, val]) => {
          html += '<div class="cat-tag">' + (CAT_EMOJI[cat.toLowerCase()] || '💸') + ' ' + cat + ' <span class="cat-amount">' + fmtShort(val.total) + '</span> (' + val.count + ')</div>';
        });
        html += '</div></div>';
      }

      // Mood breakdown
      const moods = Object.entries(s.byMood);
      if (moods.length > 0) {
        html += '<div class="section"><div class="section-title">Moods</div><div class="mood-list">';
        moods.forEach(([mood, count]) => {
          html += '<div class="mood-tag">' + (MOOD_EMOJI[mood.toLowerCase()] || '') + ' ' + mood + ' <span class="mood-count">' + count + '</span></div>';
        });
        html += '</div></div>';
      }

      // Full expense table
      html += '<div class="section"><div class="section-title">All Transactions (' + data.expenses.length + ')</div>';
      if (data.expenses.length > 0) {
        html += '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Item</th><th>Amount</th><th>Category</th><th>Place</th><th>Mood</th><th>Story</th></tr></thead><tbody>';
        data.expenses.forEach(e => {
          const date = new Date(e.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
          html += '<tr>';
          html += '<td>' + date + '</td>';
          html += '<td>' + esc(e.item) + '</td>';
          html += '<td>' + fmt(e.amount) + '</td>';
          html += '<td>' + (CAT_EMOJI[e.category.toLowerCase()] || '💸') + ' ' + esc(e.category) + '</td>';
          html += '<td>' + esc(e.place) + '</td>';
          html += '<td>' + (e.mood ? (MOOD_EMOJI[e.mood.toLowerCase()] || '') + ' ' + e.mood : '-') + '</td>';
          html += '<td class="story-text">' + esc(e.story) + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div>';
      } else {
        html += '<div style="text-align:center;padding:40px;color:var(--text3)">No transactions</div>';
      }
      html += '</div>';

      document.getElementById('content').innerHTML = html;
    }

    load();
  </script>
</body>
</html>`;