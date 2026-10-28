// Разбор потока Server-Sent Events: куски могут резать строки где угодно.

export class SSEParser {
  private buffer = ''
  private dataLines: string[] = []

  constructor(private onData: (data: string) => void) {}

  push(chunk: string) {
    this.buffer += chunk
    let nl: number
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).replace(/\r$/, '')
      this.buffer = this.buffer.slice(nl + 1)
      this.line(line)
    }
  }

  flush() {
    if (this.buffer) {
      this.line(this.buffer.replace(/\r$/, ''))
      this.buffer = ''
    }
    this.dispatch()
  }

  private line(line: string) {
    if (line === '') {
      this.dispatch()
      return
    }
    if (line.startsWith(':')) return // комментарий, например «: OPENROUTER PROCESSING»
    if (line.startsWith('data:')) this.dataLines.push(line.slice(5).replace(/^ /, ''))
  }

  private dispatch() {
    if (!this.dataLines.length) return
    const data = this.dataLines.join('\n')
    this.dataLines = []
    this.onData(data)
  }
}

/** Разбор NDJSON: одна JSON-запись на строку */
export class NDJSONParser<T> {
  private buffer = ''
  constructor(private onItem: (item: T) => void) {}

  push(chunk: string) {
    this.buffer += chunk
    let nl: number
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).trim()
      this.buffer = this.buffer.slice(nl + 1)
      if (line) this.emit(line)
    }
  }

  flush() {
    const line = this.buffer.trim()
    this.buffer = ''
    if (line) this.emit(line)
  }

  private emit(line: string) {
    try {
      this.onItem(JSON.parse(line) as T)
    } catch {
      // битая строка — пропускаем
    }
  }
}
