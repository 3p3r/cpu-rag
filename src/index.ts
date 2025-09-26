import fs from 'fs';
import d from 'debug';
import path from 'path';
import crypto from 'crypto';
import { once } from 'lodash';
import { PdfReader } from 'pdfreader';
import { type AnyOrama, create, insert, search } from '@orama/orama';
import { persist, restore } from '@orama/plugin-data-persistence';
import { embeddings } from 'cpu-embeddings';
import storage from "node-persist";
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

export async function index(directoryPath: string): Promise<AnyOrama> {
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
      embedding,
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

  return db;
}

export async function query(directoryPath: string, query: string): Promise<string | null> {
  debug('Starting query for directory: %s, query: %s', directoryPath, query);
  const directoryResolved = path.resolve(directoryPath);
  debug('Resolved directory: %s', directoryResolved);
  if (!fs.existsSync(directoryResolved) || !fs.lstatSync(directoryResolved).isDirectory()) {
    debug('Directory not found or not a directory: %s', directoryResolved);
    throw new Error(`Directory not found: ${directoryResolved}`);
  }

  const db = await index(directoryResolved);
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
