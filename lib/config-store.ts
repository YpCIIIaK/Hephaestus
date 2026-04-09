// Server-side only config storage
// This file should only be imported from API routes, not client components
// Use /api/configs endpoint for config persistence

import { ArenaConfig } from './types'
import * as fs from 'fs'
import * as path from 'path'

const CONFIGS_DIR = path.join(process.cwd(), '.configs')

function ensureDir() {
  if (!fs.existsSync(CONFIGS_DIR)) {
    fs.mkdirSync(CONFIGS_DIR, { recursive: true })
  }
}

export async function loadConfigs(): Promise<ArenaConfig[]> {
  try {
    ensureDir()
    const files = fs.readdirSync(CONFIGS_DIR).filter(f => f.endsWith('.json'))
    const configs: ArenaConfig[] = []
    for (const file of files) {
      const content = fs.readFileSync(path.join(CONFIGS_DIR, file), 'utf-8')
      configs.push(JSON.parse(content))
    }
    return configs
  } catch {
    return []
  }
}

export async function saveConfig(config: ArenaConfig): Promise<void> {
  try {
    ensureDir()
    const filePath = path.join(CONFIGS_DIR, `${config.id}.json`)
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2))
  } catch (e) {
    console.error('Failed to save config:', e)
  }
}

export async function deleteConfig(id: string): Promise<void> {
  try {
    const filePath = path.join(CONFIGS_DIR, `${id}.json`)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } catch (e) {
    console.error('Failed to delete config:', e)
  }
}
