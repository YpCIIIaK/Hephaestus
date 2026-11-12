import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'heph-auth-'))
const tools = path.join(dir, 'tools')
process.env.HEPHAESTUS_TOOLS = tools
process.env.HEPHAESTUS_NPM = path.join(dir, 'fake-npm')

const { saveServerSettings } = await import('@/lib/server/settings')
const auth = await import('@/lib/server/subscription-auth')
const { cliVersion } = await import('@/lib/server/subscriptions')

afterAll(() => fs.rm(dir, { recursive: true, force: true }))

const until = async (fn: () => boolean, ms = 5000) => {
  const end = Date.now() + ms
  while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 30))
}

// Поддельный CLI: вход печатает ссылку и ждёт код; статус зависит от файла-флага
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('fs'), flag = ${JSON.stringify(path.join(dir, 'logged-in'))}
const a = process.argv.slice(2).join(' ')
if (a === '--version') console.log('1.0.0 (fake)')
else if (a === 'auth status --json') console.log(JSON.stringify({ loggedIn: fs.existsSync(flag), authMethod: 'claude.ai', apiProvider: 'firstParty' }))
else if (a === 'auth login --claudeai') {
  console.log('Opening browser… If it did not open, visit: https://claude.ai/oauth/authorize?x=1')
  process.stdin.once('data', (d) => { if (d.toString().trim() === 'CODE-42') { fs.writeFileSync(flag, ''); console.log('Login successful'); process.exit(0) } else process.exit(1) })
} else if (a === 'auth logout') { fs.rmSync(flag, { force: true }) }
`

describe('установка и вход в подписку кнопками', () => {
  it('установка ставит CLI в общую папку инструментов, и он находится без настройки пути', async () => {
    // Поддельный npm: кладёт claude в $NPM_CONFIG_PREFIX/bin
    await fs.writeFile(
      process.env.HEPHAESTUS_NPM!,
      `#!/usr/bin/env node
const fs = require('fs'), path = require('path')
const bin = path.join(process.env.NPM_CONFIG_PREFIX, 'bin'); fs.mkdirSync(bin, { recursive: true })
fs.writeFileSync(path.join(bin, 'claude'), ${JSON.stringify(FAKE_CLAUDE)}, { mode: 0o755 })
console.log('added 1 package: ' + process.argv.slice(2).join(' '))
`,
      { mode: 0o755 },
    )
    expect((await cliVersion('claude')).version).not.toBe('1.0.0 (fake)')
    const job = await auth.startJob('claude-code', 'install')
    expect(job.state).toBe('running')
    await until(() => auth.getJob('claude-code')!.state !== 'running')
    expect(auth.getJob('claude-code')).toMatchObject({ state: 'done' })
    expect(auth.getJob('claude-code')!.output).toContain('install -g @anthropic-ai/claude-code')
    expect((await cliVersion('claude')).version).toBe('1.0.0 (fake)')
  })

  it('вход: ссылка из вывода, код из интерфейса, статус меняется; выход', async () => {
    await saveServerSettings({ subscriptions: { 'claude-code': { enabled: true } } })
    expect(await auth.loginStatus('claude-code')).toMatchObject({ loggedIn: false })
    await auth.startJob('claude-code', 'login')
    await expect(auth.startJob('claude-code', 'login')).rejects.toThrow('Уже выполняется')
    await until(() => !!auth.getJob('claude-code')!.url)
    expect(auth.getJob('claude-code')!.url).toBe('https://claude.ai/oauth/authorize?x=1')
    auth.sendCode('claude-code', ' CODE-42 ')
    await until(() => auth.getJob('claude-code')!.state !== 'running')
    expect(auth.getJob('claude-code')!.state).toBe('done')
    expect(await auth.loginStatus('claude-code')).toMatchObject({ loggedIn: true, detail: 'claude.ai' })

    await auth.startJob('claude-code', 'logout')
    await until(() => auth.getJob('claude-code')!.state !== 'running')
    expect(await auth.loginStatus('claude-code')).toMatchObject({ loggedIn: false })
  })

  it('отмена входа останавливает процесс', async () => {
    await auth.startJob('claude-code', 'login')
    auth.cancelJob('claude-code')
    await until(() => auth.getJob('claude-code')!.exitCode !== undefined)
    expect(auth.getJob('claude-code')!.state).toBe('failed')
    expect(() => auth.sendCode('claude-code', 'x')).toThrow()
  })
})
