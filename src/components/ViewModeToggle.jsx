export default function ViewModeToggle({ desktopMode, onChange, mobileLabel, desktopLabel, variant = 'light' }) {
  return (
    <div className={`kp-view kp-view-${variant}`} role="group" aria-label="View">
      <button
        type="button"
        className={`kp-view-btn${!desktopMode ? ' on' : ''}`}
        aria-pressed={!desktopMode}
        onClick={() => onChange(false)}
      >
        📱 {mobileLabel}
      </button>
      <button
        type="button"
        className={`kp-view-btn${desktopMode ? ' on' : ''}`}
        aria-pressed={desktopMode}
        onClick={() => onChange(true)}
      >
        🖥 {desktopLabel}
      </button>
    </div>
  )
}
