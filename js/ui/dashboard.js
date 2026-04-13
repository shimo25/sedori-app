/**
 * ダッシュボード（ホーム画面サマリー）
 */
const Dashboard = (() => {
  let _chart = null;
  let _tapHandler = null;

  async function refresh() {
    const [products, expenses] = await Promise.all([DB.Products.list(), DB.Expenses.list()]);
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

    // 今月の売上（販売日が今月のもの）
    const monthSold = products.filter(p => p.salePrice && p.saleDate && p.saleDate.startsWith(ym));
    const monthSales = monthSold.reduce((s, p) => s + (p.salePrice || 0), 0);
    const monthProfit = monthSold.reduce((s, p) => s + ProductsUI.calcProfit(p), 0);

    // 在庫金額（未販売の仕入合計）
    const stockAmt = products
      .filter(p => !p.salePrice || p.status !== 'completed')
      .reduce((s, p) => s + (p.purchasePrice * (p.quantity || 1)), 0);

    // 進行中取引
    const ongoing = products.filter(p =>
      ['listed','trading','shipped','await_rating'].includes(p.status)).length;

    document.getElementById('dashSales').textContent = yen(monthSales);
    document.getElementById('dashProfit').textContent = yen(monthProfit);
    document.getElementById('dashStock').textContent = yen(stockAmt);
    document.getElementById('dashOngoing').textContent = ongoing;

    renderChart(products);
  }

  function renderChart(products) {
    // 直近6ヶ月の売上・粗利
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
    }
    const salesByMonth = months.map(ym => {
      return products
        .filter(p => p.saleDate && p.saleDate.startsWith(ym))
        .reduce((s, p) => s + (p.salePrice || 0), 0);
    });
    const profitByMonth = months.map(ym => {
      return products
        .filter(p => p.saleDate && p.saleDate.startsWith(ym))
        .reduce((s, p) => s + ProductsUI.calcProfit(p), 0);
    });
    const ctx = document.getElementById('chartMonthly').getContext('2d');
    if (_chart) _chart.destroy();
    _chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: months.map(m => m.slice(5) + '月'),
        datasets: [
          {
            label: '売上',
            data: salesByMonth,
            backgroundColor: ChartTheme.alpha(ChartTheme.get('sales'), 0.7),
            borderColor: ChartTheme.get('sales'),
            borderWidth: 1
          },
          {
            label: '利益',
            data: profitByMonth,
            backgroundColor: ChartTheme.alpha(ChartTheme.get('profit'), 0.7),
            borderColor: ChartTheme.get('profit'),
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } },
        scales: { y: { beginAtZero: true, ticks: { callback: v => '¥' + v.toLocaleString() } } }
      }
    });

    // ダブルタップ → その月の売却商品一覧へ
    const canvas = document.getElementById('chartMonthly');
    canvas.style.touchAction = 'manipulation';
    if (_tapHandler) canvas.removeEventListener('click', _tapHandler);

    let lastTime = 0, lastIdx = -1, cooldown = 0;

    _tapHandler = function(e) {
      if (Date.now() - cooldown < 600) { lastIdx = -1; return; }
      if (document.getElementById('chartJumpPopup')) return;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX || e.pageX) - rect.left;
      const xScale = _chart.scales.x;
      let idx = -1;
      for (let i = 0; i < months.length; i++) {
        const pos = xScale.getPixelForValue(i);
        const half = (xScale.width / months.length) / 2;
        if (x >= pos - half && x <= pos + half) { idx = i; break; }
      }
      if (idx < 0) { lastIdx = -1; return; }
      const tapNow = Date.now();
      if (idx === lastIdx && tapNow - lastTime < 400) {
        lastIdx = -1; lastTime = 0;
        // "2025-07" → year=2025, month=7
        const year = Number(months[idx].slice(0, 4));
        const month = Number(months[idx].slice(5));
        const periodLabel = `${year}年${month}月`;
        // ポップアップ表示
        showDashJumpPopup(
          periodLabel,
          `<p>売上: <b>${yen(salesByMonth[idx])}</b> ／ 利益: <b>${yen(profitByMonth[idx])}</b></p>
           <p>この期間の売却商品一覧を表示しますか？</p>`,
          () => { ProductsUI.filterByPeriod(year, month, 0, periodLabel); switchView('products'); },
          () => { cooldown = Date.now(); }
        );
      } else {
        lastIdx = idx; lastTime = tapNow;
      }
    };
    canvas.addEventListener('click', _tapHandler);
  }

  function showDashJumpPopup(title, body, onGo, onClose) {
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
      e.stopPropagation(); e.stopImmediatePropagation();
      overlay.remove();
      if (onClose) onClose();
    }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closePopup(e); });
    overlay.addEventListener('touchend', (e) => {
      if (e.target === overlay) { e.preventDefault(); closePopup(e); }
    }, { passive: false });
    overlay.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = btn.dataset.v; closePopup(e);
        if (action === 'go') onGo();
      });
      btn.addEventListener('touchend', (e) => {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        const action = btn.dataset.v; overlay.remove();
        if (onClose) onClose();
        if (action === 'go') onGo();
      }, { passive: false });
    });
  }

  return { refresh };
})();
