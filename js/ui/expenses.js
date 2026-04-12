/**
 * 経費の一覧・登録・編集 UI
 */
const ExpensesUI = (() => {
  async function render() {
    const list = document.getElementById('expenseList');
    const empty = document.getElementById('emptyExpenses');
    let items = await DB.Expenses.list();
    items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    list.innerHTML = '';
    if (items.length === 0) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    for (const e of items) {
      const li = document.createElement('li');
      li.className = 'expense-item';
      li.innerHTML = `
        <div class="expense-info">
          <div class="expense-category">${e.date} / ${expenseCategoryLabel(e.category)}</div>
          <div class="expense-desc">${escapeHtml(e.description || '—')}</div>
        </div>
        <div class="expense-amount">${yen(e.amount)}</div>`;
      li.onclick = () => openForm(e);
      list.appendChild(li);
    }
  }

  function openForm(existing = null) {
    const e = existing || {
      id: uid(), date: today(), category: 'packing', amount: 0, description: '', memo: ''
    };
    const form = document.createElement('div');
    form.innerHTML = `
      <div class="form-row">
        <label>日付 *<input type="date" id="e_date" value="${e.date}"></label>
        <label>科目 *<select id="e_category">
          ${EXPENSE_CATEGORIES.map(c => `<option value="${c.key}" ${e.category===c.key?'selected':''}>${c.label}</option>`).join('')}
        </select></label>
      </div>
      <div class="field">
        <label>金額 *</label>
        <input type="number" id="e_amount" value="${e.amount}" min="0">
      </div>
      <div class="field">
        <label>内容 *</label>
        <input type="text" id="e_description" value="${escapeHtml(e.description)}">
      </div>
      <div class="field">
        <label>メモ</label>
        <textarea id="e_memo">${escapeHtml(e.memo || '')}</textarea>
      </div>
      ${existing ? `<button class="btn btn-danger btn-block" id="e_delete">この経費を削除</button>` : ''}
    `;
    const footer = `<button class="btn" id="e_cancel">キャンセル</button><button class="btn btn-primary" id="e_save">保存</button>`;
    const m = Modal.open({ title: existing ? '経費を編集' : '経費を登録', body: form, footer });

    const root = form.parentElement.parentElement;
    root.querySelector('#e_save').onclick = async () => {
      const newE = {
        ...e,
        date: form.querySelector('#e_date').value,
        category: form.querySelector('#e_category').value,
        amount: Number(form.querySelector('#e_amount').value) || 0,
        description: form.querySelector('#e_description').value.trim(),
        memo: form.querySelector('#e_memo').value
      };
      if (!newE.description) { Modal.toast('内容を入力してください'); return; }
      await DB.Expenses.save(newE);
      m.close();
      Modal.toast('保存しました');
      render();
      Dashboard.refresh();
    };
    root.querySelector('#e_cancel').onclick = () => m.close();
    if (existing) {
      form.querySelector('#e_delete').onclick = async () => {
        if (!(await Modal.confirm('この経費を削除しますか？'))) return;
        await DB.Expenses.remove(e.id);
        m.close();
        Modal.toast('削除しました');
        render();
        Dashboard.refresh();
      };
    }
  }

  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  return { render, openForm };
})();
