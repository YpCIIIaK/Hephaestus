import { getEncoding, encodingForModel, TiktokenModel } from 'js-tiktoken'

/**
 * Accurately calculate token count using js-tiktoken.
 * Falls back to character-based heuristic if model is unknown or fails.
 */
export function getTokenCount(text: string, modelId?: string): number {
  if (!text) return 0
  
  try {
    // Determine the best encoding. Many OpenRouter models follow GPT-4 (cl100k_base) 
    // or the newer o200k_base. Defaulting to cl100k_base as a standard BPE proxy.
    let encoding;
    
    if (modelId?.includes('gpt-4o') || modelId?.includes('o1')) {
      encoding = getEncoding('o200k_base')
    } else {
      // Use model-specific encoding if it's a known OpenAI model id,
      // otherwise use cl100k_base (GPT-4/Turbo standard).
      try {
        encoding = encodingForModel(modelId as TiktokenModel)
      } catch {
        encoding = getEncoding('cl100k_base')
      }
    }
    
    const tokens = encoding.encode(text)
    return tokens.length
  } catch (error) {
    console.warn('Tokenizer failed, falling back to heuristic:', error)
    // Fallback: ~4 chars per token
    return Math.ceil(text.length / 4)
  }
}
