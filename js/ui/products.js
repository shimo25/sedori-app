/**
 * 商品の一覧・登録・編集 UI
 */
const ProductsUI = (() => {
  let _objectURLs = []; // サムネ用、ビュー切替時にrevoke
  let _marginFilter = null; // { lo, hi, label } レポートからのフィルタ
  let _periodFilter = null; // { year, month, day, label } レポートからの期間フィルタ
  let _statusFilter = null; // { key, label } レポートからのステータスフィルタ
  let _pendingSort = null;  // 次回render時に適用するソートキー

  function ensureSortOrder() {
    if (document.getElementById('sortOrder')) return;
    const sel = document.createElement('select');
    sel.id = 'sortOrder';
    const opts = [
      ['updated_desc', '更新日（新しい順）'], ['updated_asc', '更新日（古い順）'],
      ['purchase_desc', '仕入額（高い順）'], ['purchase_asc', '仕入額（低い順）'],
      ['sale_desc', '売上（高い順）'], ['sale_asc', '売上（低い順）'],
      ['profit_desc', '損益（高い順）'], ['profit_asc', '損益（低い順）'],
      ['margin_desc', '粗利率（高い順）'], ['margin_asc', '粗利率（低い順）']
    ];
    opts.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); });
    sel.addEventListener('change', render);
    // フィルターバーの先頭行に挿入（statusFilterの後ろ）
    const bar = document.getElementById('statusFilter').parentElement;
    const searchBox = document.getElementById('searchBox');
    // 検索ボックスが同じ行にあれば分離
    if (searchBox && searchBox.parentElement === bar) {
      const bar2 = document.createElement('div');
      bar2.className = 'filter-bar';
      bar2.appendChild(searchBox);
      bar.after(bar2);
    }
    bar.appendChild(sel);
  }

  async function render() {
    ensureSortOrder();

    // レポートからのフィルタ設定を反映
    if (_pendingSort) {
      const sortEl = document.getElementById('sortOrder');
      if (sortEl) sortEl.value = _pendingSort;
      _pendingSort = null;
    }
    if (_statusFilter) {
      const statusEl = document.getElementById('statusFilter');
      if (statusEl) statusEl.value = _statusFilter.key;
    }

    const list = document.getElementById('productList');
    const empty = document.getElementById('emptyProducts');
    // 既存の ObjectURL を解放
    _objectURLs.forEach(u => URL.revokeObjectURL(u));
    _objectURLs = [];

    const filter = document.getElementById('statusFilter').value;
    const q = (document.getElementById('searchBox').value || '').trim().toLowerCase();

    const sortKey = document.getElementById('sortOrder').value;

    let products = await DB.Products.list();
    if (filter !== 'all') products = products.filter(p => p.status === filter);
    if (q) products = products.filter(p => p.name.toLowerCase().includes(q));

    // マージンフィルタ（レポートからの遷移時）
    if (_marginFilter) {
      products = products.filter(p => {
        if (!p.salePrice) return false;
        const m = calcMarginNum(p);
        return m >= _marginFilter.lo && m < _marginFilter.hi;
      });
    }

    // 期間フィルタ（レポートからの遷移時）
    if (_periodFilter) {
      products = products.filter(p => {
        if (!p.saleDate) return false;
        if (_periodFilter.day) {
          // 日単位
          const target = `${_periodFilter.year}-${String(_periodFilter.month).padStart(2,'0')}-${String(_periodFilter.day).padStart(2,'0')}`;
          return p.saleDate.startsWith(target);
        } else if (_periodFilter.month) {
          // 月単位
          const target = `${_periodFilter.year}-${String(_periodFilter.month).padStart(2,'0')}`;
          return p.saleDate.startsWith(target);
        } else {
          // 年単位
          return p.saleDate.startsWith(String(_periodFilter.year));
        }
      });
    }

    // ステータスフィルタ（レポートからの遷移時）
    if (_statusFilter) {
      products = products.filter(p => p.status === _statusFilter.key);
    }

    products.sort(getSortFn(sortKey));

    // レポートフィルタ表示バッジ
    renderFilterBadge();

    list.innerHTML = '';
    if (products.length === 0) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    for (const p of products) {
      const li = document.createElement('li');
      li.className = 'product-item';
      const thumbHtml = await renderThumb(p);
      const profit = calcProfit(p);
      li.innerHTML = `
        ${thumbHtml}
        <div class="product-info">
          <p class="product-name">${escapeHtml(p.name)}</p>
          <div class="product-meta">
            <span class="status-badge status-${p.status}">${statusLabel(p.status)}</span>
            <span>仕入 ${yen(p.purchasePrice)}</span>
            ${p.salePrice ? `<span>売上 ${yen(p.salePrice)}</span>` : ''}
            ${p.salePrice ? `<span style="color:${profit >= 0 ? 'var(--success)' : 'var(--danger)'}">損益 ${yen(profit)}</span>` : ''}
            ${p.salePrice ? `<span class="product-margin" style="color:${profit >= 0 ? 'var(--success)' : 'var(--danger)'}">粗利率 ${calcMargin(p)}%</span>` : ''}
          </div>
        </div>`;
      li.onclick = () => openForm(p);
      list.appendChild(li);
    }
  }

  async function renderThumb(p) {
    if (p.imageIds && p.imageIds.length > 0) {
      const img = await DB.Images.get(p.imageIds[0]);
      if (img && img.blob) {
        const url = URL.createObjectURL(img.blob);
        _objectURLs.push(url);
        return `<img class="product-thumb" src="${url}" alt="">`;
      }
    }
    return `<div class="product-thumb product-thumb-placeholder">📦</div>`;
  }

  function calcProfit(p) {
    if (!p.salePrice) return 0;
    const fee = p.feeAmount != null ? p.feeAmount : (p.feeRate ? p.salePrice * p.feeRate / 100 : 0);
    const shipping = p.shippingCost || 0;
    const packaging = p.packagingCost || 0;
    const other = p.otherCost || 0;
    return p.salePrice - p.purchasePrice - fee - shipping - packaging - other;
  }

  async function openForm(existing = null) {
    const p = existing || {
      id: uid(), name: '', purchaseDate: today(), purchasePrice: 0,
      purchaseFrom: '', quantity: 1, status: 'stocked', platform: 'mercari',
      listPrice: null, salePrice: null, saleDate: null, feeRate: 10,
      feeAmount: null, shippingCost: 0, memo: '', imageIds: []
    };
    const feePresets = await DB.Settings.get('feePresets', DEFAULT_FEE_PRESETS);
    const sourcePresets = await DB.Settings.get('sourcePresets', []);

    const form = document.createElement('div');
    form.innerHTML = `
      <div class="field">
        <label>商品名 *</label>
        <input type="text" id="f_name" value="${escapeAttr(p.name)}" required>
      </div>
      <div class="field">
        <label>仕入日 *</label>
        <input type="date" id="f_purchaseDate" value="${p.purchaseDate}">
      </div>
      <div class="form-row">
        <label>数量 *<input type="number" id="f_quantity" value="${p.quantity}" min="1"></label>
        <label>仕入額(1点) *<input type="number" id="f_purchasePrice" value="${p.purchasePrice}" min="0"></label>
      </div>
      <div class="field">
        <label>仕入先</label>
        ${sourcePresets.length > 0 ? `
          <select id="f_purchaseFromSel">
            <option value="">-- 選択 --</option>
            ${sourcePresets.map(s => `<option value="${escapeAttr(s)}" ${p.purchaseFrom === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
            <option value="__other__" ${p.purchaseFrom && !sourcePresets.includes(p.purchaseFrom) ? 'selected' : ''}>その他（直接入力）</option>
          </select>
          <input type="text" id="f_purchaseFrom" value="${escapeAttr(p.purchaseFrom)}" placeholder="仕入先を入力"
            style="margin-top:6px;${p.purchaseFrom && !sourcePresets.includes(p.purchaseFrom) ? '' : 'display:none;'}">
        ` : `
          <input type="text" id="f_purchaseFrom" value="${escapeAttr(p.purchaseFrom)}" placeholder="仕入先を入力">
        `}
      </div>
      <div class="form-row">
        <label>ステータス<select id="f_status">
          ${STATUSES.map(s => `<option value="${s.key}" ${p.status===s.key?'selected':''}>${s.label}</option>`).join('')}
        </select></label>
        <label>販売先<select id="f_platform">
          ${feePresets.map(fp => `<option value="${fp.id}" data-rate="${fp.rate}" ${p.platform===fp.id?'selected':''}>${fp.name}</option>`).join('')}
        </select></label>
      </div>
      <div class="form-row">
        <label>手数料率(%)<input type="number" id="f_feeRate" value="${p.feeRate ?? 10}" min="0" step="0.1"></label>
        <label>送料(自己負担)<input type="number" id="f_shippingCost" value="${p.shippingCost ?? 0}" min="0"></label>
      </div>
      <div class="form-row">
        <label>出品価格<input type="number" id="f_listPrice" value="${p.listPrice ?? ''}" min="0"></label>
        <label>販売価格<input type="number" id="f_salePrice" value="${p.salePrice ?? ''}" min="0"></label>
      </div>
      <div class="field">
        <label>販売日</label>
        <input type="date" id="f_saleDate" value="${p.saleDate ?? ''}">
      </div>
      <div class="field">
        <label>メモ</label>
        <textarea id="f_memo">${escapeHtml(p.memo || '')}</textarea>
      </div>
      <div class="field">
        <label>画像</label>
        <div class="image-grid" id="f_imageGrid"></div>
        <p class="muted" style="margin-top:6px;">画像追加時に圧縮方法を選択できます</p>
      </div>
      ${existing ? `<button class="btn btn-danger btn-block" id="f_delete">この商品を削除</button>` : ''}
    `;

    const footer = `
      <button class="btn" id="f_cancel">キャンセル</button>
      <button class="btn btn-primary" id="f_save">保存</button>
    `;

    const m = Modal.open({
      title: existing ? '商品を編集' : '商品を登録',
      body: form,
      footer
    });

    // 仕入先プルダウン↔テキスト切り替え
    const sourceSel = form.querySelector('#f_purchaseFromSel');
    const sourceInput = form.querySelector('#f_purchaseFrom');
    if (sourceSel) {
      sourceSel.onchange = () => {
        if (sourceSel.value === '__other__') {
          sourceInput.style.display = '';
          sourceInput.value = '';
          sourceInput.focus();
        } else {
          sourceInput.style.display = 'none';
          sourceInput.value = sourceSel.value;
        }
      };
    }

    // 販売先プリセット変更で手数料率を自動セット
    const platformSel = form.querySelector('#f_platform');
    const feeRateInput = form.querySelector('#f_feeRate');
    platformSel.onchange = () => {
      const rate = platformSel.selectedOptions[0].dataset.rate;
      if (rate) feeRateInput.value = rate;
    };

    // 画像管理
    const imageGrid = form.querySelector('#f_imageGrid');
    let currentImageIds = [...(p.imageIds || [])];
    async function rerenderImages() {
      imageGrid.innerHTML = '';
      for (const id of currentImageIds) {
        const img = await DB.Images.get(id);
        if (!img) continue;
        const url = URL.createObjectURL(img.blob);
        const wrap = document.createElement('div');
        wrap.className = 'img-wrap';
        wrap.innerHTML = `<img src="${url}" alt=""><button type="button" class="img-remove" aria-label="削除">×</button>`;
        wrap.querySelector('img').onclick = (e) => {
          e.stopPropagation();
          showImageViewer(url);
        };
        wrap.querySelector('.img-remove').onclick = async (e) => {
          e.stopPropagation();
          URL.revokeObjectURL(url);
          await DB.Images.remove(id);
          currentImageIds = currentImageIds.filter(x => x !== id);
          rerenderImages();
        };
        imageGrid.appendChild(wrap);
      }
      // 追加ボタン
      const add = document.createElement('label');
      add.className = 'img-wrap img-add';
      add.innerHTML = `＋<input type="file" accept="image/*" capture="environment" hidden>`;
      add.querySelector('input').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const level = await ImageUtil.chooseCompressLevel();
        if (!level) return;
        const processed = await ImageUtil.process(file, level);
        const imgRec = {
          id: uid(),
          productId: p.id,
          blob: processed.blob,
          mimeType: processed.mimeType,
          compressedLevel: processed.level,
          size: processed.size,
          createdAt: Date.now()
        };
        await DB.Images.save(imgRec);
        currentImageIds.push(imgRec.id);
        Modal.toast(`保存: ${ImageUtil.formatSize(processed.size)}`);
        rerenderImages();
      };
      imageGrid.appendChild(add);
    }
    rerenderImages();

    // 保存
    form.parentElement.parentElement.querySelector('#f_save').onclick = async () => {
      const newP = {
        ...p,
        name: form.querySelector('#f_name').value.trim(),
        purchaseDate: form.querySelector('#f_purchaseDate').value,
        quantity: Number(form.querySelector('#f_quantity').value) || 1,
        purchasePrice: Number(form.querySelector('#f_purchasePrice').value) || 0,
        purchaseFrom: (form.querySelector('#f_purchaseFromSel') && form.querySelector('#f_purchaseFromSel').value !== '__other__' && form.querySelector('#f_purchaseFromSel').value !== '')
          ? form.querySelector('#f_purchaseFromSel').value
          : form.querySelector('#f_purchaseFrom').value.trim(),
        status: form.querySelector('#f_status').value,
        platform: form.querySelector('#f_platform').value,
        feeRate: Number(form.querySelector('#f_feeRate').value) || 0,
        listPrice: numOrNull(form.querySelector('#f_listPrice').value),
        salePrice: numOrNull(form.querySelector('#f_salePrice').value),
        saleDate: form.querySelector('#f_saleDate').value || null,
        shippingCost: Number(form.querySelector('#f_shippingCost').value) || 0,
        memo: form.querySelector('#f_memo').value,
        imageIds: currentImageIds
      };
      if (!newP.name) { Modal.toast('商品名を入力してください'); return; }
      // 手数料額を自動計算
      if (newP.salePrice && newP.feeRate) {
        newP.feeAmount = Math.round(newP.salePrice * newP.feeRate / 100);
      }
      await DB.Products.save(newP);
      m.close();
      Modal.toast('保存しました');
      render();
      Dashboard.refresh();
    };
    form.parentElement.parentElement.querySelector('#f_cancel').onclick = () => m.close();
    if (existing) {
      form.querySelector('#f_delete').onclick = async () => {
        if (!(await Modal.confirm('この商品を削除しますか？'))) return;
        // 画像も削除
        for (const id of currentImageIds) await DB.Images.remove(id);
        await DB.Products.remove(p.id);
        m.close();
        Modal.toast('削除しました');
        render();
        Dashboard.refresh();
      };
    }
  }

  function showImageViewer(url) {
    const overlay = document.createElement('div');
    overlay.className = 'image-viewer';
    overlay.innerHTML = `
      <button class="image-viewer-close" aria-label="閉じる">×</button>
      <img src="${url}" alt="" draggable="false">
    `;
    const img = overlay.querySelector('img');
    const closeBtn = overlay.querySelector('.image-viewer-close');

    let scale = 1, posX = 0, posY = 0;
    let startDist = 0, startScale = 1;
    let startX = 0, startY = 0, startPosX = 0, startPosY = 0;
    let isPanning = false;

    function applyTransform() {
      img.style.transform = `translate(${posX}px, ${posY}px) scale(${scale})`;
    }

    // iOS Safari のデフォルトジェスチャー（ページズーム）を完全ブロック
    overlay.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
    overlay.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
    overlay.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });

    // 全タッチイベントのデフォルト動作を抑制
    overlay.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (e.touches.length === 2) {
        startDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        startScale = scale;
        isPanning = false;
      } else if (e.touches.length === 1) {
        isPanning = true;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startPosX = posX;
        startPosY = posY;
      }
    }, { passive: false });

    overlay.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        scale = Math.min(5, Math.max(1, startScale * (dist / startDist)));
        if (scale <= 1) { posX = 0; posY = 0; }
        applyTransform();
      } else if (e.touches.length === 1 && isPanning && scale > 1) {
        posX = startPosX + (e.touches[0].clientX - startX);
        posY = startPosY + (e.touches[0].clientY - startY);
        applyTransform();
      }
    }, { passive: false });

    overlay.addEventListener('touchend', (e) => {
      e.preventDefault();
      isPanning = false;
      if (scale <= 1) { scale = 1; posX = 0; posY = 0; applyTransform(); }

      // ダブルタップ判定
      if (e.touches.length === 0) {
        const now = Date.now();
        if (now - lastTap < 300) {
          if (scale > 1) {
            scale = 1; posX = 0; posY = 0;
          } else {
            scale = 2.5;
          }
          applyTransform();
        }
        lastTap = now;
      }
    }, { passive: false });

    let lastTap = 0;

    // 閉じる操作（タッチ＋クリック両対応）
    function tryClose(e) {
      if (e.target === overlay && scale <= 1) overlay.remove();
    }
    overlay.addEventListener('click', tryClose);
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); overlay.remove(); });
    closeBtn.addEventListener('touchend', (e) => { e.stopPropagation(); overlay.remove(); });

    document.body.appendChild(overlay);
  }

  // 商品単体の粗利率（売上に対する利益の割合）
  function calcMargin(p) {
    if (!p.salePrice) return '0.0';
    const profit = calcProfit(p);
    return (profit / p.salePrice * 100).toFixed(1);
  }
  function calcMarginNum(p) {
    if (!p.salePrice) return -Infinity;
    return calcProfit(p) / p.salePrice * 100;
  }

  function filterByMargin(lo, hi, label) {
    clearAllReportFilters();
    _marginFilter = { lo, hi, label };
    // ソートは次回renderで反映（switchViewがrender()を呼ぶ）
    _pendingSort = 'margin_desc';
  }

  function filterByPeriod(year, month, day, label) {
    clearAllReportFilters();
    _periodFilter = { year, month, day, label };
    _pendingSort = 'sale_desc';
  }

  function filterByStatusFromReport(key, label) {
    clearAllReportFilters();
    _statusFilter = { key, label };
  }

  function clearAllReportFilters() {
    _marginFilter = null;
    _periodFilter = null;
    _statusFilter = null;
  }

  function clearReportFilter() {
    clearAllReportFilters();
    // ステータスドロップダウンを「全て」に戻す
    const statusEl = document.getElementById('statusFilter');
    if (statusEl) statusEl.value = 'all';
    render();
  }

  function renderFilterBadge() {
    let badge = document.getElementById('marginFilterBadge');
    const activeFilter = _marginFilter || _periodFilter || _statusFilter;
    if (!activeFilter) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'marginFilterBadge';
      badge.className = 'margin-filter-badge';
      const bar = document.getElementById('statusFilter').parentElement;
      bar.parentElement.insertBefore(badge, bar);
    }
    let text = '';
    if (_marginFilter) {
      text = `粗利率 <b>${_marginFilter.label}</b> で絞り込み中`;
    } else if (_periodFilter) {
      text = `<b>${_periodFilter.label}</b> の売却商品を表示中`;
    } else if (_statusFilter) {
      text = `ステータス <b>${_statusFilter.label}</b> で絞り込み中`;
    }
    badge.innerHTML = `${text} <button id="btnClearMargin">× 解除</button>`;
    badge.querySelector('#btnClearMargin').onclick = clearReportFilter;
  }

  function getSortFn(key) {
    switch (key) {
      case 'updated_asc':   return (a, b) => (a.updatedAt || 0) - (b.updatedAt || 0);
      case 'purchase_desc': return (a, b) => (b.purchasePrice || 0) - (a.purchasePrice || 0);
      case 'purchase_asc':  return (a, b) => (a.purchasePrice || 0) - (b.purchasePrice || 0);
      case 'sale_desc':     return (a, b) => (b.salePrice || 0) - (a.salePrice || 0);
      case 'sale_asc':      return (a, b) => (a.salePrice || 0) - (b.salePrice || 0);
      case 'profit_desc':   return (a, b) => calcProfit(b) - calcProfit(a);
      case 'profit_asc':    return (a, b) => calcProfit(a) - calcProfit(b);
      case 'margin_desc':   return (a, b) => calcMarginNum(b) - calcMarginNum(a);
      case 'margin_asc':    return (a, b) => calcMarginNum(a) - calcMarginNum(b);
      default:              return (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);
    }
  }

  function numOrNull(v) { return v === '' ? null : Number(v); }
  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escapeAttr(s) { return escapeHtml(s); }

  return { render, openForm, calcProfit, filterByMargin, filterByPeriod, filterByStatusFromReport };
})();
