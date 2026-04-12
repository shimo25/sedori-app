/**
 * CSV 出力ユーティリティ
 * 確定申告で利用しやすい形式で、売上・経費・在庫を出力する。
 * iPhone で文字化けしないよう UTF-8 BOM 付きで出力する。
 */
const CsvUtil = (() => {

  function escape(v) {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function rowsToCsv(headers, rows) {
    const lines = [headers.map(escape).join(',')];
    for (const r of rows) lines.push(r.map(escape).join(','));
    return '\uFEFF' + lines.join('\r\n');
  }

  function download(filename, csvStr) {
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  // 売上CSV（販売済の商品）
  async function exportSales(period) {
    const products = await DB.Products.list();
    const rows = products
      .filter(p => p.salePrice && p.saleDate && inPeriod(p.saleDate, period))
      .sort((a, b) => a.saleDate.localeCompare(b.saleDate))
      .map(p => {
        const fee = p.feeAmount ?? (p.salePrice * (p.feeRate || 0) / 100);
        const profit = p.salePrice - p.purchasePrice - fee - (p.shippingCost || 0);
        return [
          p.saleDate, p.name, p.platform, p.quantity,
          p.purchasePrice, p.salePrice, Math.round(fee),
          p.shippingCost || 0, Math.round(profit),
          p.purchaseDate, p.purchaseFrom, p.memo || ''
        ];
      });
    const csv = rowsToCsv(
      ['販売日','商品名','販売先','数量','仕入額','販売額','手数料','送料','粗利','仕入日','仕入先','メモ'],
      rows
    );
    download(`sales_${periodLabel(period)}.csv`, csv);
  }

  // 経費CSV
  async function exportExpenses(period) {
    const items = await DB.Expenses.list();
    const rows = items
      .filter(e => inPeriod(e.date, period))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(e => [e.date, expenseCategoryLabel(e.category), e.amount, e.description, e.memo || '']);
    const csv = rowsToCsv(['日付','科目','金額','内容','メモ'], rows);
    download(`expenses_${periodLabel(period)}.csv`, csv);
  }

  // 在庫CSV（未販売）
  async function exportInventory() {
    const products = await DB.Products.list();
    const rows = products
      .filter(p => p.status !== 'completed')
      .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate))
      .map(p => [
        p.purchaseDate, p.name, statusLabel(p.status),
        p.quantity, p.purchasePrice, p.purchasePrice * (p.quantity || 1),
        p.purchaseFrom, p.listPrice || '', p.memo || ''
      ]);
    const csv = rowsToCsv(
      ['仕入日','商品名','ステータス','数量','仕入単価','仕入合計','仕入先','出品価格','メモ'],
      rows
    );
    download(`inventory_${today()}.csv`, csv);
  }

  function inPeriod(dateStr, period) {
    if (!period) return true;
    if (period.month === 0) return dateStr.startsWith(String(period.year));
    const ym = `${period.year}-${String(period.month).padStart(2,'0')}`;
    return dateStr.startsWith(ym);
  }
  function periodLabel(period) {
    if (!period) return 'all';
    if (period.month === 0) return String(period.year);
    return `${period.year}-${String(period.month).padStart(2,'0')}`;
  }

  return { exportSales, exportExpenses, exportInventory };
})();
