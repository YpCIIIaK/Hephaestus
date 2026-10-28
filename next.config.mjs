/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  agentRules: false,
  devIndicators: false,
  // Серверный код читает workspace/ и data/ только по путям,
  // вычисленным во время запроса; трассировать их не нужно.
  outputFileTracingExcludes: {
    '*': ['./workspace/**', './data/**'],
  },
}

export default nextConfig
