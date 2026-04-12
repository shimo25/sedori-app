/**
 * 商品の一覧・登録・編集 UI
 */
const ProductsUI = (() => {
  let _objectURLs = []; // サムネ用、ビュー切替時にrevoke

  async function render() {
    const list = document.getElementById('productList');
    const empty = document.getElementById('emptyProducts');
    // 既存の ObjectURL を解放
    _objectURLs.forEach(u => URL.revokeObjectURL(u));
    _objectURLs = [];

    const filter = document.getElementById('statusFilter').value;
    const q = (document.getElementById('searchBox').value || '').trim().toLowerCase();

    let products = await DB.Products.list();
    if (filter !== 'all') products = products.filter(p => p.status === filter);
    if (q) products = products.filter(p => p.name.toLowerCase().includes(q));
    products.sort((a, b) => b.updatedAt - a.updatedAt);

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
            ${p.status === 'completed' && p.salePrice ? `<span class="product-margin" style="color:${profit >= 0 ? 'var(--success)' : 'var(--danger)'}">粗利率 ${calcMargin(p)}%</span>` : ''}
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

    const form = document.createElement('div');
    form.innerHTML = `
      <div class="field">
        <label>商品名 *</label>
        <input type="text" id="f_name" value="${escapeAttr(p.name)}" required>
      </div>
      <div class="form-row">
        <label>仕入日 *<input type="date" id="f_purchaseDate" value="${p.purchaseDate}"></label>
        <label>数量 *<input type="number" id="f_quantity" value="${p.quantity}" min="1"></label>
      </div>
      <div class="form-row">
        <label>仕入額(1点) *<input type="number" id="f_purchasePrice" value="${p.purchasePrice}" min="0"></label>
        <label>仕入先<input type="text" id="f_purchaseFrom" value="${escapeAttr(p.purchaseFrom)}"></label>
      </div>
      <div class="field">
        <label>ステータス</label>
        <select id="f_status">
          ${STATUSES.map(s => `<option value="${s.key}" ${p.status===s.key?'selected':''}>${s.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label>販売先<select id="f_platform">
          ${feePresets.map(fp => `<option value="${fp.id}" data-rate="${fp.rate}" ${p.platform===fp.id?'selected':''}>${fp.name}</option>`).join('')}
        </select></label>
        <label>手数料率(%)<input type="number" id="f_feeRate" value="${p.feeRate ?? 10}" min="0" step="0.1"></label>
      </div>
      <div class="form-row">
        <label>出品価格<input type="number" id="f_listPrice" value="${p.listPrice ?? ''}" min="0"></label>
        <label>販売価格<input type="number" id="f_salePrice" value="${p.salePrice ?? ''}" min="0"></label>
      </div>
      <div class="form-row">
        <label>販売日<input type="date" id="f_saleDate" value="${p.saleDate ?? ''}"></label>
        <label>送料(自己負担)<input type="number" id="f_shippingCost" value="${p.shippingCost ?? 0}" min="0"></label>
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
        purchaseFrom: form.querySelector('#f_purchaseFrom').value.trim(),
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

  function numOrNull(v) { return v === '' ? null : Number(v); }
  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function escapeAttr(s) { return escapeHtml(s); }

  return { render, openForm, calcProfit };
})();
