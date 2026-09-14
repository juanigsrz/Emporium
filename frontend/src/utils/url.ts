/** Returns `url` only when it parses as an http(s) URL — drops javascript:, data:, and junk. */
export function safeHttpUrl(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url) return undefined
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}
