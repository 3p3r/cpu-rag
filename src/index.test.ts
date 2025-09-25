import { describe, expect, it } from 'vitest';
import { hello, version } from './index.js';

describe('CPU-RAG Library', () => {
  describe('hello function', () => {
    it('should return a greeting message', () => {
      const result = hello();
      expect(result).toBe('Hello from CPU-RAG!');
    });

    it('should return a string', () => {
      const result = hello();
      expect(typeof result).toBe('string');
    });
  });

  describe('version', () => {
    it('should be defined', () => {
      expect(version).toBeDefined();
    });

    it('should be a string', () => {
      expect(typeof version).toBe('string');
    });

    it('should follow semantic versioning pattern', () => {
      const semverPattern = /^\d+\.\d+\.\d+$/;
      expect(version).toMatch(semverPattern);
    });
  });

  describe('module exports', () => {
    it('should export hello function', () => {
      expect(hello).toBeDefined();
      expect(typeof hello).toBe('function');
    });

    it('should export version', () => {
      expect(version).toBeDefined();
    });
  });
});
