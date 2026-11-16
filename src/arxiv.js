// Read-only arXiv search through the official API (export.arxiv.org), returning structured papers
// with first-submitted dates so the research agent can screen abstracts and verify recency.
// arXiv asks API clients to wait three seconds between requests.
export const name = 'personal-agent-arxiv';
export const inject = ['tools'];

const ENDPOINT = 'https://export.arxiv.org/api/query';
const GAP_MS = 3000;
const LIMITS = { results: 50, abstract: 2000, comment: 300, authors: 10 };
const SORTS = { submitted: 'submittedDate', updated: 'lastUpdatedDate', relevance: 'relevance' };
const FIELD = /^(ti|au|abs|co|jr|cat|rn|id|all|submittedDate|lastUpdatedDate):/;
const OPERATORS = new Set(['AND', 'OR', 'ANDNOT']);

/** Plain words and "quoted phrases" become all: terms joined by AND; arXiv syntax passes through. */
export function buildQuery({ query, categories = [], since, until, today = new Date() }) {
  const tokens = String(query ?? '').match(/\w+:"[^"]+"|\w+:\[[^\]]*\]|"[^"]+"|\(|\)|[^\s()]+/g) ?? [];
  const parts = [];
  for (const token of tokens) {
    const previous = parts.at(-1);
    const term = OPERATORS.has(token) || token === '(' || token === ')' || FIELD.test(token) ? token : `all:${token}`;
    const joins = previous !== undefined && !OPERATORS.has(previous) && previous !== '(' && !OPERATORS.has(term) && term !== ')';
    if (joins) parts.push('AND');
    parts.push(term);
  }
  if (parts.length === 0) throw new Error('query must contain at least one search term');
  const clauses = [`(${parts.join(' ')})`];
  if (categories.length > 0) clauses.push(`(${categories.map(category => `cat:${category}`).join(' OR ')})`);
  if (since !== undefined || until !== undefined) {
    const stamp = (day, time) => `${day.replaceAll('-', '')}${time}`;
    const tomorrow = new Date(today.getTime() + 86400e3).toISOString().slice(0, 10);
    clauses.push(`submittedDate:[${stamp(since ?? '1991-01-01', '0000')} TO ${stamp(until ?? tomorrow, '2359')}]`);
  }
  return clauses.join(' AND ');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = text => text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code) =>
  code[0] === '#' ? String.fromCodePoint(Number.parseInt(code.slice(code[1] === 'x' || code[1] === 'X' ? 2 : 1), code[1] === 'x' || code[1] === 'X' ? 16 : 10)) : ENTITIES[code] ?? match);
const squash = text => decode(text).replace(/\s+/g, ' ').trim();
const clip = (text, max) => text.length > max ? `${text.slice(0, max - 1)}…` : text;
const tag = (xml, name) => { const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml); return match ? squash(match[1]) : undefined; };

/** Parse the Atom feed the API returns. */
export function parseFeed(xml) {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(match => match[1]);
  const papers = [];
  for (const entry of entries) {
    const idUrl = tag(entry, 'id') ?? '';
    if (idUrl.includes('/api/errors')) throw new Error(`arXiv rejected the query: ${tag(entry, 'summary') ?? 'unknown error'}`);
    const [, id, version] = /arxiv\.org\/abs\/(.+?)(v\d+)?$/.exec(idUrl) ?? [];
    if (!id) continue;
    const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map(match => squash(match[1]));
    const categories = [...entry.matchAll(/<category[^>]*term="([^"]+)"/g)].map(match => match[1]);
    const comment = tag(entry, 'arxiv:comment');
    papers.push({
      id,
      ...version ? { version } : {},
      title: tag(entry, 'title') ?? '',
      authors: authors.length > LIMITS.authors ? [...authors.slice(0, LIMITS.authors), `et al. (${authors.length} authors)`] : authors,
      published: (tag(entry, 'published') ?? '').slice(0, 10),
      updated: (tag(entry, 'updated') ?? '').slice(0, 10),
      primary_category: /<arxiv:primary_category[^>]*term="([^"]+)"/.exec(entry)?.[1] ?? categories[0] ?? '',
      categories,
      ...comment ? { comment: clip(comment, LIMITS.comment) } : {},
      abstract: clip(tag(entry, 'summary') ?? '', LIMITS.abstract),
      url: `https://arxiv.org/abs/${id}`,
    });
  }
  const total = Number(tag(xml, 'opensearch:totalResults'));
  return { total: Number.isFinite(total) ? total : papers.length, papers };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (value, field) => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !DAY.test(value.trim())) throw new Error(`${field} must be YYYY-MM-DD`);
  return value.trim();
};

export function arxivTool({ fetch = globalThis.fetch, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let last = -Infinity;
  return {
    name: 'arxiv_search',
    description: 'Search arXiv through its official API. Plain words must all match (title, abstract and other fields); put exact phrases in double quotes; OR, AND, ANDNOT, parentheses and arXiv fields (ti:, abs:, au:, cat:) also work. Returns papers with arXiv id, title, authors, first-submitted (published) and updated dates, categories, author comment and abstract; newest submissions first by default. Screen the abstracts, then read the few promising papers in full (https://arxiv.org/html/<id> or the abs page). Read-only.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'For example: "KV cache" (compression OR eviction)' },
        categories: { type: 'array', items: { type: 'string' }, description: 'arXiv categories to restrict to, such as cs.LG, cs.CL, cs.AI.' },
        since: { type: 'string', description: 'Only papers first submitted on or after this day (YYYY-MM-DD, UTC).' },
        until: { type: 'string', description: 'Only papers first submitted on or before this day (YYYY-MM-DD, UTC).' },
        sort: { type: 'string', enum: Object.keys(SORTS), description: 'submitted (default, newest first), updated or relevance.' },
        limit: { type: 'integer', minimum: 1, maximum: LIMITS.results, description: 'Default 20.' },
      },
      required: ['query'],
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const categories = Array.isArray(args.categories) ? args.categories.map(String).map(item => item.trim()).filter(Boolean) : [];
      if (categories.some(item => !/^[a-z-]+(\.[A-Za-z-]+)?$/.test(item))) throw new Error('categories must look like cs.LG or math');
      const search = buildQuery({ query: args.query, categories, since: day(args.since, 'since'), until: day(args.until, 'until') });
      const sort = SORTS[args.sort] ?? SORTS.submitted;
      const limit = Number.isSafeInteger(args.limit) ? Math.min(Math.max(args.limit, 1), LIMITS.results) : 20;
      const url = `${ENDPOINT}?${new URLSearchParams({ search_query: search, start: '0', max_results: String(limit), sortBy: sort, sortOrder: 'descending' })}`;
      const wait = last + GAP_MS - now();
      if (wait > 0) await sleep(wait);
      last = now();
      const signal = AbortSignal.any([exec.signal, AbortSignal.timeout(30e3)].filter(Boolean));
      const response = await fetch(url, { signal, headers: { 'User-Agent': 'personal-agent (local research assistant)' } });
      if (!response.ok) throw new Error(`arXiv API answered HTTP ${response.status}; try again in a few seconds`);
      const { total, papers } = parseFeed(await response.text());
      return { query: search, sort: args.sort ?? 'submitted', total, returned: papers.length, papers };
    },
    presentCall: args => ({ card: 'generic', title: '搜索 arXiv', kind: 'search', content: [{ type: 'text', text: String(args.query ?? '') }] }),
  };
}

export function apply(ctx) {
  ctx.tools.register(arxivTool());
}
