/**
 * 画像圧縮ユーティリティ
 * Canvas を使って JPEG に変換・リサイズする。
 */
const ImageUtil = (() => {

  const PRESETS = {
    none:     { label: '圧縮しない（オリジナル）', desc: '傷・状態確認に推奨 / 約 2〜5 MB', maxSide: null, quality: null },
    standard: { label: '標準圧縮',                 desc: '長辺1600px / 品質85% / 約 300〜500 KB', maxSide: 1600, quality: 0.85 },
    high:     { label: '高圧縮（容量優先）',       desc: '長辺1024px / 品質70% / 約 100〜200 KB', maxSide: 1024, quality: 0.70 }
  };

  /**
   * File -> { blob, size, mimeType, level }
   */
  async function process(file, level) {
    if (level === 'none') {
      return { blob: file, size: file.size, mimeType: file.type || 'image/jpeg', level };
    }
    const preset = PRESETS[level] || PRESETS.standard;
    const img = await loadImage(file);
    const { width, height } = fitInside(img.width, img.height, preset.maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise(res =>
      canvas.toBlob(res, 'image/jpeg', preset.quality));
    return { blob, size: blob.size, mimeType: 'image/jpeg', level };
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  function fitInside(w, h, maxSide) {
    if (!maxSide || (w <= maxSide && h <= maxSide)) return { width: w, height: h };
    const r = Math.min(maxSide / w, maxSide / h);
    return { width: Math.round(w * r), height: Math.round(h * r) };
  }

  /**
   * 圧縮レベル選択ダイアログ
   * @returns Promise<'none'|'standard'|'high'|null>
   */
  function chooseCompressLevel() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal">
          <div class="modal-header">
            <h2>画像の保存方法を選んでください</h2>
            <button class="modal-close" aria-label="閉じる">×</button>
          </div>
          <div class="modal-body">
            <p class="muted">商品の傷を確認する画像は「圧縮しない」推奨です。全体写真は圧縮しても問題ありません。</p>
            <div class="compress-options">
              ${Object.entries(PRESETS).map(([k, p]) => `
                <div class="compress-option" data-level="${k}">
                  <div class="opt-title">${p.label}</div>
                  <div class="opt-desc">${p.desc}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>`;
      document.getElementById('modalRoot').appendChild(overlay);
      const close = (val) => {
        overlay.remove();
        resolve(val);
      };
      overlay.querySelector('.modal-close').onclick = () => close(null);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
      overlay.querySelectorAll('.compress-option').forEach(el => {
        el.onclick = () => close(el.dataset.level);
      });
    });
  }

  function blobToObjectURL(blob) {
    return URL.createObjectURL(blob);
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
    return (bytes/1024/1024).toFixed(2) + ' MB';
  }

  return { process, chooseCompressLevel, blobToObjectURL, formatSize, PRESETS };
})();
