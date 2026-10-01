window.App = window.App || {};

/* ProposalDoc — the customer-facing proposal, as pure functions (no DOM, no clock,
   no network), so it runs identically in the browser and in node (tests/unit).

   The document is rendered from a PROPOSAL record ONLY (migration 074). That row has
   no cost or margin columns and this module never receives an underwriting record,
   so the customer document has no way to show an internal figure. Keep it that way:
   do not pass an underwriting (or anything derived from one but the price) in here.

   Money is a decimal STRING ("18571.43") end to end, like UnderwritingCalc; this only
   inserts thousands separators for display. */
App.ProposalDoc = (function () {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // 1 -> "PRO-0001" (per-company sequence; the database assigns the number).
  function numberLabel(n) {
    const v = Number(n);
    return 'PRO-' + (Number.isFinite(v) ? String(Math.trunc(v)).padStart(4, '0') : '----');
  }

  // "18571.43" -> "$18,571.43"
  function money(s) {
    if (s === null || s === undefined || s === '') return '—';
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(s));
    if (!m) return '—';
    const whole = m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (m[1] || '') + '$' + whole + (m[3] !== undefined ? '.' + m[3] : '');
  }

  function dateLabel(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  /* Starting text for a new proposal. Mirrors the database defaults in
     074's guard_proposal_insert (which is what real data uses); this copy only
     serves the offline preview. ctx = { projectName, jobAddress }. */
  function defaults(ctx) {
    const c = ctx || {};
    const name = c.projectName || '';
    return {
      title: name ? 'Proposal — ' + name : 'Proposal',
      scopeOfWork: 'Furnish all labor and materials for ' + (name || 'the work') +
        (c.jobAddress ? ' at ' + c.jobAddress : '') + ', as described below.\n\n[Describe the scope of work here.]',
      terms: '1. This proposal is valid for 30 days from the date issued.\n' +
        '2. Payment terms: [enter payment schedule].\n' +
        '3. Work not described in the scope above requires a written change order.',
    };
  }

  const block = (label, body) => `<section class="pp-sec"><h2>${esc(label)}</h2>${body}</section>`;
  const text = (s) => `<p class="pp-text">${esc(s)}</p>`;

  /* The printable document (inner HTML of .pp-doc). `p` is a proposal record:
     { number, companyName, clientName, projectName, jobAddress, title,
       scopeOfWork, terms, total, createdAt } */
  function documentHtml(p) {
    const client = p.clientName
      ? `<p class="pp-strong">${esc(p.clientName)}</p>`
      : `<p class="pp-blank">Client name</p>`;
    const job = (p.projectName ? `<p class="pp-strong">${esc(p.projectName)}</p>` : '') +
      (p.jobAddress ? text(p.jobAddress) : `<p class="pp-blank">Job address</p>`);
    return `
      <header class="pp-doc-head">
        <div class="pp-co">${esc(p.companyName || '')}</div>
        <div class="pp-ref">
          <div><b>Proposal ${esc(numberLabel(p.number))}</b></div>
          <div>${esc(dateLabel(p.createdAt))}</div>
        </div>
      </header>
      <h1 class="pp-title">${esc(p.title || 'Proposal')}</h1>
      <div class="pp-two">
        ${block('Prepared for', client)}
        ${block('Job site', job)}
      </div>
      ${block('Scope of work', text(p.scopeOfWork))}
      <section class="pp-sec pp-price"><h2>Total price</h2><div class="pp-total">${esc(money(p.total))}</div></section>
      ${block('Terms', text(p.terms))}
      <div class="pp-sign">
        <div><div class="pp-line"></div><span>Customer signature</span></div>
        <div><div class="pp-line"></div><span>Date</span></div>
      </div>
      <div class="pp-sign">
        <div><div class="pp-line"></div><span>Authorized signature — ${esc(p.companyName || 'Company')}</span></div>
        <div><div class="pp-line"></div><span>Date</span></div>
      </div>`;
  }

  return { numberLabel, money, dateLabel, defaults, documentHtml };
})();
