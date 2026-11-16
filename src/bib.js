// Add a paper to the user's BibTeX library (JabRef, BibDesk and the like) by arXiv id or DOI. The BibTeX comes from arXiv or
// doi.org, never from the model, so authors, year and venue are the publisher's own. The tool can
// only append to that one .bib file and never edits or removes an existing entry; reference managers
// notice the change on disk. A paper already in the library (same arXiv id, DOI or title) is skipped.
import { appendFile, readFile } from 'node:fs/promises';
import { loadSettings } from './config.js';
import { actionLogger, withLog } from './log.js';

export const name = 'personal-agent-bib';
export const inject = ['tools'];

export const TAG = 'assistant';

const ARXIV = /^(?:arxiv:\s*)?(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i;
const ARXIV_URL = /arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?/i;
const DOI = /^(?:doi:\s*)?(10\.\d{4,9}\/\S+)$/i;
const DOI_URL = /(?:dx\.)?doi\.org\/(10\.\d{4,9}\/\S+)/i;

/** An arXiv id, an arXiv link, a DOI or a doi.org link, normalized. */
export function parsePaper(value) {
  const text = String(value ?? '').trim();
  const arxiv = ARXIV.exec(text) ?? ARXIV_URL.exec(text);
  if (arxiv) return { kind: 'arxiv', id: arxiv[1] };
  const doi = DOI.exec(text) ?? DOI_URL.exec(text);
  if (doi) return { kind: 'doi', id: decodeURIComponent(doi[1]).replace(/[.,;)]+$/, '') };
  throw new Error('paper must be an arXiv id (2601.00001), an arXiv link, a DOI (10.1137/19M1261043) or a doi.org link; find the id first when only the title is known');
}

const ENTRY = /^\s*@(\w+)\s*\{\s*([^,\s]+)\s*,([\s\S]*)\}\s*$/;
const escape = text => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Whether the library already has this paper, judged by arXiv id or DOI anywhere in it. */
export function findDuplicate(library, paper) {
  const pattern = paper.kind === 'arxiv'
    ? new RegExp(`(?<![\\d.])${escape(paper.id)}(?:v\\d+)?(?![\\d])`, 'i')
    : new RegExp(`${escape(paper.id)}(?![\\w/.-])`, 'i');
  const match = pattern.exec(library);
  if (!match) return undefined;
  const start = library.lastIndexOf('@', match.index);
  return /^@\w+\s*\{\s*([^,\s]+)/.exec(library.slice(start))?.[1];
}

/** Split an entry body into `name = value` fields at top-level commas. */
export function splitFields(body) {
  const fields = [];
  let depth = 0, quoted = false, start = 0;
  const push = end => {
    const part = body.slice(start, end).trim();
    const field = /^(\w[\w-]*)\s*=\s*([\s\S]+)$/.exec(part);
    if (field) fields.push([field[1].toLowerCase(), field[2].replace(/\s+/g, ' ').trim()]);
  };
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === '{') depth++;
    else if (char === '}') depth--;
    else if (char === '"' && depth === 0) quoted = !quoted;
    else if (char === ',' && depth === 0 && !quoted) { push(i); start = i + 1; }
  }
  push(body.length);
  return fields;
}

const plainTitle = title => title.toLowerCase().replace(/\\[a-z]+|[^a-z0-9]+/g, '');

/** The key of an entry with the same title, which catches the arXiv and journal versions of one paper. */
export function findSameTitle(library, title) {
  const wanted = plainTitle(title ?? '');
  if (wanted.length < 12) return undefined;
  for (const match of library.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,([\s\S]*?)\n\}/g)) {
    const found = splitFields(match[2]).find(([field]) => field === 'title');
    if (found && plainTitle(found[1]) === wanted) return match[1];
  }
  return undefined;
}

/** Take the publisher's entry, give it a key not yet in the library, tag it and lay it out one field per line. */
export function prepareEntry(bibtex, library, keywords) {
  const match = ENTRY.exec(bibtex);
  if (!match) throw new Error('the source did not return a BibTeX entry');
  const [, type, key, body] = match;
  const fields = splitFields(body);
  if (fields.length === 0) throw new Error('the source returned a BibTeX entry with no fields');
  const taken = new Set([...library.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,/g)].map(found => found[1]));
  let unique = key;
  for (let suffix = 0; taken.has(unique); suffix++) unique = `${key}${String.fromCharCode(97 + suffix)}`;
  // A bare & breaks LaTeX; links keep theirs.
  for (const entry of fields) if (!['url', 'doi', 'file'].includes(entry[0])) entry[1] = entry[1].replace(/(?<!\\)&/g, '\\&');
  if (!fields.some(([field]) => field === 'keywords')) fields.push(['keywords', `{${[TAG, ...keywords].join(', ')}}`]);
  const width = Math.max(...fields.map(([field]) => field.length));
  const lines = fields.map(([field, value]) => `  ${field.padEnd(width)} = ${value},`);
  const title = fields.find(([field]) => field === 'title')?.[1].replace(/^[{"]|[}"]$/g, '');
  return { key: unique, type: type.toLowerCase(), entry: `@${type}{${unique},\n${lines.join('\n')}\n}`, ...title ? { title } : {} };
}

export function bibTool({ fetch = globalThis.fetch, library } = {}) {
  if (!library) throw new Error('bibTool needs the path of a BibTeX library');
  let writing = Promise.resolve();
  return {
    name: 'bib_add',
    description: `Add a paper to the user's BibTeX library (${library}) without asking first, when the user wants to keep a paper they read or liked. Give its arXiv id or DOI (or a link to either); when only the title is known, find the id first. The BibTeX entry comes from arXiv or doi.org, not from you. The entry is appended with keywords "${TAG}" plus any you pass; a paper already in the library is skipped. Returns the citation key. It cannot edit or remove existing entries.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        paper: { type: 'string', description: 'arXiv id like 2601.00001, a DOI like 10.1137/19M1261043, or an arxiv.org / doi.org link.' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'Extra JabRef keywords, such as to-read or kv-cache.' },
      },
      required: ['paper'],
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const paper = parsePaper(args.paper);
      const keywords = Array.isArray(args.keywords) ? args.keywords.map(String).map(word => word.trim()).filter(word => word && !/[{},]/.test(word)) : [];
      const signal = AbortSignal.any([exec.signal, AbortSignal.timeout(30e3)].filter(Boolean));
      const url = paper.kind === 'arxiv' ? `https://arxiv.org/bibtex/${paper.id}` : `https://doi.org/${paper.id}`;
      const response = await fetch(url, { signal, headers: { Accept: 'application/x-bibtex', 'User-Agent': 'personal-agent (local research assistant)' }, redirect: 'follow' });
      if (response.status === 404) throw new Error(`${paper.kind === 'arxiv' ? 'arXiv' : 'doi.org'} has no paper ${paper.id}`);
      if (!response.ok) throw new Error(`${paper.kind === 'arxiv' ? 'arXiv' : 'doi.org'} answered HTTP ${response.status}; try again later`);
      const bibtex = await response.text();
      // One write at a time, so two adds cannot interleave or both miss each other's duplicate.
      const result = writing.then(async () => {
        const text = await readFile(library, 'utf8').catch(error => {
          throw new Error(error?.code === 'ENOENT' ? `the JabRef library ${library} does not exist` : `cannot read ${library}: ${error.message}`);
        });
        const existing = findDuplicate(text, paper);
        if (existing) return { added: false, reason: 'already in the library', key: existing, library };
        const prepared = prepareEntry(bibtex, text, keywords);
        const sameTitle = findSameTitle(text, prepared.title);
        if (sameTitle) return { added: false, reason: 'a paper with the same title is already in the library (perhaps another version of it)', key: sameTitle, library };
        await appendFile(library, `${text === '' || text.endsWith('\n') ? '' : '\n'}\n${prepared.entry}\n`, 'utf8');
        return { added: true, key: prepared.key, type: prepared.type, ...prepared.title ? { title: prepared.title } : {}, library, source: url };
      });
      writing = result.catch(() => {});
      return result;
    },
    presentCall: args => ({ card: 'generic', title: '加入 JabRef', kind: 'edit', content: [{ type: 'text', text: String(args.paper ?? '') }] }),
  };
}

// bib_add is offered only once the user has named their BibTeX library in the settings.
export function apply(ctx, config) {
  const settings = loadSettings(config);
  if (!settings.bibLibrary) return;
  for (const definition of withLog([bibTool({ library: settings.bibLibrary })], actionLogger({ path: settings.actionLog }))) ctx.tools.register(definition);
}
