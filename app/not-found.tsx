import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <div className="ember-text text-6xl font-semibold">404</div>
      <p className="text-muted">Такой страницы в кузнице нет.</p>
      <Link href="/chat" className="text-sm font-medium text-accent hover:underline">
        Вернуться в чат
      </Link>
    </div>
  )
}
