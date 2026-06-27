import type { Transaction } from '../types';
import { formatEuro } from '../utils';

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function printTransactions(
  transactions: Transaction[],
  budgetName: string,
  userName: string,
): void {
  const income  = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  const rows = transactions.map(t => `
    <tr>
      <td>${fmtDate(t.date)}</td>
      <td>${t.type === 'income' ? 'Einnahme' : 'Ausgabe'}</td>
      <td>${t.category}</td>
      <td>${t.description}</td>
      <td class="${t.type}">${t.type === 'income' ? '+' : '−'}${formatEuro(t.amount)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8"/>
<title>FinanzTracker – ${budgetName}</title>
<style>
  body { font-family: system-ui, sans-serif; font-size: 12px; color: #111; margin: 24px; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .meta { color: #666; margin-bottom: 16px; font-size: 11px; }
  .summary { display: flex; gap: 24px; margin-bottom: 16px; padding: 10px 14px;
             border: 1px solid #e5e7eb; border-radius: 4px; }
  .summary span { font-size: 11px; color: #555; }
  .summary strong { display: block; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase;
       letter-spacing: .05em; color: #888; border-bottom: 2px solid #e5e7eb; }
  td { padding: 6px 8px; border-bottom: 1px solid #f3f4f6; }
  td.income  { color: #4A6FA5; font-weight: 600; text-align: right; }
  td.expense { text-align: right; font-weight: 600; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<h1>FinanzTracker – ${budgetName}</h1>
<p class="meta">Erstellt am ${fmtDate(new Date().toISOString().slice(0, 10))}${userName ? ' · ' + userName : ''}</p>
<div class="summary">
  <span><strong>${formatEuro(income)}</strong>Einnahmen</span>
  <span><strong>${formatEuro(expense)}</strong>Ausgaben</span>
  <span><strong>${formatEuro(income - expense)}</strong>Saldo</span>
</div>
<table>
  <thead><tr><th>Datum</th><th>Typ</th><th>Kategorie</th><th>Beschreibung</th><th>Betrag</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 400);
}
