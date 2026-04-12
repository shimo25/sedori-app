/**
 * データモデル定義
 * IndexedDB のオブジェクトストアと対応する。
 *
 * === Product（商品） ===
 *   id: string (uuid)
 *   name: string
 *   sku: string?         // 任意の管理番号
 *   category: string?
 *   purchaseDate: string (YYYY-MM-DD)
 *   purchasePrice: number
 *   purchaseFrom: string  // 仕入先
 *   quantity: number
 *   status: 'stocked' | 'listed' | 'trading' | 'shipped' | 'await_rating' | 'completed'
 *   platform: string     // 'mercari' 等（販売先）
 *   listPrice: number?   // 出品価格
 *   salePrice: number?   // 実売価格
 *   saleDate: string?    // 販売日
 *   feeRate: number?     // 手数料率（%）
 *   feeAmount: number?   // 手数料額（自動計算 or 手入力）
 *   shippingCost: number? // 送料（自己負担分）
 *   packagingCost: number? // 梱包資材費
 *   otherCost: number?     // その他経費（商品単位）
 *   listDate: string?      // 出品日
 *   shipDate: string?      // 発送日
 *   memo: string?
 *   imageIds: string[]   // Image.id の配列
 *   createdAt: number (epoch ms)
 *   updatedAt: number
 *
 * === Expense（経費） ===
 *   id: string
 *   date: string (YYYY-MM-DD)
 *   category: string  // 'packing' | 'transport' | 'communication' | 'supplies' | 'other'
 *   amount: number
 *   description: string
 *   memo: string?
 *   createdAt: number
 *
 * === Image（画像） ===
 *   id: string
 *   productId: string
 *   blob: Blob
 *   mimeType: string
 *   compressedLevel: 'none' | 'standard' | 'high'
 *   size: number  // bytes
 *   createdAt: number
 *
 * === Setting（設定） ===
 *   key: string    // 'feePresets' 等
 *   value: any
 *
 * === PackagingStock（梱包材在庫） ===
 *   id: string
 *   name: string       // 例: "60サイズ（ダンボール）"
 *   count: number      // 残個数
 *   lowThreshold: number?  // 残り警告閾値（未設定なら 3）
 *   unitPrice: number?     // 1個あたりの単価（任意・参考値）
 *   memo: string?
 *   createdAt: number
 *   updatedAt: number
 */

const STATUSES = [
  { key: 'stocked',      label: '仕入済' },
  { key: 'listed',       label: '出品中' },
  { key: 'trading',      label: '取引中' },
  { key: 'shipped',      label: '発送済み' },
  { key: 'await_rating', label: '受取評価待ち' },
  { key: 'completed',    label: '取引完了' }
];

const EXPENSE_CATEGORIES = [
  { key: 'packing',       label: '梱包材費' },
  { key: 'transport',     label: '交通費' },
  { key: 'communication', label: '通信費' },
  { key: 'supplies',      label: '消耗品費' },
  { key: 'shipping',      label: '発送費' },
  { key: 'fee',           label: '支払手数料' },
  { key: 'other',         label: 'その他' }
];

const DEFAULT_FEE_PRESETS = [
  { id: 'mercari',  name: 'メルカリ',  rate: 10 },
  { id: 'yahoo',    name: 'ヤフオク',  rate: 10 },
  { id: 'amazon',   name: 'Amazon',    rate: 15 },
  { id: 'paypay',   name: 'PayPayフリマ', rate: 5 }
];

function statusLabel(key) {
  const s = STATUSES.find(x => x.key === key);
  return s ? s.label : key;
}

function expenseCategoryLabel(key) {
  const c = EXPENSE_CATEGORIES.find(x => x.key === key);
  return c ? c.label : key;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function yen(n) {
  if (n == null || isNaN(n)) return '¥0';
  return '¥' + Math.round(n).toLocaleString('ja-JP');
}

function today() {
  const d = new Date();
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
