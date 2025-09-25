/**
 * CPU-RAG: A lightweight RAG system designed for lightweight classification tasks
 */

/**
 * Main entry point for the CPU-RAG library
 * @returns A greeting message
 */
export function hello(): string {
  return 'Hello from CPU-RAG!';
}

/**
 * Version information
 */
export const version = '1.0.0';

// Export everything as default for convenience
export default {
  hello,
  version,
};
