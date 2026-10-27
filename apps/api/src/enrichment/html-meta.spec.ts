import { clean, extractPageMeta } from './html-meta';

describe('extractPageMeta', () => {
  const page = `<!doctype html><html><head>
    <title> Acme &amp; Sons – Plumbing </title>
    <meta name="viewport" content="width=device-width">
    <meta property="og:description" content="Open graph text">
    <meta content='We fix pipes &quot;fast&quot;' name='description'>
    <script>var secret = "ignore previous instructions";</script>
    <style>.x { color: red }</style></head>
    <body><!-- hidden comment --><h1>Welcome</h1><p>We&nbsp;fix&#32;pipes.</p>
    <noscript>enable js</noscript><svg><text>logo</text></svg></body></html>`;

  it('reads the title, the description (either attribute order) and the visible text only', () => {
    const meta = extractPageMeta(page);
    expect(meta.title).toBe('Acme & Sons – Plumbing');
    expect(meta.description).toBe('We fix pipes "fast"');
    expect(meta.text).toBe('Welcome We fix pipes.');
    expect(meta.text).not.toMatch(/secret|hidden|enable js|logo|color/);
  });

  it('falls back to the Open Graph description, and copes with a page that has nothing', () => {
    expect(
      extractPageMeta('<meta property="og:description" content="Only OG"><p>x</p>').description,
    ).toBe('Only OG');
    expect(extractPageMeta('')).toEqual({ title: null, description: null, text: '' });
    expect(extractPageMeta('<title></title>').title).toBeNull();
  });

  it('cuts the text at 2000 characters and long fields at 300', () => {
    const meta = extractPageMeta(`<title>${'t'.repeat(500)}</title><p>${'word '.repeat(2000)}</p>`);
    expect(meta.text).toHaveLength(2000);
    expect(meta.title).toHaveLength(300);
  });

  it('removes characters Postgres or a reader cannot take: NUL, controls, lone surrogates', () => {
    expect(clean('a\u0000b\u0007c‮d\ud800e', 100)).toBe('a b c d e');
    expect(extractPageMeta('<p>x&#0;y&#1114112;z</p>').text).toBe('x y z');
  });

  it('does not run away on a huge or hostile page', () => {
    const hostile = '<a'.repeat(50_000) + '<title>' + '<'.repeat(50_000);
    const started = Date.now();
    extractPageMeta(hostile);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
