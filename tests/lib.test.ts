import { describe, expect, it } from 'vitest'
import { extractJson } from '@/lib/json'
import { pickAliasModel, providerOf, upstreamModelId, computeCost } from '@/lib/models'
import { NDJSONParser, SSEParser } from '@/lib/sse'
import { renderTemplate } from '@/lib/template'
import { BM25, chunkText, stem, tokenize } from '@/lib/text'
import { estimateTokens } from '@/lib/tokens'
import { plural, formatCost } from '@/lib/utils'
import type { ModelInfo } from '@/lib/types'

describe('extractJson', () => {
  it('достаёт JSON из ```-блока, текста и чинит висячие запятые', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('Вот ответ: {"a": {"b": "}"}} и всё')).toEqual({ a: { b: '}' } })
    expect(extractJson('{"a": [1, 2,],}')).toEqual({ a: [1, 2] })
    expect(extractJson('[1,2]')).toEqual([1, 2])
    expect(extractJson('ничего')).toBeNull()
  })
})

describe('SSE и NDJSON', () => {
  it('собирает события из кусков, режущих строки', () => {
    const got: string[] = []
    const p = new SSEParser((d) => got.push(d))
    p.push(': OPENROUTER PROCESSING\n\nda')
    p.push('ta: {"x":1}\n\ndata: [DO')
    p.push('NE]\n\n')
    p.flush()
    expect(got).toEqual(['{"x":1}', '[DONE]'])
  })
  it('NDJSON пропускает битые строки', () => {
    const got: unknown[] = []
    const p = new NDJSONParser((d) => got.push(d))
    p.push('{"a":1}\n{bad}\n{"b"')
    p.push(':2}')
    p.flush()
    expect(got).toEqual([{ a: 1 }, { b: 2 }])
  })
})

describe('шаблоны', () => {
  it('подставляет input, prev и узлы по имени', () => {
    const ctx = { input: 'вопрос', prev: 'входы', byLabel: { 'Поиск в сети': 'результаты' } }
    expect(renderTemplate('{{input}} | {{ prev }} | {{поиск в сети}} | {{нет}}', ctx)).toBe('вопрос | входы | результаты | {{нет}}')
  })
})

describe('поиск по тексту', () => {
  it('стеммер сводит формы слова', () => {
    expect(stem('моделей')).toBe(stem('модели'))
    expect(tokenize('Ёлки и модели')).toEqual(['елки', 'модел'])
  })
  it('BM25 находит релевантный фрагмент', () => {
    const idx = new BM25()
    idx.add('1', tokenize('Рецепт борща со свёклой и капустой'))
    idx.add('2', tokenize('Настройка нейронных моделей и обучение сетей'))
    idx.add('3', tokenize('Обзор языковых моделей'))
    expect(idx.search('как обучить модель')[0].id).toBe('2')
    idx.remove('2')
    expect(idx.search('обучение').length).toBe(0)
  })
  it('режет текст на фрагменты с номерами строк', () => {
    const text = Array.from({ length: 100 }, (_, i) => `строка ${i + 1} ${'x'.repeat(50)}`).join('\n')
    const chunks = chunkText(text, 600)
    expect(chunks.length).toBeGreaterThan(5)
    expect(chunks[0].startLine).toBe(1)
    expect(chunks.at(-1)!.endLine).toBe(100)
  })
})

describe('модели', () => {
  it('провайдеры по префиксу', () => {
    expect(providerOf('ollama/llama3')).toBe('ollama')
    expect(upstreamModelId('custom/qwen')).toBe('qwen')
    expect(providerOf('openai/gpt-5')).toBe('openrouter')
  })
  it('псевдоним берёт самую свежую модель семейства', () => {
    const cat: ModelInfo[] = [
      { id: 'anthropic/claude-sonnet-4', name: '', provider: 'openrouter', vendor: 'anthropic', created: 1 },
      { id: 'anthropic/claude-sonnet-4.5', name: '', provider: 'openrouter', vendor: 'anthropic', created: 5 },
      { id: 'google/gemini-2.5-flash', name: '', provider: 'openrouter', vendor: 'google', created: 3 },
      { id: 'google/gemini-2.5-flash-lite', name: '', provider: 'openrouter', vendor: 'google', created: 3 },
    ]
    expect(pickAliasModel('@smart', cat)).toBe('anthropic/claude-sonnet-4.5')
    expect(pickAliasModel('@default', cat)).toBe('google/gemini-2.5-flash')
    expect(pickAliasModel('@fast', cat)).toBe('google/gemini-2.5-flash-lite')
    expect(pickAliasModel('@smart', [{ id: 'ollama/qwen', name: '', provider: 'ollama', vendor: 'ollama' }])).toBe('ollama/qwen')
  })
  it('стоимость по прайсу', () => {
    expect(computeCost({ id: 'x', name: '', provider: 'openrouter', vendor: 'x', pricing: { prompt: 1e-6, completion: 2e-6 } }, 1000, 500)).toBeCloseTo(0.002)
    expect(computeCost({ id: 'x', name: '', provider: 'ollama', vendor: 'x' }, 1000, 500)).toBe(0)
  })
})

describe('форматирование', () => {
  it('склонения и деньги', () => {
    expect(plural(1, ['модель', 'модели', 'моделей'])).toBe('модель')
    expect(plural(3, ['модель', 'модели', 'моделей'])).toBe('модели')
    expect(plural(11, ['модель', 'модели', 'моделей'])).toBe('моделей')
    expect(formatCost(0.00042)).toBe('$0.0004')
    expect(formatCost(12.5)).toBe('$12.50')
  })
  it('оценка токенов учитывает кириллицу', () => {
    expect(estimateTokens('привет мир')).toBeGreaterThan(estimateTokens('hello wrld'))
  })
})
