import fs from 'node:fs/promises'
import path from 'node:path'

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as T
  } catch {
    return fallback
  }
}

/** Запись через временный файл, чтобы обрыв не оставил полупустой JSON */
export async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
  await fs.rename(tmp, file)
}
