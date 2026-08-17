export default async function handler(_req, res) {
  res.status(200).json({
    ok: true,
    gemini: 'v2-auto-discovery',
    branch: 'main',
    updated: '2026-08-17',
  })
}
