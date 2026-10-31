import assert from 'node:assert/strict'
import { dedupeLines, payMentions, stripPay, offerIssues } from '../src/lib/offerText.js'

const d = 'Key box: 5493 | Pagamento funcionário: ¥1.500 (¥1.000 base + ¥500 adicional local)\nKey box: 5493 | Pagamento funcionário: ¥1.500 (¥1.000 base + ¥500 adicional local)\nBasic Cleaning'
assert.equal(dedupeLines(d), 'Key box: 5493 | Pagamento funcionário: ¥1.500 (¥1.000 base + ¥500 adicional local)\nBasic Cleaning')
assert.equal(payMentions(d).length, 2)
assert.equal(stripPay(d), 'Key box: 5493\nBasic Cleaning')
assert.deepEqual(offerIssues({ job_category: 'spot', spot_value: 1000, description: d }), ['payTwice', 'repeated'])
assert.deepEqual(offerIssues({ job_category: 'regular', spot_value: 0, description: 'Key box: 5493' }), [])
assert.deepEqual(offerIssues({ job_category: 'regular', description: 'Key box: 1 | Pago ¥2,000' }), ['payInText'])
assert.equal(stripPay('Key box: 0808 | 2 AC units'), 'Key box: 0808 | 2 AC units', 'números sem ¥ ficam')
console.log('offer text ok')
