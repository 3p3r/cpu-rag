import { describe, expect, it } from 'vitest';
import { extract, index, query } from './index.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
      // Assuming the database has some documents after indexing
      // You can add more specific assertions based on the database structure
    });
  });

  describe('query', () => {
    it('should query the indexed database', async () => {
      const directoryPath = path.join(__dirname, '../fixtures');
      const queryString = 'sample'; // Assuming 'sample' might be in the PDFs
      const result = await query(directoryPath, queryString);
      expect(result).toBeDefined();
      // Result can be a string (path) or null
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
