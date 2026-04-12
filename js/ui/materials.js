/**
 * 資材（梱包材）在庫管理画面
 * サイズごとの在庫をグリッドカード形式で一覧表示。
 */
const MaterialsUI = (() => {
  function init() {
    // ＋ 追加ボタン（タブ切替後にセクション内に表示される）
    document.getElementById('btnAddMaterial').onclick = () => openForm();
  }

  async function render() {
    const list = await DB.Packaging.list();
    list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    // ---- サマリー ----
    const summary = document.getElementById('materialsSummary');
    const totalTypes = list.length;
    const totalCount = list.reduce((s, i) => s + (i.count || 0), 0);
    const lowCount = list.filter(i => (i.count || 0) <= (i.lowThreshold ?? 3)).length;
    summary.innerHTML = `
      <div class="msum-grid">
        <div class="msum"><span class="msum-label">サイズ種類</span><span class="msum-value">${totalTypes}</span></div>
        <div class="msum"><span class="msum-label">合計在庫</span><span class="msum-value">${totalCount}<span class="msum-unit">個</span></span></div>
        <div class="msum ${lowCount > 0 ? 'warn' : ''}"><span class="msum-label">要補充</span><span class="msum-value">${lowCount}<span class="msum-unit">種</span></span></div>
      </div>
    `;

    // ---- グリッド ----
    const grid = document.getElementById('materialsGrid');
    const empty = document.getElementById('emptyMaterials');
    grid.innerHTML = '';
    if (list.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    for (const item of list) {
      const threshold = item.lowThreshold ?? 3;
      const count = item.count || 0;
      const isZero = count === 0;
      const isLow = !isZero && count <= threshold;
      const card = document.createElement('div');
      card.className = `material-card ${isZero ? 'zero' : isLow ? 'low' : ''}`;
      card.innerHTML = `
        <div class="material-head">
          <div class="material-name">${escapeAttr(item.name)}</div>
          ${isZero ? '<span class="material-badge zero">在庫切れ</span>' : isLow ? '<span class="material-badge">残少</span>' : ''}
        </div>
        <div class="material-count">
          <span class="material-count-num">${count}</span><span class="material-count-unit">個</span>
        </div>
        <div class="material-meta">
          ${item.unitPrice ? `単価 ${yen(item.unitPrice)} / ` : ''}補充目安 ${threshold}個以下
        </div>
        <div class="material-actions">
          <button class="btn btn-m-minus" data-id="${item.id}" aria-label="1減らす">－1</button>
          <button class="btn btn-m-plus" data-id="${item.id}" aria-label="1増やす">＋1</button>
          <button class="btn btn-m-edit" data-id="${item.id}" aria-label="編集">編集</button>
        </div>
      `;
      grid.appendChild(card);
    }

    grid.querySelectorAll('.btn-m-minus').forEach(b => {
      b.onclick = async (e) => {
        e.stopPropagation();
        await DB.Packaging.adjust(b.dataset.id, -1);
        render();
      };
    });
    grid.querySelectorAll('.btn-m-plus').forEach(b => {
      b.onclick = async (e) => {
        e.stopPropagation();
        await DB.Packaging.adjust(b.dataset.id, +1);
        render();
      };
    });
    grid.querySelectorAll('.btn-m-edit').forEach(b => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const item = await DB.Packaging.get(b.dataset.id);
        openForm(item);
      };
    });
  }

  function openForm(existing = null) {
    const isEdit = !!existing;
    const data = existing || { id: uid(), name: '', count: 0, lowThreshold: 3, unitPrice: 0, memo: '' };
    const html = `
      <div class="field"><label>サイズ名（例: 60サイズ ダンボール）</label>
        <input type="text" id="mName" value="${escapeAttr(data.name)}"></div>
      <div class="form-row">
        <label>残個数<input type="number" id="mCount" min="0" step="1" value="${data.count || 0}"></label>
        <label>補充警告閾値<input type="number" id="mThreshold" min="0" step="1" value="${data.lowThreshold ?? 3}"></label>
      </div>
      <div class="field"><label>単価（任意・円）</label>
        <input type="number" id="mUnit" min="0" step="1" value="${data.unitPrice || 0}"></div>
      <div class="field"><label>メモ</label>
        <textarea id="mMemo" rows="2">${escapeAttr(data.memo || '')}</textarea></div>
    `;
    const footer = isEdit
      ? `<button class="btn btn-danger" id="mDelete">削除</button>
         <button class="btn" id="mCancel">キャンセル</button>
         <button class="btn btn-primary" id="mSave">保存</button>`
      : `<button class="btn" id="mCancel">キャンセル</button>
         <button class="btn btn-primary" id="mSave">保存</button>`;

    const m = Modal.open({
      title: isEdit ? '梱包材を編集' : '梱包材を追加',
      body: html,
      footer
    });
    const root = m.overlay;

    root.querySelector('#mCancel').onclick = () => m.close();
    root.querySelector('#mSave').onclick = async () => {
      const name = root.querySelector('#mName').value.trim();
      if (!name) { Modal.toast('サイズ名を入力してください'); return; }
      const saved = {
        ...data,
        name,
        count: Math.max(0, Number(root.querySelector('#mCount').value) || 0),
        lowThreshold: Math.max(0, Number(root.querySelector('#mThreshold').value) || 0),
        unitPrice: Math.max(0, Number(root.querySelector('#mUnit').value) || 0),
        memo: root.querySelector('#mMemo').value.trim()
      };
      await DB.Packaging.save(saved);
      m.close();
      Modal.toast(isEdit ? '更新しました' : '追加しました');
      render();
    };
    if (isEdit) {
      root.querySelector('#mDelete').onclick = async () => {
        if (!(await Modal.confirm(`「${data.name}」を削除しますか？`))) return;
        await DB.Packaging.remove(data.id);
        m.close();
        Modal.toast('削除しました');
        render();
      };
    }
  }

  function escapeAttr(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  return { init, render, openForm };
})();
