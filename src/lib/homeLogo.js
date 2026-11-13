// v1.0.242 · Clicking the KuriPuro logo goes back to the home of whoever is signed in
// (admin, employee, client, seller, marketing). Same element, same look: it only becomes clickable.
export function homeLogoProps(onHome, label = 'Home') {
  return {
    role: 'link', tabIndex: 0, 'aria-label': label, title: label, 'data-home-logo': '',
    onClick: e => { e.preventDefault?.(); onHome() },
    onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onHome() } },
  }
}
