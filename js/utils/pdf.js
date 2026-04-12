/**
 * PDF 出力ユーティリティ（複式簿記スタイル）
 * 仕訳帳 / 総勘定元帳 / 損益計算書 を jsPDF + autoTable で生成する。
 *
 * === 仕訳ルール（シンプル版 / 免税事業者前提 / 現金主義ベース） ===
 * 仕入  （日付=仕入日）  : 仕入高 / 現金
 * 販売  （日付=販売日）  : 現金 / 売上高
 *                         支払手数料 / 現金    （手数料）
 *                         荷造運賃 / 現金      （送料）
 * 経費  （日付=経費日）  : 各経費科目 / 現金
 *
 * 注: 日本語フォントを jsPDF 標準搭載せず、CDN の IPAex フォントを動的に読み込んで埋め込む。
 */
const PdfUtil = (() => {

  const JP_FONT_URL = 'https://cdn.jsdelivr.net/gh/minoryorg/Noto-Sans-CJK-JP@master/fonts/NotoSansCJKjp-Regular.ttf';
  let _jpFontBase64 = null;

  // 日本語フォントを一度だけ読み込む
  async function loadJpFont() {
    if (_jpFontBase64) return _jpFontBase64;
    try {
      const res = await fetch(JP_FONT_URL);
      if (!res.ok) throw new Error('fetch failed');
      const buf = await res.arrayBuffer();
      _jpFontBase64 = arrayBufferToBase64(buf);
      return _jpFontBase64;
    } catch (e) {
      console.warn('日本語フォント読み込み失敗', e);
      return null;
    }
  }
  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  async function createDoc() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const font = await loadJpFont();
    if (font) {
      doc.addFileToVFS('NotoSansJP.ttf', font);
      doc.addFont('NotoSansJP.ttf', 'noto', 'normal');
      doc.setFont('noto');
    }
    return doc;
  }

  // 仕訳配列を作成
  async function buildJournal(period) {
    const [products, expenses] = await Promise.all([DB.Products.list(), DB.Expenses.list()]);
    const entries = [];

    // 仕入
    for (const p of products) {
      if (!inPeriod(p.purchaseDate, period)) continue;
      const amt = (p.purchasePrice || 0) * (p.quantity || 1);
      if (amt > 0) {
        entries.push({
          date: p.purchaseDate,
          debit: '仕入高', debitAmt: amt,
          credit: '現金', creditAmt: amt,
          summary: `仕入 ${p.name}`
        });
      }
    }
    // 販売
    for (const p of products) {
      if (!p.saleDate || !p.salePrice || !inPeriod(p.saleDate, period)) continue;
      entries.push({
        date: p.saleDate,
        debit: '現金', debitAmt: p.salePrice,
        credit: '売上高', creditAmt: p.salePrice,
        summary: `売上 ${p.name}`
      });
      const fee = p.feeAmount ?? (p.salePrice * (p.feeRate || 0) / 100);
      if (fee > 0) {
        entries.push({
          date: p.saleDate,
          debit: '支払手数料', debitAmt: Math.round(fee),
          credit: '現金', creditAmt: Math.round(fee),
          summary: `販売手数料 ${p.name}`
        });
      }
      if (p.shippingCost > 0) {
        entries.push({
          date: p.saleDate,
          debit: '荷造運賃', debitAmt: p.shippingCost,
          credit: '現金', creditAmt: p.shippingCost,
          summary: `送料 ${p.name}`
        });
      }
    }
    // 経費
    for (const e of expenses) {
      if (!inPeriod(e.date, period)) continue;
      entries.push({
        date: e.date,
        debit: expenseCategoryLabel(e.category), debitAmt: e.amount,
        credit: '現金', creditAmt: e.amount,
        summary: e.description || ''
      });
    }
    entries.sort((a, b) => a.date.localeCompare(b.date));
    return entries;
  }

  async function exportJournal(period) {
    const entries = await buildJournal(period);
    const doc = await createDoc();
    doc.setFontSize(14);
    doc.text('仕訳帳', 14, 16);
    doc.setFontSize(10);
    doc.text(`期間: ${periodTitle(period)}`, 14, 23);
    doc.autoTable({
      startY: 28,
      head: [['日付','借方科目','借方金額','貸方科目','貸方金額','摘要']],
      body: entries.map(e => [
        e.date, e.debit, e.debitAmt.toLocaleString(),
        e.credit, e.creditAmt.toLocaleString(), e.summary
      ]),
      styles: { font: 'noto', fontSize: 8 },
      headStyles: { fillColor: [44, 123, 229], font: 'noto' }
    });
    doc.save(`仕訳帳_${periodLabel(period)}.pdf`);
  }

  async function exportLedger(period) {
    const entries = await buildJournal(period);
    // 科目ごとにグルーピング
    const accounts = {};
    for (const e of entries) {
      (accounts[e.debit] ||= []).push({ ...e, side: '借方', amt: e.debitAmt });
      (accounts[e.credit] ||= []).push({ ...e, side: '貸方', amt: e.creditAmt });
    }
    const doc = await createDoc();
    doc.setFontSize(14);
    doc.text('総勘定元帳', 14, 16);
    doc.setFontSize(10);
    doc.text(`期間: ${periodTitle(period)}`, 14, 23);
    let y = 30;
    for (const [account, items] of Object.entries(accounts)) {
      if (y > 250) { doc.addPage(); y = 20; }
      doc.setFontSize(12);
      doc.text(account, 14, y);
      y += 2;
      const rows = items.map(i => [i.date, i.side, i.amt.toLocaleString(), i.summary]);
      const debitTotal = items.filter(i => i.side==='借方').reduce((s,i)=>s+i.amt,0);
      const creditTotal = items.filter(i => i.side==='貸方').reduce((s,i)=>s+i.amt,0);
      rows.push(['合計','借方', debitTotal.toLocaleString(), '']);
      rows.push(['','貸方', creditTotal.toLocaleString(), '']);
      doc.autoTable({
        startY: y + 2,
        head: [['日付','借/貸','金額','摘要']],
        body: rows,
        styles: { font: 'noto', fontSize: 8 },
        headStyles: { fillColor: [44, 123, 229], font: 'noto' }
      });
      y = doc.lastAutoTable.finalY + 8;
    }
    doc.save(`総勘定元帳_${periodLabel(period)}.pdf`);
  }

  async function exportPL(period) {
    const entries = await buildJournal(period);
    const sum = (account, side) =>
      entries.filter(e => e[side === 'debit' ? 'debit' : 'credit'] === account)
             .reduce((s, e) => s + (side === 'debit' ? e.debitAmt : e.creditAmt), 0);

    const sales = sum('売上高', 'credit');
    const purchase = sum('仕入高', 'debit');
    const expenseAccounts = ['支払手数料','荷造運賃', ...EXPENSE_CATEGORIES.map(c => c.label)];
    const expenseRows = expenseAccounts.map(a => [a, sum(a, 'debit')]).filter(r => r[1] > 0);
    const expenseTotal = expenseRows.reduce((s, r) => s + r[1], 0);
    const grossProfit = sales - purchase;
    const netProfit = grossProfit - expenseTotal;

    const doc = await createDoc();
    doc.setFontSize(14);
    doc.text('損益計算書', 14, 16);
    doc.setFontSize(10);
    doc.text(`期間: ${periodTitle(period)}`, 14, 23);

    const body = [
      ['【売上の部】', ''],
      ['  売上高', sales.toLocaleString()],
      ['【売上原価】', ''],
      ['  仕入高', purchase.toLocaleString()],
      ['売上総利益（粗利）', grossProfit.toLocaleString()],
      ['【販売費及び一般管理費】', ''],
      ...expenseRows.map(([a, v]) => ['  ' + a, v.toLocaleString()]),
      ['経費合計', expenseTotal.toLocaleString()],
      ['当期純利益', netProfit.toLocaleString()]
    ];
    doc.autoTable({
      startY: 28,
      head: [['項目','金額（円）']],
      body,
      styles: { font: 'noto', fontSize: 10 },
      headStyles: { fillColor: [44, 123, 229], font: 'noto' },
      columnStyles: { 1: { halign: 'right' } }
    });
    doc.save(`損益計算書_${periodLabel(period)}.pdf`);
  }

  function inPeriod(dateStr, period) {
    if (!period) return true;
    if (period.month === 0) return dateStr.startsWith(String(period.year));
    const ym = `${period.year}-${String(period.month).padStart(2,'0')}`;
    return dateStr.startsWith(ym);
  }
  function periodLabel(period) {
    if (period.month === 0) return String(period.year);
    return `${period.year}-${String(period.month).padStart(2,'0')}`;
  }
  function periodTitle(period) {
    if (period.month === 0) return `${period.year}年（年間）`;
    return `${period.year}年${period.month}月`;
  }

  return { exportJournal, exportLedger, exportPL, buildJournal, createDoc };
})();
