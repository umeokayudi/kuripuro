// Extrai dados de contrato de trabalho (PDF) via Gemini

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { pdfBase64, fileName, employeeName } = req.body || {}
  if (!pdfBase64) return res.status(400).json({ error: 'pdfBase64 is required' })

  const prompt = `Analise este contrato de trabalho${employeeName ? ` de ${employeeName}` : ''} (limpeza/restaurante no Japão).
Extraia os dados e retorne APENAS JSON válido (sem markdown) com esta estrutura:
{
  "full_name": "nome completo",
  "contract_start": "YYYY-MM-DD ou null",
  "contract_end": "YYYY-MM-DD ou null (null = indeterminado)",
  "contract_type": "Full-time ou Freelancer ou Part-time",
  "salary_type": "fixed ou hourly ou per_job ou mixed",
  "fixed_salary": número mensal em yen ou 0,
  "hourly_rate": número por hora em yen ou 0,
  "job_bonus_rate": percentual bônus por job ou 0,
  "monthly_work_days": número de dias úteis/mês ou 22,
  "bank_name": "nome do banco",
  "bank_branch": "agência",
  "account_type": "普通 ou 当座",
  "account_number": "número da conta",
  "account_holder_katakana": "nome em katakana",
  "service_description": "descrição do serviço/contrato",
  "retroactive_allowed": true/false se permite relatório retroativo,
  "notes": "outras observações relevantes",
  "confidence": "high/medium/low"
}
Use null para campos não encontrados. Valores monetários só números.`

  try {
    const { geminiGenerate } = await import('./_gemini.js')
    const data = await geminiGenerate({
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } },
          { text: prompt },
        ],
      }],
      generationConfig: { responseMimeType: 'application/json' },
    })

    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || ''
    let extracted
    try {
      extracted = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim())
    } catch {
      return res.status(422).json({ error: 'IA não conseguiu estruturar o PDF. Revise manualmente.', raw: text.slice(0, 500) })
    }

    res.status(200).json({ extracted, fileName })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
