export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  docCount: number;
  chunkCount: number;
}

export interface RagDocument {
  id: string;
  kbId: string;
  title: string;
  source: 'paste' | 'upload' | 'url';
  sourceRef: string;
  addedAt: string;
  chunkCount: number;
}

export interface RagChunk {
  id: string;
  docId: string;
  text: string;
  embedding: number[];
}

export interface KbStore {
  kb: KnowledgeBase;
  docs: RagDocument[];
  chunks: RagChunk[];
}

export interface QueryResult {
  text: string;
  score: number;
  docTitle: string;
  docId: string;
}
