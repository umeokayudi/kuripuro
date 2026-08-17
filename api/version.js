import { API_BUILD } from './_gemini.js'

export default async function handler(_req, res) {
  res.status(200).json({
    ok: true,
    build: API_BUILD,
    geminiKey: !!process.env.GEMINI_API_KEY,
  })
}
