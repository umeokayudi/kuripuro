// v1.0.250 · Peças visuais do cartão de serviço do funcionário ("Meu dia"), direção "Cor que trabalha".
// Só apresentação: cada peça recebe os mesmos handlers/dados que o cartão já usava.
import CameraOrGallery from './CameraOrGallery'

// Ícones dos tiles (sempre os mesmos em todo o sistema)
const ICONS = {
  map3d: <path d="M12 2.8 20 7.3v9.4l-8 4.5-8-4.5V7.3l8-4.5Zm0 0v9.4m8-4.9-8 4.9-8-4.9" />,
  access: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2" /></>,
  ai: <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7L4.5 11l5.6-1.9L12 3.5Zm6.5 11.5.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />,
  manual: <><rect x="3.5" y="5" width="17" height="14" rx="3" /><path d="m10.5 9.3 4 2.7-4 2.7V9.3Z" /></>,
  problem: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3.5 17.3l3.2 3.2 5.8-5.8a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6Z" />,
  camera: <><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.5-2h4.4l1.5 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-8Z" /><circle cx="12" cy="12.5" r="3.4" /></>,
  play: <path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
}

export function JcIcon({ name, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

/** Chip de status com cor de significado: blue | green | amber | red | gray */
export function StatusChip({ tone = 'blue', children, live = false }) {
  return <span className={`jc-chip is-${tone}${live ? ' is-live' : ''}`}>{live && <i aria-hidden="true" />}{children}</span>
}

/** Uma fileira de botões com tile colorido (Mapa 3D · Acesso · Perguntar à IA …). */
export function ActionTiles({ items }) {
  const list = items.filter(Boolean)
  if (!list.length) return null
  return (
    <div className="jc-tiles" style={{ gridTemplateColumns: `repeat(${Math.min(list.length, 4)}, minmax(0, 1fr))` }}>
      {list.map(it => (
        <button key={it.key} type="button" className={`jc-tile mod-${it.key}${it.on ? ' is-on' : ''}`} aria-expanded={it.on === undefined ? undefined : !!it.on} title={it.title || it.label}
          onClick={ev => { ev.stopPropagation(); it.onClick() }}>
          <span className="jc-tile-ico"><JcIcon name={it.icon || it.key} size={18} /></span>
          <span className="jc-tile-label">{it.label}</span>
        </button>
      ))}
    </div>
  )
}

/** Botão de câmera grande (o mesmo fluxo de sempre: pergunta Câmera ou Galeria). */
export function BigCamera({ L, onFiles, label, compact = false }) {
  return (
    <CameraOrGallery L={L} onFiles={onFiles} multiple>
      {open => (
        <button type="button" onClick={ev => { ev.stopPropagation(); open() }} data-testid="photo-add"
          className={`jc-cam${compact ? ' is-compact' : ''}`} aria-label={L('Add photo', '写真を追加', 'Adicionar foto')}>
          <JcIcon name="camera" size={compact ? 20 : 24} />
          <span>{label || L('Take photo', '撮影', 'Fotografar')}</span>
        </button>
      )}
    </CameraOrGallery>
  )
}

/** Botão principal do rodapé do cartão (Iniciar / Concluir), modelagem tipo Uber. */
export function MainButton({ tone = 'brand', disabled, onClick, children, icon }) {
  return (
    <button type="button" className={`jc-main is-${tone}`} disabled={disabled} onClick={onClick}>
      {icon && <JcIcon name={icon} size={18} />}<span>{children}</span>
    </button>
  )
}

/** Anel de progresso ao redor da foto do funcionário (pontos). */
export function PointsRing({ value, tone, children, size = 52 }) {
  const R = 23, C = 2 * Math.PI * R
  const ratio = Math.max(0, Math.min(1, value))
  return (
    <span className={`jc-ring is-${tone}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 52 52" aria-hidden="true">
        <circle cx="26" cy="26" r={R} className="jc-ring-track" />
        <circle cx="26" cy="26" r={R} className="jc-ring-bar" strokeDasharray={C} strokeDashoffset={C * (1 - ratio)} />
      </svg>
      <span className="jc-ring-face">{children}</span>
    </span>
  )
}
