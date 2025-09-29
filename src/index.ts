import fs from 'fs';
import d from 'debug';
import path from 'path';
import crypto from 'crypto';
import { once } from 'lodash';
import { PdfReader } from 'pdfreader';
import { type AnyOrama, create, insert, search } from '@orama/orama';
import { persist, restore } from '@orama/plugin-data-persistence';
import { PassThrough, Writable } from 'stream';
import { embeddings } from 'cpu-embeddings';
import storage from "node-persist";
import ffmpeg from 'fluent-ffmpeg';
import { glob } from "glob";

const debug = d('cpu-rag');

const hash = (input: string) => {
  debug('Hashing input: %s', `${input.slice(0, 20)}...`);
  const result = crypto.createHash('sha256').update(input).digest('hex').slice(0, 8);
  debug('Generated hash: %s', result);
  return result;
};

const initialize = once(async () => {
  debug('Initializing storage with dir: .cache');
  await storage.init({ dir: '.cache' });
  debug('Storage initialized successfully');
});

async function getOrCreateCache<T>(cacheKey: string): Promise<Record<string, T>> {
  debug('Getting or creating cache for key: %s', cacheKey);
  await initialize();

  const current = await storage.getItem(cacheKey);
  debug('Cache exists: %s', !!current);

  if (!current) {
    debug('Creating new cache');
    await storage.setItem(cacheKey, {});
    return {};
  } else {
    debug('Returning existing cache');
    return current as Record<string, T>;
  }
}

async function getOrCreateDB(cacheKey: string): Promise<AnyOrama> {
  debug('Getting or creating DB for key: %s', cacheKey);
  await initialize();

  let db: ReturnType<typeof create> | Awaited<ReturnType<typeof restore>> | null = null;

  if (await storage.getItem(cacheKey)) {
    debug('Restoring DB from storage');
    const persisted = await storage.getItem(cacheKey) as string;
    db = await restore('json', persisted);
    debug('DB restored successfully');
  } else {
    debug('Creating new DB with schema');
    db = create({
      schema: {
        embedding: 'vector[384]',
        content: 'string',
        path: 'string',
      },
    });
    debug('New DB created');
  }

  return db as AnyOrama;
}

/**
 * Extracts text from a PDF file.
 * @param pdfPath Path to the PDF file.
 * @returns Extracted text as a string.
 */
export async function extract(pdfPath: string): Promise<string> {
  debug('Extracting text from PDF: %s', pdfPath);
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    new PdfReader().parseFileItems(pdfPath, (err, item) => {
      if (err) {
        debug('Error extracting PDF: %s', err);
        reject(err);
      } else if (!item) {
        const text = chunks.join('\n');
        debug('Extracted text length: %d characters', text.length);
        resolve(text);
      } else if (item.text) {
        chunks.push(item.text);
      }
    });
  });
}

/**
 * Indexes PDF files in a directory into an Orama database.
 * @param directoryPath Path to the directory containing PDF files.
 * @returns The Orama database instance.
 */
export async function index(directoryPath: string): Promise<{ db: AnyOrama, cache: Record<string, boolean>; }> {
  debug('Starting index for directory: %s', directoryPath);
  const directoryResolved = path.resolve(directoryPath);
  debug('Resolved directory: %s', directoryResolved);
  if (!fs.existsSync(directoryResolved) || !fs.lstatSync(directoryResolved).isDirectory()) {
    debug('Directory not found or not a directory: %s', directoryResolved);
    throw new Error(`Directory not found: ${directoryResolved}`);
  }

  const dbKey = `${directoryResolved}:db`;
  debug('DB key: %s', dbKey);
  const db = await getOrCreateDB(dbKey);

  const cacheKey = `${directoryResolved}:cache`;
  debug('Cache key: %s', cacheKey);
  const cache = await getOrCreateCache<boolean>(cacheKey);

  const pdfFiles = await glob(path.join(directoryResolved, '**/*.pdf'), {
    absolute: true,
    follow: false,
    nodir: true,
  });
  debug('Found %d PDF files', pdfFiles.length);

  for (const file of pdfFiles) {
    if (file in cache) {
      debug('Skipping already processed PDF: %s', file);
      continue;
    }
    debug('Processing PDF: %s', file);
    const text = await extract(file);
    const embedding = await embeddings(text);
    const id = hash(file);
    debug('Inserting document with ID: %s', id);
    await insert(db, {
      id,
      embedding: Array.from(embedding), // todo: move to cpu-embeddings
      content: text,
      path: file,
    });
    cache[file] = true;
    await storage.setItem(cacheKey, cache);
    debug('Processed and cached PDF: %s', file);
  }

  debug('Persisting DB');
  const persisted = (await persist(db as any, 'json')) as string;
  await storage.setItem(dbKey, persisted);
  debug('DB persisted successfully');

  return { db, cache };
}

/**
 * Queries the indexed database for the most relevant document to the given query.
 * @param directoryPath Path to the directory containing indexed PDF files.
 * @param query The query string.
 * @returns The path of the most relevant document, or null if no match is found.
 */
export async function query(directoryPath: string, query: string): Promise<string | null> {
  debug('Starting query for directory: %s, query: %s', directoryPath, query);
  const directoryResolved = path.resolve(directoryPath);
  debug('Resolved directory: %s', directoryResolved);
  if (!fs.existsSync(directoryResolved) || !fs.lstatSync(directoryResolved).isDirectory()) {
    debug('Directory not found or not a directory: %s', directoryResolved);
    throw new Error(`Directory not found: ${directoryResolved}`);
  }

  const { db } = await index(directoryResolved);
  debug('DB indexed, performing search');

  const result = await search(db, {
    mode: 'hybrid',
    term: query,
    vector: {
      value: await embeddings(query),
      property: 'embedding',
    },
    similarity: 0.85,
    includeVectors: true,
    offset: 0,
    limit: 1,
  });

  if (result.hits.length > 0) {
    const path = result.hits[0].document.path;
    debug('Query result: found path %s', path);
    return path;
  } else {
    debug('Query result: no matches found');
    return null;
  }
}

function saveToAudioFile(outputPath: string): Writable {
  const sampleRate = 44100; // Assuming standard sample rate; adjust if needed
  const channels = 1; // Assuming mono; adjust if needed

  const inputStream = new PassThrough();

  ffmpeg(inputStream)
    .inputFormat('f32le') // Float32 little-endian for samples between -1 and 1
    .inputOptions([`-ar ${sampleRate}`, `-ac ${channels}`])
    .audioCodec('flac')
    .output(outputPath)
    .on('end', () => {
      console.log('FLAC encoding completed successfully.');
    })
    .on('error', (err) => {
      console.error('Error during FLAC encoding:', err);
    })
    .run();

  return inputStream;
}

/**
 * Indexes PDF files in a directory and generates audio files from their embeddings
 * as a series of PCM samples saved in FLAC format.
 * @param directoryPath Path to the directory containing PDF files.
 * @param outputPath Path to the output FLAC file.
 */
export async function vocalize(directoryPath: string, outputPath: string): Promise<void> {
  debug('Starting vocalize for directory: %s, output: %s', directoryPath, outputPath);
  const directoryResolved = path.resolve(directoryPath);
  debug('Resolved directory: %s', directoryResolved);
  if (!fs.existsSync(directoryResolved) || !fs.lstatSync(directoryResolved).isDirectory()) {
    debug('Directory not found or not a directory: %s', directoryResolved);
    throw new Error(`Directory not found: ${directoryResolved}`);
  }

  const { db, cache } = await index(directoryResolved);
  debug('Indexing completed');

  const outputStream = saveToAudioFile(outputPath);
  debug('Output stream for FLAC file created');

  for (const file of Object.keys(cache)) {
    debug('Getting vectors for file: %s', file);
    const result = await search(db, {
      limit: 1,
      offset: 0,
      where: {
        path: file,
      },
      includeVectors: true,
    });
    if (result.hits.length > 0) {
      const vector = result.hits[0].document.embedding as number[];
      debug('Writing %d samples to output stream for file: %s', vector.length, file);
      const paddedLength = Math.ceil(vector.length / 1024) * 1024;
      const paddedVector = new Float32Array(paddedLength);
      paddedVector.set(vector);
      const buffer = Buffer.from(paddedVector.buffer);
      const canWrite = outputStream.write(buffer);
      if (!canWrite) {
        debug('Backpressure detected, waiting for drain');
        await new Promise((resolve) => outputStream.once('drain', resolve));
      }
    } else {
      debug('No vectors found for file: %s', file);
    }
  }

  outputStream.end();
  debug('All samples written, output stream ended');

  return new Promise((resolve, reject) => {
    outputStream.on('finish', () => {
      debug('FLAC file writing finished');
      resolve();
    });
    outputStream.on('error', (err) => {
      debug('Error writing FLAC file: %s', err);
      reject(err);
    });
  });
}
