// Нарезка текста на фрагменты и BM25-поиск. Без внешних зависимостей,
// работает и для русского, и для английского текста.

export interface Chunk {
  text: string
  startLine: number
  endLine: number
}

/** Режет текст по строкам на куски ~targetChars с перекрытием в overlapLines строк */
export function chunkText(text: string, targetChars = 1200, overlapLines = 2): Chunk[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const chunks: Chunk[] = []
  let start = 0
  while (start < lines.length) {
    let end = start
    let size = 0
    while (end < lines.length && (size < targetChars || end === start)) {
      size += lines[end].length + 1
      end++
      // Предпочитаем резать на пустой строке, если кусок уже не маленький
      if (size > targetChars * 0.6 && lines[end] === '') break
    }
    const body = lines.slice(start, end).join('\n').trim()
    if (body) chunks.push({ text: body, startLine: start + 1, endLine: end })
    if (end >= lines.length) break
    start = Math.max(end - overlapLines, start + 1)
  }
  return chunks
}

const RU_ENDINGS = [
  'иями', 'ениями', 'ения', 'ение', 'ений', 'ании', 'ание', 'ания', 'ость', 'ости', 'ировать', 'ировал',
  'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ией', 'иях', 'ешь', 'ишь', 'ует', 'ают', 'яют',
  'ить', 'ать', 'ять', 'еть', 'ой', 'ей', 'ий', 'ый', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ов', 'ев', 'ах',
  'ях', 'ам', 'ям', 'ом', 'ем', 'ую', 'юю', 'ия', 'ть', 'ся', 'ит', 'ет', 'ют',
  'у', 'ю', 'а', 'я', 'о', 'е', 'ы', 'и', 'ь',
].sort((a, b) => b.length - a.length)
const EN_ENDINGS = ['ations', 'ation', 'ings', 'ing', 'ies', 'ed', 'es', 's']

/** Грубый стеммер: отрезает типичные окончания, чтобы «модели» и «моделей» совпадали */
export function stem(word: string): string {
  if (word.length <= 4) return word
  const endings = /[а-яё]/.test(word) ? RU_ENDINGS : EN_ENDINGS
  for (const e of endings) {
    if (word.endsWith(e) && word.length - e.length >= 3) return word.slice(0, -e.length)
  }
  return word
}

const STOP = new Set([
  'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как', 'а', 'то', 'все', 'она', 'так', 'его', 'но', 'да',
  'ты', 'к', 'у', 'же', 'вы', 'за', 'бы', 'по', 'только', 'ее', 'мне', 'было', 'вот', 'от', 'меня', 'еще', 'нет',
  'о', 'из', 'ему', 'это', 'для', 'при', 'или', 'ли', 'the', 'a', 'an', 'of', 'to', 'in', 'is', 'and', 'or', 'for',
  'on', 'with', 'as', 'by', 'at', 'be', 'it', 'this', 'that', 'are', 'was', 'from',
])

export function tokenize(text: string): string[] {
  const words = text.toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}_]+/gu) ?? []
  const out: string[] = []
  for (const w of words) {
    if (w.length < 2 || STOP.has(w)) continue
    out.push(stem(w))
  }
  return out
}

export interface BM25Doc {
  id: string
  tokens: string[]
}

export interface BM25Hit {
  id: string
  score: number
}

/** Индекс BM25 над произвольными фрагментами */
export class BM25 {
  private docs = new Map<string, Map<string, number>>()
  private lengths = new Map<string, number>()
  private df = new Map<string, number>()
  private totalLength = 0

  constructor(
    private k1 = 1.4,
    private b = 0.75,
  ) {}

  get size() {
    return this.docs.size
  }

  add(id: string, tokens: string[]) {
    if (this.docs.has(id)) this.remove(id)
    const tf = new Map<string, number>()
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
    for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1)
    this.docs.set(id, tf)
    this.lengths.set(id, tokens.length)
    this.totalLength += tokens.length
  }

  remove(id: string) {
    const tf = this.docs.get(id)
    if (!tf) return
    for (const t of tf.keys()) {
      const n = (this.df.get(t) ?? 1) - 1
      if (n <= 0) this.df.delete(t)
      else this.df.set(t, n)
    }
    this.totalLength -= this.lengths.get(id) ?? 0
    this.docs.delete(id)
    this.lengths.delete(id)
  }

  search(query: string | string[], limit = 5): BM25Hit[] {
    const qTokens = Array.from(new Set(typeof query === 'string' ? tokenize(query) : query))
    if (!qTokens.length || !this.docs.size) return []
    const N = this.docs.size
    const avg = this.totalLength / N || 1
    const hits: BM25Hit[] = []
    for (const [id, tf] of this.docs) {
      let score = 0
      const len = this.lengths.get(id) ?? 0
      for (const q of qTokens) {
        const f = tf.get(q)
        if (!f) continue
        const df = this.df.get(q) ?? 0
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
        score += idf * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * len) / avg)))
      }
      if (score > 0) hits.push({ id, score })
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit)
  }
}
