import path from 'path';
import { describe, expect, it } from 'vitest';

import { extract, index, query } from './index.js';

describe('CPU-RAG Library', () => {
  describe('extract', () => {
    it('should extract text from a PDF file', async () => {
      const pdfPath = path.join(__dirname, '../fixtures/sample-1.pdf');
      const text = await extract(pdfPath);
      expect(text).toBeDefined();
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
    });
  });

  describe('index', () => {
    it('should index PDF files in a directory', async () => {
      const directoryPath = path.join(__dirname, '../fixtures');
      const db = await index(directoryPath);
      expect(db).toBeDefined();
    });
  });

  describe('query', () => {
    it('should query the indexed database', async () => {
      const directoryPath = path.join(__dirname, '../fixtures');
      const queryString = 'climate';
      const result = await query(directoryPath, queryString);
      expect(result).toBeDefined();
      if (result !== null) {
        expect(typeof result).toBe('string');
        expect(result.endsWith('.pdf')).toBe(true);
      }
    });
  });

  describe('sanity check', () => {
    it('should pass a basic test', () => {
      expect(1 + 1).toBe(2);
    });
  });
});
