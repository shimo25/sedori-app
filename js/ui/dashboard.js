/**
 * ダッシュボード（ホーム画面サマリー）
 */
const Dashboard = (() => {
  let _chart = null;

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
  }

  return { refresh };
})();
