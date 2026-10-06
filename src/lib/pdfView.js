/** Default PDF viewer zoom: fit page width so A4 stays A4 but is readable on phones. */
export function applyReadablePdfView(doc) {
  if (doc && typeof doc.setDisplayMode === 'function') {
    doc.setDisplayMode('fullwidth', 'continuous')
  }
  return doc
}

export function a4JsPdf(jsPDF) {
  return applyReadablePdfView(new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' }))
}
