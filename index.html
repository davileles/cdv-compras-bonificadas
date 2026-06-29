const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// URLs permitidas (whitelist de segurança)
const ALLOWED = [
  'comparemania.com.br'
];

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  next();
});

app.get('/fetch', async (req, res) => {
  const target = req.query.url;

  if (!target) {
    return res.status(400).json({ error: 'Parâmetro ?url= obrigatório' });
  }

  // Valida que a URL é permitida
  const isAllowed = ALLOWED.some(domain => target.includes(domain));
  if (!isAllowed) {
    return res.status(403).json({ error: 'Domínio não permitido' });
  }

  try {
    const response = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CDV-Panel/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9'
      },
      timeout: 15000
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Destino retornou ${response.status}` });
    }

    const html = await response.text();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(html);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`CDV Proxy rodando na porta ${PORT}`));
