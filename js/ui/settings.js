/**
 * 設定画面
 */
const SettingsUI = (() => {
  function init() {
    document.getElementById('btnBackup').onclick = async () => {
      await doBackup();
    };
    document.getElementById('fileRestore').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!(await Modal.confirm('現在のデータを全て置き換えます。続行しますか？'))) return;
      try {
        const text = await file.text();
        await DB.importAll(JSON.parse(text));
        Modal.toast('インポート完了');
        location.reload();
      } catch (err) {
        Modal.toast('インポート失敗: ' + err.message);
      }
    };
    document.getElementById('btnAddPreset').onclick = async () => {
      const presets = await DB.Settings.get('feePresets', DEFAULT_FEE_PRESETS);
      presets.push({ id: uid(), name: '新しい販売先', rate: 10 });
      await DB.Settings.set('feePresets', presets);
      render();
    };

    // CSV インポート
    document.getElementById('btnCsvImport').onclick = () => CsvImport.openImportDialog();

    // ダークモードボタン
    document.querySelectorAll('.dm-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const mode = btn.dataset.dm;
        await DB.Settings.set('darkMode', mode);
        DarkMode.apply(mode);
        renderDarkMode();
      });
    });

    // グラフ配色リセット
    document.getElementById('btnResetTheme').onclick = async () => {
      await ChartTheme.reset();
      renderThemeColors();
      Modal.toast('配色をリセットしました');
    };

    // 設定画面の中にリサーチ呼び出しボタンを追加
    const aboutCard = document.querySelector('#view-settings .card:last-child');
    const researchBtn = document.createElement('button');
    researchBtn.className = 'btn btn-primary btn-block';
    researchBtn.textContent = '相場リサーチを開く';
    researchBtn.onclick = () => Research.openDialog();
    aboutCard.insertBefore(researchBtn, aboutCard.querySelector('p'));
  }

  async function render() {
    await renderFeePresets();
    renderDarkMode();
    renderThemeColors();
  }

  // ---------- ダークモード ----------
  async function renderDarkMode() {
    const mode = await DB.Settings.get('darkMode', 'light');
    document.querySelectorAll('.dm-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.dm === mode);
    });
  }

  // ---------- グラフ配色 ----------
  function renderThemeColors() {
    const theme = ChartTheme.current();
    const labels = ChartTheme.ROLE_LABELS;
    const container = document.getElementById('themeColors');
    container.innerHTML = '';
    const editableKeys = ['sales', 'purchase', 'expense', 'profit', 'loss', 'neutral', 'warning'];
    for (const key of editableKeys) {
      const row = document.createElement('div');
      row.className = 'theme-row';
      row.innerHTML = `
        <label>${labels[key] || key}</label>
        <input type="color" value="${theme[key]}" data-role="${key}">
      `;
      container.appendChild(row);
    }
    container.querySelectorAll('input[type="color"]').forEach(inp => {
      inp.addEventListener('change', async () => {
        const updated = { ...ChartTheme.current(), [inp.dataset.role]: inp.value };
        await ChartTheme.save(updated);
      });
    });
  }

  // ---------- 手数料プリセット ----------
  async function renderFeePresets() {
    const presets = await DB.Settings.get('feePresets', DEFAULT_FEE_PRESETS);
    const container = document.getElementById('feePresets');
    container.innerHTML = '';
    presets.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'form-row preset-row';
      row.innerHTML = `
        <label>名称<input type="text" value="${escapeAttr(p.name)}" data-i="${i}" data-k="name"></label>
        <label>手数料(%)<input type="number" value="${p.rate}" data-i="${i}" data-k="rate" step="0.1"></label>
        <label>&nbsp;<button class="btn btn-danger" data-del="${i}">削除</button></label>
      `;
      container.appendChild(row);
    });
    container.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('change', async () => {
        presets[inp.dataset.i][inp.dataset.k] = inp.dataset.k === 'rate' ? Number(inp.value) : inp.value;
        await DB.Settings.set('feePresets', presets);
      });
    });
    container.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = async () => {
        presets.splice(Number(btn.dataset.del), 1);
        await DB.Settings.set('feePresets', presets);
        renderFeePresets();
      };
    });
  }

  function escapeAttr(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  // ---------- バックアップ実行 ----------
  async function doBackup() {
    const data = await DB.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sedori-backup-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 100);
    await DB.Settings.set('lastBackupDate', today());
    Modal.toast('バックアップしました');
  }

  // ---------- バックアップ促進チェック ----------
  const BACKUP_INTERVAL_DAYS = 7;
  async function checkBackupReminder() {
    const last = await DB.Settings.get('lastBackupDate', null);
    if (!last) {
      // 一度もバックアップしていない場合、初回起動から3日後に促す
      const firstUse = await DB.Settings.get('firstUseDate', null);
      if (!firstUse) {
        await DB.Settings.set('firstUseDate', today());
        return;
      }
      if (daysSince(firstUse) < 3) return;
    } else {
      if (daysSince(last) < BACKUP_INTERVAL_DAYS) return;
    }
    // 今日すでに表示済みなら出さない
    const dismissed = await DB.Settings.get('backupDismissedDate', null);
    if (dismissed === today()) return;
    showBackupReminder();
  }

  function daysSince(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    return Math.floor((now - d) / (1000 * 60 * 60 * 24));
  }

  function showBackupReminder() {
    if (document.getElementById('backupReminder')) return;
    const bar = document.createElement('div');
    bar.id = 'backupReminder';
    bar.className = 'backup-reminder';
    const last = '';
    bar.innerHTML = `
      <span>データのバックアップをおすすめします</span>
      <div class="backup-reminder-btns">
        <button id="btnBackupNow" class="btn btn-primary btn-sm">今すぐ保存</button>
        <button id="btnBackupLater" class="btn btn-sm">あとで</button>
      </div>
    `;
    document.body.prepend(bar);
    document.getElementById('btnBackupNow').onclick = async () => {
      bar.remove();
      await doBackup();
    };
    document.getElementById('btnBackupLater').onclick = async () => {
      bar.remove();
      await DB.Settings.set('backupDismissedDate', today());
    };
  }

  return { init, render, checkBackupReminder };
})();


/**
 * ダークモード管理
 * light / dark / auto（端末連動）
 */
const DarkMode = (() => {
  let _mediaQuery = null;
  let _listener = null;

  function apply(mode) {
    // 既存リスナー除去
    if (_mediaQuery && _listener) {
      _mediaQuery.removeEventListener('change', _listener);
      _listener = null;
    }

    if (mode === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (mode === 'auto') {
      _mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const setAuto = () => {
        document.documentElement.classList.toggle('dark', _mediaQuery.matches);
      };
      setAuto();
      _listener = setAuto;
      _mediaQuery.addEventListener('change', _listener);
    } else {
      document.documentElement.classList.remove('dark');
    }

    // Chart.js のグローバルデフォルト色をダーク対応
    updateChartDefaults();
  }

  function updateChartDefaults() {
    const isDark = document.documentElement.classList.contains('dark');
    if (typeof Chart !== 'undefined') {
      const textColor = isDark ? '#e2e8f0' : '#1f2937';
      const gridColor = isDark ? 'rgba(148,163,184,0.2)' : 'rgba(0,0,0,0.1)';
      Chart.defaults.color = textColor;
      Chart.defaults.borderColor = gridColor;
    }
  }

  async function init() {
    const mode = await DB.Settings.get('darkMode', 'light');
    apply(mode);
  }

  return { apply, init };
})();
