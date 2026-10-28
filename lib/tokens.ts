// Быстрая оценка количества токенов без загрузки токенайзера.
// Точные цифры приходят от провайдера после ответа; оценка нужна
// для обрезки контекста и прогноза стоимости до запуска.

export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0
  let cyr = 0
  let other = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 0x0400 && code <= 0x04ff) cyr++
    else other++
  }
  // Кириллица в BPE-словарях дробится мельче, чем латиница
  return Math.ceil(other / 4 + cyr / 2.6)
}

export function estimateMessagesTokens(messages: { content: string | null }[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 2)
}
