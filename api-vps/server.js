const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3005;

const pool = new Pool({
    host: process.env.DB_HOST || 'db',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'fbelegance',
    user: process.env.DB_USER || 'fbelegance',
    password: process.env.DB_PASSWORD,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
    console.error('Unexpected PG error:', err);
});

const UPLOAD_DIR = '/app/uploads/produtos';

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(UPLOAD_DIR)) {
            fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        }
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const ext = file.originalname.split('.').pop();
        cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|webp|gif/;
        const ext = allowed.test(path.extname(file.originalname).toLowerCase());
        const mime = allowed.test(file.mimetype);
        if (ext && mime) return cb(null, true);
        cb(new Error('Apenas imagens são permitidas (jpg, png, webp, gif)'));
    }
});

app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
    const allowedOrigins = [
        'https://fbelegancelux.com.br',
        'https://www.fbelegancelux.com.br',
        'http://localhost:3000',
        'http://localhost:3002'
    ];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use('/uploads', express.static('/app/uploads'));


// ─── AUTENTICAÇÃO ────────────────────────────────────────────────────────────
//
// Até aqui a API não tinha autenticação alguma: qualquer pessoa podia
// chamar POST/PUT/DELETE e alterar o catálogo. A "senha" existia apenas
// no JavaScript do navegador, o que não protege nada — o painel era só
// escondido, e a API, aberta.
//
// O CORS acima NÃO é proteção: ele só instrui navegadores. Um `curl`
// ignora CORS por completo, então a verificação precisa acontecer aqui.

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('[fbelegance] JWT_SECRET não definido — recusando iniciar. ' +
        'Sem ele qualquer token seria aceito ou nenhum seria emitido.');
    process.exit(1);
}

const TOKEN_TTL = '12h';

/** Áreas do painel que podem ser liberadas individualmente por usuário.
 *  Um 'admin' tem todas por definição e não depende desta lista. */
const PERMISSOES_VALIDAS = ['produtos', 'categorias', 'marcas', 'tamanhos', 'config', 'feedbacks', 'propostas'];

function gerarToken(usuario) {
    return jwt.sign(
        {
            sub: usuario.id,
            email: usuario.email,
            papel: usuario.papel,
            nome: usuario.nome
        },
        JWT_SECRET,
        { expiresIn: TOKEN_TTL }
    );
}

/** Exige um token válido de um usuário que ainda esteja ativo.
 *
 *  O estado é relido do banco a cada requisição de propósito: um token
 *  válido de 12h continuaria funcionando depois de o admin desativar a
 *  conta ou remover permissões, e "desativar" precisa ter efeito
 *  imediato para servir de resposta a um incidente. */
async function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Não autenticado' });

    let payload;
    try {
        payload = jwt.verify(token, JWT_SECRET);
    } catch (e) {
        return res.status(401).json({ error: 'Sessão inválida ou expirada' });
    }

    try {
        const { rows } = await pool.query(
            'SELECT id, nome, email, papel, ativo, permissoes FROM usuarios WHERE id = $1',
            [payload.sub]
        );
        const u = rows[0];
        if (!u) return res.status(401).json({ error: 'Usuário não encontrado' });
        if (!u.ativo) return res.status(403).json({ error: 'Usuário desativado' });
        req.usuario = u;
        next();
    } catch (err) {
        console.error('[auth] erro ao carregar usuário:', err);
        res.status(500).json({ error: 'Erro interno de autenticação' });
    }
}

/** Exige uma permissão específica. Admin passa sempre. */
function requirePermissao(area) {
    return (req, res, next) => {
        const u = req.usuario;
        if (!u) return res.status(401).json({ error: 'Não autenticado' });
        if (u.papel === 'admin') return next();
        const permissoes = Array.isArray(u.permissoes) ? u.permissoes : [];
        if (permissoes.includes(area)) return next();
        return res.status(403).json({ error: `Sem permissão para: ${area}` });
    };
}

/** Só admin — usado na gestão de usuários. */
function requireAdmin(req, res, next) {
    if (!req.usuario) return res.status(401).json({ error: 'Não autenticado' });
    if (req.usuario.papel !== 'admin') {
        return res.status(403).json({ error: 'Apenas administradores' });
    }
    next();
}

app.post('/api/auth/login', async (req, res) => {
    const { email, senha } = req.body || {};
    if (!email || !senha) {
        return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
    }
    try {
        const { rows } = await pool.query(
            'SELECT * FROM usuarios WHERE lower(email) = lower($1)',
            [String(email).trim()]
        );
        const u = rows[0];

        // Mesma mensagem para e-mail inexistente e senha errada: dizer
        // qual dos dois falhou permite descobrir quais e-mails têm conta.
        // O compare roda mesmo sem usuário para o tempo de resposta não
        // denunciar a diferença.
        const hash = u ? u.senha_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidiu';
        const ok = await bcrypt.compare(String(senha), hash);
        if (!u || !ok) {
            return res.status(401).json({ error: 'E-mail ou senha incorretos' });
        }
        if (!u.ativo) {
            return res.status(403).json({ error: 'Usuário desativado. Fale com o administrador.' });
        }

        await pool.query('UPDATE usuarios SET ultimo_login = now() WHERE id = $1', [u.id]);

        res.json({
            token: gerarToken(u),
            usuario: {
                id: u.id,
                nome: u.nome,
                email: u.email,
                papel: u.papel,
                permissoes: u.permissoes || []
            }
        });
    } catch (err) {
        console.error('[auth] erro no login:', err);
        res.status(500).json({ error: 'Erro ao entrar' });
    }
});

/** Quem sou eu — o painel chama no carregamento para revalidar o token
 *  guardado no navegador e redesenhar as abas conforme as permissões. */
app.get('/api/auth/me', requireAuth, (req, res) => {
    const u = req.usuario;
    res.json({
        id: u.id, nome: u.nome, email: u.email,
        papel: u.papel, permissoes: u.permissoes || [],
        permissoesDisponiveis: PERMISSOES_VALIDAS
    });
});

app.post('/api/auth/trocar-senha', requireAuth, async (req, res) => {
    const { senhaAtual, novaSenha } = req.body || {};
    if (!senhaAtual || !novaSenha) {
        return res.status(400).json({ error: 'Informe a senha atual e a nova' });
    }
    if (String(novaSenha).length < 8) {
        return res.status(400).json({ error: 'A nova senha precisa ter ao menos 8 caracteres' });
    }
    try {
        const { rows } = await pool.query('SELECT senha_hash FROM usuarios WHERE id = $1', [req.usuario.id]);
        const ok = await bcrypt.compare(String(senhaAtual), rows[0].senha_hash);
        if (!ok) return res.status(401).json({ error: 'Senha atual incorreta' });
        const hash = await bcrypt.hash(String(novaSenha), 10);
        await pool.query('UPDATE usuarios SET senha_hash = $1 WHERE id = $2', [hash, req.usuario.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('[auth] erro ao trocar senha:', err);
        res.status(500).json({ error: 'Erro ao trocar a senha' });
    }
});

// ─── USUÁRIOS (somente admin) ────────────────────────────────────────────────

app.get('/api/usuarios', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, nome, email, papel, ativo, permissoes, ultimo_login, created_at
             FROM usuarios ORDER BY created_at ASC`
        );
        res.json({ usuarios: rows, permissoesDisponiveis: PERMISSOES_VALIDAS });
    } catch (err) {
        console.error('[usuarios] erro ao listar:', err);
        res.status(500).json({ error: 'Erro ao listar usuários' });
    }
});

app.post('/api/usuarios', requireAuth, requireAdmin, async (req, res) => {
    const { nome, email, senha, papel, permissoes } = req.body || {};
    if (!nome || !email || !senha) {
        return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios' });
    }
    if (String(senha).length < 8) {
        return res.status(400).json({ error: 'A senha precisa ter ao menos 8 caracteres' });
    }
    const papelFinal = papel === 'admin' ? 'admin' : 'usuario';
    const permsFinal = Array.isArray(permissoes)
        ? permissoes.filter((p) => PERMISSOES_VALIDAS.includes(p))
        : [];
    try {
        const hash = await bcrypt.hash(String(senha), 10);
        const { rows } = await pool.query(
            `INSERT INTO usuarios (nome, email, senha_hash, papel, permissoes)
             VALUES ($1, $2, $3, $4, $5::jsonb)
             RETURNING id, nome, email, papel, ativo, permissoes, created_at`,
            [String(nome).trim(), String(email).trim(), hash, papelFinal, JSON.stringify(permsFinal)]
        );
        res.status(201).json(rows[0]);
    } catch (err) {
        if (err && err.code === '23505') {
            return res.status(409).json({ error: 'Já existe um usuário com esse e-mail' });
        }
        console.error('[usuarios] erro ao criar:', err);
        res.status(500).json({ error: 'Erro ao criar usuário' });
    }
});

app.put('/api/usuarios/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { nome, papel, ativo, permissoes, novaSenha } = req.body || {};
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });

    // Trava contra o admin se trancar para fora: desativar a própria
    // conta, ou rebaixar o último admin, deixaria o painel sem ninguém
    // capaz de gerenciar usuários — e não há caminho de recuperação
    // pela interface.
    if (id === req.usuario.id && (ativo === false || papel === 'usuario')) {
        return res.status(400).json({
            error: 'Você não pode desativar nem rebaixar a própria conta de administrador'
        });
    }
    try {
        if (papel === 'usuario' || ativo === false) {
            const { rows: admins } = await pool.query(
                "SELECT id FROM usuarios WHERE papel = 'admin' AND ativo = TRUE AND id <> $1",
                [id]
            );
            if (admins.length === 0) {
                return res.status(400).json({
                    error: 'Este é o último administrador ativo — promova outro antes de alterá-lo'
                });
            }
        }

        const campos = [];
        const valores = [];
        let i = 1;
        if (typeof nome === 'string' && nome.trim()) { campos.push(`nome = $${i++}`); valores.push(nome.trim()); }
        if (papel === 'admin' || papel === 'usuario') { campos.push(`papel = $${i++}`); valores.push(papel); }
        if (typeof ativo === 'boolean') { campos.push(`ativo = $${i++}`); valores.push(ativo); }
        if (Array.isArray(permissoes)) {
            campos.push(`permissoes = $${i++}::jsonb`);
            valores.push(JSON.stringify(permissoes.filter((p) => PERMISSOES_VALIDAS.includes(p))));
        }
        if (typeof novaSenha === 'string' && novaSenha) {
            if (novaSenha.length < 8) {
                return res.status(400).json({ error: 'A senha precisa ter ao menos 8 caracteres' });
            }
            campos.push(`senha_hash = $${i++}`);
            valores.push(await bcrypt.hash(novaSenha, 10));
        }
        if (campos.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });

        valores.push(id);
        const { rows } = await pool.query(
            `UPDATE usuarios SET ${campos.join(', ')} WHERE id = $${i}
             RETURNING id, nome, email, papel, ativo, permissoes, ultimo_login, created_at`,
            valores
        );
        if (!rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
        res.json(rows[0]);
    } catch (err) {
        console.error('[usuarios] erro ao atualizar:', err);
        res.status(500).json({ error: 'Erro ao atualizar usuário' });
    }
});

app.delete('/api/usuarios/:id', requireAuth, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
    if (id === req.usuario.id) {
        return res.status(400).json({ error: 'Você não pode excluir a própria conta' });
    }
    try {
        const { rowCount } = await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
        if (!rowCount) return res.status(404).json({ error: 'Usuário não encontrado' });
        res.json({ success: true });
    } catch (err) {
        console.error('[usuarios] erro ao excluir:', err);
        res.status(500).json({ error: 'Erro ao excluir usuário' });
    }
});

// ─── PRODUTOS ────────────────────────────────────────────────────────────────

app.get('/api/produtos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM produtos ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/produtos error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/produtos/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM produtos WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Produto não encontrado' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('GET /api/produtos/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/produtos', requireAuth, requirePermissao('produtos'), upload.array('images', 10), async (req, res) => {
    try {
        const { nome, descricao_completa, preco, categoria, status, tamanhos, numeracao, marca, mais_procurado } = req.body;

        if (!nome || !nome.trim()) {
            return res.status(400).json({ error: 'Nome é obrigatório' });
        }

        let imageUrls = [];
        if (req.files && req.files.length) {
            for (const file of req.files) {
                imageUrls.push(`${getBaseUrl(req)}/uploads/produtos/${file.filename}`);
            }
        }

        if (imageUrls.length === 0) {
            return res.status(400).json({ error: 'Pelo menos uma imagem é obrigatória' });
        }

        let parsedTamanhos = null;
        if (tamanhos) {
            parsedTamanhos = typeof tamanhos === 'string' ? JSON.parse(tamanhos) : tamanhos;
        }

        const result = await pool.query(
            `INSERT INTO produtos (nome, descricao_completa, preco, images, categoria, status, tamanhos, numeracao, marca, mais_procurado)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [
                nome.trim(),
                descricao_completa || '',
                preco || 'R$ 0,00',
                JSON.stringify(imageUrls),
                categoria || 'casacos',
                status || 'disponiveis',
                parsedTamanhos ? JSON.stringify(parsedTamanhos) : null,
                numeracao || null,
                marca || null,
                mais_procurado === 'true'
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('POST /api/produtos error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Ordem de exibição definida manualmente pelo admin (arrastar e soltar na
// aba Estoque). Precisa vir ANTES de PUT /api/produtos/:id, senão o Express
// casaria "reorder" com o parâmetro :id dessa rota.
app.put('/api/produtos/reorder', requireAuth, requirePermissao('produtos'), async (req, res) => {
    try {
        const { order } = req.body;
        if (!Array.isArray(order) || !order.length) {
            return res.status(400).json({ error: 'order deve ser um array de ids' });
        }
        await Promise.all(order.map((id, idx) =>
            pool.query('UPDATE produtos SET ordem = $1 WHERE id = $2', [idx, id])
        ));
        res.json({ success: true });
    } catch (err) {
        console.error('PUT /api/produtos/reorder error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/produtos/:id', requireAuth, requirePermissao('produtos'), upload.array('newImages', 10), async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, descricao_completa, preco, categoria, status, tamanhos, numeracao, existingImages, marca, mais_procurado } = req.body;

        const current = await pool.query('SELECT * FROM produtos WHERE id = $1', [id]);
        if (current.rows.length === 0) {
            return res.status(404).json({ error: 'Produto não encontrado' });
        }

        let oldImages = [];
        if (existingImages) {
            oldImages = JSON.parse(existingImages);
        } else {
            oldImages = current.rows[0].images || [];
        }

        let newImageUrls = [];
        if (req.files && req.files.length) {
            for (const file of req.files) {
                newImageUrls.push(`${getBaseUrl(req)}/uploads/produtos/${file.filename}`);
            }
        }

        const allImages = [...oldImages, ...newImageUrls];

        let parsedTamanhos = null;
        if (tamanhos) {
            parsedTamanhos = typeof tamanhos === 'string' ? JSON.parse(tamanhos) : tamanhos;
        }

        const result = await pool.query(
            `UPDATE produtos SET
                nome = COALESCE($1, nome),
                descricao_completa = COALESCE($2, descricao_completa),
                preco = COALESCE($3, preco),
                images = $4,
                categoria = COALESCE($5, categoria),
                status = COALESCE($6, status),
                tamanhos = $7,
                numeracao = $8,
                marca = $9,
                mais_procurado = COALESCE($10, mais_procurado)
             WHERE id = $11 RETURNING *`,
            [
                nome || null,
                descricao_completa || null,
                preco || null,
                JSON.stringify(allImages),
                categoria || null,
                status || null,
                parsedTamanhos ? JSON.stringify(parsedTamanhos) : null,
                numeracao || null,
                marca || null,
                mais_procurado === undefined ? null : mais_procurado === 'true',
                id
            ]
        );

        res.json(result.rows[0]);
    } catch (err) {
        console.error('PUT /api/produtos/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/produtos/:id', requireAuth, requirePermissao('produtos'), async (req, res) => {
    try {
        const current = await pool.query('SELECT images FROM produtos WHERE id = $1', [req.params.id]);
        if (current.rows.length > 0) {
            const images = current.rows[0].images || [];
            for (const imgUrl of images) {
                const filename = imgUrl.split('/').pop();
                const filepath = path.join(UPLOAD_DIR, filename);
                if (fs.existsSync(filepath)) {
                    fs.unlinkSync(filepath);
                }
            }
        }

        await pool.query('DELETE FROM produtos WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('DELETE /api/produtos/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── MARCAS (filtro por categoria) ───────────────────────────────────────────
// Antes vivia hardcoded no front (BRANDS_BY_CAT, script.js) — cada marca nova
// exigia editar o código-fonte. Agora é dado de verdade no banco, gerenciável
// pelo admin (aba Categorias). categoria+nome é único: adicionar uma marca já
// cadastrada não duplica, só devolve a existente.

app.get('/api/brands', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, categoria, nome FROM brands ORDER BY categoria, nome');
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/brands error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/brands', requireAuth, requirePermissao('marcas'), async (req, res) => {
    try {
        const { categoria, nome } = req.body;
        if (!categoria || !nome || !String(nome).trim()) {
            return res.status(400).json({ error: 'categoria e nome são obrigatórios' });
        }
        const nomeTrim = String(nome).trim();
        const inserted = await pool.query(
            `INSERT INTO brands (categoria, nome) VALUES ($1, $2)
             ON CONFLICT (categoria, nome) DO NOTHING RETURNING *`,
            [categoria, nomeTrim]
        );
        if (inserted.rows.length > 0) {
            return res.status(201).json(inserted.rows[0]);
        }
        // Já existia (conflito) — devolve a linha existente, sem duplicar nem dar erro.
        const existing = await pool.query('SELECT * FROM brands WHERE categoria = $1 AND nome = $2', [categoria, nomeTrim]);
        res.json(existing.rows[0]);
    } catch (err) {
        console.error('POST /api/brands error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/brands/:id', requireAuth, requirePermissao('marcas'), async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM brands WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Marca não encontrada' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error('DELETE /api/brands/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── CATEGORIAS (antes hardcoded no front: CATS/ADM_CATS/ADM_ICONS/         ──
// TAMANHO_CATS/CAT_IMAGE_FIELDS em script.js) — agora dado de verdade no
// banco, gerenciável pelo admin (aba Categorias). size_mode define se o
// produto dessa categoria usa seletor de tamanho ('tamanho'), numeração
// ('numero') ou nenhum ('nenhum').

app.get('/api/categories', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM categories ORDER BY sort_order, id');
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/categories error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/categories', requireAuth, requirePermissao('categorias'), upload.single('cover_image'), async (req, res) => {
    try {
        const { slug, label, icon, size_mode, sort_order } = req.body;
        if (!slug || !String(slug).trim() || !label || !String(label).trim()) {
            return res.status(400).json({ error: 'slug e label são obrigatórios' });
        }
        const coverImage = req.file ? `${getBaseUrl(req)}/uploads/produtos/${req.file.filename}` : null;
        const result = await pool.query(
            `INSERT INTO categories (slug, label, icon, size_mode, cover_image, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [
                String(slug).trim(),
                String(label).trim(),
                icon || 'ti-tag',
                size_mode || 'nenhum',
                coverImage,
                Number.isFinite(parseInt(sort_order, 10)) ? parseInt(sort_order, 10) : 0
            ]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'Já existe uma categoria com esse slug' });
        }
        console.error('POST /api/categories error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/categories/:id', requireAuth, requirePermissao('categorias'), upload.single('cover_image'), async (req, res) => {
    try {
        const { id } = req.params;
        const current = await pool.query('SELECT * FROM categories WHERE id = $1', [id]);
        if (current.rows.length === 0) {
            return res.status(404).json({ error: 'Categoria não encontrada' });
        }
        const cur = current.rows[0];
        const { slug, label, icon, size_mode, sort_order } = req.body;
        const coverImage = req.file ? `${getBaseUrl(req)}/uploads/produtos/${req.file.filename}` : cur.cover_image;

        const result = await pool.query(
            `UPDATE categories SET
                slug = $1, label = $2, icon = $3, size_mode = $4, cover_image = $5, sort_order = $6
             WHERE id = $7 RETURNING *`,
            [
                slug ? String(slug).trim() : cur.slug,
                label ? String(label).trim() : cur.label,
                icon || cur.icon,
                size_mode || cur.size_mode,
                coverImage,
                sort_order !== undefined && Number.isFinite(parseInt(sort_order, 10)) ? parseInt(sort_order, 10) : cur.sort_order,
                id
            ]
        );

        // Imagem antiga substituída por upload novo: remove do disco (mesmo
        // princípio já usado em produtos/config).
        if (req.file && cur.cover_image) {
            const filename = cur.cover_image.split('/').pop();
            const filepath = path.join(UPLOAD_DIR, filename);
            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        }

        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'Já existe uma categoria com esse slug' });
        }
        console.error('PUT /api/categories/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Nunca apaga uma categoria ainda usada por produtos existentes — protege
// contra perda de referência (produtos ficariam com categoria "órfã").
app.delete('/api/categories/:id', requireAuth, requirePermissao('categorias'), async (req, res) => {
    try {
        const current = await pool.query('SELECT slug FROM categories WHERE id = $1', [req.params.id]);
        if (current.rows.length === 0) {
            return res.status(404).json({ error: 'Categoria não encontrada' });
        }
        const { slug } = current.rows[0];
        const inUse = await pool.query('SELECT COUNT(*) FROM produtos WHERE categoria = $1', [slug]);
        if (parseInt(inUse.rows[0].count, 10) > 0) {
            return res.status(409).json({ error: `Categoria em uso por ${inUse.rows[0].count} produto(s). Mova ou remova os produtos antes de excluir a categoria.` });
        }
        await pool.query('DELETE FROM categories WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('DELETE /api/categories/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── ESCALAS DE TAMANHO/NUMERAÇÃO (antes hardcoded: SIZES/NUMEROS em       ──
// script.js) — valores possíveis para os seletores de tamanho (modo=
// 'tamanho') e numeração de calçados (modo='numero') no formulário de
// produto, agora gerenciáveis pelo admin.

app.get('/api/size-options', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM size_options ORDER BY modo, sort_order, id');
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/size-options error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/size-options', requireAuth, requirePermissao('tamanhos'), async (req, res) => {
    try {
        const { modo, valor, sort_order } = req.body;
        if (!modo || !valor || !String(valor).trim()) {
            return res.status(400).json({ error: 'modo e valor são obrigatórios' });
        }
        const valorTrim = String(valor).trim();
        const inserted = await pool.query(
            `INSERT INTO size_options (modo, valor, sort_order) VALUES ($1, $2, $3)
             ON CONFLICT (modo, valor) DO NOTHING RETURNING *`,
            [modo, valorTrim, Number.isFinite(parseInt(sort_order, 10)) ? parseInt(sort_order, 10) : 0]
        );
        if (inserted.rows.length > 0) {
            return res.status(201).json(inserted.rows[0]);
        }
        const existing = await pool.query('SELECT * FROM size_options WHERE modo = $1 AND valor = $2', [modo, valorTrim]);
        res.json(existing.rows[0]);
    } catch (err) {
        console.error('POST /api/size-options error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/size-options/:id', requireAuth, requirePermissao('tamanhos'), async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM size_options WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Opção não encontrada' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error('DELETE /api/size-options/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── UPLOAD AVULSO ──────────────────────────────────────────────────────────

app.post('/api/upload', requireAuth, upload.single('imagem'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }
    res.json({ url: `${getBaseUrl(req)}/uploads/produtos/${req.file.filename}` });
});

// ─── FEEDBACKS DE CLIENTES ──────────────────────────────────────────────────
//
// Dois formatos na mesma lista, escolhidos item a item: print da
// conversa (imagem) ou depoimento escrito (texto + nome). O que é
// obrigatório muda conforme o tipo, então a checagem fica aqui — o
// banco aceita os dois nulos porque não sabe qual é qual.

function validarFeedback(body, arquivo, atual) {
    const tipo = (body.tipo || atual?.tipo || 'print').trim();
    if (!['print', 'texto'].includes(tipo)) {
        return { erro: 'Tipo deve ser "print" ou "texto"' };
    }
    const texto = body.texto !== undefined ? String(body.texto).trim() : (atual?.texto || '');
    const nome = body.nome !== undefined ? String(body.nome).trim() : (atual?.nome || '');
    const imagem = arquivo
        ? null // preenchido pelo chamador, que conhece a baseUrl
        : (body.imagem !== undefined ? String(body.imagem).trim() : (atual?.imagem || ''));

    if (tipo === 'print' && !arquivo && !imagem) {
        return { erro: 'Um feedback do tipo "print" precisa de uma imagem' };
    }
    if (tipo === 'texto' && !texto) {
        return { erro: 'Um feedback do tipo "texto" precisa do depoimento escrito' };
    }
    if (texto.length > 1000) {
        return { erro: 'O depoimento passa de 1000 caracteres' };
    }
    return {
        tipo,
        texto: texto || null,
        nome: nome || null,
        cidade: body.cidade !== undefined ? String(body.cidade).trim() || null : (atual?.cidade || null),
        imagem: imagem || null
    };
}

// Público — só os ativos, na ordem definida pelo painel.
app.get('/api/feedbacks', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, tipo, imagem, texto, nome, cidade FROM feedbacks WHERE ativo = TRUE ORDER BY ordem ASC, id ASC'
        );
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/feedbacks error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Painel — inclui os desativados, que o site não mostra.
app.get('/api/feedbacks/todos', requireAuth, requirePermissao('feedbacks'), async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM feedbacks ORDER BY ordem ASC, id ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/feedbacks/todos error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/feedbacks', requireAuth, requirePermissao('feedbacks'), upload.single('imagem'), async (req, res) => {
    try {
        const v = validarFeedback(req.body, req.file, null);
        if (v.erro) return res.status(400).json({ error: v.erro });

        const imagem = req.file
            ? `${getBaseUrl(req)}/uploads/produtos/${req.file.filename}`
            : v.imagem;

        const result = await pool.query(
            `INSERT INTO feedbacks (tipo, imagem, texto, nome, cidade, ordem, ativo)
             VALUES ($1, $2, $3, $4, $5,
                     COALESCE((SELECT MAX(ordem) + 1 FROM feedbacks), 0), TRUE)
             RETURNING *`,
            [v.tipo, imagem, v.texto, v.nome, v.cidade]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('POST /api/feedbacks error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/feedbacks/:id', requireAuth, requirePermissao('feedbacks'), upload.single('imagem'), async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM feedbacks WHERE id = $1', [req.params.id]);
        const atual = rows[0];
        if (!atual) return res.status(404).json({ error: 'Feedback não encontrado' });

        const v = validarFeedback(req.body, req.file, atual);
        if (v.erro) return res.status(400).json({ error: v.erro });

        const imagem = req.file
            ? `${getBaseUrl(req)}/uploads/produtos/${req.file.filename}`
            : v.imagem;

        const result = await pool.query(
            `UPDATE feedbacks
                SET tipo = $1, imagem = $2, texto = $3, nome = $4, cidade = $5,
                    ordem = $6, ativo = $7
              WHERE id = $8
              RETURNING *`,
            [
                v.tipo, imagem, v.texto, v.nome, v.cidade,
                req.body.ordem !== undefined ? parseInt(req.body.ordem, 10) || 0 : atual.ordem,
                req.body.ativo !== undefined ? req.body.ativo === 'true' || req.body.ativo === true : atual.ativo,
                req.params.id
            ]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('PUT /api/feedbacks/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/feedbacks/:id', requireAuth, requirePermissao('feedbacks'), async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM feedbacks WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Feedback não encontrado' });
        res.json({ success: true });
    } catch (err) {
        console.error('DELETE /api/feedbacks/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});


// ─── PROPOSTAS DE VENDA (página /vender) ────────────────────────────────────
//
// Este é o único POST da API aberto a quem não fez login, e ele aceita
// arquivo. Isso o torna a superfície mais exposta do sistema: sem
// limite, uma única pessoa enche o disco da VPS com uploads e derruba
// junto o site e o banco, que dividem o mesmo volume.
//
// Daí as três barreiras abaixo, nesta ordem de propósito:
//   1. limite por IP  — antes do multer, senão o arquivo já foi gravado
//                       em disco quando a recusa acontece;
//   2. limite de fotos e de tamanho — o multer já corta em 8MB/arquivo;
//   3. limite de texto — evita gravar megabytes em campo livre.
//
// A contagem por IP vive em memória e zera quando o container
// reinicia. Para o volume desta loja isso basta: o objetivo é conter
// abuso casual, não um ataque coordenado — e o custo de acertar isso
// com Redis não se paga aqui.

const PROPOSTA_JANELA_MS = 60 * 60 * 1000;
const PROPOSTA_MAX_POR_JANELA = 3;
const PROPOSTA_MAX_FOTOS = 6;
const propostasPorIp = new Map();

function limitarPropostas(req, res, next) {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'desconhecido';
    const agora = Date.now();

    // Varre o mapa inteiro a cada envio para não vazar memória com IPs
    // que apareceram uma vez e nunca mais. São poucas entradas — o
    // limite é de 3 por hora.
    for (const [chave, marcas] of propostasPorIp) {
        const vivas = marcas.filter(t => agora - t < PROPOSTA_JANELA_MS);
        if (vivas.length) propostasPorIp.set(chave, vivas);
        else propostasPorIp.delete(chave);
    }

    const recentes = propostasPorIp.get(ip) || [];
    if (recentes.length >= PROPOSTA_MAX_POR_JANELA) {
        return res.status(429).json({
            error: 'Você já enviou algumas propostas agora há pouco. Tente novamente mais tarde ou fale com a gente pelo WhatsApp.'
        });
    }
    propostasPorIp.set(ip, [...recentes, agora]);
    next();
}

/** Corta e limpa um campo de texto vindo de fora do painel. */
function campoPublico(valor, max) {
    if (valor === undefined || valor === null) return null;
    const s = String(valor).trim();
    if (!s) return null;
    return s.slice(0, max);
}

app.post('/api/propostas', limitarPropostas, upload.array('imagens', PROPOSTA_MAX_FOTOS), async (req, res) => {
    try {
        const nome = campoPublico(req.body.nome, 120);
        const telefone = campoPublico(req.body.telefone, 40);
        const peca = campoPublico(req.body.peca, 160);

        if (!nome || !telefone || !peca) {
            return res.status(400).json({ error: 'Nome, telefone e peça são obrigatórios' });
        }

        const imagens = (req.files || []).map(f => `${getBaseUrl(req)}/uploads/produtos/${f.filename}`);

        const result = await pool.query(
            `INSERT INTO propostas (nome, telefone, marca, peca, tamanho, estado, valor, observacoes, imagens)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, created_at`,
            [
                nome,
                telefone,
                campoPublico(req.body.marca, 80),
                peca,
                campoPublico(req.body.tamanho, 40),
                campoPublico(req.body.estado, 40),
                campoPublico(req.body.valor, 40),
                campoPublico(req.body.observacoes, 1000),
                JSON.stringify(imagens)
            ]
        );
        // Devolve só o recibo: a proposta inteira não interessa a quem
        // enviou, e ecoar os dados de volta só amplia o que um envio
        // forjado consegue observar.
        res.status(201).json({ success: true, id: result.rows[0].id });
    } catch (err) {
        console.error('POST /api/propostas error:', err);
        res.status(500).json({ error: 'Não foi possível registrar sua proposta' });
    }
});

app.get('/api/propostas', requireAuth, requirePermissao('propostas'), async (req, res) => {
    try {
        const { status } = req.query;
        const filtrar = ['aguardando', 'aprovada', 'recusada'].includes(status);
        const result = await pool.query(
            filtrar
                ? 'SELECT * FROM propostas WHERE status = $1 ORDER BY created_at DESC'
                : 'SELECT * FROM propostas ORDER BY created_at DESC',
            filtrar ? [status] : []
        );
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/propostas error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/propostas/:id', requireAuth, requirePermissao('propostas'), async (req, res) => {
    try {
        const { status } = req.body || {};
        if (!['aguardando', 'aprovada', 'recusada'].includes(status)) {
            return res.status(400).json({ error: 'Status inválido' });
        }
        const result = await pool.query(
            'UPDATE propostas SET status = $1 WHERE id = $2 RETURNING *',
            [status, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Proposta não encontrada' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('PUT /api/propostas/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

/** Telefone no formato que o wa.me aceita: só dígitos, com o 55 na
 *  frente. As pessoas digitam "(43) 99617-9533", "+55 43 99617 9533" e
 *  "43996179533" no mesmo campo, e o link precisa dos três iguais. */
function telefoneParaWhatsApp(bruto) {
    const digitos = String(bruto || '').replace(/\D/g, '');
    if (!digitos) return null;
    // 10 (fixo com DDD) ou 11 (celular com DDD) → falta o país.
    if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
    return digitos;
}

/**
 * Publica uma proposta como peça do catálogo.
 *
 * Reaproveita as fotos que o cliente já enviou — elas estão na mesma
 * pasta das fotos de produto, então basta copiar as URLs. Sem isto, o
 * caminho seria rebaixar e reenviar as mesmas imagens, duplicando
 * arquivo no disco por nada.
 *
 * Exige permissão de `produtos`, e não de `propostas`: o que acontece
 * aqui é a criação de uma peça no catálogo. Quem só cuida da fila de
 * propostas responde e recusa, mas não publica.
 *
 * As duas gravações vão numa transação porque precisam concordar: uma
 * peça publicada cuja proposta continua "aguardando" reapareceria na
 * fila para ser publicada de novo.
 */
app.post('/api/propostas/:id/publicar', requireAuth, requirePermissao('produtos'), async (req, res) => {
    const { categoria, preco, nome, marca, tamanhos, numeracao, descricao_completa } = req.body || {};

    if (!categoria || !String(categoria).trim()) {
        return res.status(400).json({ error: 'Escolha a categoria da peça' });
    }
    if (!preco || !String(preco).trim()) {
        return res.status(400).json({ error: 'Informe o preço de venda' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows } = await client.query('SELECT * FROM propostas WHERE id = $1 FOR UPDATE', [req.params.id]);
        const proposta = rows[0];
        if (!proposta) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Proposta não encontrada' });
        }

        const jaPublicada = await client.query('SELECT id FROM produtos WHERE proposta_id = $1', [proposta.id]);
        if (jaPublicada.rows.length) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Esta proposta já virou uma peça do catálogo' });
        }

        // `slug` no banco é o que o resto do sistema chama de `value`
        // (ver o mapeamento na carga de categorias do script.js) e é o
        // que fica gravado em produtos.categoria.
        const catValida = await client.query('SELECT 1 FROM categories WHERE slug = $1', [String(categoria).trim()]);
        if (!catValida.rows.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Categoria inexistente' });
        }

        const imagens = Array.isArray(proposta.imagens) ? proposta.imagens : [];
        if (!imagens.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Esta proposta não tem foto — não dá para publicar sem imagem' });
        }

        let tamanhosLista = null;
        if (tamanhos) {
            tamanhosLista = typeof tamanhos === 'string' ? JSON.parse(tamanhos) : tamanhos;
        }

        const produto = await client.query(
            `INSERT INTO produtos
               (nome, descricao_completa, preco, images, categoria, status, tamanhos, numeracao, marca,
                vendedor_telefone, proposta_id)
             VALUES ($1, $2, $3, $4, $5, 'disponiveis', $6, $7, $8, $9, $10)
             RETURNING *`,
            [
                String(nome || proposta.peca).trim(),
                descricao_completa !== undefined ? descricao_completa : (proposta.observacoes || null),
                String(preco).trim(),
                JSON.stringify(imagens),
                String(categoria).trim(),
                tamanhosLista ? JSON.stringify(tamanhosLista) : null,
                numeracao !== undefined ? numeracao : null,
                marca !== undefined ? marca : (proposta.marca || null),
                telefoneParaWhatsApp(proposta.telefone),
                proposta.id
            ]
        );

        await client.query("UPDATE propostas SET status = 'aprovada' WHERE id = $1", [proposta.id]);
        await client.query('COMMIT');

        res.status(201).json(produto.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('POST /api/propostas/:id/publicar error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.delete('/api/propostas/:id', requireAuth, requirePermissao('propostas'), async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM propostas WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Proposta não encontrada' });
        res.json({ success: true });
    } catch (err) {
        console.error('DELETE /api/propostas/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});


// ─── CONFIGURAÇÕES DO SITE (capa) ────────────────────────────────────────────

app.get('/api/config', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM config WHERE id = 1');
        res.json(result.rows[0] || {});
    } catch (err) {
        console.error('GET /api/config error:', err);
        res.status(500).json({ error: err.message });
    }
});

const CONFIG_IMAGE_FIELDS = ['hero_image', 'cat_img_casacos', 'cat_img_camisetas', 'cat_img_shorts', 'cat_img_calcados', 'cat_img_acessorios', 'cat_img_perfumes', 'feat_image', 'feature_banner_image', 'sobre_imagem'];
const CONFIG_TEXT_FIELDS = ['hero_eyebrow', 'hero_title1', 'hero_title2', 'hero_title3', 'hero_desc', 'hero_tag_eyebrow', 'hero_tag_title', 'feat_badge', 'feat_name', 'feat_desc', 'feat_link', 'feature1_title', 'feature1_desc', 'feature2_title', 'feature2_desc', 'feature3_title', 'feature3_desc', 'sobre_titulo', 'sobre_texto'];

// hero_images (carrossel do banner) é tratado à parte dos outros campos de
// imagem: é um array (multer aceita vários arquivos no mesmo campo), não
// um único arquivo por campo como cat_img_* / hero_image.
app.put('/api/config', requireAuth, requirePermissao('config'), upload.fields([
    ...CONFIG_IMAGE_FIELDS.map(f => ({ name: f, maxCount: 1 })),
    { name: 'hero_images', maxCount: 12 }
]), async (req, res) => {
    try {
        const existing = await pool.query('SELECT * FROM config WHERE id = 1');
        const cur = existing.rows[0] || {};

        const allFields = [...CONFIG_IMAGE_FIELDS, ...CONFIG_TEXT_FIELDS];
        const values = allFields.map(field => {
            if (CONFIG_IMAGE_FIELDS.includes(field)) {
                const file = req.files && req.files[field] && req.files[field][0];
                return file ? `${getBaseUrl(req)}/uploads/produtos/${file.filename}` : (cur[field] || null);
            }
            return req.body[field] !== undefined ? req.body[field] : (cur[field] || null);
        });

        // --- Carrossel do hero: imagens mantidas (o admin pode remover
        // alguma existente) + novas enviadas nesta requisição. ---
        let keptHeroImages = cur.hero_images || [];
        if (req.body.hero_images_keep !== undefined) {
            try {
                const parsed = JSON.parse(req.body.hero_images_keep);
                if (Array.isArray(parsed)) keptHeroImages = parsed;
            } catch (e) { /* mantém o valor atual se vier malformado */ }
        }
        const newHeroFiles = (req.files && req.files.hero_images) || [];
        const newHeroUrls = newHeroFiles.map(f => `${getBaseUrl(req)}/uploads/produtos/${f.filename}`);
        // .filter(Boolean): nunca deixa entrada vazia/nula entrar na lista —
        // foi exatamente isso que causou uma imagem "quebrada" aparecendo no
        // carrossel (o front tinha um bug que mandava null aqui; corrigido
        // lá também, mas o backend não deve confiar só nisso).
        const heroImages = [...keptHeroImages, ...newHeroUrls].filter(Boolean);

        // Apaga do disco as imagens do carrossel que foram removidas nesta
        // troca (mesmo princípio do DELETE /api/produtos/:id).
        const removedHeroImages = (cur.hero_images || []).filter(url => url && !heroImages.includes(url));
        for (const url of removedHeroImages) {
            const filename = url.split('/').pop();
            const filepath = path.join(UPLOAD_DIR, filename);
            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        }

        const heroShuffle = req.body.hero_shuffle === 'true' || req.body.hero_shuffle === true;
        const parsedInterval = parseInt(req.body.hero_interval_ms, 10);
        const heroIntervalMs = Number.isFinite(parsedInterval) && parsedInterval >= 1000
            ? parsedInterval
            : (cur.hero_interval_ms || 5000);

        allFields.push('hero_images', 'hero_shuffle', 'hero_interval_ms');
        values.push(JSON.stringify(heroImages), heroShuffle, heroIntervalMs);
        // hero_image (singular) é o que o site realmente exibe hoje. Só
        // sincroniza com a primeira do carrossel quando NÃO veio um upload
        // explícito nesse campo nesta requisição — senão o upload feito
        // pelo admin (aba Site) era sempre descartado e substituído pela
        // primeira imagem do carrossel antigo.
        const heroImageFile = req.files && req.files['hero_image'] && req.files['hero_image'][0];
        if (!heroImageFile) {
            values[allFields.indexOf('hero_image')] = heroImages[0] || cur.hero_image || null;
        }

        const placeholders = allFields.map((_, i) => `$${i + 1}`).join(', ');
        const updates = allFields.map((f, i) => `${f} = $${i + 1}`).join(', ');

        const result = await pool.query(
            `INSERT INTO config (id, ${allFields.join(', ')})
             VALUES (1, ${placeholders})
             ON CONFLICT (id) DO UPDATE SET ${updates}
             RETURNING *`,
            values
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('PUT /api/config error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── ADMIN STATS ────────────────────────────────────────────────────────────

app.get('/api/admin/stats', requireAuth, async (req, res) => {
    try {
        const total = await pool.query('SELECT COUNT(*) FROM produtos');
        const byStatus = await pool.query(
            'SELECT status, COUNT(*) as count FROM produtos GROUP BY status'
        );
        res.json({
            totalProdutos: parseInt(total.rows[0].count),
            porStatus: byStatus.rows
        });
    } catch (err) {
        console.error('GET /api/admin/stats error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ─── HELPERS ────────────────────────────────────────────────────────────────

function getBaseUrl(req) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return `${protocol}://${host}`;
}

// ─── START ──────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
    console.log(`FB Elegance API running on port ${PORT}`);
});
