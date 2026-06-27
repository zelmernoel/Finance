const PFX = 'receipt:';

export function saveReceipt(txId: string, dataUrl: string): void {
  try { localStorage.setItem(PFX + txId, dataUrl); } catch { /* storage full */ }
}

export function getReceipt(txId: string): string | null {
  try { return localStorage.getItem(PFX + txId); } catch { return null; }
}

export function deleteReceipt(txId: string): void {
  try { localStorage.removeItem(PFX + txId); } catch { /* ignore */ }
}

export function hasReceipt(txId: string): boolean {
  try { return localStorage.getItem(PFX + txId) !== null; } catch { return false; }
}

export async function fileToDataUrl(file: File, maxPx = 1400, quality = 0.82): Promise<string> {
  if (!file.type.startsWith('image/')) {
    // PDF or other — store as-is
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target?.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

export function printReceipt(dataUrl: string, label: string): void {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head>
    <title>Beleg – ${label}</title>
    <style>
      body { margin: 0; padding: 16px; display: flex; justify-content: center; }
      img  { max-width: 100%; height: auto; }
      @media print { body { padding: 0; } }
    </style>
    </head><body>
    <img src="${dataUrl}" onload="window.print();window.close();" />
    </body></html>`);
  win.document.close();
}
