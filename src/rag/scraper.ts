export async function scrapeUrl(url: string): Promise<{ title: string; text: string }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'MCP-Gateway-RAG/1.0 (document indexer)' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);

  const ct = res.headers.get('content-type') ?? '';
  const body = await res.text();

  if (ct.includes('text/html')) {
    const title = body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? url;
    const text = body
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s{3,}/g, '\n\n')
      .trim();
    return { title, text };
  }

  return { title: url, text: body };
}
