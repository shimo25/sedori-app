/**
 * PDF 出力ユーティリティ（pdf-lib 版）
 * 仕訳帳 / 総勘定元帳 / 損益計算書 を pdf-lib で生成し、日本語TTFをCID埋め込みする。
 *
 * === 仕訳ルール（シンプル版 / 免税事業者前提 / 現金主義ベース） ===
 * 仕入  （日付=仕入日）  : 仕入高 / 現金
 * 販売  （日付=販売日）  : 現金 / 売上高
 *                         支払手数料 / 現金    （手数料）
 *                         荷造運賃 / 現金      （送料）
 * 経費  （日付=経費日）  : 各経費科目 / 現金
 */
const PdfUtil = (() => {

  const JP_FONT_URL = 'https://cdn.jsdelivr.net/gh/minoryorg/Noto-Sans-CJK-JP@master/fonts/NotoSansCJKjp-Regular.ttf';
  const JP_FONT_CACHE_KEY = 'jpFontBytes_v2'; // base64 のまま保持
  let _jpFontBytes = null; // Uint8Array

  // A4 portrait（pt単位、pdf-lib標準）
  const PAGE_W = 595.28, PAGE_H = 841.89;
  const MARGIN = 36;
  const HEAD_FILL = [0.17, 0.48, 0.90]; // rgb 0-1
  const TEXT_COLOR = [0, 0, 0];
  const WHITE = [1, 1, 1];
  const GRID_COLOR = [0.75, 0.75, 0.75];

  // 日本語フォントを読み込む（メモリ→localStorage→CDNの順にフォールバック）
  async function loadJpFont() {
    if (_jpFontBytes) return _jpFontBytes;
    try {
      const cached = localStorage.getItem(JP_FONT_CACHE_KEY);
      if (cached) {
        _jpFontBytes = base64ToBytes(cached);
        return _jpFontBytes;
      }
    } catch (e) { /* 無視 */ }

    let res;
    try {
      res = await fetch(JP_FONT_URL);
    } catch (e) {
      throw new Error(`日本語フォント取得失敗 (${e.message})`);
    }
    if (!res.ok) throw new Error(`日本語フォント取得失敗 (status ${res.status})`);
    const buf = await res.arrayBuffer();
    _jpFontBytes = new Uint8Array(buf);
    try { localStorage.setItem(JP_FONT_CACHE_KEY, bytesToBase64(_jpFontBytes)); } catch (e) { /* 容量超過無視 */ }
    return _jpFontBytes;
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }
  function base64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // --- PDF ドキュメント＆ページ管理ヘルパー ---
  class Doc {
    constructor(pdfDoc, font) {
      this.pdfDoc = pdfDoc;
      this.font = font;
      this.page = null;
      this.y = 0;
      this.addPage();
    }
    addPage() {
      this.page = this.pdfDoc.addPage([PAGE_W, PAGE_H]);
      this.y = PAGE_H - MARGIN;
    }
    ensureSpace(h) {
      if (this.y - h < MARGIN) this.addPage();
    }
    textWidth(s, size) { return this.font.widthOfTextAtSize(s, size); }
    drawText(text, x, y, size, color = TEXT_COLOR) {
      const { rgb } = PDFLib;
      this.page.drawText(String(text), { x, y, size, font: this.font, color: rgb(...color) });
    }
    drawRect(x, y, w, h, fillColor) {
      const { rgb } = PDFLib;
      this.page.drawRectangle({ x, y, width: w, height: h, color: rgb(...fillColor) });
    }
    drawBorder(x, y, w, h) {
      const { rgb } = PDFLib;
      this.page.drawRectangle({
        x, y, width: w, height: h,
        borderColor: rgb(...GRID_COLOR), borderWidth: 0.5
      });
    }
  }

  async function createDoc() {
    const fontBytes = await loadJpFont();
    const pdfDoc = await PDFLib.PDFDocument.create();
    pdfDoc.registerFontkit(window.fontkit);
    // subset: false にして全グリフ埋め込み（PDFサイズは大きくなるが全ビューアで確実に表示）
    const font = await pdfDoc.embedFont(fontBytes, { subset: false });
    return new Doc(pdfDoc, font);
  }

  // 表を描画。rows は行配列、各行はセル文字列配列。cellAlign は列ごとの 'left'|'right'
  function drawTable(doc, opts) {
    const { headers, rows, colWidths, fontSize = 9, cellAlign = [], headFill = HEAD_FILL } = opts;
    const rowHeight = fontSize * 1.8;
    const padX = 4;
    const totalW = colWidths.reduce((a, b) => a + b, 0);
    const startX = MARGIN;

    function drawRow(cells, y, isHead) {
      let x = startX;
      if (isHead) doc.drawRect(x, y, totalW, rowHeight, headFill);
      for (let i = 0; i < cells.length; i++) {
        const w = colWidths[i];
        doc.drawBorder(x, y, w, rowHeight);
        const text = String(cells[i] ?? '');
        const align = isHead ? 'center' : (cellAlign[i] || 'left');
        const textW = doc.textWidth(text, fontSize);
        let tx = x + padX;
        if (align === 'right') tx = x + w - padX - textW;
        else if (align === 'center') tx = x + (w - textW) / 2;
        const ty = y + (rowHeight - fontSize) / 2 + fontSize * 0.15;
        const color = isHead ? WHITE : TEXT_COLOR;
        doc.drawText(text, tx, ty, fontSize, color);
        x += w;
      }
    }

    // ヘッダ
    doc.ensureSpace(rowHeight);
    doc.y -= rowHeight;
    drawRow(headers, doc.y, true);

    // 明細
    for (const row of rows) {
      doc.ensureSpace(rowHeight);
      // 新ページに切り替わった場合はヘッダ再描画
      if (doc.y - rowHeight < MARGIN) {
        doc.addPage();
        doc.y -= rowHeight;
        drawRow(headers, doc.y, true);
      }
      doc.y -= rowHeight;
      drawRow(row, doc.y, false);
    }
  }

  async function saveDoc(doc, filename) {
    const bytes = await doc.pdfDoc.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // --- 仕訳生成（ロジックは従来と同じ） ---
  async function buildJournal(period) {
    const [products, expenses] = await Promise.all([DB.Products.list(), DB.Expenses.list()]);
    const entries = [];
    for (const p of products) {
      if (!inPeriod(p.purchaseDate, period)) continue;
      const amt = (p.purchasePrice || 0) * (p.quantity || 1);
      if (amt > 0) {
        entries.push({ date: p.purchaseDate, debit: '仕入', debitAmt: amt, credit: '現金', creditAmt: amt, summary: `仕入 ${p.name}` });
      }
    }
    for (const p of products) {
      if (!p.saleDate || !p.salePrice || !inPeriod(p.saleDate, period)) continue;
      entries.push({ date: p.saleDate, debit: '現金', debitAmt: p.salePrice, credit: '売上', creditAmt: p.salePrice, summary: `売上 ${p.name}` });
      const fee = p.feeAmount ?? (p.salePrice * (p.feeRate || 0) / 100);
      if (fee > 0) entries.push({ date: p.saleDate, debit: '支払手数料', debitAmt: Math.round(fee), credit: '現金', creditAmt: Math.round(fee), summary: `販売手数料 ${p.name}` });
      if (p.shippingCost > 0) entries.push({ date: p.saleDate, debit: '荷造運賃', debitAmt: p.shippingCost, credit: '現金', creditAmt: p.shippingCost, summary: `送料 ${p.name}` });
    }
    for (const e of expenses) {
      if (!inPeriod(e.date, period)) continue;
      entries.push({ date: e.date, debit: expenseCategoryLabel(e.category), debitAmt: e.amount, credit: '現金', creditAmt: e.amount, summary: e.description || '' });
    }
    entries.sort((a, b) => a.date.localeCompare(b.date));
    return entries;
  }

  async function exportJournal(period) {
    const entries = await buildJournal(period);
    const doc = await createDoc();
    doc.y -= 6;
    doc.drawText('仕訳帳', MARGIN, doc.y - 14, 16);
    doc.y -= 20;
    doc.drawText(`期間: ${periodTitle(period)}`, MARGIN, doc.y - 10, 10);
    doc.y -= 16;

    drawTable(doc, {
      headers: ['日付', '借方科目', '借方金額', '貸方科目', '貸方金額', '摘要'],
      rows: entries.map(e => [e.date, e.debit, e.debitAmt.toLocaleString(), e.credit, e.creditAmt.toLocaleString(), e.summary]),
      colWidths: [70, 75, 70, 75, 70, 163],
      fontSize: 8,
      cellAlign: ['left', 'left', 'right', 'left', 'right', 'left']
    });
    await saveDoc(doc, `仕訳帳_${periodLabel(period)}.pdf`);
  }

  async function exportLedger(period) {
    const entries = await buildJournal(period);
    const accounts = {};
    for (const e of entries) {
      (accounts[e.debit] ||= []).push({ ...e, side: '借方', amt: e.debitAmt });
      (accounts[e.credit] ||= []).push({ ...e, side: '貸方', amt: e.creditAmt });
    }
    const doc = await createDoc();
    doc.y -= 6;
    doc.drawText('総勘定元帳', MARGIN, doc.y - 14, 16);
    doc.y -= 20;
    doc.drawText(`期間: ${periodTitle(period)}`, MARGIN, doc.y - 10, 10);
    doc.y -= 16;

    for (const [account, items] of Object.entries(accounts)) {
      doc.ensureSpace(40);
      doc.y -= 14;
      doc.drawText(account, MARGIN, doc.y, 12);
      doc.y -= 4;
      const debitTotal = items.filter(i => i.side === '借方').reduce((s, i) => s + i.amt, 0);
      const creditTotal = items.filter(i => i.side === '貸方').reduce((s, i) => s + i.amt, 0);
      const rows = items.map(i => [i.date, i.side, i.amt.toLocaleString(), i.summary]);
      rows.push(['合計', '借方', debitTotal.toLocaleString(), '']);
      rows.push(['', '貸方', creditTotal.toLocaleString(), '']);
      drawTable(doc, {
        headers: ['日付', '借/貸', '金額', '摘要'],
        rows,
        colWidths: [75, 50, 80, 318],
        fontSize: 8,
        cellAlign: ['left', 'center', 'right', 'left']
      });
      doc.y -= 10;
    }
    await saveDoc(doc, `総勘定元帳_${periodLabel(period)}.pdf`);
  }

  async function exportPL(period) {
    const entries = await buildJournal(period);
    const sum = (account, side) =>
      entries.filter(e => e[side === 'debit' ? 'debit' : 'credit'] === account)
             .reduce((s, e) => s + (side === 'debit' ? e.debitAmt : e.creditAmt), 0);

    const sales = sum('売上', 'credit');
    const purchase = sum('仕入', 'debit');
    // 経費科目は「荷造運賃」＋EXPENSE_CATEGORIES（支払手数料はここに含まれるので重複させない）
    const expenseAccounts = [...new Set(['荷造運賃', ...EXPENSE_CATEGORIES.map(c => c.label)])];
    const expenseRows = expenseAccounts.map(a => [a, sum(a, 'debit')]).filter(r => r[1] > 0);
    const expenseTotal = expenseRows.reduce((s, r) => s + r[1], 0);
    const grossProfit = sales - purchase;
    const netProfit = grossProfit - expenseTotal;

    const doc = await createDoc();
    doc.y -= 6;
    doc.drawText('損益計算書', MARGIN, doc.y - 14, 16);
    doc.y -= 20;
    doc.drawText(`期間: ${periodTitle(period)}`, MARGIN, doc.y - 10, 10);
    doc.y -= 16;

    const rows = [
      ['【売上】', ''],
      ['  売上', sales.toLocaleString()],
      ['【仕入】', ''],
      ['  仕入', purchase.toLocaleString()],
      ['売上総利益（粗利）', grossProfit.toLocaleString()],
      ['【販売費及び一般管理費】', ''],
      ...expenseRows.map(([a, v]) => ['  ' + a, v.toLocaleString()]),
      ['経費合計', expenseTotal.toLocaleString()],
      ['当期純利益', netProfit.toLocaleString()]
    ];
    drawTable(doc, {
      headers: ['項目', '金額（円）'],
      rows,
      colWidths: [380, 143],
      fontSize: 10,
      cellAlign: ['left', 'right']
    });
    await saveDoc(doc, `損益計算書_${periodLabel(period)}.pdf`);
  }

  // PDF生成呼び出しをラップし、フォント読込失敗時はトーストで通知して中止する
  function withFontGuard(fn) {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (e) {
        if (String(e.message || '').includes('日本語フォント')) {
          const msg = '日本語フォントの読み込みに失敗しました。通信環境を確認して再度お試しください。';
          try { Modal.toast(msg); } catch (_) { alert(msg); }
          console.error(e);
          return;
        }
        throw e;
      }
    };
  }

  function inPeriod(dateStr, period) {
    if (!period) return true;
    if (period.month === 0) return dateStr.startsWith(String(period.year));
    const ym = `${period.year}-${String(period.month).padStart(2, '0')}`;
    return dateStr.startsWith(ym);
  }
  function periodLabel(period) {
    if (period.month === 0) return String(period.year);
    return `${period.year}-${String(period.month).padStart(2, '0')}`;
  }
  function periodTitle(period) {
    if (period.month === 0) return `${period.year}年（年間）`;
    return `${period.year}年${period.month}月`;
  }

  return {
    exportJournal: withFontGuard(exportJournal),
    exportLedger: withFontGuard(exportLedger),
    exportPL: withFontGuard(exportPL),
    buildJournal,
    createDoc
  };
})();
