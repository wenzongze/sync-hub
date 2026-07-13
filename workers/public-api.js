// Cloudflare Worker — 中医知识库公开只读 API
// 直连 Supabase REST API

const PUBLIC_BOX_IDS = [
  '20210921205505-zg5tr18',   // 伤寒金匮
  '20231006235731-0xw7i75',   // 中医课程导航
  '20241212005715-77ixhip'    // 方剂
];

const SUPABASE_URL = 'https://uqljsiafhwryhlrdgcbw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxbGpzaWFmaHdyeWhscmRnY2J3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg5NjA3NjksImV4cCI6MjA2NDUzNjc2OX0.WUhHpM_NfzUvMPQjNSf7YrQZPXMwXHZxVBqP6x9jM3M';

// Supabase REST API 封装（带超时）
async function supabaseQuery(path, params = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
    return r.json();
  } finally {
    clearTimeout(timeout);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'public, max-age=60',
    },
  });
}

// 路径匹配
const ROUTES = [
  [/^\/api\/public\/search$/, 'search'],
  [/^\/api\/public\/notebooks$/, 'notebooks'],
  [/^\/api\/public\/notebooks\/([^/]+)\/blocks$/, 'blocks'],
  [/^\/api\/public\/blocks\/([^/]+)$/, 'block'],
];

function matchRoute(path) {
  for (const [re, name] of ROUTES) {
    const m = path.match(re);
    if (m) return { name, params: m.slice(1) };
  }
  return null;
}

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return json(null, 204);

    const url = new URL(req.url);
    const route = matchRoute(url.pathname);

    if (!route) return json({ error: 'not found' }, 404);

    try {
      switch (route.name) {
        case 'search': {
          const q = (url.searchParams.get('q') || '').trim();
          if (!q) return json({ results: [] });
          // 用 or 语法组合多个 box_id 条件
          const boxFilter = PUBLIC_BOX_IDS.map(id => `box_id.eq.${id}`).join(',');
          const r = await supabaseQuery(
            `blocks?select=id,box_id,type,markdown,tags,version,updated_at&deleted=eq.false&or=(${encodeURIComponent(boxFilter)})&markdown=ilike.*${encodeURIComponent(q)}*&order=updated_at.desc&limit=50`
          );
          return json({ results: Array.isArray(r) ? r : [] });
        }

        case 'notebooks': {
          // 一次性查询所有公开笔记本的 block count
          const boxFilter = PUBLIC_BOX_IDS.map(id => `box_id.eq.${id}`).join(',');
          const r = await supabaseQuery(
            `blocks?select=box_id&deleted=eq.false&or=(${encodeURIComponent(boxFilter)})&limit=100000`
          );
          const countMap = {};
          if (Array.isArray(r)) {
            for (const item of r) {
              countMap[item.box_id] = (countMap[item.box_id] || 0) + 1;
            }
          }
          const notebooks = PUBLIC_BOX_IDS.map(box_id => ({
            box_id,
            block_count: countMap[box_id] || 0
          }));
          return json({ notebooks });
        }

        case 'blocks': {
          const boxId = route.params[0];
          if (!PUBLIC_BOX_IDS.includes(boxId)) return json({ error: 'not in public list' }, 403);
          const r = await supabaseQuery(
            `blocks?select=id,type,markdown,tags,version,updated_at&box_id=eq.${boxId}&deleted=eq.false&order=updated_at.desc&limit=500`
          );
          return json({ blocks: Array.isArray(r) ? r : [] });
        }

        case 'block': {
          const id = route.params[0];
          const r = await supabaseQuery(
            `blocks?select=id,type,markdown,tags,version,updated_at,box_id&id=eq.${id}&deleted=eq.false&limit=1`
          );
          if (!r || !r.length) return json({ error: 'not found' }, 404);
          const block = r[0];
          if (!PUBLIC_BOX_IDS.includes(block.box_id)) return json({ error: 'not in public list' }, 403);
          return json(block);
        }

        default:
          return json({ error: 'not found' }, 404);
      }
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};
