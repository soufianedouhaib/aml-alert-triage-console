// Turns the workflow's per-step audit log into the evidence the case screen
// shows: stage progress plus the findings each step produced.
'use strict';

// Step ids and output variable ids, pinned from the workflow (version 1.2).
const NODES = {
  parser:    { id: 'f1006fc2-b9e2-4775-95ce-b466f165aba9', name: 'Alert Parser & Entity Extractor', out: { parsedAlert: 'workflow_output_d6jsohndc' } },
  sanLookup: { id: '6559bef9-e645-486a-80b9-a1d00ef89f8f', name: 'Sanctions/PEP Lookup', out: { sanctionsRaw: 'workflow_output_pb1t3dcsg' } },
  medLookup: { id: '894fc31a-5204-43b9-9bed-e4e9fe1dd382', name: 'Adverse Media Search', out: { mediaRaw: 'workflow_output_mf1mqgd9i' } },
  txnLookup: { id: '1e4d8fbb-82c7-4a77-90c4-d2d5d890bc36', name: 'Transaction & Customer Data', out: { customerData: 'workflow_output_faav5ydkw' } },
  sanAgent:  { id: 'ff9f3ef6-9b94-4b6e-997d-8abc31dd433f', name: 'Sanctions & PEP Screener', out: { sanctionsFindings: 'workflow_output_yyscx20kl' } },
  medAgent:  { id: '7440f214-dbaf-4718-af95-9275d6ebe64e', name: 'Adverse Media Analyst', out: { mediaFindings: 'workflow_output_3q5a2h5vv' } },
  typAgent:  { id: 'e7a4a3e2-643a-4d8b-aad5-ce74e98fd76a', name: 'Transaction Typology Analyst', out: { typologyFindings: 'workflow_output_oovgnyncz' } },
  risk:      { id: 'a258d31d-f12c-42f6-aedb-ddd56d39a579', name: 'Risk Aggregator & Scorer', out: { riskPackage: 'workflow_output_pv16glq4c' } },
  narrative: { id: '1e4b44f8-f693-47c6-91b8-fc5244a80785', name: 'Investigation Narrative Generator', out: { narrative: 'workflow_output_dh85gateu' } },
  presenter: { id: '624b6db1-9ac2-46cc-b100-e2cba1402a6f', name: 'HITL Presenter', out: { presentationMd: 'workflow_output_ikmyfdmyb', manifest: 'workflow_output_o5ljr1wqz' } },
  review:    { id: 'feee4faa-3d1d-4d30-b47f-0baf78ba18e7', name: 'Compliance Officer Review', out: { officerResponse: 'workflow_output_feqiebau8' } },
  resolver:  { id: '16cd35ba-880e-4c47-b750-bb6cf9cf8d94', name: 'HITL Resolver', out: { officerDecisions: 'workflow_output_1m33sezec' } },
  router:    { id: '5ebebaf9-3c35-4cc1-94c7-af33899ea937', name: 'Disposition Router & Audit Logger', out: { final: 'workflow_output_861m2mt2e' } },
};

// Stage grouping shown on screen (names are deliberately plain).
const STAGES = [
  { key: 'intake', label: 'Alert intake', detail: 'Alert parsed, entities extracted', nodes: ['parser'] },
  { key: 'lookups', label: 'Evidence lookups', detail: 'Sanctions/PEP, adverse media, customer & transactions', nodes: ['sanLookup', 'medLookup', 'txnLookup'] },
  { key: 'analysts', label: 'Specialist analysis', detail: 'Sanctions screener, media analyst, typology analyst', nodes: ['sanAgent', 'medAgent', 'typAgent'] },
  { key: 'scoring', label: 'Risk scoring', detail: 'Tiered score and recommended disposition', nodes: ['risk'] },
  { key: 'narrative', label: 'Investigation narrative', detail: 'Citation-backed case narrative', nodes: ['narrative', 'presenter'] },
  { key: 'review', label: 'Officer review', detail: 'Confirm, override or annotate', nodes: ['review', 'resolver'] },
  { key: 'routing', label: 'Routing & audit', detail: 'Queue, SLA and immutable audit record', nodes: ['router'] },
];

function norm(s) { return String(s || '').replace(/^\*\s*/, '').trim().toLowerCase(); }

function tryJson(v) {
  if (typeof v !== 'string') return v;
  let s = v.trim();
  const fence = s.match(/```[a-zA-Z]*\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  if (!(s.startsWith('{') || s.startsWith('['))) return v;
  try { return JSON.parse(s); } catch (e) { return v; }
}

function findEntry(map, node) {
  if (!map) return null;
  if (map[node.id]) return map[node.id];
  const want = norm(node.name);
  for (const k of Object.keys(map)) {
    if (norm(k) === want) return map[k];
    const e = map[k];
    if (e && (norm(e.nodeName) === want || norm(e.name) === want || e.nodeId === node.id)) return e;
  }
  return null;
}

function outputValue(entry, varName) {
  if (!entry || !Array.isArray(entry.executionOutput)) return undefined;
  const o = entry.executionOutput.find((x) => x && x.variableName === varName);
  return o ? tryJson(o.value) : undefined;
}

function stepStatus(entry) {
  if (!entry) return 'PENDING';
  const s = String(entry.executionStatus || 'UNKNOWN').toUpperCase();
  if (s === 'STARTED' || s === 'RUNNING' || s === 'IN_PROGRESS') return 'RUNNING';
  return s;
}

function build(audit, caseStatus) {
  const map = (audit && audit.audit && audit.audit.nodesExecutionData) || {};
  const data = {};
  const steps = {};
  for (const [k, node] of Object.entries(NODES)) {
    const e = findEntry(map, node);
    steps[k] = { status: stepStatus(e), startedAt: e && e.executionStartTime ? e.executionStartTime : null, ms: e && e.executionTime ? e.executionTime : null };
    for (const [field, v] of Object.entries(node.out)) {
      const val = outputValue(e, v);
      if (val !== undefined && val !== null && val !== '') data[field] = val;
    }
  }
  const terminal = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(caseStatus);
  const stages = STAGES.map((st) => {
    const ss = st.nodes.map((n) => steps[n]);
    let status = 'PENDING';
    if (ss.some((s) => s.status === 'FAILED')) status = 'FAILED';
    else if (ss.every((s) => s.status === 'COMPLETED')) status = 'DONE';
    else if (st.key === 'review' && (caseStatus === 'WAITING' || ss.some((s) => s.status === 'WAITING'))) status = 'WAITING';
    else if (ss.some((s) => s.status !== 'PENDING')) status = 'RUNNING';
    if (status === 'RUNNING' && terminal && caseStatus !== 'COMPLETED') status = 'STOPPED';
    const ms = ss.reduce((m, s) => Math.max(m, s.ms || 0), 0);
    return { key: st.key, label: st.label, detail: st.detail, status, ms: ms || null };
  });
  if (caseStatus === 'COMPLETED') stages.forEach((s) => { if (s.status === 'PENDING' || s.status === 'RUNNING') s.status = 'DONE'; });
  return { stages, data, hasAudit: Object.keys(map).length > 0 };
}

// Pull the officer packet out of a review webhook payload, wherever it sits.
function findPacket(obj) {
  let manifest = null; let md = null;
  const seen = new Set();
  (function walk(v, depth) {
    if (v == null || depth > 9) return;
    if (typeof v === 'string') {
      if (!md && /^\s*CASE REVIEW/.test(v)) md = v;
      else if (!manifest && /"case_header"|"officer_actions"/.test(v)) { const j = tryJson(v); if (j && typeof j === 'object') walk(j, depth + 1); }
      return;
    }
    if (typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (!manifest && !Array.isArray(v) && (v.case_header || v.officer_actions || v.risk_dashboard)) { manifest = v; return; }
    for (const k of Object.keys(v)) walk(v[k], depth + 1);
  })(obj, 0);
  return { manifest, md };
}

module.exports = { NODES, STAGES, build, findPacket, tryJson };
