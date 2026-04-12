/**
 * 相場リサーチユーティリティ
 * 商品名から各マーケットの検索 URL を生成してリンクを開く。
 * 公式APIを使わないため規約リスクがなく、iPhone 上で外部ブラウザ/アプリを開くだけでOK。
 */
const Research = (() => {
  const SITES = [
    { id: 'mercari',      name: 'メルカリ',    build: (q) => `https://jp.mercari.com/search?keyword=${encodeURIComponent(q)}&status=sold_out` },
    { id: 'mercari_live', name: 'メルカリ出品中', build: (q) => `https://jp.mercari.com/search?keyword=${encodeURIComponent(q)}&status=on_sale` },
    { id: 'yahoo',        name: 'ヤフオク落札',  build: (q) => `https://auctions.yahoo.co.jp/closedsearch/closedsearch?p=${encodeURIComponent(q)}` },
    { id: 'amazon',       name: 'Amazon',        build: (q) => `https://www.amazon.co.jp/s?k=${encodeURIComponent(q)}` },
    { id: 'paypay',       name: 'PayPayフリマ',  build: (q) => `https://paypayfleamarket.yahoo.co.jp/search/${encodeURIComponent(q)}` },
    { id: 'keepa',        name: 'Keepa',         build: (q) => `https://keepa.com/#!search/5-${encodeURIComponent(q)}` }
  ];

  function openDialog(productName = '') {
    const form = document.createElement('div');
    form.innerHTML = `
      <div class="field">
        <label>商品名・キーワード</label>
        <input type="text" id="r_q" value="${escapeAttr(productName)}">
      </div>
      <p class="muted">タップするとブラウザで検索結果を開きます。過去の売れた価格を見るには「メルカリ（売り切れ）」「ヤフオク落札」が便利です。</p>
      <div id="r_links"></div>
    `;
    const m = Modal.open({ title: '相場リサーチ', body: form });
    const linksEl = form.querySelector('#r_links');
    const input = form.querySelector('#r_q');
    function update() {
      const q = input.value.trim();
      linksEl.innerHTML = SITES.map(s => {
        const url = q ? s.build(q) : '#';
        return `<a class="btn btn-block" href="${url}" target="_blank" rel="noopener">${s.name}</a>`;
      }).join('');
    }
    input.addEventListener('input', update);
    update();
  }

  function escapeAttr(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  return { openDialog, SITES };
})();
