const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'davileles/cdv-compras-bonificadas';

const ALLOWED = ['comparemania.com.br', 'passageirodeprimeira.com'];

app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Fetch para análise de ofertas (sem restrição de domínio) ─────────────────
app.get('/fetch-oferta', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).json({ error: 'Parâmetro ?url= obrigatório' });
  if (!/^https?:\/\//i.test(target)) return res.status(400).json({ error: 'URL inválida' });

  try {
    const response = await fetch(target, {
      compress: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'identity',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 20000
    });
    if (!response.ok) return res.status(response.status).json({ error: `Destino retornou ${response.status}` });
    const html = await response.text();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Proxy de fetch (domínios restritos — usado pelo painel público) ───────────
app.get('/fetch', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).json({ error: 'Parâmetro ?url= obrigatório' });

  const isAllowed = ALLOWED.some(domain => target.includes(domain));
  if (!isAllowed) return res.status(403).json({ error: 'Domínio não permitido' });

  try {
    const response = await fetch(target, {
      compress: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'identity',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 15000
    });
    if (!response.ok) return res.status(response.status).json({ error: `Destino retornou ${response.status}` });
    const html = await response.text();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Salvar alerta ─────────────────────────────────────────────────────────────
app.post('/alerta', async (req, res) => {
  const { email, parceiro, programa, minPts } = req.body || {};

  if (!email || !parceiro || !programa || !minPts) {
    return res.status(400).json({ ok: false, erro: 'Campos obrigatórios: email, parceiro, programa, minPts' });
  }
  if (!GITHUB_TOKEN) {
    return res.status(500).json({ ok: false, erro: 'GITHUB_TOKEN não configurado no servidor' });
  }

  try {
    const apiBase = `https://api.github.com/repos/${GITHUB_REPO}/contents/alertas.json`;
    const headers = {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    };

    const getRes = await fetch(apiBase, { compress: false, headers });
    const getData = await getRes.json();
    const sha = getData.sha;
    const alertas = JSON.parse(Buffer.from(getData.content, 'base64').toString('utf8'));

    const idx = alertas.findIndex(a => a.email === email && a.parceiro === parceiro && a.programa === programa);
    if (idx >= 0) {
      alertas[idx].minPts = minPts;
      alertas[idx].atualizadoEm = new Date().toISOString();
    } else {
      alertas.push({ email, parceiro, programa, minPts, criadoEm: new Date().toISOString() });
    }

    const putRes = await fetch(apiBase, {
      compress: false,
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `chore: alerta ${email} → ${parceiro} (${programa} ≥ ${minPts} pts)`,
        content: Buffer.from(JSON.stringify(alertas, null, 2)).toString('base64'),
        sha
      })
    });

    if (putRes.ok) {
      res.json({ ok: true });
    } else {
      const err = await putRes.json();
      res.status(500).json({ ok: false, erro: err.message || 'Falha ao salvar no GitHub' });
    }
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// ── Helpers genéricos de leitura/escrita de arquivos JSON no GitHub ───────────
function ghHeaders() {
  return {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json'
  };
}

async function ghGetJson(filePath, fallback) {
  const apiBase = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`;
  const res = await fetch(apiBase, { compress: false, headers: ghHeaders() });
  if (res.status === 404) return { data: fallback, sha: null };
  const data = await res.json();
  if (!res.ok || !data.content) return { data: fallback, sha: null };
  try {
    return { data: JSON.parse(Buffer.from(data.content, 'base64').toString('utf8')), sha: data.sha };
  } catch (e) {
    return { data: fallback, sha: data.sha };
  }
}

async function ghPutJson(filePath, jsonData, sha, message) {
  const apiBase = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filePath}`;
  const body = {
    message,
    content: Buffer.from(JSON.stringify(jsonData, null, 2)).toString('base64'),
  };
  if (sha) body.sha = sha;
  const res = await fetch(apiBase, { compress: false, method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Falha ao salvar ${filePath} no GitHub (status ${res.status})`);
  }
  return res.json();
}

const OFERTAS_PENDENTES_PATH  = 'ofertas-pendentes.json';
const OFERTAS_APROVADAS_PATH  = 'ofertas.json';
const OFERTAS_REJEITADAS_PATH = 'ofertas-rejeitadas.json';
const PASSAGENS_PATH          = 'passagens.json';
const MAX_OFERTAS_APROVADAS   = 100;
const MAX_DIAS_PASSAGENS      = 180;

// ── Aprovar oferta pendente ───────────────────────────────────────────────────
app.post('/ofertas/aprovar', async (req, res) => {
  const { id, edits } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, erro: 'Campo obrigatório: id' });
  if (!GITHUB_TOKEN) return res.status(500).json({ ok: false, erro: 'GITHUB_TOKEN não configurado no servidor' });

  try {
    const pend = await ghGetJson(OFERTAS_PENDENTES_PATH, { geradoEm: null, items: [] });
    const idx = (pend.data.items || []).findIndex((o) => o.id === id);
    if (idx < 0) return res.status(404).json({ ok: false, erro: 'Oferta não encontrada nas pendentes (pode já ter sido processada)' });

    const item = { ...pend.data.items[idx], ...(edits || {}) };
    pend.data.items.splice(idx, 1);

    const aprov = await ghGetJson(OFERTAS_APROVADAS_PATH, { geradoEm: null, items: [] });
    const jaExiste = (aprov.data.items || []).some((o) => o.id === id);
    const novosAprovados = jaExiste
      ? aprov.data.items
      : [item, ...(aprov.data.items || [])].slice(0, MAX_OFERTAS_APROVADAS);

    await ghPutJson(
      OFERTAS_APROVADAS_PATH,
      { geradoEm: new Date().toISOString(), items: novosAprovados },
      aprov.sha,
      `chore: aprova oferta "${item.titulo || id}"`
    );
    await ghPutJson(
      OFERTAS_PENDENTES_PATH,
      { geradoEm: pend.data.geradoEm || new Date().toISOString(), items: pend.data.items },
      pend.sha,
      `chore: remove oferta aprovada "${item.titulo || id}" das pendentes`
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// ── Rejeitar oferta pendente ──────────────────────────────────────────────────
app.post('/ofertas/rejeitar', async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, erro: 'Campo obrigatório: id' });
  if (!GITHUB_TOKEN) return res.status(500).json({ ok: false, erro: 'GITHUB_TOKEN não configurado no servidor' });

  try {
    const rej = await ghGetJson(OFERTAS_REJEITADAS_PATH, []);
    const listaRejeitadas = Array.isArray(rej.data) ? rej.data : [];
    if (!listaRejeitadas.includes(id)) listaRejeitadas.push(id);
    await ghPutJson(OFERTAS_REJEITADAS_PATH, listaRejeitadas.slice(-1000), rej.sha, `chore: bloqueia oferta rejeitada ${id}`);

    const pend = await ghGetJson(OFERTAS_PENDENTES_PATH, { geradoEm: null, items: [] });
    const idx = (pend.data.items || []).findIndex((o) => o.id === id);
    if (idx >= 0) {
      pend.data.items.splice(idx, 1);
      await ghPutJson(
        OFERTAS_PENDENTES_PATH,
        { geradoEm: pend.data.geradoEm || new Date().toISOString(), items: pend.data.items },
        pend.sha,
        `chore: remove oferta rejeitada ${id} das pendentes`
      );
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// ── Publicar oferta diretamente no radar ──────────────────────────────────────
app.post('/ofertas/publicar', async (req, res) => {
  const oferta = req.body || {};
  if (!oferta.titulo) return res.status(400).json({ ok: false, erro: 'Campo obrigatório: titulo' });
  if (!GITHUB_TOKEN) return res.status(500).json({ ok: false, erro: 'GITHUB_TOKEN não configurado no servidor' });

  try {
    const raw = (oferta.titulo || '') + Date.now();
    let hash = 0;
    for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
    const id = hash.toString(36);

    const item = {
      id,
      titulo:            oferta.titulo || '',
      emoji:             oferta.emoji  || '📰',
      resumo:            oferta.resumo || oferta.descricao || '',
      programa:          oferta.programa || '',
      bonus:             oferta.bonus || '',
      prazo:             oferta.prazo || '',
      categoria:         oferta.categoria || 'geral',
      loja:              oferta.loja || '',
      cupom:             oferta.cupom || '',
      milheiro:          oferta.milheiro || '',
      tetoTransferencia: oferta.tetoTransferencia || '',
      importante:        oferta.importante || '',
      link:              oferta.link || '',
      restricoes:        Array.isArray(oferta.restricoes) ? oferta.restricoes : [],
      publicadoEm:       new Date().toISOString(),
    };

    const aprov = await ghGetJson(OFERTAS_APROVADAS_PATH, { geradoEm: null, items: [] });
    const jaExiste = (aprov.data.items || []).some(o => o.id === id);
    const novosItens = jaExiste
      ? aprov.data.items
      : [item, ...(aprov.data.items || [])].slice(0, 100);

    await ghPutJson(
      OFERTAS_APROVADAS_PATH,
      { geradoEm: new Date().toISOString(), items: novosItens },
      aprov.sha,
      `chore: publica oferta "${item.titulo}"`
    );

    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// ── Registrar passagem enviada ────────────────────────────────────────────────
// Chamado pelo gerador após envio bem-sucedido via Baileys (aba Emissão e Alertas)
// Body: { origem, destino, cia, programa, pontos, cabine, datas_ida, datas_volta, fonte }
// fonte: 'emissao' | 'alerta'
app.post('/passagens/registrar', async (req, res) => {
  const { origem, destino, cia, programa, pontos, cabine, datas_ida, datas_volta, fonte } = req.body || {};

  if (!origem || !destino || !programa || !pontos) {
    return res.status(400).json({ ok: false, erro: 'Campos obrigatórios: origem, destino, programa, pontos' });
  }
  if (!GITHUB_TOKEN) {
    return res.status(500).json({ ok: false, erro: 'GITHUB_TOKEN não configurado no servidor' });
  }

  try {
    // Gera ID estável baseado na rota + programa + pontos + timestamp
    const raw = `${origem}-${destino}-${programa}-${pontos}-${Date.now()}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
    const id = hash.toString(36);

    const agora = new Date().toISOString();

    const novaPassagem = {
      id,
      origem:      origem.trim(),
      destino:     destino.trim(),
      cia:         (cia || '').trim(),
      programa:    programa.trim(),
      pontos:      Number(pontos),
      cabine:      (cabine || '').trim(),
      datas_ida:   (datas_ida || '').trim(),
      datas_volta: (datas_volta || '').trim(),
      fonte:       fonte || 'emissao',
      enviadoEm:   agora,
    };

    // Lê passagens existentes
    const atual = await ghGetJson(PASSAGENS_PATH, { items: [] });
    let items = Array.isArray(atual.data.items) ? atual.data.items : [];

    // Remove passagens com mais de 180 dias
    const corteMs = Date.now() - MAX_DIAS_PASSAGENS * 24 * 60 * 60 * 1000;
    items = items.filter(p => new Date(p.enviadoEm).getTime() >= corteMs);

    // Adiciona nova passagem no início
    items.unshift(novaPassagem);

    await ghPutJson(
      PASSAGENS_PATH,
      { atualizadoEm: agora, items },
      atual.sha,
      `chore: registra passagem ${origem} → ${destino} (${programa} ${pontos} pts)`
    );

    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

// ── Excluir passagem ──────────────────────────────────────────────────────────
app.post('/passagens/excluir', async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, erro: 'Campo obrigatório: id' });
  if (!GITHUB_TOKEN) return res.status(500).json({ ok: false, erro: 'GITHUB_TOKEN não configurado no servidor' });

  try {
    const atual = await ghGetJson(PASSAGENS_PATH, { items: [] });
    const items = (atual.data.items || []).filter(p => p.id !== id);

    await ghPutJson(
      PASSAGENS_PATH,
      { atualizadoEm: new Date().toISOString(), items },
      atual.sha,
      `chore: remove passagem ${id}`
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, erro: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CDV Proxy rodando na porta ${PORT}`);
});
