import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bibTool, findDuplicate, findSameTitle, parsePaper, prepareEntry, splitFields } from '../src/bib.js';

const exec = { agent: {}, signal: new AbortController().signal };

const ARXIV_BIB = `@misc{lovelace2026analyticalengineslanguagemodels,
      title={Analytical Engines as Language Models},
      author={Ada Lovelace and Alan Turing},
      year={2026},
      eprint={2601.00001},
      archivePrefix={arXiv},
      primaryClass={cs.AI},
      url={https://arxiv.org/abs/2601.00001},
}`;
const DOI_BIB = ' @article{Minster_2020, title={Randomized Algorithms for Low-Rank Tensor Decompositions in the {Tucker} Format}, volume={2}, DOI={10.1137/19m1261043}, journal={SIAM Journal on Mathematics of Data Science}, author={Minster, Rachel and Saibaba, Arvind K.}, year={2020}, month=Jan, pages={189–215} }';
const LIBRARY = `@Misc{minster2019randomized,
  author        = {Rachel Minster},
  eprint        = {1905.07311},
  url           = {https://arxiv.org/abs/1905.07311},
}

@Article{wang2020,
  doi = {10.48550/arXiv.2006.04768},
}
`;

test('papers are recognized by arXiv id, arXiv link, DOI or doi.org link', () => {
  assert.deepEqual(parsePaper('2601.00001'), { kind: 'arxiv', id: '2601.00001' });
  assert.deepEqual(parsePaper(' arXiv:2601.00001v2 '), { kind: 'arxiv', id: '2601.00001' });
  assert.deepEqual(parsePaper('https://arxiv.org/pdf/2601.00001v1.pdf'), { kind: 'arxiv', id: '2601.00001' });
  assert.deepEqual(parsePaper('https://arxiv.org/abs/hep-th/9901001'), { kind: 'arxiv', id: 'hep-th/9901001' });
  assert.deepEqual(parsePaper('10.1137/19M1261043'), { kind: 'doi', id: '10.1137/19M1261043' });
  assert.deepEqual(parsePaper('https://doi.org/10.1137/19M1261043.'), { kind: 'doi', id: '10.1137/19M1261043' });
  assert.throws(() => parsePaper('Analytical Engines as Language Models'), /find the id first/);
});

test('duplicates are found by arXiv id or DOI and report the existing key', () => {
  assert.equal(findDuplicate(LIBRARY, { kind: 'arxiv', id: '1905.07311' }), 'minster2019randomized');
  assert.equal(findDuplicate(LIBRARY, { kind: 'arxiv', id: '1905.0731' }), undefined);
  assert.equal(findDuplicate(LIBRARY, { kind: 'doi', id: '10.48550/ARXIV.2006.04768' }), 'wang2020');
  assert.equal(findDuplicate(LIBRARY, { kind: 'doi', id: '10.48550/arXiv.2006.0476' }), undefined);
});

test('entries are laid out one field per line, tagged, and keep their key unless it is taken', () => {
  const fields = splitFields(' title={A, B {C}}, month=Jan, note="x, y", pages={1--2} ');
  assert.deepEqual(fields, [['title', '{A, B {C}}'], ['month', 'Jan'], ['note', '"x, y"'], ['pages', '{1--2}']]);
  const doi = prepareEntry(DOI_BIB, LIBRARY, ['to-read']);
  assert.equal(doi.key, 'Minster_2020');
  assert.equal(doi.title, 'Randomized Algorithms for Low-Rank Tensor Decompositions in the {Tucker} Format');
  assert.match(doi.entry, /^@article\{Minster_2020,\n  title    = \{Randomized/);
  assert.match(doi.entry, /\n  keywords = \{assistant, to-read\},\n\}$/);
  const taken = prepareEntry(ARXIV_BIB, '@misc{lovelace2026analyticalengineslanguagemodels,\n}\n', []);
  assert.equal(taken.key, 'lovelace2026analyticalengineslanguagemodelsa');
  assert.throws(() => prepareEntry('<html>not found</html>', '', []), /did not return a BibTeX entry/);
  const amp = prepareEntry('@article{k, publisher={A & B}, note={C \\& D}, url={https://x.org/?a=1&b=2}}', '', []);
  assert.match(amp.entry, /publisher = \{A \\& B\}/);
  assert.match(amp.entry, /note      = \{C \\& D\}/);
  assert.match(amp.entry, /url       = \{https:\/\/x\.org\/\?a=1&b=2\}/);
});

test('another version of a paper already in the library is caught by its title', () => {
  const library = '@Misc{minster2019,\n  title = {Randomized algorithms for low-rank tensor decompositions in the {Tucker} format},\n}\n';
  assert.equal(findSameTitle(library, 'Randomized Algorithms for Low-Rank Tensor Decompositions in the Tucker Format'), 'minster2019');
  assert.equal(findSameTitle(library, 'Randomized Algorithms for Low-Rank Matrix Decompositions'), undefined);
  assert.equal(findSameTitle(library, 'Intro'), undefined);
});

test('bib_add appends the fetched entry once, skips a duplicate and never rewrites earlier text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bib-test-'));
  const library = join(dir, 'article.bib');
  try {
    await writeFile(library, LIBRARY.trimEnd());
    const urls = [];
    const tool = bibTool({ library, fetch: async (url, options) => { urls.push([url, options.headers.Accept]); return { ok: true, status: 200, text: async () => ARXIV_BIB }; } });
    const added = await tool.execute({ paper: 'https://arxiv.org/abs/2601.00001v2', keywords: ['kv cache', 'bad,word'] }, exec);
    assert.equal(added.added, true);
    assert.equal(added.key, 'lovelace2026analyticalengineslanguagemodels');
    assert.deepEqual(urls, [['https://arxiv.org/bibtex/2601.00001', 'application/x-bibtex']]);
    const text = await readFile(library, 'utf8');
    assert.ok(text.startsWith(LIBRARY.trimEnd()));
    assert.match(text, /\n\n@misc\{lovelace2026analyticalengineslanguagemodels,\n/);
    assert.match(text, /\n  archiveprefix = \{arXiv\},\n[\s\S]*\n  keywords      = \{assistant, kv cache\},\n\}\n$/);
    const again = await tool.execute({ paper: '2601.00001' }, exec);
    assert.deepEqual(again, { added: false, reason: 'already in the library', key: 'lovelace2026analyticalengineslanguagemodels', library });
    assert.equal(await readFile(library, 'utf8'), text);
    const missing = bibTool({ library: join(dir, 'none.bib'), fetch: async () => ({ ok: true, status: 200, text: async () => ARXIV_BIB }) });
    await assert.rejects(missing.execute({ paper: '2601.00001' }, exec), /does not exist/);
    const gone = bibTool({ library, fetch: async () => ({ ok: false, status: 404, text: async () => '' }) });
    await assert.rejects(gone.execute({ paper: '10.9999/none' }, exec), /doi\.org has no paper 10\.9999\/none/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
