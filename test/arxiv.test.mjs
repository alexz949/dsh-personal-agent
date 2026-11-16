import test from 'node:test';
import assert from 'node:assert/strict';
import { arxivTool, buildQuery, parseFeed } from '../src/arxiv.js';

const exec = { agent: {}, signal: new AbortController().signal };

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">137</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/2610.01234v2</id>
    <updated>2026-10-20T10:00:00Z</updated>
    <published>2026-10-02T17:59:59Z</published>
    <title>Squeezing the KV
      Cache: Eviction &amp; Quantization</title>
    <summary>  We study KV cache
      compression for long contexts.  </summary>
    <author><name>Ada Lovelace</name></author>
    <author><name>Alan Turing</name></author>
    <arxiv:comment xmlns:arxiv="http://arxiv.org/schemas/atom">Accepted at ICLR 2027; 12 pages</arxiv:comment>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/hep-th/9901001v1</id>
    <updated>1999-01-01T00:00:00Z</updated>
    <published>1999-01-01T00:00:00Z</published>
    <title>Old style id</title>
    <summary>x</summary>
    <author><name>B</name></author>
    <category term="hep-th"/>
  </entry>
</feed>`;

test('queries: plain words and phrases become all: terms, arXiv syntax passes through', () => {
  assert.equal(buildQuery({ query: 'KV cache' }), '(all:KV AND all:cache)');
  assert.equal(buildQuery({ query: '"KV cache" (compression OR eviction)' }), '(all:"KV cache" AND ( all:compression OR all:eviction ))');
  assert.equal(buildQuery({ query: 'abs:"kv cache" OR ti:eviction' }), '(abs:"kv cache" OR ti:eviction)');
  assert.equal(buildQuery({ query: 'au:Han ANDNOT cat:cs.CV' }), '(au:Han ANDNOT cat:cs.CV)');
  assert.equal(
    buildQuery({ query: 'kv cache', categories: ['cs.LG', 'cs.CL'], since: '2026-10-01', today: new Date('2026-10-29T12:00:00Z') }),
    '(all:kv AND all:cache) AND (cat:cs.LG OR cat:cs.CL) AND submittedDate:[202610010000 TO 202610302359]',
  );
  assert.throws(() => buildQuery({ query: '   ' }), /at least one search term/);
});

test('the Atom feed parses into papers with clean text, dates and links', () => {
  const { total, papers } = parseFeed(FEED);
  assert.equal(total, 137);
  assert.deepEqual(papers[0], {
    id: '2610.01234',
    version: 'v2',
    title: 'Squeezing the KV Cache: Eviction & Quantization',
    authors: ['Ada Lovelace', 'Alan Turing'],
    published: '2026-10-02',
    updated: '2026-10-20',
    primary_category: 'cs.LG',
    categories: ['cs.LG', 'cs.CL'],
    comment: 'Accepted at ICLR 2027; 12 pages',
    abstract: 'We study KV cache compression for long contexts.',
    url: 'https://arxiv.org/abs/2610.01234',
  });
  assert.equal(papers[1].id, 'hep-th/9901001');
  assert.equal(papers[1].primary_category, 'hep-th');
  const error = '<feed><entry><id>http://arxiv.org/api/errors#incorrect_id</id><title>Error</title><summary>incorrect id format for 1234</summary></entry></feed>';
  assert.throws(() => parseFeed(error), /arXiv rejected the query: incorrect id format/);
});

test('the tool sends one well-formed request, clamps the limit and spaces requests three seconds apart', async () => {
  const urls = [], sleeps = [];
  let clock = 1_000_000;
  const tool = arxivTool({
    fetch: async url => { urls.push(new URL(url)); return { ok: true, status: 200, text: async () => FEED }; },
    now: () => clock,
    sleep: async ms => { sleeps.push(ms); clock += ms; },
  });
  const result = await tool.execute({ query: '"KV cache"', categories: ['cs.LG'], limit: 500 }, exec);
  assert.equal(result.total, 137);
  assert.equal(result.returned, 2);
  assert.equal(urls[0].origin + urls[0].pathname, 'https://export.arxiv.org/api/query');
  assert.equal(urls[0].searchParams.get('search_query'), '(all:"KV cache") AND (cat:cs.LG)');
  assert.equal(urls[0].searchParams.get('max_results'), '50');
  assert.equal(urls[0].searchParams.get('sortBy'), 'submittedDate');
  clock += 1000;
  await tool.execute({ query: 'eviction', sort: 'relevance' }, exec);
  assert.deepEqual(sleeps, [2000]);
  assert.equal(urls[1].searchParams.get('sortBy'), 'relevance');
  await assert.rejects(tool.execute({ query: 'x', since: 'last week' }, exec), /since must be YYYY-MM-DD/);
  await assert.rejects(tool.execute({ query: 'x', categories: ['cs LG; drop'] }, exec), /categories must look like/);
  const failing = arxivTool({ fetch: async () => ({ ok: false, status: 503, text: async () => '' }), sleep: async () => {} });
  await assert.rejects(failing.execute({ query: 'x' }, exec), /HTTP 503/);
});
