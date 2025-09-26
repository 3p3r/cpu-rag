import fs from 'fs';
import pathModule from 'path';
import { PdfReader } from 'pdfreader';
import { create, insert, search } from '@orama/orama';
import { persist, restore } from '@orama/plugin-data-persistence';
import { embeddings } from 'cpu-embeddings';

async function extractTextFromPdf(pdfPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    new PdfReader().parseFileItems(pdfPath, (err: any, item: any) => {
      if (err) {
        reject(err);
      } else if (!item) {
        resolve(text);
      } else if (item.text) {
        text += `${item.text}\n`;
      }
    });
  });
}

async function indexAndSearchPdfs(directoryPath: string, query: string): Promise<string | null> {
  const cachePath = pathModule.join(directoryPath, 'orama-cache.json');

  let db: any;

  if (fs.existsSync(cachePath)) {
    const persisted = fs.readFileSync(cachePath, 'utf8');
    db = await restore('json', persisted);
  } else {
    const pdfFiles = fs.readdirSync(directoryPath).filter((file) => file.endsWith('.pdf'));

    if (pdfFiles.length === 0) {
      return null;
    }

    // Get embedding dimension
    const sampleEmbedding = await embeddings('test');
    const dim = sampleEmbedding.length;

    db = await create({
      schema: {
        embedding: `vector[${dim}]`,
      },
    });

    for (const file of pdfFiles) {
      const pdfPath = pathModule.join(directoryPath, file);
      const text = await extractTextFromPdf(pdfPath);
      const embedding = await embeddings(text);
      await insert(db, {
        id: pdfPath,
        embedding,
      });
    }

    const persisted = (await persist(db, 'json')) as string;
    fs.writeFileSync(cachePath, persisted);
  }

  const queryEmbedding = await embeddings(query);
  const results = await search(db, {
    mode: 'vector',
    vector: {
      value: queryEmbedding,
      property: 'embedding',
    },
    limit: 1,
  });

  if (results.hits.length > 0) {
    return results.hits[0].id;
  } else {
    return null;
  }
}

export default indexAndSearchPdfs;
