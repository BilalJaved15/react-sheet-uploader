/**
 * Demo fixtures for AI-assisted column matching.
 *
 * The matcher here is a canned response on a timer, not a model call. A public
 * demo page has nowhere safe to put an API key, and the point being shown is
 * the review flow — suggestions arriving, the banner appearing, the user
 * confirming — which is identical whichever way the suggestions were produced.
 * `REAL_MATCHER_SNIPPET` below is what the same wiring looks like against an
 * actual endpoint.
 */

import type { AiMatchFn, Field } from '../src';

/**
 * A schema whose headers no string metric can reach.
 *
 * Every header in the CSV below is a real-world naming pattern from some
 * internal system: an ERP's abbreviations, a CRM's jargon, a column named after
 * the report it came from. Matching these needs to know what the words mean.
 */
export const aiDemoFields: Field[] = [
  {
    label: 'First Name',
    key: 'firstName',
    validators: [{ validate: 'required' }],
  },
  { label: 'Last Name', key: 'lastName' },
  {
    label: 'Email',
    key: 'email',
    type: 'email',
    validators: [{ validate: 'required' }],
  },
  { label: 'Phone', key: 'phone', type: ['phone-number', { country: 'US' }] },
  { label: 'Company', key: 'company' },
  {
    label: 'Plan',
    key: 'plan',
    type: 'select',
    selectOptions: [
      { label: 'Free', value: 'free' },
      { label: 'Pro', value: 'pro' },
      { label: 'Enterprise', value: 'enterprise' },
    ],
  },
  { label: 'Seats', key: 'seats', type: ['number', { round: 0, min: 1 }] },
  { label: 'MRR', key: 'mrr', type: ['number', { preset: 'usd' }] },
  { label: 'Signed Up', key: 'signedUp', type: 'date' },
  { label: 'Country', key: 'country', type: 'country' },
];

/**
 * Headers deliberately chosen to defeat the heuristic.
 *
 * `Rev/Mo` and `MRR` share no characters and no words. `Tier` and `Plan` are
 * synonyms only in this domain. `Acct Exec Notes` looks like nothing in the
 * schema and should stay unimported.
 */
export const AI_DEMO_CSV = `Cust Fwd Nm,Acct Holder Srnm,Primary Contact Pt,Mobile No,Org Legal Nm,Tier,Lic Ct,Rev/Mo,Onboard Dt,Territory,Acct Exec Notes
Ada,Lovelace,ada@example.com,415-555-2671,Analytical Engines Ltd,Enterprise,120,"$12,000.00",1852-11-27,United Kingdom,Renewal due Q3
Alan,Turing,alan@example.com,(650) 555-0143,Bletchley Systems,Pro,45,4500,1954-06-07,United Kingdom,Expansion opportunity
Grace,Hopper,grace@example.com,202-555-0188,US Navy,Enterprise,4000,"$99,500.00",1959-03-15,United States,Multi-year contract
Katherine,Johnson,katherine@example.com,281-555-0110,NASA,Pro,300,"$18,250.00",1918-08-26,United States,
Radia,Perlman,radia@example.com,617-555-0164,Spanning Tree Inc,Free,1,0,1988-01-04,United States,Trial expiring
`;

/**
 * What a model would return for the CSV above, keyed by header.
 *
 * Confidences are the interesting part of the demo: `Territory` is genuinely
 * ambiguous — it could be a sales region rather than a country — so it comes
 * back low enough to be flagged for a second look rather than trusted.
 */
const CANNED_SUGGESTIONS: Record<
  string,
  { fieldKey: string | null; confidence: number; reason: string }
> = {
  'Cust Fwd Nm': {
    fieldKey: 'firstName',
    confidence: 0.94,
    reason: '"Fwd Nm" is a forename abbreviation',
  },
  'Acct Holder Srnm': {
    fieldKey: 'lastName',
    confidence: 0.96,
    reason: '"Srnm" is surname',
  },
  'Primary Contact Pt': {
    fieldKey: 'email',
    confidence: 0.97,
    reason: 'Values are email addresses',
  },
  'Mobile No': {
    fieldKey: 'phone',
    confidence: 0.95,
    reason: 'Mobile number is a phone number',
  },
  'Org Legal Nm': {
    fieldKey: 'company',
    confidence: 0.93,
    reason: 'Legal name of the organisation',
  },
  Tier: {
    fieldKey: 'plan',
    confidence: 0.89,
    reason: 'Values match the plan options exactly',
  },
  'Lic Ct': {
    fieldKey: 'seats',
    confidence: 0.85,
    reason: 'Licence count is the number of seats',
  },
  'Rev/Mo': {
    fieldKey: 'mrr',
    confidence: 0.92,
    reason: 'Revenue per month is MRR',
  },
  'Onboard Dt': {
    fieldKey: 'signedUp',
    confidence: 0.9,
    reason: 'Onboarding date is when they signed up',
  },
  Territory: {
    fieldKey: 'country',
    confidence: 0.64,
    reason: 'Values are country names, though "territory" may mean sales region',
  },
  'Acct Exec Notes': {
    fieldKey: null,
    confidence: 0.88,
    reason: 'Free-text sales notes with no matching field',
  },
};

/** Roughly what a small model on a free tier costs you in wall-clock time. */
const SIMULATED_LATENCY_MS = 1400;

/**
 * Stands in for the host application's matcher.
 *
 * Honours the abort signal exactly as a real `fetch` would, so the cancel path
 * — user clicks Continue while the request is in flight — is demoed too.
 */
export const simulatedAiMatch: AiMatchFn = (input, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(
        input.columns
          .map((column) => {
            const canned = CANNED_SUGGESTIONS[column.header.trim()];
            if (!canned) return null;
            return { columnIndex: column.index, ...canned };
          })
          .filter((suggestion) => suggestion !== null),
      );
    }, SIMULATED_LATENCY_MS);

    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });

/** Shown on the demo page so the real wiring is visible next to the fake one. */
export const REAL_MATCHER_SNIPPET = `// Your app — the API key stays on your server.
settings={{
  matchingStep: {
    aiMatch: async (input, signal) => {
      const res = await fetch('/api/match-columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal,
      });
      return res.json();
    },
  },
}}

// Your server — buildMatchPrompt and parseMatchResponse are exported.
import { buildMatchPrompt, parseMatchResponse } from 'react-sheet-uploader';

app.post('/api/match-columns', async (req, res) => {
  const completion = await model.generate(buildMatchPrompt(req.body));
  res.json(parseMatchResponse(completion));
});`;
