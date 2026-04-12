/**
 * 汎用モーダル
 */
const Modal = (() => {
  function open({ title, body, footer = '', onClose }) {
    const root = document.getElementById('modalRoot');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2>${title}</h2>
          <button class="modal-close" aria-label="閉じる">×</button>
        </div>
        <div class="modal-body"></div>
        ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
      </div>`;
    const bodyEl = overlay.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else bodyEl.appendChild(body);
    root.appendChild(overlay);

    const close = () => {
      overlay.remove();
      onClose && onClose();
    };
    overlay.querySelector('.modal-close').onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    return { overlay, close, bodyEl };
  }

  function toast(msg, ms = 2000) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  function confirm(msg) {
    return new Promise((resolve) => {
      const root = document.getElementById('modalRoot');
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal">
          <div class="modal-header"><h2>確認</h2></div>
          <div class="modal-body"><p>${msg}</p></div>
          <div class="modal-footer">
            <button class="btn" data-v="0">キャンセル</button>
            <button class="btn btn-danger" data-v="1">OK</button>
          </div>
        </div>`;
      root.appendChild(overlay);
      overlay.querySelectorAll('button').forEach(b => {
        b.onclick = () => { overlay.remove(); resolve(b.dataset.v === '1'); };
      });
    });
  }

  return { open, toast, confirm };
})();
