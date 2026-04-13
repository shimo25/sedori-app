/**
 * レポート画面（グラフ付き詳細分析）
 *
 * ① 年間 KPI カード（売上/仕入/経費/粗利/純利益/利益率）
 * ② 月次推移グラフ（棒+折れ線: 売上・仕入+経費・利益）
 * ③ 経費カテゴリ別ドーナツ
 * ⑤ ステータス別商品数（横棒）
 * ⑥ 累積利益カーブ（折れ線）
 * ⑦ 利益率分布（ヒストグラム）
 * ⑧ 仕入元別売上（横棒）
 * + 移動平均ライン / 前年同期比
 *
 * ④ プラットフォーム別は将来対応可能に構造だけ用意。
 */
const Reports = (() => {
  const _charts = {};

  function getPeriod() {
    return {
      year: Number(document.getElementById('reportYear').value) || new Date().getFullYear(),
      month: Number(document.getElementById('reportMonth').value) || 0
    };
  }

  function init() {
    const now = new Date();
    document.getElementById('reportYear').value = now.getFullYear();
    document.getElementById('reportMonth').value = 0; // 年間表示をデフォルトに

    document.getElementById('reportYear').addEventListener('change', refresh);
    document.getElementById('reportMonth').addEventListener('change', refresh);

    document.getElementById('btnExportCsvSales').onclick = () => CsvUtil.exportSales(getPeriod());
    document.getElementById('btnExportCsvExpenses').onclick = () => CsvUtil.exportExpenses(getPeriod());
    document.getElementById('btnExportCsvInventory').onclick = () => CsvUtil.exportInventory();
    document.getElementById('btnExportPdfJournal').onclick = async () => { Modal.toast('PDF生成中...'); await PdfUtil.exportJournal(getPeriod()); };
    document.getElementById('btnExportPdfLedger').onclick = async () => { Modal.toast('PDF生成中...'); await PdfUtil.exportLedger(getPeriod()); };
    document.getElementById('btnExportPdfPL').onclick = async () => { Modal.toast('PDF生成中...'); await PdfUtil.exportPL(getPeriod()); };
  }

  async function refresh() {
    const period = getPeriod();
    const [summary, ts] = await Promise.all([
      DataAgg.summarize(period),
      DataAgg.timeseries(period)
    ]);

    // ---- 前年同期データ（年間表示時のみ取得） ----
    let prevSummary = null;
    if (period.month === 0) {
      prevSummary = await DataAgg.summarize({ year: period.year - 1, month: 0 });
    }

    renderKPI(summary, prevSummary);
    renderTrendChart(ts, period);
    renderExpenseDonut(summary);
    renderStatusBar(summary);
    renderCumProfit(ts, period);
    renderMarginDist(summary);
    renderSourceBar(summary);
    renderTextSummary(summary);
  }

  // ---------- KPI ----------
  function renderKPI(s, prev) {
    // 売上総利益率（粗利率）= 粗利 ÷ 売上高
    const grossMargin = s.sales ? (s.grossProfit / s.sales * 100) : 0;
    // 営業利益率 = 純利益（営業利益）÷ 売上高
    const opMargin = s.sales ? (s.netProfit / s.sales * 100) : 0;
    const kpis = [
      { label: '売上高',      value: yen(s.sales),        color: 'sales' },
      { label: '売上原価',    value: yen(s.cost),          color: 'purchase' },
      { label: '販管費',      value: yen(s.fees + s.ship + (s.packaging||0) + (s.otherCost||0) + s.expenses), color: 'expense' },
      { label: '売上総利益',  value: yen(s.grossProfit),   color: s.grossProfit >= 0 ? 'profit' : 'loss' },
      { label: '営業利益',    value: yen(s.netProfit),     color: s.netProfit >= 0 ? 'profit' : 'loss' },
      { label: '営業利益率',  value: opMargin.toFixed(1) + '%', color: opMargin >= 0 ? 'profit' : 'loss' }
    ];
    const el = document.getElementById('reportKPI');
    el.innerHTML = kpis.map(k => {
      const yoy = prev ? buildYoY(k.label, prev, s) : '';
      return `<div class="kpi-item">
        <span class="kpi-label">${k.label}</span>
        <span class="kpi-value" style="color:var(--chart-${k.color})">${k.value}</span>
        ${yoy}
      </div>`;
    }).join('');
  }

  function buildYoY(label, prev, cur) {
    let curV, prevV;
    if (label === '売上高') { curV = cur.sales; prevV = prev.sales; }
    else if (label === '営業利益') { curV = cur.netProfit; prevV = prev.netProfit; }
    else return '';
    const pct = Analytics.yoyPct(curV, prevV);
    if (prevV === 0 && curV === 0) return '';
    const sign = pct >= 0 ? '+' : '';
    const cls = pct >= 0 ? 'up' : 'down';
    return `<span class="kpi-yoy ${cls}">${sign}${pct.toFixed(0)}% YoY</span>`;
  }

  // ---------- ② 月次推移（棒+折れ線） ----------
  function renderTrendChart(ts, period) {
    const ctx = document.getElementById('chartTrend').getContext('2d');
    destroy('trend');

    // 仕入+経費の合算
    const totalCost = ts.purchase.map((v, i) => v + ts.expense[i] + ts.fees[i] + ts.ship[i]);
    // 移動平均（年表示 3ヶ月、月表示 7日）
    const maWindow = period.month === 0 ? 3 : 7;
    const profitMA = Analytics.movingAverage(ts.profit, maWindow);

    _charts.trend = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ts.labels,
        datasets: [
          {
            label: '売上',
            data: ts.sales,
            backgroundColor: ChartTheme.alpha(ChartTheme.get('sales'), 0.7),
            borderColor: ChartTheme.get('sales'),
            borderWidth: 1,
            order: 2
          },
          {
            label: '仕入+経費',
            data: totalCost,
            backgroundColor: ChartTheme.alpha(ChartTheme.get('expense'), 0.5),
            borderColor: ChartTheme.get('expense'),
            borderWidth: 1,
            order: 3
          },
          {
            label: '純利益',
            data: ts.profit,
            type: 'line',
            borderColor: ChartTheme.get('profit'),
            backgroundColor: ChartTheme.alpha(ChartTheme.get('profit'), 0.1),
            fill: true,
            tension: 0.3,
            pointRadius: 3,
            borderWidth: 2,
            order: 1
          },
          {
            label: `利益(${maWindow}期平均)`,
            data: profitMA,
            type: 'line',
            borderColor: ChartTheme.get('neutral'),
            borderDash: [6, 3],
            pointRadius: 0,
            borderWidth: 1.5,
            fill: false,
            order: 0
          }
        ]
      },
      options: chartOpts('¥')
    });

    // ダブルタップ → その月/日の取引一覧へ
    attachDoubleTap('chartTrend', 'trend', 'x', ts.labels.length, (idx, onClose) => {
      const label = ts.labels[idx];
      const salesVal = ts.sales[idx];
      const profitVal = ts.profit[idx];
      let year = period.year, month = 0, day = 0;
      if (period.month === 0) {
        month = idx + 1; // 1月〜12月
      } else {
        month = period.month;
        day = idx + 1; // 1日〜末日
      }
      const periodLabel = period.month === 0
        ? `${year}年${month}月`
        : `${year}年${month}月${day}日`;
      showChartJumpPopup(
        periodLabel,
        `<p>売上: <b>${yen(salesVal)}</b> ／ 利益: <b>${yen(profitVal)}</b></p>
         <p>この期間の売却商品一覧を表示しますか？</p>`,
        () => { ProductsUI.filterByPeriod(year, month, day, periodLabel); switchView('products'); },
        onClose
      );
    });
  }

  // ---------- ③ 経費カテゴリ別ドーナツ ----------
  function renderExpenseDonut(s) {
    const ctx = document.getElementById('chartExpense').getContext('2d');
    destroy('expense');

    // 手数料・送料・梱包資材費もここに含める
    const data = {};
    data['販売手数料'] = Math.round(s.fees);
    data['送料'] = Math.round(s.ship);
    if (s.packaging) data['梱包資材費'] = Math.round(s.packaging);
    if (s.otherCost) data['その他経費(商品)'] = Math.round(s.otherCost);
    for (const [k, v] of Object.entries(s.byCategory)) {
      data[expenseCategoryLabel(k)] = v;
    }
    const entries = Object.entries(data).filter(([, v]) => v > 0);
    if (entries.length === 0) {
      entries.push(['データなし', 0]);
    }

    const palette = [
      ChartTheme.get('expense'), ChartTheme.get('accent1'), ChartTheme.get('accent2'),
      ChartTheme.get('accent3'), ChartTheme.get('accent4'), ChartTheme.get('accent5'),
      ChartTheme.get('accent6'), ChartTheme.get('warning'), ChartTheme.get('neutral')
    ];

    _charts.expense = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: entries.map(([l]) => l),
        datasets: [{
          data: entries.map(([, v]) => v),
          backgroundColor: entries.map((_, i) => palette[i % palette.length]),
          borderWidth: 1,
          borderColor: 'var(--card)'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '55%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: (c) => `${c.label}: ${yen(c.raw)}` } }
        }
      }
    });
  }

  // ---------- ⑤ ステータス別商品数（横棒） ----------
  function renderStatusBar(s) {
    const ctx = document.getElementById('chartStatus').getContext('2d');
    destroy('status');

    const entries = STATUSES.map(st => ({
      label: st.label,
      count: s.byStatus[st.key] || 0
    }));
    const statusColors = [
      ChartTheme.get('accent1'), ChartTheme.get('accent3'), ChartTheme.get('warning'),
      ChartTheme.get('accent5'), ChartTheme.get('accent2'), ChartTheme.get('neutral')
    ];

    _charts.status = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: entries.map(e => e.label),
        datasets: [{
          data: entries.map(e => e.count),
          backgroundColor: statusColors,
          borderWidth: 0
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { stepSize: 1 } },
          y: { grid: { display: false } }
        }
      }
    });

    // ダブルタップ → そのステータスの商品一覧へ
    attachDoubleTap('chartStatus', 'status', 'y', entries.length, (idx, onClose) => {
      const st = STATUSES[idx];
      if (!st || entries[idx].count === 0) return;
      showChartJumpPopup(
        `${st.label}`,
        `<p>該当商品: <b>${entries[idx].count}件</b></p>
         <p>この商品一覧を表示しますか？</p>`,
        () => { ProductsUI.filterByStatusFromReport(st.key, st.label); switchView('products'); },
        onClose
      );
    });
  }

  // ---------- ⑥ 累積利益カーブ ----------
  function renderCumProfit(ts, period) {
    const ctx = document.getElementById('chartCumProfit').getContext('2d');
    destroy('cumProfit');

    _charts.cumProfit = new Chart(ctx, {
      type: 'line',
      data: {
        labels: ts.labels,
        datasets: [{
          label: '累積利益',
          data: ts.cumProfit,
          borderColor: ChartTheme.get('profit'),
          backgroundColor: ChartTheme.alpha(ChartTheme.get('profit'), 0.15),
          fill: true,
          tension: 0.3,
          pointRadius: 2,
          borderWidth: 2
        }, {
          label: '±0 ライン',
          data: new Array(ts.labels.length).fill(0),
          borderColor: ChartTheme.get('neutral'),
          borderDash: [4, 4],
          pointRadius: 0,
          borderWidth: 1,
          fill: false
        }]
      },
      options: chartOpts('¥')
    });

    // ダブルタップ → その月/日の取引一覧へ
    attachDoubleTap('chartCumProfit', 'cumProfit', 'x', ts.labels.length, (idx, onClose) => {
      const label = ts.labels[idx];
      const cumVal = ts.cumProfit[idx];
      const profitVal = ts.profit[idx];
      let year = period.year, month = 0, day = 0;
      if (period.month === 0) {
        month = idx + 1;
      } else {
        month = period.month;
        day = idx + 1;
      }
      const periodLabel = period.month === 0
        ? `${year}年${month}月`
        : `${year}年${month}月${day}日`;
      showChartJumpPopup(
        periodLabel,
        `<p>当期利益: <b>${yen(profitVal)}</b> ／ 累積: <b>${yen(cumVal)}</b></p>
         <p>この期間の売却商品一覧を表示しますか？</p>`,
        () => { ProductsUI.filterByPeriod(year, month, day, periodLabel); switchView('products'); },
        onClose
      );
    });
  }

  // ---------- ⑦ 利益率分布ヒストグラム ----------
  function renderMarginDist(s) {
    const ctx = document.getElementById('chartMargin').getContext('2d');
    destroy('margin');

    const labels = ['<-50', '-50~-40', '-40~-30', '-30~-20', '-20~-10', '-10~0',
                    '0~10', '10~20', '20~30', '30~40', '40~50', '50~60', '60~100'];
    const colors = s.marginDist.map((_, i) => {
      if (i <= 5) return ChartTheme.alpha(ChartTheme.get('loss'), 0.4 + i * 0.1);
      return ChartTheme.alpha(ChartTheme.get('profit'), 0.3 + (i - 6) * 0.08);
    });

    // バケット境界（products.jsのフィルタに渡す用）
    const bucketEdges = [-Infinity, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60, 100];

    _charts.margin = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels.map(l => l + '%'),
        datasets: [{
          label: '件数',
          data: s.marginDist,
          backgroundColor: colors,
          borderWidth: 0
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1 } },
          x: { ticks: { font: { size: 9 }, maxRotation: 45 } }
        }
      }
    });

    // ダブルタップで商品一覧へ遷移（attachDoubleTapで統一管理）
    attachDoubleTap('chartMargin', 'margin', 'x', labels.length, (idx, onClose) => {
      if (s.marginDist[idx] === 0) return;
      const lo = bucketEdges[idx];
      const hi = bucketEdges[idx + 1];
      const label = labels[idx] + '%';
      const count = s.marginDist[idx];
      showChartJumpPopup(
        `粗利率 ${label}`,
        `<p>該当商品: <b>${count}件</b></p><p>この範囲の商品一覧を表示しますか？</p>`,
        () => { ProductsUI.filterByMargin(lo, hi, label); switchView('products'); },
        onClose
      );
    });
  }

  /**
   * 汎用チャートジャンプポップアップ
   * @param {string} title - ポップアップタイトル
   * @param {string} body  - 本文HTML
   * @param {Function} onGo - 「商品一覧へ」押下時のコールバック
   * @param {Function} onClose - ポップアップ閉じ後のコールバック（クールダウン用）
   */
  function showChartJumpPopup(title, body, onGo, onClose) {
    // 既存のポップアップをすべて削除（安全策）
    document.querySelectorAll('#chartJumpPopup').forEach(el => el.remove());

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'chartJumpPopup';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><h2>${title}</h2></div>
        <div class="modal-body">${body}</div>
        <div class="modal-footer">
          <button class="btn" data-v="cancel">閉じる</button>
          <button class="btn btn-primary" data-v="go">商品一覧へ</button>
        </div>
      </div>`;
    document.getElementById('modalRoot').appendChild(overlay);

    function closePopup(e) {
      e.stopPropagation();
      e.stopImmediatePropagation();
      overlay.remove();
      if (onClose) onClose();
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closePopup(e);
    });
    overlay.addEventListener('touchend', (e) => {
      if (e.target === overlay) { e.preventDefault(); closePopup(e); }
    }, { passive: false });

    overlay.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = btn.dataset.v;
        closePopup(e);
        if (action === 'go') onGo();
      });
      btn.addEventListener('touchend', (e) => {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        const action = btn.dataset.v;
        overlay.remove();
        if (onClose) onClose();
        if (action === 'go') onGo();
      }, { passive: false });
    });
  }

  /**
   * 汎用ダブルタップハンドラをcanvasに付与
   * @param {string} canvasId - canvas要素のID
   * @param {string} chartKey - _charts内のキー
   * @param {string} axis - 'x' or 'y'（横棒の場合は'y'）
   * @param {number} dataCount - データ点の数（scale.ticksはiPhoneで間引かれるため実データ数を渡す）
   * @param {Function} onDoubleTap - (index, onClose) => void
   */
  // 既存リスナーを管理するマップ（canvasId → { handler, abort }）
  const _tapListeners = {};

  function attachDoubleTap(canvasId, chartKey, axis, dataCount, onDoubleTap) {
    const canvas = document.getElementById(canvasId);

    // 前回のリスナーを削除（年変更時の二重登録を防止）
    if (_tapListeners[canvasId]) {
      canvas.removeEventListener('click', _tapListeners[canvasId]);
    }

    let lastTime = 0, lastIdx = -1, cooldown = 0;

    // iOSのダブルタップズームを防止
    canvas.style.touchAction = 'manipulation';

    function getIndex(e) {
      const chart = _charts[chartKey];
      if (!chart) return -1;
      const rect = canvas.getBoundingClientRect();
      const scale = chart.scales[axis];
      if (!scale) return -1;
      const coord = axis === 'x'
        ? (e.clientX || e.pageX) - rect.left
        : (e.clientY || e.pageY) - rect.top;
      for (let i = 0; i < dataCount; i++) {
        const pos = scale.getPixelForValue(i);
        const total = axis === 'x' ? scale.width : scale.height;
        const half = (total / dataCount) / 2;
        if (coord >= pos - half && coord <= pos + half) return i;
      }
      return -1;
    }

    function handler(e) {
      if (Date.now() - cooldown < 600) { lastIdx = -1; return; }
      if (document.getElementById('chartJumpPopup')) return;
      const idx = getIndex(e);
      if (idx < 0) { lastIdx = -1; return; }
      const now = Date.now();
      if (idx === lastIdx && now - lastTime < 400) {
        lastIdx = -1; lastTime = 0;
        onDoubleTap(idx, () => { cooldown = Date.now(); });
      } else {
        lastIdx = idx; lastTime = now;
      }
    }

    canvas.addEventListener('click', handler);
    _tapListeners[canvasId] = handler;
  }

  // ---------- ⑧ 仕入元別売上（横棒） ----------
  function renderSourceBar(s) {
    const ctx = document.getElementById('chartSource').getContext('2d');
    destroy('source');

    const entries = Object.entries(s.bySource).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (entries.length === 0) entries.push(['データなし', 0]);

    _charts.source = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: entries.map(([l]) => l),
        datasets: [{
          data: entries.map(([, v]) => v),
          backgroundColor: ChartTheme.alpha(ChartTheme.get('purchase'), 0.6),
          borderColor: ChartTheme.get('purchase'),
          borderWidth: 1
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { callback: v => '¥' + v.toLocaleString() } },
          y: { grid: { display: false } }
        }
      }
    });
  }

  // ---------- テキスト集計（既存相当） ----------
  function renderTextSummary(s) {
    const el = document.getElementById('reportSummary');
    const grossMargin = s.sales ? (s.grossProfit / s.sales * 100).toFixed(1) : '0.0';
    const opMargin = s.sales ? (s.netProfit / s.sales * 100).toFixed(1) : '0.0';
    el.innerHTML = `
      <table style="width:100%; font-size:14px;">
        <tr><td><b>損益計算書（P/L）</b></td><td></td></tr>
        <tr><td>売上高</td><td style="text-align:right">${yen(s.sales)}</td></tr>
        <tr><td>売上原価（仕入）</td><td style="text-align:right">${yen(s.cost)}</td></tr>
        <tr style="border-top:1.5px solid var(--border)">
          <td><b>売上総利益（粗利）</b></td>
          <td style="text-align:right"><b>${yen(s.grossProfit)}</b> <span class="muted">${grossMargin}%</span></td></tr>
        <tr><td colspan="2" class="muted" style="padding:4px 0 2px">─ 販売費及び一般管理費（販管費）</td></tr>
        <tr><td style="padding-left:12px">販売手数料</td><td style="text-align:right">${yen(Math.round(s.fees))}</td></tr>
        <tr><td style="padding-left:12px">荷造運賃（送料）</td><td style="text-align:right">${yen(Math.round(s.ship))}</td></tr>
        <tr><td style="padding-left:12px">梱包資材費</td><td style="text-align:right">${yen(Math.round(s.packaging || 0))}</td></tr>
        <tr><td style="padding-left:12px">その他経費（商品別）</td><td style="text-align:right">${yen(Math.round(s.otherCost || 0))}</td></tr>
        <tr><td style="padding-left:12px">その他経費（一般）</td><td style="text-align:right">${yen(s.expenses)}</td></tr>
        <tr style="border-top:2px solid var(--primary)">
          <td><b>営業利益</b></td>
          <td style="text-align:right"><b style="color:${s.netProfit >= 0 ? 'var(--success)' : 'var(--danger)'}">${yen(s.netProfit)}</b> <span class="muted">${opMargin}%</span></td></tr>
        <tr><td colspan="2" class="muted" style="padding-top:8px">販売件数: ${s.soldCount}件</td></tr>
      </table>`;
  }

  // ---------- ヘルパー ----------
  function destroy(key) {
    if (_charts[key]) { _charts[key].destroy(); _charts[key] = null; }
  }

  function chartOpts(prefix) {
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${prefix === '¥' ? yen(c.raw) : c.raw}` } }
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => prefix === '¥' ? '¥' + v.toLocaleString() : v } },
        x: { grid: { display: false } }
      }
    };
  }

  return { init, refresh };
})();
