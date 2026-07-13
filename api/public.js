// Vercel Serverless Function — 公开只读 API
// 为 GitHub Pages / 公网提供中医知识库检索和浏览

import pg from 'pg';

const { Pool } = pg;

// 公开笔记本白名单
const PUBLIC_BOX_IDS = [
  '20210921205505-zg5tr18',   // 伤寒金匮
  '20231006235731-0xw7i75',   // 中医课程导航
  '20241212005715-77ixhip'    // 方剂
];

function getPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    if (path === '/api/public/search') {
      return await handleSearch(req, res, url);
    }
    if (path === '/api/public/notebooks') {
      return await handleNotebooks(req, res);
    }
    if (path.startsWith('/api/public/notebooks/') && path.endsWith('/blocks')) {
      const boxId = path.split('/')[4];
      return await handleBlocks(req, res, boxId);
    }
    if (path.startsWith('/api/public/blocks/')) {
      const id = path.split('/')[4];
      return await handleBlock(req, res, id);
    }
    res.status(404).json({ error: 'not found' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}

async function handleSearch(req, res, url) {
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return res.json({ results: [] });

  const pool = getPool();
  try {
    const r = await pool.query(
      `SELECT id, box_id, type, markdown, tags, version, updated_at
       FROM blocks
       WHERE deleted=false AND box_id = ANY($1) AND markdown ILIKE $2
       ORDER BY updated_at DESC LIMIT 50`,
      [PUBLIC_BOX_IDS, `%${q}%`]
    );
    res.json({ results: r.rows });
  } finally {
    await pool.end();
  }
}

async function handleNotebooks(req, res) {
  const pool = getPool();
  try {
    const r = await pool.query(
      `SELECT box_id, COUNT(*) as block_count
       FROM blocks
       WHERE deleted=false AND box_id = ANY($1)
       GROUP BY box_id ORDER BY box_id`,
      [PUBLIC_BOX_IDS]
    );
    res.json({ notebooks: r.rows });
  } finally {
    await pool.end();
  }
}

async function handleBlocks(req, res, boxId) {
  if (!PUBLIC_BOX_IDS.includes(boxId)) {
    return res.status(403).json({ error: 'not in public list' });
  }
  const pool = getPool();
  try {
    const r = await pool.query(
      `SELECT id, type, markdown, tags, version, updated_at
       FROM blocks
       WHERE box_id=$1 AND deleted=false
       ORDER BY sort, updated_at`,
      [boxId]
    );
    res.json({ blocks: r.rows });
  } finally {
    await pool.end();
  }
}

async function handleBlock(req, res, id) {
  const pool = getPool();
  try {
    const r = await pool.query(
      `SELECT id, type, markdown, tags, version, updated_at, box_id
       FROM blocks WHERE id=$1 AND deleted=false`,
      [id]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'not found' });
    if (!PUBLIC_BOX_IDS.includes(r.rows[0].box_id)) {
      return res.status(403).json({ error: 'not in public list' });
    }
    res.json(r.rows[0]);
  } finally {
    await pool.end();
  }
}
