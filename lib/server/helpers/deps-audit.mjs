#!/usr/bin/env node
// heph-deps-audit — проверка зависимостей проекта на известные уязвимости.
// Сам определяет менеджер пакетов по lock-файлам и запускает его аудит:
// npm, pnpm, yarn, pip (pip-audit), cargo (cargo-audit), go (govulncheck).
// Сырой вывод — в audit/deps-<менеджер>.json, в консоль — сводка по серьёзности.
// Код выхода 0, если проверка прошла (даже с найденными уязвимостями),
// 1 — если ни одну проверку выполнить не удалось.
// Ставится Hephaestus в общую папку инструментов; запуск: heph-deps-audit [папка]

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve(process.argv[2] || '.')
const out = path.join(dir, 'audit')
const has = (f) => fs.existsSync(path.join(dir, f))
const isWin = process.platform === 'win32'

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', shell: isWin, maxBuffer: 256 * 1024 * 1024, timeout: 10 * 60_000, env: { ...process.env, NO_COLOR: '1', CI: '1' } })
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', missing: r.error?.code === 'ENOENT' || /not (found|recognized)|не является внутренней/i.test(r.stderr || '') }
}

const which = (cmd) => run(isWin ? 'where' : 'which', [cmd]).code === 0

function save(name, text) {
  fs.mkdirSync(out, { recursive: true })
  const file = path.join(out, `deps-${name}.json`)
  fs.writeFileSync(file, text)
  return path.relative(dir, file).split(path.sep).join('/')
}

const fmt = (c) => {
  const order = ['critical', 'high', 'moderate', 'medium', 'low', 'info']
  const parts = order.filter((k) => c[k]).map((k) => `${k} ${c[k]}`)
  return parts.length ? parts.join(', ') : 'уязвимостей не найдено'
}

/** Сводка npm/pnpm: metadata.vulnerabilities */
function npmLike(json) {
  try {
    const d = JSON.parse(json)
    if (d?.metadata?.vulnerabilities) return d.metadata.vulnerabilities
    if (d?.advisories) {
      const c = {}
      for (const a of Object.values(d.advisories)) c[a.severity] = (c[a.severity] || 0) + 1
      return c
    }
  } catch {}
  return null
}

const checks = []

if (has('pnpm-lock.yaml')) {
  checks.push(() => {
    const r = which('pnpm') ? run('pnpm', ['audit', '--json']) : run('npx', ['--yes', 'pnpm@9', 'audit', '--json'])
    const file = save('pnpm', r.stdout)
    const c = npmLike(r.stdout)
    return c ? `pnpm audit: ${fmt(c)} → ${file}` : `pnpm audit не дал результата: ${(r.stderr || r.stdout).trim().slice(0, 300)}`
  })
} else if (has('yarn.lock')) {
  checks.push(() => {
    const berry = has('.yarnrc.yml')
    const r = berry ? run('yarn', ['npm', 'audit', '--json', '--recursive']) : run('npx', ['--yes', 'yarn@1', 'audit', '--json'])
    const file = save('yarn', r.stdout)
    const c = {}
    for (const line of r.stdout.split('\n')) {
      try {
        const e = JSON.parse(line)
        if (e.type === 'auditSummary') Object.assign(c, e.data.vulnerabilities)
        if (e.type === 'auditAdvisory') void 0
        if (e.advisory?.severity) c[e.advisory.severity] = (c[e.advisory.severity] || 0) + 1
      } catch {}
    }
    return `yarn audit: ${fmt(c)} → ${file}`
  })
} else if (has('package-lock.json') || has('npm-shrinkwrap.json')) {
  checks.push(() => {
    const r = run('npm', ['audit', '--json'])
    const file = save('npm', r.stdout)
    const c = npmLike(r.stdout)
    return c ? `npm audit: ${fmt(c)} → ${file}` : `npm audit не дал результата: ${(r.stderr || r.stdout).trim().slice(0, 300)}`
  })
} else if (has('package.json')) {
  checks.push(() => 'package.json без lock-файла — npm-зависимости не проверены (нужен package-lock.json, pnpm-lock.yaml или yarn.lock)')
}

if (['requirements.txt', 'poetry.lock', 'Pipfile.lock', 'pyproject.toml'].some(has)) {
  checks.push(() => {
    const py = which('python3') ? 'python3' : 'python'
    const args = ['-m', 'pip_audit', '-f', 'json', '--progress-spinner', 'off']
    if (has('requirements.txt')) args.push('-r', 'requirements.txt')
    let r = run(py, args)
    if (/No module named pip_audit/i.test(r.stderr)) return 'pip-audit не установлен — Python-зависимости не проверены (поставьте: pip install pip-audit в общее окружение $HEPHAESTUS_TOOLS/venv)'
    const file = save('pip', r.stdout)
    try {
      const d = JSON.parse(r.stdout)
      const n = (d.dependencies || d).reduce?.((s, x) => s + (x.vulns?.length || 0), 0) ?? 0
      return `pip-audit: ${n ? `уязвимостей ${n}` : 'уязвимостей не найдено'} → ${file}`
    } catch {
      return `pip-audit не дал результата: ${(r.stderr || r.stdout).trim().slice(0, 300)}`
    }
  })
}

if (has('Cargo.lock')) {
  checks.push(() => {
    const r = run('cargo', ['audit', '--json'])
    if (r.missing || /no such (sub)?command/i.test(r.stderr)) return 'cargo-audit не установлен — Rust-зависимости не проверены (cargo install cargo-audit)'
    const file = save('cargo', r.stdout)
    try {
      const n = JSON.parse(r.stdout).vulnerabilities?.count ?? 0
      return `cargo audit: ${n ? `уязвимостей ${n}` : 'уязвимостей не найдено'} → ${file}`
    } catch {
      return `cargo audit не дал результата: ${r.stderr.trim().slice(0, 300)}`
    }
  })
}

if (has('go.sum')) {
  checks.push(() => {
    const r = run('govulncheck', ['-json', './...'])
    if (r.missing) return 'govulncheck не установлен — Go-зависимости не проверены (go install golang.org/x/vuln/cmd/govulncheck@latest)'
    const file = save('go', r.stdout)
    const n = (r.stdout.match(/"osv":/g) || []).length
    return `govulncheck: ${n ? `уязвимостей ${n}` : 'уязвимостей не найдено'} → ${file}`
  })
}

if (!checks.length) {
  console.log('Lock-файлов зависимостей не найдено (npm, pnpm, yarn, pip, cargo, go) — проверять нечего')
  process.exit(0)
}

let ok = 0
for (const check of checks) {
  try {
    const line = check()
    console.log(line)
    if (!/не (дал результата|установлен|проверены)/.test(line)) ok++
  } catch (e) {
    console.log(`Ошибка проверки: ${e instanceof Error ? e.message : String(e)}`)
  }
}
process.exit(ok ? 0 : 1)
