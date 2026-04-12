/**
 * エントリポイント
 */
(async function main() {
  await DB.open();

  // 設定の初期値
  const presets = await DB.Settings.get('feePresets', null);
  if (!presets) await DB.Settings.set('feePresets', DEFAULT_FEE_PRESETS);

  // ダークモード適用（画面描画前に先に適用）
  await DarkMode.init();

  // グラフ配色ロード
  await ChartTheme.load();

  // タブ切替
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // + ボタン
  document.getElementById('btnAdd').addEventListener('click', () => {
    const v = currentView();
    if (v === 'products' || v === 'dashboard') ProductsUI.openForm();
    else if (v === 'expenses') ExpensesUI.openForm();
    else if (v === 'materials') MaterialsUI.openForm();
    else ProductsUI.openForm();
  });

  // 商品フィルタ
  document.getElementById('statusFilter').addEventListener('change', ProductsUI.render);
  document.getElementById('searchBox').addEventListener('input', ProductsUI.render);
  // sortOrder は products.js 内で動的生成＆リスナー登録

  // レポート初期化
  Reports.init();

  // 設定画面初期化
  SettingsUI.init();

  // 資材画面初期化
  MaterialsUI.init();

  // 初期描画
  await Dashboard.refresh();
  await ProductsUI.render();
  await ExpensesUI.render();

  // バックアップ促進チェック
  SettingsUI.checkBackupReminder();

  // Service Worker 登録 + 更新検知
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.register('sw.js').catch(() => null);
    if (reg) {
      // 新バージョンが見つかったら通知バーを表示
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBar();
          }
        });
      });
      // 起動時にも手動チェック（キャッシュ更新検知）
      reg.update().catch(() => {});
    }
  }
})();

function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  const titles = {
    dashboard: 'ダッシュボード', products: '商品', expenses: '経費',
    materials: '梱包資材', reports: 'レポート', settings: '設定'
  };
  document.getElementById('pageTitle').textContent = titles[name] || '';
  if (name === 'dashboard') Dashboard.refresh();
  if (name === 'products') ProductsUI.render();
  if (name === 'expenses') ExpensesUI.render();
  if (name === 'materials') MaterialsUI.render();
  if (name === 'reports') Reports.refresh();
  if (name === 'settings') SettingsUI.render();
}

function currentView() {
  const active = document.querySelector('.view.active');
  return active ? active.id.replace('view-', '') : 'dashboard';
}

function showUpdateBar() {
  if (document.getElementById('updateBar')) return;
  const bar = document.createElement('div');
  bar.id = 'updateBar';
  bar.className = 'update-bar';
  bar.innerHTML = '新しいバージョンがあります <button id="btnUpdate">タップで更新</button>';
  document.body.prepend(bar);
  document.getElementById('btnUpdate').onclick = () => {
    location.reload();
  };
}
