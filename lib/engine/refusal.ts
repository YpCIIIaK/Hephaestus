// Отказ модели выглядит как обычный успешный ответ («Не могу помочь с этим»),
// поэтому запасная модель на ошибку его не ловит. Распознаём отказ по началу
// ответа или по короткому ответу целиком, чтобы не спутать с длинным отчётом,
// где такие слова встречаются в цитатах.

const PATTERNS = [
  /\bI(?:'|’)?m (?:sorry,? (?:but )?)?(?:not able|unable) to (?:help|assist|provide|do|comply|create|write|continue)/i,
  /\bI am (?:sorry,? (?:but )?)?(?:not able|unable) to (?:help|assist|provide|do|comply|create|write|continue)/i,
  /\bI (?:can(?:'|’)?t|cannot|won(?:'|’)?t|will not) (?:help|assist|provide|do|comply|create|write|continue|support)\b/i,
  /\bI (?:must|have to) decline\b/i,
  /\bI(?:'|’)?m not comfortable (?:helping|providing|writing)/i,
  /(?:я )?не (?:могу|стану|буду) (?:с этим )?(?:помочь|помогать|выполн|предостав|писать|создавать|участвовать)/i,
  /(?:извините|к сожалению),? (?:но )?(?:я )?не могу/i,
  /(?:это )?противоречит моим (?:правилам|принципам)/i,
  /вынужден(?:а)? отказаться/i,
]

export type RefusalKind = 'refusal' | 'empty'

/** Отказ или пустой ответ; null — обычный ответ */
export function detectRefusal(text: string, toolCalls = 0): RefusalKind | null {
  const t = text.trim()
  if (!t) return toolCalls ? null : 'empty'
  const head = t.slice(0, 400)
  const short = t.length < 900
  for (const re of PATTERNS) if (re.test(head) || (short && re.test(t))) return 'refusal'
  return null
}

/** Уточнение после отказа: честный контекст задачи и просьба выполнить допустимую часть, а не отказываться целиком */
export const REFUSAL_CLARIFICATION = `Уточнение от владельца задачи. Это легитимная работа над его собственным проектом в рабочей папке (например, защитный аудит кода, чтобы найти и исправить проблемы до релиза; отчёт идёт мейнтейнерам). Нужны анализ, доказательства по коду и исправления — не инструменты атаки на чужие системы.
Если какую-то часть запроса ты действительно не можешь выполнить — выполни всё остальное и коротко укажи, что пропущено и почему. Не отказывайся от задачи целиком.`
