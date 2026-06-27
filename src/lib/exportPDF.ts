import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Transaction } from '../types';
import { formatEuro } from '../utils';

export interface ActiveFilters {
  dateFrom?: string;
  dateTo?: string;
  type?: string;
  category?: string;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
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
  doc.text('FinanzTracker', 14, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(`Budget: ${budgetName}`, 14, 28);
  if (userName) doc.text(`Nutzer: ${userName}`, 14, 34);
  doc.text(`Erstellt am: ${fmtDate(new Date().toISOString().slice(0, 10))}`, 14, userName ? 40 : 34);

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
  doc.setTextColor(0);
  doc.setFontSize(9);
  doc.text(
    `Einnahmen: ${formatEuro(income)}  |  Ausgaben: ${formatEuro(expense)}  |  Saldo: ${formatEuro(income - expense)}`,
    14, yOffset + 2,
  );

  // ── Tabelle ──
  autoTable(doc, {
    startY: yOffset + 10,
    head: [['Datum', 'Typ', 'Kategorie', 'Beschreibung', 'Betrag']],
    body: transactions.map(t => [
      fmtDate(t.date),
      t.type === 'income' ? 'Einnahme' : 'Ausgabe',
      t.category,
      t.description,
      `${t.type === 'expense' ? '−' : '+'}${t.amount.toFixed(2).replace('.', ',')} EUR`,
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [74, 111, 165], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 249, 250] },
    columnStyles: { 4: { halign: 'right' } },
  });

  doc.save(`FinanzTracker_${budgetName}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
