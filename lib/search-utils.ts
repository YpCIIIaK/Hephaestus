/**
 * Robust search results fetcher for DuckDuckGo Lite.
 * Bypasses blocks with rotated headers and provides multiple parsing fallbacks.
 */
export async function performSearch(query: string, maxResults = 5) {
  try {
    const res = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Origin': 'https://lite.duckduckgo.com',
        'Referer': 'https://lite.duckduckgo.com/'
      },
      body: `q=${encodeURIComponent(query)}`
    });

    if (!res.ok) {
      return `[Search Engine Error: ${res.status} ${res.statusText}]`;
    }

    const html = await res.text();
    
    // Fallback 1: Specific DDG Lite CSS classes
    const results: string[] = [];
    const tableBlocks = html.split("<table").slice(1);
    
    for (const block of tableBlocks) {
      if (results.length >= maxResults) break;
      
      const titleMatch = block.match(/<a[^>]*class=['"]result-link['"][^>]*>(.*?)<\/a>/i);
      const snippetMatch = block.match(/<td[^>]*class=['"]result-snippet['"][^>]*>(.*?)<\/td>/i);
      
      if (titleMatch || snippetMatch) {
        const title = (titleMatch?.[1] || 'Untitled').replace(/<[^>]+>/g, '').trim();
        const snippet = (snippetMatch?.[1] || 'No snippet available').replace(/<[^>]+>/g, '').trim();
        if (title !== 'Untitled' || snippet !== 'No snippet available') {
          results.push(`### ${title}\n${snippet}`);
        }
      }
    }

    // Fallback 2: Generic table fallback (if classes change)
    if (results.length === 0) {
      const rows = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) || [];
      for (const row of rows) {
        if (results.length >= maxResults) break;
        if (row.includes('result-link') || row.includes('result-snippet')) continue; // Already tried above
        
        const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
        if (cells.length >= 2) {
          const content = cells.map(c => c.replace(/<[^>]+>/g, '').trim()).filter(c => c.length > 20);
          if (content.length > 0) {
             results.push(content.join('\n'));
          }
        }
      }
    }

    // Fallback 3: Greedy text extraction (last resort)
    if (results.length === 0) {
       const textSnippets = html.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
       const clean = textSnippets
         .map(s => s.replace(/<[^>]+>/g, '').trim())
         .filter(s => s.length > 50 && !s.includes('DuckDuckGo'))
         .slice(0, maxResults);
       
       if (clean.length > 0) return clean.join('\n\n---\n\n');
    }

    return results.length > 0 ? results.join('\n\n---\n\n') : "No relevant search results found.";
  } catch (error: any) {
    console.error('Core Search Error:', error);
    return `[Search failed: ${error.message}]`;
  }
}
