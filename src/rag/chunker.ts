const CHUNK_SIZE = 512;
const OVERLAP_WORDS = 20;

export function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const paragraphs = normalized.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

  const chunks: string[] = [];
  let current = '';
  let overlapTail = '';

  const flush = () => {
    const s = (overlapTail + ' ' + current).trim();
    if (s) chunks.push(s);
    const words = current.split(/\s+/);
    overlapTail = words.slice(-OVERLAP_WORDS).join(' ');
    current = '';
  };

  for (const para of paragraphs) {
    if (para.length > CHUNK_SIZE) {
      // Split long paragraph by sentence
      const sentences = para.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [para];
      for (const sent of sentences) {
        if (current.length + sent.length > CHUNK_SIZE && current) flush();
        current += (current ? ' ' : '') + sent.trim();
      }
    } else {
      if (current.length + para.length + 2 > CHUNK_SIZE && current) flush();
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim()) {
    const s = (overlapTail + ' ' + current).trim();
    if (s) chunks.push(s);
  }

  return chunks.filter(c => c.length > 10);
}
