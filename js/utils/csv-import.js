/**
 * CSV インポートユーティリティ
 *
 * 任意の CSV を読み込み → 先頭行プレビュー → 列マッピング UI →
 * 確認 → 既存商品を全クリアして一括インポート。
 *
 * 日付フォーマットは YYYY/MM/DD, YYYY-MM-DD, YYYY.MM.DD, MM/DD/YYYY に対応。
 */
const CsvImport = (() => {

  // ---- マッピング可能なフィールド定義 ----
  const FIELD_DEFS = [
    { key: '',              label: '（使わない）' },
    { key: 'name',          label: '商品名',      required: true },
    { key: 'purchaseDate',  label: '仕入日' },
    { key: 'purchasePrice', label: '仕入価格',    type: 'number' },
    { key: 'purchaseFrom',  label: '仕入先' },
    { key: 'saleDate',      label: '販売日' },
    { key: 'salePrice',     label: '売値（販売価格）', type: 'number' },
    { key: 'listPrice',     label: '出品価格',    type: 'number' },
    { key: 'feeAmount',     label: '手数料（円）', type: 'number' },
    { key: 'feeRate',       label: '手数料率（%）', type: 'number' },
    { key: 'shippingCost',  label: '送料',        type: 'number' },
    { key: 'packagingCost', label: '梱包資材費',  type: 'number' },
    { key: 'otherCost',     label: 'その他経費（商品単位）', type: 'number' },
    { key: 'profit',        label: '利益（参考値・取込まない）', type: 'ignore' },
    { key: 'profitRate',    label: '利益率（参考値・取込まない）', type: 'ignore' },
    { key: 'quantity',      label: '数量',        type: 'number' },
    { key: 'platform',      label: '販売先' },
    { key: 'status',        label: 'ステータス' },
    { key: 'listDate',      label: '出品日' },
    { key: 'shipDate',      label: '発送日' },
    { key: 'sku',           label: '管理番号(SKU)' },
    { key: 'category',      label: 'カテゴリ' },
    { key: 'memo',          label: 'メモ' }
  ];

  let _rows = [];      // パース済み全行
  let _headers = [];   // 先頭行（ヘッダー候補）
  let _mapping = [];   // 列 → フィールド key の配列
  let _hasHeader = true;

  // ===== CSV パーサー（RFC 4180 準拠） =====
  function parseCSV(text) {
    const rows = [];
    let i = 0;
    const len = text.length;
    while (i < len) {
      const row = [];
      while (i < len) {
        let val = '';
        if (text[i] === '"') {
          // クォート付きフィールド
          i++;
          while (i < len) {
            if (text[i] === '"') {
              if (i + 1 < len && text[i + 1] === '"') {
                val += '"'; i += 2;
              } else {
                i++; break;
              }
            } else {
              val += text[i++];
            }
          }
        } else {
          // 非クォート
          while (i < len && text[i] !== ',' && text[i] !== '\r' && text[i] !== '\n') {
            val += text[i++];
          }
        }
        row.push(val.trim());
        if (i < len && text[i] === ',') { i++; continue; }
        break;
      }
      // 改行スキップ
      while (i < len && (text[i] === '\r' || text[i] === '\n')) i++;
      if (row.length > 0 && !(row.length === 1 && row[0] === '')) {
        rows.push(row);
      }
    }
    return rows;
  }

  // ===== 日付パース =====
  function parseDate(s) {
    if (!s) return '';
    const str = String(s).trim();
    // YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD
    let m = str.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    // MM/DD/YYYY
    m = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
    if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    // YYYYMMDD
    m = str.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return '';
  }

  // ===== 数値パース（¥やカンマ対応） =====
  function parseNum(s) {
    if (s == null || s === '') return 0;
    const cleaned = String(s).replace(/[¥￥$,、\s%％]/g, '');
    const n = Number(cleaned);
    return isNaN(n) ? 0 : n;
  }

  // ===== ステータス推定 =====
  function guessStatus(s) {
    if (!s) return 'completed';
    const t = String(s).trim();
    if (/取引完了|完了|sold|済/.test(t)) return 'completed';
    if (/出品中|listing|active/.test(t)) return 'listed';
    if (/出品前|準備|draft/.test(t)) return 'stocked';
    if (/取引中|trading/.test(t)) return 'trading';
    if (/発送済|shipped/.test(t)) return 'shipped';
    if (/評価|rating|await/.test(t)) return 'await_rating';
    if (/仕入|stocked|在庫/.test(t)) return 'stocked';
    return 'completed';
  }

  // ===== プラットフォーム推定 =====
  function guessPlatform(s) {
    if (!s) return 'mercari';
    const t = String(s).toLowerCase();
    if (/メルカリ|mercari/.test(t)) return 'mercari';
    if (/ヤフオク|yahoo|yauction/.test(t)) return 'yahoo';
    if (/amazon|アマゾン/.test(t)) return 'amazon';
    if (/paypay|ペイペイ/.test(t)) return 'paypay';
    return 'mercari';
  }

  // ===== 列ヘッダーから自動マッピング推定 =====
  function autoGuess(headers) {
    return headers.map(h => {
      const t = String(h).toLowerCase().replace(/[\s_\-]/g, '');
      if (/商品名|name|品名|タイトル|title/.test(t)) return 'name';
      if (/仕入日|purchasedate|仕入れ日|入荷日/.test(t)) return 'purchaseDate';
      if (/仕入価格|仕入れ値|仕入額|原価|purchaseprice|cost|仕入単価/.test(t)) return 'purchasePrice';
      if (/仕入先|仕入元|purchasefrom|shop/.test(t)) return 'purchaseFrom';
      if (/取引完了日|販売日|売却日|saledate|solddate|完了日/.test(t)) return 'saleDate';
      if (/売値|販売価格|saleprice|売上|売却額|selling/.test(t)) return 'salePrice';
      if (/出品価格|listprice|希望価格/.test(t)) return 'listPrice';
      if (/手数料額|feeamount|手数料\(円\)|手数料円/.test(t)) return 'feeAmount';
      if (/^手数料$/.test(t)) return 'feeAmount';
      if (/手数料[率%]|feerate|手数料\(%\)/.test(t)) return 'feeRate';
      if (/送料|shipping|配送/.test(t)) return 'shippingCost';
      if (/梱包資材費|梱包費|packagingcost|梱包材/.test(t)) return 'packagingCost';
      if (/^経費$|othercost|その他経費|雑費/.test(t)) return 'otherCost';
      if (/利益率|profitrate|margin/.test(t)) return 'profitRate';
      if (/利益|profit|粗利/.test(t)) return 'profit';
      if (/数量|qty|quantity/.test(t)) return 'quantity';
      if (/販売先|platform|プラットフォーム/.test(t)) return 'platform';
      if (/ステータス|status|状態/.test(t)) return 'status';
      if (/出品日|listdate|掲載日/.test(t)) return 'listDate';
      if (/発送日|shipdate/.test(t)) return 'shipDate';
      if (/sku|管理番号|管理コード/.test(t)) return 'sku';
      if (/カテゴリ|category|ジャンル/.test(t)) return 'category';
      if (/メモ|memo|備考|note/.test(t)) return 'memo';
      return '';
    });
  }

  // ===== 行 → Product オブジェクト変換 =====
  function rowToProduct(row) {
    const p = {
      id: uid(),
      name: '', purchaseDate: today(), purchasePrice: 0,
      purchaseFrom: '', quantity: 1, status: 'completed',
      platform: 'mercari', listPrice: 0, salePrice: 0,
      saleDate: '', feeRate: 0, feeAmount: 0, shippingCost: 0,
      packagingCost: 0, otherCost: 0,
      listDate: '', shipDate: '',
      sku: '', category: '', memo: '', imageIds: []
    };

    const dateKeys = ['purchaseDate', 'saleDate', 'listDate', 'shipDate'];

    for (let ci = 0; ci < _mapping.length; ci++) {
      const key = _mapping[ci];
      if (!key) continue;
      const raw = row[ci] ?? '';
      const def = FIELD_DEFS.find(f => f.key === key);
      if (!def || def.type === 'ignore') continue;

      if (dateKeys.includes(key)) {
        p[key] = parseDate(raw) || p[key];
      } else if (def.type === 'number') {
        p[key] = parseNum(raw);
      } else if (key === 'status') {
        p.status = guessStatus(raw);
      } else if (key === 'platform') {
        p.platform = guessPlatform(raw);
      } else {
        p[key] = raw;
      }
    }

    // 未販売でステータスが完了になっている場合の補正
    if (p.saleDate && p.salePrice && p.status === 'completed') {
      // OK
    } else if (!p.salePrice && p.status === 'completed') {
      p.status = 'stocked';
    }

    return p;
  }

  // ===== メインの UI フロー =====
  async function openImportDialog() {
    // Step 1: ファイル選択
    const file = await pickFile();
    if (!file) return;

    const text = await readFile(file);
    _rows = parseCSV(text);
    if (_rows.length < 1) {
      Modal.toast('CSVにデータがありません');
      return;
    }

    // Step 2: ヘッダー行有無 + マッピング画面
    _hasHeader = true;
    _headers = _rows[0];
    _mapping = autoGuess(_headers);

    showMappingUI();
  }

  function pickFile() {
    return new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.csv,text/csv,.tsv,.txt';
      inp.onchange = () => resolve(inp.files[0] || null);
      inp.click();
    });
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      // Shift-JIS 対応も試みる
      reader.readAsText(file, 'UTF-8');
    });
  }

  // ===== Step 2: マッピング UI =====
  function showMappingUI() {
    const dataRows = _hasHeader ? _rows.slice(1) : _rows;
    const previewRows = dataRows.slice(0, 5);
    const cols = _headers.length;

    // プレビューテーブル
    let tableHtml = '<div style="overflow-x:auto; margin-bottom:12px;">';
    tableHtml += '<table class="csv-preview"><thead><tr>';
    for (let c = 0; c < cols; c++) {
      tableHtml += `<th>
        <div class="csv-col-header">${_hasHeader ? esc(_headers[c]) : `列${c + 1}`}</div>
        <select class="csv-map-sel" data-col="${c}">
          ${FIELD_DEFS.map(f => `<option value="${f.key}" ${_mapping[c] === f.key ? 'selected' : ''}>${f.label}</option>`).join('')}
        </select>
      </th>`;
    }
    tableHtml += '</tr></thead><tbody>';
    for (const row of previewRows) {
      tableHtml += '<tr>';
      for (let c = 0; c < cols; c++) {
        tableHtml += `<td>${esc(row[c] ?? '')}</td>`;
      }
      tableHtml += '</tr>';
    }
    tableHtml += '</tbody></table></div>';

    const bodyHtml = `
      <div class="csv-import-info">
        <p>全 <b>${dataRows.length}</b> 件のデータが見つかりました。</p>
        <p style="font-size:12px; color:var(--text-muted);">各列のドロップダウンで「この列は何のデータか」を選んでください。<br>
        「（使わない）」にした列は取り込まれません。</p>
      </div>
      <label style="font-size:13px; display:flex; align-items:center; gap:6px; margin-bottom:10px;">
        <input type="checkbox" id="csvHasHeader" ${_hasHeader ? 'checked' : ''}>
        1行目はヘッダー（列名）行
      </label>
      ${tableHtml}
      <div class="csv-import-warn" style="font-size:12px; color:var(--danger); margin-bottom:8px;">
        ⚠ インポートすると既存の商品データは全て削除されます
      </div>
    `;

    const footer = `
      <button class="btn" id="csvCancel">キャンセル</button>
      <button class="btn btn-primary" id="csvDoImport">インポート実行</button>
    `;

    const m = Modal.open({ title: 'CSV インポート', body: bodyHtml, footer });
    const root = m.overlay;

    // ヘッダー行チェックボックス
    root.querySelector('#csvHasHeader').onchange = (e) => {
      _hasHeader = e.target.checked;
      if (_hasHeader) {
        _headers = _rows[0];
        _mapping = autoGuess(_headers);
      } else {
        _headers = _rows[0].map((_, i) => `列${i + 1}`);
        _mapping = new Array(_rows[0].length).fill('');
      }
      m.close();
      showMappingUI();
    };

    // マッピング変更
    root.querySelectorAll('.csv-map-sel').forEach(sel => {
      sel.onchange = () => {
        _mapping[Number(sel.dataset.col)] = sel.value;
      };
    });

    root.querySelector('#csvCancel').onclick = () => m.close();
    root.querySelector('#csvDoImport').onclick = async () => {
      // バリデーション: 商品名は必須
      if (!_mapping.includes('name')) {
        Modal.toast('「商品名」列を割り当ててください');
        return;
      }
      if (!(await Modal.confirm(
        `既存の商品データを全て削除し、CSV の ${_hasHeader ? _rows.length - 1 : _rows.length} 件を取り込みます。\nよろしいですか？`
      ))) return;

      await doImport();
      m.close();
    };
  }

  // ===== Step 3: インポート実行 =====
  async function doImport() {
    const dataRows = _hasHeader ? _rows.slice(1) : _rows;

    // 既存商品 + 画像を全クリア
    const existingProducts = await DB.Products.list();
    for (const p of existingProducts) {
      const imgs = await DB.Images.byProduct(p.id);
      for (const img of imgs) await DB.Images.remove(img.id);
      await DB.Products.remove(p.id);
    }

    let imported = 0, skipped = 0;
    for (const row of dataRows) {
      const p = rowToProduct(row);
      if (!p.name || p.name.trim() === '') {
        skipped++;
        continue;
      }
      await DB.Products.save(p);
      imported++;
    }

    Modal.toast(`${imported} 件インポート完了${skipped ? `（${skipped} 件スキップ）` : ''}`);

    // 画面を更新
    if (typeof ProductsUI !== 'undefined') ProductsUI.render();
    if (typeof Dashboard !== 'undefined') Dashboard.refresh();
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  return { openImportDialog, parseCSV, FIELD_DEFS };
})();
