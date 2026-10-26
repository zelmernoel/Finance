import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Transaction } from '../types';
import { formatDate as fmtDate, formatEuro, todayISO } from '../utils';

export interface ActiveFilters {
  dateFrom?: string;
  dateTo?: string;
  type?: string;
  category?: string;
}

export function exportTransactionsPDF(
  transactions: Transaction[],
  filters: ActiveFilters,
  userName: string,
  budgetName: string,
): void {
  const doc = new jsPDF();

  // ── Header ──
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Finance', 14, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(`Budget: ${budgetName}`, 14, 28);
  if (userName) doc.text(`Nutzer: ${userName}`, 14, 34);
  doc.text(`Erstellt am: ${fmtDate(todayISO())}`, 14, userName ? 40 : 34);

  let yOffset = userName ? 48 : 42;
  if (filters.dateFrom || filters.dateTo) {
    doc.text(
      `Zeitraum: ${filters.dateFrom ? fmtDate(filters.dateFrom) : '–'} bis ${filters.dateTo ? fmtDate(filters.dateTo) : 'heute'}`,
      14, yOffset,
    );
    yOffset += 6;
  }
  if (filters.category) { doc.text(`Kategorie: ${filters.category}`, 14, yOffset); yOffset += 6; }
  if (filters.type)     { doc.text(`Typ: ${filters.type === 'income' ? 'Einnahmen' : 'Ausgaben'}`, 14, yOffset); yOffset += 6; }

  // ── Summen ──
  const income  = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const anyTax  = transactions.some(t => (t.taxAmount ?? 0) > 0);
  const ust     = transactions.filter(t => t.type === 'income').reduce((s, t) => s + (t.taxAmount ?? 0), 0);
  const vst     = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + (t.taxAmount ?? 0), 0);
  doc.setTextColor(0);
  doc.setFontSize(9);
  doc.text(
    `Einnahmen: ${formatEuro(income)}  |  Ausgaben: ${formatEuro(expense)}  |  Saldo: ${formatEuro(income - expense)}`,
    14, yOffset + 2,
  );
  if (anyTax) {
    yOffset += 5;
    doc.text(`darin USt: ${formatEuro(ust)}  |  darin VSt: ${formatEuro(vst)}`, 14, yOffset + 2);
  }

  // Helvetica (WinAnsi) kennt das typografische Minus (U+2212) nicht — jsPDF
  // schrieb die Zelle dann als UCS-2 und die Ausgabenzeilen waren Zeichensalat.
  const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} EUR`;

  // ── Tabelle ──
  autoTable(doc, {
    startY: yOffset + 10,
    head: [[...['Datum', 'Typ', 'Kategorie', 'Beschreibung', 'Betrag'], ...(anyTax ? ['davon Steuer'] : [])]],
    body: transactions.map(t => [
      fmtDate(t.date),
      t.type === 'income' ? 'Einnahme' : 'Ausgabe',
      t.category,
      t.description,
      `${t.type === 'expense' ? '-' : '+'}${eur(t.amount)}`,
      ...(anyTax ? [t.taxAmount ? eur(t.taxAmount) : ''] : []),
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [74, 111, 165], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 249, 250] },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' } },
  });

  doc.save(`Finance_${budgetName}_${todayISO()}.pdf`);
}
