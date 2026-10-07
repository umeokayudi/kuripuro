import { jsPDF } from 'jspdf'
import { yenFmt } from './reportAnalytics'
import { a4JsPdf } from './pdfView'

function drawBars(doc, series, x, y, w, h) {
  const max = Math.max(...(series || []).map(s => Number(s.value) || 0), 0)
  if (!max) {
    doc.setFontSize(9)
    doc.setTextColor(120)
    doc.text('—', x, y + 8)
    return y + 14
  }
  const n = series.length
  const gap = 1.4
  const bw = Math.max(2, (w - gap * (n - 1)) / n)
  series.forEach((s, i) => {
    const bh = Math.max(1, (Number(s.value) / max) * h)
    const bx = x + i * (bw + gap)
    doc.setFillColor(12, 28, 48)
    doc.rect(bx, y + (h - bh), bw, bh, 'F')
  })
  return y + h + 6
}

export function generateReportPdf({
  title,
  subtitle,
  filtersLine,
  kpis = [],
  revenue = [],
  ranking = [],
  services = [],
  slices = [],
  invoices = [],
  generatedAt,
}) {
  const doc = a4JsPdf(jsPDF)
  const W = 210
  const margin = 14
  let y = 12

  doc.setFillColor(11, 26, 44)
  doc.rect(0, 0, W, 28, 'F')
  doc.setTextColor(193, 156, 86)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('KuriPuro', margin, 12)
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(11)
  doc.text(String(title || 'Report'), margin, 20)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(String(subtitle || ''), W - margin, 20, { align: 'right' })
  y = 36

  doc.setTextColor(70)
  doc.setFontSize(8)
  const filterLines = doc.splitTextToSize(String(filtersLine || ''), W - margin * 2)
  doc.text(filterLines, margin, y)
  y += filterLines.length * 4 + 4

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(12, 28, 48)
  const colW = (W - margin * 2) / 2
  kpis.forEach((k, i) => {
    const cx = margin + (i % 2) * colW
    if (i % 2 === 0 && i > 0) y += 12
    doc.setFontSize(8)
    doc.setTextColor(120)
    doc.setFont('helvetica', 'normal')
    doc.text(String(k.label), cx, y)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(12, 28, 48)
    doc.setFontSize(11)
    doc.text(String(k.value), cx, y + 6)
  })
  y += 16

  const section = (label) => {
    if (y > 250) { doc.addPage(); y = 16 }
    doc.setFillColor(238, 242, 246)
    doc.rect(margin, y - 4, W - margin * 2, 8, 'F')
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(12, 28, 48)
    doc.text(label, margin + 3, y + 1.5)
    y += 10
  }

  section('Revenue')
  y = drawBars(doc, revenue, margin, y, W - margin * 2, 28)

  section('Clients')
  ranking.slice(0, 8).forEach((r) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(40)
    doc.text(String(r.name || '').slice(0, 42), margin, y)
    doc.text(yenFmt(r.value), W - margin, y, { align: 'right' })
    y += 5
  })
  if (!ranking.length) { doc.setTextColor(120); doc.text('—', margin, y); y += 6 }

  section('Services')
  y = drawBars(doc, services, margin, y, W - margin * 2, 22)

  section('Status')
  slices.forEach((s) => {
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(40)
    doc.text(`${s.label}: ${yenFmt(s.value)}`, margin, y)
    y += 5
  })

  section('Invoices')
  invoices.slice(0, 18).forEach((row) => {
    if (y > 280) { doc.addPage(); y = 16 }
    doc.setFontSize(7.5)
    doc.setTextColor(40)
    const line = `${row.date || ''}  ${String(row.client || '').slice(0, 28)}  ${row.status || ''}  ${yenFmt(row.total)}`
    doc.text(line, margin, y)
    y += 4.5
  })

  doc.setFillColor(11, 26, 44)
  doc.rect(0, 285, W, 12, 'F')
  doc.setTextColor(193, 156, 86)
  doc.setFontSize(7)
  doc.text('KuriPuro by JBM', margin, 292)
  doc.text(String(generatedAt || ''), W - margin, 292, { align: 'right' })

  return doc
}
