/**
 * グラフ用ユーティリティ
 *  - ChartTheme: 意味で色分けされた配色テーマ（CSS変数 + IndexedDB 保存）
 *  - Analytics : 移動平均・前年同期比などの分析計算ヘルパー
 *  - DataAgg   : レポート用のデータ集計（売上/経費/利益を月次・日次に展開）
 */

// ===== ChartTheme（配色テーマ） =====
const ChartTheme = (() => {
  // 意味で色分け（デフォルト）
  const DEFAULT_THEME = {
    sales:    '#2c7be5', // 売上 = 青
    purchase: '#8b5cf6', // 仕入 = 紫
    expense:  '#f39c12', // 経費 = オレンジ
    profit:   '#27ae60', // 利益（黒字）= 緑
    loss:     '#e74c3c', // 損失（赤字）= 赤
    neutral:  '#94a3b8', // 中立 = グレー
    warning:  '#fbbf24', // 警告 = 黄
    accent1:  '#06b6d4', // ステータス系
    accent2:  '#ec4899',
    accent3:  '#84cc16',
    accent4:  '#f97316',
    accent5:  '#a855f7',
    accent6:  '#14b8a6'
  };

  const ROLE_LABELS = {
    sales:    '売上',
    purchase: '仕入',
    expense:  '経費',
    profit:   '利益（黒字）',
    loss:     '損失（赤字）',
    neutral:  '中立（基準線等）',
    warning:  '警告',
    accent1:  'アクセント1',
    accent2:  'アクセント2',
    accent3:  'アクセント3',
    accent4:  'アクセント4',
    accent5:  'アクセント5',
    accent6:  'アクセント6'
  };

  let _current = { ...DEFAULT_THEME };

  function applyToCSS(theme) {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(theme)) {
      root.style.setProperty(`--chart-${k}`, v);
    }
  }

  async function load() {
    const saved = await DB.Settings.get('chartTheme', null);
    _current = { ...DEFAULT_THEME, ...(saved || {}) };
    applyToCSS(_current);
    return _current;
  }

  async function save(theme) {
    _current = { ...DEFAULT_THEME, ...theme };
    applyToCSS(_current);
    await DB.Settings.set('chartTheme', _current);
  }

  async function reset() {
    _current = { ...DEFAULT_THEME };
    applyToCSS(_current);
    await DB.Settings.set('chartTheme', _current);
  }

  function get(role) {
    return _current[role] || DEFAULT_THEME[role] || '#888';
  }

  function alpha(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r},${g},${b},${a})`;
  }

  return { DEFAULT_THEME, ROLE_LABELS, load, save, reset, get, alpha, current: () => _current };
})();


// ===== Analytics（分析ヘルパー） =====
const Analytics = (() => {
  // 単純移動平均（windowSize 個分）
  function movingAverage(values, windowSize = 3) {
    const out = [];
    for (let i = 0; i < values.length; i++) {
      const from = Math.max(0, i - windowSize + 1);
      const slice = values.slice(from, i + 1);
      out.push(slice.reduce((s, v) => s + v, 0) / slice.length);
    }
    return out;
  }

  // 配列の累積合計
  function cumulative(values) {
    let sum = 0;
    return values.map(v => (sum += v));
  }

  // 前年同期比（%）
  function yoyPct(curr, prev) {
    if (prev === 0) return curr > 0 ? 100 : 0;
    return ((curr - prev) / Math.abs(prev)) * 100;
  }

  // 利益率（%）
  function profitMargin(profit, sales) {
    if (!sales) return 0;
    return (profit / sales) * 100;
  }

  return { movingAverage, cumulative, yoyPct, profitMargin };
})();


// ===== DataAgg（売上/経費/利益の集計） =====
const DataAgg = (() => {

  // 商品 1 件あたりの諸計算
  function calcOne(p) {
    const cost = (p.purchasePrice || 0) * (p.quantity || 1);
    const sales = p.salePrice || 0;
    const fee = p.feeAmount != null ? p.feeAmount : (p.feeRate ? sales * p.feeRate / 100 : 0);
    const ship = p.shippingCost || 0;
    const packaging = p.packagingCost || 0;
    const other = p.otherCost || 0;
    const grossProfit = sales - cost;
    const netProfit = sales - cost - fee - ship - packaging - other;
    return { cost, sales, fee, ship, packaging, other, grossProfit, netProfit };
  }

  /**
   * 期間ごとの集計（暦年/暦月ベース）
   * period = { year, month } (month=0 で年間)
   * 戻り値: { sales, cost, fees, ship, expenses, grossProfit, netProfit, soldCount, byCategory{...}, bySource{...}, byPlatform{...}, byStatus{...}, marginDist[10], sold:[] }
   */
  async function summarize(period) {
    const [products, expenses] = await Promise.all([DB.Products.list(), DB.Expenses.list()]);

    const inP = (d) => {
      if (!d) return false;
      if (period.month === 0) return d.startsWith(String(period.year));
      const ym = `${period.year}-${String(period.month).padStart(2, '0')}`;
      return d.startsWith(ym);
    };

    const sold = products.filter(p => p.salePrice && p.saleDate && inP(p.saleDate));
    let sales = 0, cost = 0, fees = 0, ship = 0, packagingSum = 0, otherSum = 0;
    const bySource = {}, byPlatform = {};
    const margins = [];

    for (const p of sold) {
      const c = calcOne(p);
      sales += c.sales;
      cost += c.cost;
      fees += c.fee;
      ship += c.ship;
      packagingSum += c.packaging;
      otherSum += c.other;
      // 仕入元別
      const src = (p.purchaseFrom || '不明').trim() || '不明';
      bySource[src] = (bySource[src] || 0) + c.sales;
      // プラットフォーム別
      const pf = p.platform || 'unknown';
      byPlatform[pf] = (byPlatform[pf] || 0) + c.sales;
      // 利益率
      if (c.sales > 0) margins.push((c.netProfit / c.sales) * 100);
    }

    // 経費（仕入を除く諸経費）
    const periodExpenses = expenses.filter(e => inP(e.date));
    const byCategory = {};
    let expSum = 0;
    for (const e of periodExpenses) {
      byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
      expSum += e.amount;
    }

    // 全商品ステータス別（期間に依存しない）
    const byStatus = {};
    for (const p of products) {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    }

    // 利益率の分布（上限100%）
    // [<-50, -50~-40, -40~-30, -30~-20, -20~-10, -10~0, 0~10, 10~20, 20~30, 30~40, 40~50, 50~60, 60~100]
    const bucketEdges = [-Infinity, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60];
    const dist = new Array(13).fill(0);
    for (const m of margins) {
      const clamped = Math.min(m, 99.9); // 上限100%
      for (let i = bucketEdges.length - 1; i >= 0; i--) {
        if (clamped >= bucketEdges[i]) { dist[i]++; break; }
      }
    }

    const grossProfit = sales - cost;
    const netProfit = grossProfit - fees - ship - packagingSum - otherSum - expSum;

    return {
      sales, cost, fees, ship,
      packaging: packagingSum, otherCost: otherSum,
      expenses: expSum,
      grossProfit, netProfit,
      soldCount: sold.length,
      byCategory, bySource, byPlatform, byStatus,
      marginDist: dist,
      sold, periodExpenses
    };
  }

  /**
   * 期間内の月次（年表示時）または日次（月表示時）系列を返す
   * 戻り値: { labels[], sales[], purchase[], expense[], profit[], cumProfit[] }
   */
  async function timeseries(period) {
    const [products, expenses] = await Promise.all([DB.Products.list(), DB.Expenses.list()]);

    let buckets, labels, keyOf;
    if (period.month === 0) {
      // 年表示: 1月〜12月の 12 バケット
      buckets = 12;
      labels = Array.from({ length: 12 }, (_, i) => `${i + 1}月`);
      keyOf = (d) => {
        if (!d || !d.startsWith(String(period.year))) return -1;
        return Number(d.slice(5, 7)) - 1;
      };
    } else {
      // 月表示: 1日〜末日の日次バケット
      const lastDay = new Date(period.year, period.month, 0).getDate();
      buckets = lastDay;
      labels = Array.from({ length: lastDay }, (_, i) => `${i + 1}日`);
      const ym = `${period.year}-${String(period.month).padStart(2, '0')}`;
      keyOf = (d) => {
        if (!d || !d.startsWith(ym)) return -1;
        return Number(d.slice(8, 10)) - 1;
      };
    }

    const sales    = new Array(buckets).fill(0);
    const purchase = new Array(buckets).fill(0);
    const expense  = new Array(buckets).fill(0);
    const fees     = new Array(buckets).fill(0);
    const ship     = new Array(buckets).fill(0);
    const pkg      = new Array(buckets).fill(0);
    const other    = new Array(buckets).fill(0);

    for (const p of products) {
      // 売上は saleDate 基準
      if (p.salePrice && p.saleDate) {
        const i = keyOf(p.saleDate);
        if (i >= 0) {
          const c = calcOne(p);
          sales[i] += c.sales;
          fees[i]  += c.fee;
          ship[i]  += c.ship;
          pkg[i]   += c.packaging;
          other[i] += c.other;
        }
      }
      // 仕入は purchaseDate 基準
      if (p.purchasePrice && p.purchaseDate) {
        const i = keyOf(p.purchaseDate);
        if (i >= 0) {
          purchase[i] += (p.purchasePrice || 0) * (p.quantity || 1);
        }
      }
    }
    for (const e of expenses) {
      const i = keyOf(e.date);
      if (i >= 0) expense[i] += e.amount;
    }

    // 純利益 = 売上 - 仕入 - 手数料 - 送料 - 梱包資材費 - その他経費 - 経費
    const profit = sales.map((s, i) => s - purchase[i] - fees[i] - ship[i] - pkg[i] - other[i] - expense[i]);
    const cumProfit = Analytics.cumulative(profit);

    return { labels, sales, purchase, expense, fees, ship, profit, cumProfit };
  }

  return { calcOne, summarize, timeseries };
})();
