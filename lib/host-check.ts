// Защита от DNS rebinding: чужой сайт может перепривязать свой домен на
// 127.0.0.1, и тогда браузер посчитает его запросы к нашему API «своими».
// Поэтому API отвечает только на запросы, адресованные localhost.
// Для доступа из локальной сети имена хостов перечисляются в HEPHAESTUS_ALLOWED_HOSTS.

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export function hostName(host: string): string {
  const h = host.trim().toLowerCase()
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1)
  return h.replace(/:\d+$/, '')
}

export function isAllowedHost(host: string | null, extra = ''): boolean {
  if (!host) return false
  const name = hostName(host)
  if (LOCAL.has(name) || name.endsWith('.localhost')) return true
  return extra
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(name)
}
