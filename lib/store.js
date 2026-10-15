// Tiny key-value layer. Works with:
//   1. Redis over REST (Upstash / Vercel KV) — env vars matched by suffix
//      (…KV_REST_API_URL + …KV_REST_API_TOKEN, or …REDIS_REST_URL + …REDIS_REST_TOKEN)
//   2. Redis over TCP (REDIS_URL / …_REDIS_URL) via the optional ioredis package
//   3. In-memory fallback (local testing only — data is lost on restart)
'use strict';

function envBySuffix(suffixes) {
  const keys = Object.keys(process.env);
  for (const s of suffixes) {
    const k = keys.find((x) => x === s || x.endsWith('_' + s));
    if (k && process.env[k]) return process.env[k];
  }
  return '';
}

const REST_URL = envBySuffix(['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL', 'REDIS_REST_URL']);
const REST_TOKEN = envBySuffix(['KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN', 'REDIS_REST_TOKEN']);
const TCP_URL = envBySuffix(['REDIS_URL', 'KV_URL']);

let mode = 'memory';
let tcp = null;
if (REST_URL && REST_TOKEN) {
  mode = 'rest';
} else if (TCP_URL && /^rediss?:\/\//.test(TCP_URL)) {
  try {
    const Redis = require('ioredis');
    tcp = new Redis(TCP_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
    tcp.on('error', () => {});
    mode = 'tcp';
  } catch (e) {
    mode = 'memory';
  }
}

const mem = { h: new Map(), s: new Map() };

async function cmd(args) {
  if (mode === 'rest') {
    const r = await fetch(REST_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + REST_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const t = await r.text();
    let j;
    try { j = JSON.parse(t); } catch (e) { throw new Error('Storage error ' + r.status); }
    if (j.error) throw new Error('Storage error: ' + j.error);
    return j.result;
  }
  if (mode === 'tcp') {
    const [c, ...rest] = args;
    return tcp.call(c, ...rest);
  }
  return memCmd(args);
}

function memCmd(args) {
  const c = String(args[0]).toUpperCase();
  const key = args[1];
  if (c === 'HSET') {
    if (!mem.h.has(key)) mem.h.set(key, new Map());
    const h = mem.h.get(key);
    for (let i = 2; i < args.length; i += 2) h.set(String(args[i]), String(args[i + 1]));
    return 1;
  }
  if (c === 'HGET') { const h = mem.h.get(key); return h && h.has(String(args[2])) ? h.get(String(args[2])) : null; }
  if (c === 'HDEL') { const h = mem.h.get(key); let n = 0; if (h) for (const f of args.slice(2)) if (h.delete(String(f))) n++; return n; }
  if (c === 'HGETALL') { const h = mem.h.get(key); const out = []; if (h) for (const [k, v] of h) out.push(k, v); return out; }
  if (c === 'GET') { const v = mem.s.get(key); if (!v) return null; if (v.exp && v.exp < Date.now()) { mem.s.delete(key); return null; } return v.val; }
  if (c === 'SET') {
    let exp = 0;
    const i = args.findIndex((a) => String(a).toUpperCase() === 'EX');
    if (i > 0) exp = Date.now() + Number(args[i + 1]) * 1000;
    mem.s.set(key, { val: String(args[2]), exp });
    return 'OK';
  }
  if (c === 'DEL') { let n = 0; for (const k of args.slice(1)) { if (mem.s.delete(k)) n++; if (mem.h.delete(k)) n++; } return n; }
  throw new Error('Unsupported command ' + c);
}

function parse(v) { if (v == null) return null; try { return JSON.parse(v); } catch (e) { return null; } }

module.exports = {
  mode: () => mode,
  persistent: () => mode !== 'memory',
  async hget(key, field) { return parse(await cmd(['HGET', key, field])); },
  async hset(key, field, obj) { await cmd(['HSET', key, field, JSON.stringify(obj)]); return obj; },
  async hdel(key, field) { return cmd(['HDEL', key, field]); },
  async hgetall(key) {
    const r = await cmd(['HGETALL', key]);
    const out = {};
    if (Array.isArray(r)) { for (let i = 0; i < r.length; i += 2) { const p = parse(r[i + 1]); if (p) out[r[i]] = p; } }
    else if (r && typeof r === 'object') { for (const k of Object.keys(r)) { const p = parse(r[k]); if (p) out[k] = p; } }
    return out;
  },
  async get(key) { return parse(await cmd(['GET', key])); },
  async set(key, obj, ttlSec) {
    const a = ['SET', key, JSON.stringify(obj)];
    if (ttlSec) a.push('EX', String(ttlSec));
    return cmd(a);
  },
  async del(key) { return cmd(['DEL', key]); },
};
