(function(){
    // ─── CONFIGURAÇÃO API ─────────────────────────────────────────────────────
    const API_BASE = "https://api.fbelegancelux.com.br";

    // ─── SESSÃO ADMIN ────────────────────────────────────────────────────────
    // Guarda o token emitido pela API no login. Antes disto a "senha" era
    // uma string literal comparada aqui no navegador — qualquer pessoa
    // via o código-fonte e entrava; e a API sequer checava quem chamava.
    // Agora a decisão é do servidor: aqui só carregamos a credencial.
    const TOKEN_KEY = 'fb_admin_token';
    let sessaoUsuario = null;   // {id, nome, email, papel, permissoes}

    function getToken()      { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
    function setToken(t)     { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} }
    function limparSessao()  { setToken(null); sessaoUsuario = null; }

    /** O usuário pode usar esta área do painel? Admin tem tudo. */
    function podeAcessar(area) {
        if (!sessaoUsuario) return false;
        if (sessaoUsuario.papel === 'admin') return true;
        return Array.isArray(sessaoUsuario.permissoes) && sessaoUsuario.permissoes.includes(area);
    }

    // ─── CLIENTE API (fetch nativo) ──────────────────────────────────────────
    async function apiFetch(method, path, body) {
        const opts = { method, headers: {} };
        if (body !== undefined && !(body instanceof FormData)) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        } else if (body instanceof FormData) {
            opts.body = body;
        }
        // Enviado em toda chamada, inclusive nos GETs públicos: é
        // inofensivo lá e evita ter que lembrar de marcar rota por rota
        // qual precisa de token — esquecer uma seria uma falha silenciosa.
        const token = getToken();
        if (token) opts.headers['Authorization'] = 'Bearer ' + token;

        const res = await fetch(API_BASE + path, opts);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            // Token expirado ou conta desativada pelo admin: derruba a
            // sessão local em vez de deixar a tela num limbo em que todo
            // botão falha sem explicação.
            if (res.status === 401 && token) {
                limparSessao();
                alert('Sua sessão expirou. Entre novamente.');
                location.reload();
            }
            // A API responde { error: "..." }; ler `message` deixava toda
            // mensagem de erro cair no genérico do statusText.
            throw new Error(err.error || err.message || res.statusText);
        }
        return res.json();
    }

    async function dbGetAll()        { return apiFetch('GET', '/api/produtos'); }
    async function dbInsert(data)    { return apiFetch('POST', '/api/produtos', data); }
    async function dbUpdate(id, data){ return apiFetch('PUT', `/api/produtos/${id}`, data); }
    async function dbDelete(id)      { return apiFetch('DELETE', `/api/produtos/${id}`); }
    async function dbReorderProdutos(order) { return apiFetch('PUT', '/api/produtos/reorder', { order }); }
    async function dbGetConfig()     { return apiFetch('GET', '/api/config'); }
    async function dbGetFeedbacks()       { return apiFetch('GET', '/api/feedbacks'); }
    async function dbGetBrands()          { return apiFetch('GET', '/api/brands'); }
    async function dbAddBrand(categoria, nome) { return apiFetch('POST', '/api/brands', { categoria, nome }); }
    async function dbDeleteBrand(id)      { return apiFetch('DELETE', `/api/brands/${id}`); }
    async function dbGetCategories()          { return apiFetch('GET', '/api/categories'); }
    async function dbAddCategory(formData)    { return apiFetch('POST', '/api/categories', formData); }
    async function dbUpdateCategory(id, formData) { return apiFetch('PUT', `/api/categories/${id}`, formData); }
    async function dbDeleteCategory(id)       { return apiFetch('DELETE', `/api/categories/${id}`); }
    async function dbGetSizeOptions()             { return apiFetch('GET', '/api/size-options'); }
    async function dbAddSizeOption(modo, valor)   { return apiFetch('POST', '/api/size-options', { modo, valor }); }
    async function dbDeleteSizeOption(id)         { return apiFetch('DELETE', `/api/size-options/${id}`); }

    // Upload de imagem para o servidor
    async function uploadImage(file) {
        const fd = new FormData();
        fd.append('imagem', file);
        const token = getToken();
        const res = await fetch(`${API_BASE}/api/upload`, {
            method: 'POST',
            body: fd,
            headers: token ? { Authorization: 'Bearer ' + token } : {}
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error('Upload falhou: ' + (err.message || res.statusText));
        }
        const data = await res.json();
        return data.url;
    }

    // ─── ESTADO ───────────────────────────────────────────────────────────────
    let produtos = [];
    let filtroCategoria = 'procurados';
    let filtroTamanho = [];
    let filtroNumero = [];
    let filtroMarca = [];
    let termoBusca = '';
    let adminVisible = false;
    let currentEditId = null;

    let filterMenuOpen = false;

    // Categorias reais (produtos são cadastrados nelas, usadas em admin/marca/vitrine).
    // Agora cadastradas pelo admin (aba Categorias) e carregadas do banco — ver
    // carregarCategorias(). Esta lista fica só como fallback caso a API de
    // categorias falhe no carregamento, pra site/formulário nunca ficarem vazios.
    const CATS_FALLBACK = [
        { value: "casacos", label: "Casacos", icon: "ti-hanger", size_mode: "tamanho", cover_image: null },
        { value: "camisetas", label: "Camisetas", icon: "ti-shirt", size_mode: "tamanho", cover_image: null },
        { value: "shorts", label: "Shorts", icon: "ti-layout-rows", size_mode: "tamanho", cover_image: null },
        { value: "calcados", label: "Calçados", icon: "ti-shoe", size_mode: "numero", cover_image: null },
        { value: "acessorios", label: "Acessórios", icon: "ti-diamond", size_mode: "nenhum", cover_image: null },
        { value: "perfumes", label: "Perfumes", icon: "ti-spray", size_mode: "nenhum", cover_image: null }
    ];
    let CATS = CATS_FALLBACK.slice();
    // Abas de navegação abaixo do banner: "Mais Procurados" é uma vitrine (todos os
    // produtos, sem filtro de categoria) e vem sempre selecionada por padrão —
    // nenhuma categoria específica é pré-filtrada ao carregar o site.
    let NAV_TABS = [{ value: "procurados", label: "Mais Procurados" }, ...CATS];

    // Categorias que usam grade de tamanhos (P/M/G) vs. numeração vs. nenhuma —
    // derivadas do size_mode de cada categoria (ver recalcularDerivadosDeCategorias()).
    let TAMANHO_CATS = CATS.filter(c => c.size_mode === 'tamanho').map(c => c.value);
    let NUMERO_CATS = CATS.filter(c => c.size_mode === 'numero').map(c => c.value);
    // Imagem de capa por categoria (aba Site do admin) — agora vem de
    // categories.cover_image, não mais de colunas fixas em config.
    let CAT_COVER_IMAGES = {};
    // Escalas de tamanho/numeração — cadastradas pelo admin (aba Categorias),
    // carregadas do banco em carregarSizeOptions(). Fallback igual ao acima.
    const SIZES_FALLBACK = ['XXS','XS','S','M','L','XL','XXL'];
    const NUMEROS_FALLBACK = ['34','35','36','37','38','39','40','41','42','43','44','45'];
    let SIZES = SIZES_FALLBACK.slice();
    let NUMEROS = NUMEROS_FALLBACK.slice();
    // Marcas agora são cadastradas pelo admin (aba Categorias), não mais fixas
    // aqui — ver carregarBrands(). Esta lista fica só como fallback caso a
    // API de marcas falhe no carregamento, pra sidebar/formulário nunca
    // ficarem vazios por causa de uma falha de rede.
    const BRANDS_BY_CAT_FALLBACK = {
        casacos: ['AllSaints','Off-White','Palm Angels','Ralph Lauren','Moncler','Diesel'],
        camisetas: ['AllSaints','Off-White','Golden Goose','Palm Angels','Ralph Lauren','Moncler','Diesel','Boss'],
        shorts: ['Vilebrequin','Sundek'],
        calcados: ['Nike','Golden Goose','Off-White','Zegna','Gucci','Bottega Veneta','Louis Vuitton']
    };
    let BRANDS_BY_CAT = {};
    // id numérico de cada marca (categoria+nome -> id), pra dar pra excluir
    // no admin sem precisar de outra chamada — populado junto em carregarBrands().
    let BRAND_IDS = {};

    // Normalização de status/categorias para evitar valores inconsistentes do backend
    function stripAccents(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').trim(); }
    function normalizeStatus(s){
        const v = stripAccents(s);
        if(!v) return 'disponiveis';
        if(['vendido','vendida','vendidos'].includes(v)) return 'vendido';
        if(['lancamento','lancamentos','lancamento'].includes(v)) return 'lancamentos';
        if(['em breve','embreve','em_breve'].includes(v)) return 'embreve';
        return 'disponiveis';
    }
    function normalizeCategoria(c){
        const v = stripAccents(c);
        if(['casacos','casaco'].includes(v)) return 'casacos';
        if(['camisetas','camiseta'].includes(v)) return 'camisetas';
        if(['shorts'].includes(v)) return 'shorts';
        if(['calcados','calcado'].includes(v)) return 'calcados';
        if(['acessorios','acessorio'].includes(v)) return 'acessorios';
        if(['perfumes','perfume'].includes(v)) return 'perfumes';
        // Categorias legadas: mantidas para não quebrar produtos antigos ainda não reclassificados.
        // Não aparecem mais nas abas — reclassifique-os no admin em Casacos/Camisetas/Acessórios/Perfumes.
        if(['vestuario','vestuarios'].includes(v)) return 'vestuario';
        if(['lifestyle'].includes(v)) return 'lifestyle';
        return v || 'outros';
    }
    function parseNumeracao(str){
        const out = new Set();
        String(str||'').split(',').forEach(tok => {
            tok = tok.trim();
            if (!tok) return;
            const m = tok.match(/^(\d+)\s*-\s*(\d+)$/);
            if (m) {
                let a = parseInt(m[1],10), b = parseInt(m[2],10);
                if (a > b) { const t=a; a=b; b=t; }
                for (let n=a; n<=b; n++) out.add(String(n));
            } else out.add(tok);
        });
        return out;
    }
    function numeroMatches(numeracaoStr, selecionados){
        const set = parseNumeracao(numeracaoStr);
        return selecionados.some(n => set.has(n));
    }
    function normalizeProduct(p){
        if(!p) return p;
        const np = { ...p };
        np.categoria = normalizeCategoria(p.categoria);
        np.status = normalizeStatus(p.status);
        // garante arrays definidos
        if(!Array.isArray(np.images)) np.images = Array.isArray(p.images)?p.images:[];
        if(!Array.isArray(np.tamanhos) && np.tamanhos) np.tamanhos = String(np.tamanhos).split(',').map(x=>x.trim()).filter(Boolean);
        return np;
    }

    // Histórico simples de vendas no localStorage
    function addSaleRecord(prod){
        try{
            const key = 'fb_sales_history';
            const list = JSON.parse(localStorage.getItem(key) || '[]');
            list.unshift({ id: prod.id, nome: prod.nome, preco: prod.preco, categoria: prod.categoria, date: new Date().toISOString() });
            localStorage.setItem(key, JSON.stringify(list.slice(0,200)));
        }catch(e){ console.warn('sale record failed', e); }
    }
    function removeSaleRecord(prodId){
        try{
            const key = 'fb_sales_history';
            const list = JSON.parse(localStorage.getItem(key) || '[]').filter(r=>r.id!==prodId);
            localStorage.setItem(key, JSON.stringify(list));
        }catch(e){ console.warn('remove sale record failed', e); }
    }

    // ─── TOAST ────────────────────────────────────────────────────────────────
    const toast = document.getElementById('toastNotification');
    const toastMsg = document.getElementById('toastMessage');
    function showToast(msg, isError) {
        toastMsg.innerText = msg;
        toast.style.borderLeftColor = isError ? '#c0392b' : '#B8924F';
        toast.querySelector('i').className = isError ? 'fas fa-exclamation-circle' : 'fas fa-check-circle';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3500);
    }
    document.getElementById('toastClose').addEventListener('click', () => toast.classList.remove('show'));
    document.getElementById('printOverlayClose').addEventListener('click', fecharPrint);
    document.getElementById('printOverlay').addEventListener('click', e => {
        if (e.target === document.getElementById('printOverlay')) fecharPrint();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharPrint(); });

    // ─── FORMATAÇÃO DE PREÇO (esquerda → direita, sem inverter) ──────────────
    function digitosParaPreco(digits) {
        if (!digits || digits === '0') return 'R$ 0,00';
        const num = parseInt(digits.replace(/^0+/, '') || '0', 10);
        const reais = Math.floor(num / 100);
        const centavos = num % 100;
        return 'R$ ' + reais.toLocaleString('pt-BR') + ',' + String(centavos).padStart(2, '0');
    }

    function bindPreco(el) {
        if (!el) return;
        el.addEventListener('keydown', function(e) {
            if (e.key === 'Backspace') {
                e.preventDefault();
                const d = this.value.replace(/\D/g, '');
                this.value = digitosParaPreco(d.slice(0, -1) || '0');
                moveCursorToEnd(this);
            }
        });
        el.addEventListener('input', function(e) {
            // Captura apenas o dígito digitado (evita processar backspace aqui)
            const d = this.value.replace(/\D/g, '');
            this.value = digitosParaPreco(d);
            moveCursorToEnd(this);
        });
        el.addEventListener('focus', function() { moveCursorToEnd(this); });
        el.addEventListener('click', function() { moveCursorToEnd(this); });
    }

    function moveCursorToEnd(el) {
        const len = el.value.length;
        el.setSelectionRange(len, len);
    }

    // ─── FAVORITOS ────────────────────────────────────────────────────────────
    let favoritos = JSON.parse(localStorage.getItem('fb_favoritos') || '[]');
    function toggleFavorito(id) {
        const idx = favoritos.indexOf(id);
        if (idx === -1) favoritos.push(id); else favoritos.splice(idx, 1);
        localStorage.setItem('fb_favoritos', JSON.stringify(favoritos));
        return favoritos.includes(id);
    }

    // ─── CARRINHO ─────────────────────────────────────────────────────────────
    let cart = JSON.parse(localStorage.getItem('fb_cart') || '[]');

    function saveCart()     { localStorage.setItem('fb_cart', JSON.stringify(cart)); updateCartUI(); }
    function updateCartUI() { document.getElementById('cartCount').innerText = cart.reduce((s,i) => s+i.quantity, 0); renderCartModal(); }

    function addToCart(prod) {
        if (prod.status === 'vendido') { showToast('❌ Item já vendido!', true); return; }
        const ex = cart.find(i => i.id === prod.id);
        if (ex) ex.quantity++;
        else cart.push({ id:prod.id, nome:prod.nome, preco:prod.preco, images:prod.images, tamanhos:prod.tamanhos, numeracao:prod.numeracao, categoria:prod.categoria, quantity:1 });
        saveCart();
        showToast('✓ ' + prod.nome + ' adicionado à sacola');
    }
    // Compara como texto: o id gravado no carrinho vem da API como
    // número, e o que volta do botão (dataset) é sempre string. Com `!==`
    // entre 291 e "291" o filtro nunca casava e a lixeira de cada item
    // não removia nada — só o "limpar carrinho" funcionava, porque ele
    // esvazia a lista sem comparar id nenhum.
    function removeFromCart(id) {
        cart = cart.filter(i => String(i.id) !== String(id));
        saveCart();
    }
    function clearCart()        { cart = []; saveCart(); }

    function precoNum(p) { return parseFloat((p||'').replace('R$ ','').replace(/\./g,'').replace(',','.')) || 0; }

    function renderCartModal() {
        const c = document.getElementById('cartItemsList');
        if (!c) return;
        if (!cart.length) { c.innerHTML = '<div style="text-align:center;padding:20px;">Sua sacola está vazia.</div>'; document.getElementById('cartTotal').innerHTML = ''; return; }
        let html = '', total = 0;
        cart.forEach(item => {
            total += precoNum(item.preco) * item.quantity;
            const img = (item.images||[])[0] || 'https://placehold.co/100x100?text=Sem+imagem';
            html += `<div class="cart-item">
                <img class="cart-item-img" src="${img}" alt="${escapeHtml(item.nome)}">
                <div class="cart-item-info"><strong>${escapeHtml(item.nome)}</strong><span>${item.preco} x ${item.quantity}</span></div>
                <button class="cart-item-remove" data-id="${item.id}"><i class="fas fa-trash-alt"></i></button>
            </div>`;
        });
        c.innerHTML = html;
        document.getElementById('cartTotal').innerHTML = 'Total: R$ ' + total.toFixed(2).replace('.',',');
        c.querySelectorAll('.cart-item-remove').forEach(btn => btn.addEventListener('click', () => { removeFromCart(btn.dataset.id); }));
    }

    function sendCartToWhatsApp() {
        if (!cart.length) { showToast('Sua sacola está vazia', true); return; }
        let msg = "🛍️ *Meu pedido:*%0A";
        cart.forEach(item => {
            let extra = '';
            if (TAMANHO_CATS.includes(item.categoria) && item.tamanhos) extra = ` (Tam: ${item.tamanhos.join(',')})`;
            if (NUMERO_CATS.includes(item.categoria) && item.numeracao) extra = ` (Num: ${item.numeracao})`;
            msg += `- ${item.nome}${extra} - ${item.preco} x ${item.quantity}%0A`;
        });
        const total = cart.reduce((s,i) => s + precoNum(i.preco)*i.quantity, 0);
        msg += `%0A*Total:* R$ ${total.toFixed(2).replace('.',',')}`;
        window.open('https://wa.me/5543996179533?text=' + msg, '_blank');
    }

    // ─── CARREGAR PRODUTOS ────────────────────────────────────────────────────
    async function carregarProdutos() {
        try {
            const data = await dbGetAll();
            produtos = Array.isArray(data) ? data.map(normalizeProduct) : [];
            renderizarCatalogo();
            renderizarSecoesCuradas();
            if (adminVisible) renderizarAdminLista();
            abrirProdutoDoEndereco();
        } catch(err) {
            console.error('Erro Supabase:', err);
            document.getElementById('product-grid').innerHTML = `<div class="empty-message">Erro ao carregar: ${err.message}</div>`;
            showToast('Erro ao carregar estoque: ' + err.message, true);
        }
    }

    // ─── CATEGORIAS (carregadas do banco, editáveis no admin) ─────────────────
    // Recalcula todas as listas derivadas de CATS (abas de navegação, quem usa
    // tamanho/numeração, ícones/labels do admin, imagens de capa) — chamado
    // sempre que CATS muda (carga inicial ou depois de add/editar/excluir
    // categoria no admin).
    function recalcularDerivadosDeCategorias() {
        NAV_TABS = [{ value: "procurados", label: "Mais Procurados" }, ...CATS];
        TAMANHO_CATS = CATS.filter(c => c.size_mode === 'tamanho').map(c => c.value);
        NUMERO_CATS = CATS.filter(c => c.size_mode === 'numero').map(c => c.value);
        ADM_CATS = Object.fromEntries(CATS.map(c => [c.value, c.label]));
        ADM_ICONS = Object.fromEntries(CATS.map(c => [c.value, c.icon || 'ti-box']));
        CAT_COVER_IMAGES = Object.fromEntries(CATS.map(c => [c.value, c.cover_image]));
    }

    async function carregarCategorias() {
        try {
            const rows = await dbGetCategories();
            if (Array.isArray(rows) && rows.length) {
                CATS = rows
                    .slice()
                    .sort((a, b) => (a.sort_order - b.sort_order) || a.id - b.id)
                    .map(r => ({ id: r.id, value: r.slug, label: r.label, icon: r.icon, size_mode: r.size_mode, cover_image: r.cover_image }));
            }
        } catch (err) {
            console.warn('categorias: usando lista padrão (falha ao carregar da API)', err);
            CATS = CATS_FALLBACK.slice();
        }
        recalcularDerivadosDeCategorias();
        // Várias telas já podem ter renderizado com o fallback antes das
        // categorias reais chegarem — atualiza tudo que depende delas.
        if (typeof renderizarCatTabs === 'function') renderizarCatTabs();
        if (typeof renderizarCatalogo === 'function') renderizarCatalogo();
        if (typeof renderizarCatShowcase === 'function') renderizarCatShowcase(siteConfig);
        if (typeof renderizarFiltroMenu === 'function') renderizarFiltroMenu();
        if (typeof refreshNumSizeVisibility === 'function' && adminVisible) refreshNumSizeVisibility();
        if (typeof admRenderCats === 'function' && admTab === 'categorias') admRenderCats();
        if (typeof admRenderCatsManage === 'function' && admTab === 'categorias') admRenderCatsManage();
        if (typeof admRenderBrands === 'function' && admTab === 'categorias') admRenderBrands();
    }

    async function carregarSizeOptions() {
        try {
            const rows = await dbGetSizeOptions();
            const tamanhos = rows.filter(r => r.modo === 'tamanho').sort((a,b) => (a.sort_order-b.sort_order)||a.id-b.id).map(r => r.valor);
            const numeros = rows.filter(r => r.modo === 'numero').sort((a,b) => (a.sort_order-b.sort_order)||a.id-b.id).map(r => r.valor);
            SIZES = tamanhos.length ? tamanhos : SIZES_FALLBACK.slice();
            NUMEROS = numeros.length ? numeros : NUMEROS_FALLBACK.slice();
        } catch (err) {
            console.warn('tamanhos/numeração: usando lista padrão (falha ao carregar da API)', err);
            SIZES = SIZES_FALLBACK.slice();
            NUMEROS = NUMEROS_FALLBACK.slice();
        }
        if (typeof renderSizeButtonGroup === 'function') {
            renderSizeButtonGroup('adm-f-tamanhos-buttons', SIZES, syncSizesToInput);
            renderSizeButtonGroup('adm-f-numeracao-buttons', NUMEROS, syncNumerosToInput);
        }
        if (typeof renderizarFiltroMenu === 'function') renderizarFiltroMenu();
        if (typeof admRenderSizeOpts === 'function' && admTab === 'categorias') admRenderSizeOpts();
    }

    // ─── MARCAS (carregadas do banco, editáveis no admin) ─────────────────────
    async function carregarBrands() {
        try {
            const rows = await dbGetBrands();
            const grouped = {};
            const ids = {};
            rows.forEach(b => {
                if (!grouped[b.categoria]) grouped[b.categoria] = [];
                grouped[b.categoria].push(b.nome);
                ids[`${b.categoria}::${b.nome}`] = b.id;
            });
            BRANDS_BY_CAT = grouped;
            BRAND_IDS = ids;
        } catch (err) {
            console.warn('marcas: usando lista padrão (falha ao carregar da API)', err);
            BRANDS_BY_CAT = BRANDS_BY_CAT_FALLBACK;
            BRAND_IDS = {};
        }
        // A sidebar de filtros e o formulário de produto no admin já podem
        // ter renderizado antes das marcas chegarem — atualiza os dois se
        // já estiverem na tela.
        if (typeof renderizarFiltroMenu === 'function') renderizarFiltroMenu();
        if (typeof refreshNumSizeVisibility === 'function' && adminVisible) refreshNumSizeVisibility();
        if (typeof admRenderBrands === 'function' && admTab === 'categorias') admRenderBrands();
    }

    let siteConfig = {};
    // Textos que dependem da config (hero, selos, "sobre nós") nascem com
    // .aguardando-conteudo no HTML — escondidos até aqui decidir o valor
    // final, pra edição no painel nunca aparecer como "pisca" entre o
    // texto de reserva antigo e o novo. Timeout é rede muito lenta ou
    // travada: melhor mostrar a reserva do que deixar em branco pra sempre.
    function revelarConteudoDinamico() {
        document.querySelectorAll('.aguardando-conteudo').forEach(el => el.classList.remove('aguardando-conteudo'));
    }
    async function carregarCapaDoSite() {
        const timeoutRevelar = setTimeout(revelarConteudoDinamico, 3000);
        try {
            const cfg = await dbGetConfig();
            siteConfig = cfg || {};
            renderizarCatShowcase(siteConfig);
            if (!cfg) return;
            const rawHeroImages = (Array.isArray(cfg.hero_images) && cfg.hero_images.length)
                ? cfg.hero_images
                : (cfg.hero_image ? [cfg.hero_image] : []);
            // Defesa extra: nunca deixa uma entrada vazia/nula virar imagem
            // quebrada no carrossel, não importa a origem do dado.
            const heroImages = rawHeroImages.filter(Boolean);
            initHeroCarousel(heroImages, { shuffle: !!cfg.hero_shuffle, intervalMs: cfg.hero_interval_ms || 5000 });
            const setText = (id, val) => { const el = document.getElementById(id); if (el && val) el.textContent = val; };
            // Igual ao setText, mas reconhece **negrito**. O texto vem do
            // painel admin, então é escapado primeiro: o marcador é a única
            // coisa que pode virar HTML.
            const setRichText = (id, val) => {
                const el = document.getElementById(id);
                if (!el || !val) return;
                el.innerHTML = escapeHtml(val).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
            };
            setText('heroEyebrow', cfg.hero_eyebrow);
            setText('heroTitle1', cfg.hero_title1);
            setText('heroTitle2', cfg.hero_title2);
            setText('heroTitle3', cfg.hero_title3);
            setText('heroDesc', cfg.hero_desc);
            setText('heroTagEyebrow', cfg.hero_tag_eyebrow);
            setText('heroTagTitle', cfg.hero_tag_title);
            setText('feature1Title', cfg.feature1_title);
            setRichText('feature1Desc', cfg.feature1_desc);
            setText('feature2Title', cfg.feature2_title);
            setRichText('feature2Desc', cfg.feature2_desc);
            setText('feature3Title', cfg.feature3_title);
            setRichText('feature3Desc', cfg.feature3_desc);
            renderizarDestaque(cfg);
            renderizarFeatureBanner(cfg);
            renderizarSobre(cfg);
        } catch(err) {
            console.warn('capa do site: usando conteúdo padrão', err);
            renderizarCatShowcase({});
            renderizarSobre({});
        } finally {
            clearTimeout(timeoutRevelar);
            revelarConteudoDinamico();
        }
    }

    // ─── SOBRE NÓS ────────────────────────────────────────────────────────────
    // Texto inicial, editável pelo painel. Existe para a seção nunca
    // aparecer vazia antes de alguém preencher, e diz só o que a própria
    // loja já afirma no resto do site.
    const SOBRE_PADRAO = `Somos uma curadoria de moda masculina de luxo em second hand: peças que já tiveram dono e seguem impecáveis, escolhidas uma a uma.

Autenticidade aqui é inegociável. Toda peça passa por análise e autenticação antes de entrar no catálogo — e só entra se for original.

Empresa consolidada em Londrina, no Paraná, com **mais de 1000 produtos entregues** para todo o Brasil. O atendimento é pessoal, pelo WhatsApp, do primeiro contato até a peça chegar na sua mão.`;

    function renderizarSobre(cfg) {
        const titulo = (cfg && cfg.sobre_titulo || '').trim();
        const corpoTexto = (cfg && cfg.sobre_texto || '').trim() || SOBRE_PADRAO;

        if (titulo) {
            const el = document.getElementById('sobreTitulo');
            if (el) el.textContent = titulo;
        }

        const corpo = document.getElementById('sobreTexto');
        if (corpo) {
            // Linha em branco separa parágrafo; **isto** vira negrito. O
            // texto é escapado antes, então nada além do marcador vira
            // HTML — o campo é editável pelo painel.
            corpo.innerHTML = corpoTexto
                .split(/\n\s*\n/)
                .map(p => p.trim())
                .filter(Boolean)
                .map(p => `<p>${escapeHtml(p)
                    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                    .replace(/\n/g, '<br>')}</p>`)
                .join('');
        }

        const media = document.getElementById('sobreMedia');
        const img = document.getElementById('sobreImagem');
        if (media && img) {
            const temImagem = !!(cfg && cfg.sobre_imagem);
            if (temImagem) img.src = cfg.sobre_imagem;
            media.style.display = temImagem ? '' : 'none';
            document.querySelector('.sobre-inner')?.classList.toggle('sobre-sem-imagem', !temImagem);
        }
    }

    // ─── FEEDBACKS DE CLIENTES ────────────────────────────────────────────────
    function cardDeFeedback(f) {
        if (f.tipo === 'print') {
            if (!f.imagem) return '';
            return `<div class="feedback-card feedback-card-print" data-print="${escapeHtml(f.imagem)}">
                <img src="${escapeHtml(f.imagem)}" alt="Feedback de cliente" loading="lazy">
            </div>`;
        }
        return `<div class="feedback-card feedback-card-texto">
            <div class="feedback-aspas">&ldquo;</div>
            <div class="feedback-texto">${escapeHtml(f.texto || '')}</div>
        </div>`;
    }

    async function renderizarFeedbacks() {
        const secao = document.getElementById('feedbacksSection');
        const track = document.getElementById('feedbacksTrack');
        if (!secao || !track) return;

        let lista = [];
        // Falha de rede aqui não pode derrubar o resto da página: a seção
        // simplesmente não aparece, como quando não há nada cadastrado.
        try { lista = await dbGetFeedbacks(); } catch (_) { lista = []; }
        const cards = (Array.isArray(lista) ? lista : []).map(cardDeFeedback).filter(Boolean);
        if (!cards.length) { secao.style.display = 'none'; return; }

        track.innerHTML = cards.join('');
        secao.style.display = 'block';

        const prev = document.getElementById('feedbacksPrev');
        const next = document.getElementById('feedbacksNext');
        const passo = () => (track.querySelector('.feedback-card')?.offsetWidth || 280) + 18;
        if (prev) prev.onclick = () => track.scrollBy({ left: -passo(), behavior: 'smooth' });
        if (next) next.onclick = () => track.scrollBy({ left: passo(), behavior: 'smooth' });

        // Com dois ou três feedbacks tudo cabe na tela e não há o que
        // rolar — seta que não leva a lugar nenhum só confunde. Refaz a
        // conta ao redimensionar, porque o que cabe muda com a largura.
        const ajustarSetas = () => {
            const rola = track.scrollWidth > track.clientWidth + 4;
            [prev, next].forEach(b => { if (b) b.style.display = rola ? '' : 'none'; });
        };
        ajustarSetas();
        window.addEventListener('resize', ajustarSetas);

        track.querySelectorAll('[data-print]').forEach(el => {
            el.addEventListener('click', () => abrirPrint(el.dataset.print));
        });
    }

    function abrirPrint(url) {
        const overlay = document.getElementById('printOverlay');
        const img = document.getElementById('printOverlayImg');
        if (!overlay || !img) return;
        img.src = url;
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
    function fecharPrint() {
        const overlay = document.getElementById('printOverlay');
        if (!overlay) return;
        overlay.classList.remove('open');
        document.body.style.overflow = 'auto';
    }

    // ─── BANNER DE IMAGEM (final da página, acima dos selos de confiança) ─────
    function renderizarFeatureBanner(cfg) {
        const wrap = document.getElementById('featureBannerWrap');
        if (!wrap) return;
        if (!cfg || !cfg.feature_banner_image) { wrap.style.display = 'none'; return; }
        document.getElementById('featureBannerImg').src = cfg.feature_banner_image;
        wrap.style.display = 'block';
    }

    // ─── CARROSSEL DO HERO ────────────────────────────────────────────────────
    // Troca automática de imagens no banner principal, com fade suave, setas,
    // pontinhos de posição e pausa ao passar o mouse. Todas as imagens ficam
    // empilhadas (position:absolute) dentro de uma caixa de altura fixa
    // (.hero-media), então trocar de imagem nunca desloca o layout — só a
    // opacidade muda (ver .hero-slide no style.css).
    let heroTimer = null;
    let heroStopFn = () => {};
    let heroStartFn = () => {};
    let heroHoverBound = false;
    function initHeroCarousel(images, opts) {
        const track = document.getElementById('heroCarousel');
        const prevBtn = document.getElementById('heroPrev');
        const nextBtn = document.getElementById('heroNext');
        const dotsWrap = document.getElementById('heroDots');
        const media = document.getElementById('heroMedia');
        if (!track) return;
        if (heroTimer) { clearInterval(heroTimer); heroTimer = null; }

        let list = (images && images.length) ? images.slice() : [];
        if (list.length === 0) return; // mantém a <img> estática original do HTML

        if (opts && opts.shuffle) {
            for (let i = list.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [list[i], list[j]] = [list[j], list[i]];
            }
        }

        track.innerHTML = list.map((src, i) =>
            `<img class="hero-img hero-slide${i === 0 ? ' is-active' : ''}" src="${src}" alt="FB Elegance Lux" loading="${i === 0 ? 'eager' : 'lazy'}"${i === 0 ? ' fetchpriority="high"' : ''}>`
        ).join('');
        const slides = Array.from(track.querySelectorAll('.hero-slide'));

        const multiple = slides.length > 1;
        prevBtn.style.display = multiple ? 'flex' : 'none';
        nextBtn.style.display = multiple ? 'flex' : 'none';
        dotsWrap.innerHTML = multiple
            ? slides.map((_, i) => `<button type="button" class="hero-dot${i === 0 ? ' is-active' : ''}" data-idx="${i}" aria-label="Ir para imagem ${i + 1}"></button>`).join('')
            : '';
        const dots = Array.from(dotsWrap.querySelectorAll('.hero-dot'));

        let current = 0;
        function goTo(idx) {
            slides[current].classList.remove('is-active');
            if (dots[current]) dots[current].classList.remove('is-active');
            current = (idx + slides.length) % slides.length;
            slides[current].classList.add('is-active');
            if (dots[current]) dots[current].classList.add('is-active');
        }
        function next() { goTo(current + 1); }
        function prev() { goTo(current - 1); }

        const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        function startAutoplay() {
            if (!multiple || reducedMotion) return;
            stopAutoplay();
            heroTimer = setInterval(next, Math.max(1000, opts.intervalMs || 5000));
        }
        function stopAutoplay() { if (heroTimer) { clearInterval(heroTimer); heroTimer = null; } }

        if (multiple) {
            prevBtn.onclick = () => { prev(); startAutoplay(); };
            nextBtn.onclick = () => { next(); startAutoplay(); };
            dots.forEach(d => d.onclick = () => { goTo(parseInt(d.dataset.idx, 10)); startAutoplay(); });
        }
        // heroStopFn/heroStartFn são indireções pra os listeners de
        // mouseenter/mouseleave (ligados uma única vez, ver mais abaixo)
        // sempre chamarem a versão atual de start/stopAutoplay — sem isso,
        // cada re-render (ex.: admin salvando a capa de novo) acumularia
        // um novo par de listeners no mesmo #heroMedia.
        heroStopFn = stopAutoplay;
        heroStartFn = multiple ? startAutoplay : () => {};
        if (media && !heroHoverBound) {
            heroHoverBound = true;
            media.addEventListener('mouseenter', () => heroStopFn());
            media.addEventListener('mouseleave', () => heroStartFn());
        }
        startAutoplay();
    }

    // ─── DESTAQUE (produto mais vendido) ───────────────────────────────────────
    function renderizarDestaque(cfg) {
        const section = document.getElementById('featuredBanner');
        if (!section) return;
        if (!cfg || !cfg.feat_image || !cfg.feat_name) { section.style.display = 'none'; return; }
        document.getElementById('featuredImg').src = cfg.feat_image;
        document.getElementById('featuredImg').alt = cfg.feat_name;
        document.getElementById('featuredBadge').textContent = cfg.feat_badge || 'Mais vendido';
        document.getElementById('featuredName').textContent = cfg.feat_name;
        document.getElementById('featuredDesc').textContent = cfg.feat_desc || '';
        const link = document.getElementById('featuredLink');
        const fallbackLink = cfg.feat_link || 'https://wa.me/5543996179533';
        link.href = fallbackLink;
        link.onclick = async function(e) {
            e.preventDefault();
            if (!produtos.length) { try { await carregarProdutos(); } catch(_) {} }
            const nomeAlvo = (cfg.feat_name || '').trim().toLowerCase();
            const prod = produtos.find(p => (p.nome || '').trim().toLowerCase() === nomeAlvo);
            if (prod) {
                mudarCategoria(prod.categoria);
                setTimeout(() => abrirProduto(prod), 300);
            } else {
                window.open(fallbackLink, '_blank');
            }
        };
        section.style.display = 'block';
    }

    // ─── SEÇÕES CURADAS ───────────────────────────────────────────────────────
    // A busca esconde a seção de lançamentos e precisa saber ao que
    // devolvê-la depois — daí o estado ficar guardado aqui, em vez de ser
    // relido do style no meio da busca.
    let lancamentosTemItens = false;
    function renderizarSecoesCuradas() {
        const lancs = produtos.filter(p => p.status === 'lancamentos');
        const lancSec = document.getElementById('lancamentosSection');
        const lancGrid = document.getElementById('lancamentosGrid');
        lancamentosTemItens = lancs.length > 0;
        if (lancs.length) { lancSec.style.display='block'; lancGrid.innerHTML=''; lancs.slice(0,6).forEach(p => lancGrid.appendChild(criarCard(p))); }
        else lancSec.style.display = 'none';
    }

    // ─── CARD ─────────────────────────────────────────────────────────────────
    const STATUS = { disponiveis:['DISPONÍVEL','disponivel'], lancamentos:['LANÇAMENTO','lancamento'], embreve:['EM BREVE','embreve'], vendido:['VENDIDO','vendido'] };
    const CAT_LABEL = { casacos:'CASACOS', camisetas:'CAMISETAS', shorts:'SHORTS', calcados:'CALÇADOS', acessorios:'ACESSÓRIOS', perfumes:'PERFUMES', vestuario:'VESTUÁRIO', lifestyle:'LIFESTYLE' };

    // ─── LINK DIRETO DA PEÇA ──────────────────────────────────────────────────
    // O site é uma página só e mora no GitHub Pages, que não reescreve
    // caminho nenhum. Por isso o endereço que abre uma peça é um
    // parâmetro (?produto=<id>) e não uma rota de verdade.
    //
    // As pastas em /produto/<id>-<slug>/ existem à parte, geradas pelo
    // robô em .github/workflows: elas só carregam as marcações de
    // preview (foto, nome e preço no cartão do WhatsApp) e devolvem a
    // pessoa para cá. É o link delas que o botão "copiar" entrega.
    function slugProduto(prod) {
        return String(prod.nome || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60) || 'peca';
    }
    function linkDoProduto(prod) {
        return `${location.origin}/produto/${prod.id}-${slugProduto(prod)}/`;
    }
    async function copiarLinkDoProduto(prod) {
        const link = linkDoProduto(prod);
        try {
            await navigator.clipboard.writeText(link);
            showToast('Link copiado — é só colar no WhatsApp');
        } catch (_) {
            // A área de transferência depende de permissão do navegador.
            // Quando ela é negada, mostrar o link para copiar na mão é
            // melhor do que o botão simplesmente não fazer nada.
            window.prompt('Copie o link da peça:', link);
        }
    }
    // Deixa o endereço da barra sempre compartilhável enquanto a peça
    // está aberta. replaceState em vez de pushState de propósito: assim
    // o botão "voltar" continua saindo do site, como antes, em vez de
    // acumular uma entrada por peça espiada.
    function marcarProdutoNoEndereco(prod) {
        try { history.replaceState(null, '', `?produto=${prod.id}`); } catch (_) {}
    }
    function limparProdutoDoEndereco() {
        try { history.replaceState(null, '', location.pathname); } catch (_) {}
    }

    // Todo interesse de compra vai para a loja, inclusive nas peças que
    // vieram de terceiros — nas duas modalidades descritas em /vender é
    // a FB quem conduz a venda: na venda direta a peça já é dela, e na
    // consignação o atendimento ao comprador faz parte do combinado.
    //
    // (Houve uma versão em que a peça consignada mandava o comprador
    // direto para o dono dela. Foi revertido: tirava a FB da venda que
    // ela mesma se comprometeu a conduzir. `produtos.vendedor_telefone`
    // continua gravado, mas hoje serve só como procedência no painel.)
    const WHATSAPP_LOJA = '5543996179533';

    /**
     * A versão de VITRINE da foto — a que a grade da loja mostra.
     *
     * A original é foto de celular: 3 a 6 MB cada. Com uma dúzia de
     * cards na primeira tela, eram dezenas de megabytes só para
     * desenhar a página, e é isso que fazia abrir e rolar o site ficar
     * lento. A vitrine tem 700px em WebP — cobre o card em tela retina
     * e pesa uns 60 KB.
     *
     * Se o arquivo ainda não existe (foto enviada antes desta mudança,
     * ou o lote ainda não rodou no servidor), `fbFotoFalhou` troca pela
     * original: fica lento, não fica quebrado.
     */
    // Sondagem: o servidor já tem as fotos de vitrine?
    //
    // Enquanto a API nova não for publicada e o lote não rodar, a pasta
    // /vitrine/ não existe. Sem esta checagem, CADA foto da grade faria
    // um 404 antes de cair na original — uma requisição perdida por
    // card, deixando o site mais lento do que antes da mudança.
    //
    // Aqui é UMA requisição para a página inteira. Deu certo, a loja usa
    // as fotos leves; deu 404, usa as originais e nem tenta. Quando o
    // servidor for atualizado, passa a funcionar sozinho — sem mexer
    // neste arquivo de novo.
    let vitrineDisponivel = null; // null = ainda não sei

    function fotoVitrine(original) {
        if (!original || vitrineDisponivel === false) return original || '';
        return original.replace(/\/uploads\/produtos\/([^/]+)$/, '/uploads/produtos/vitrine/$1.webp');
    }

    function sondarVitrine(exemplo) {
        if (vitrineDisponivel !== null || !exemplo) return;
        const alvo = exemplo.replace(/\/uploads\/produtos\/([^/]+)$/, '/uploads/produtos/vitrine/$1.webp');
        if (alvo === exemplo) { vitrineDisponivel = false; return; }

        const teste = new Image();
        teste.onload = () => { vitrineDisponivel = true; };
        teste.onerror = () => { vitrineDisponivel = false; };
        teste.src = alvo;
    }

    /**
     * Queda em dois degraus, chamada pelo `onerror` do card.
     *
     * 1º erro → tenta a foto original (a vitrine ainda não existe).
     * 2º erro → o cartão de indisponível.
     *
     * Sem o controle por `data-tentou`, uma original também quebrada
     * entraria em laço: erro → troca → erro → troca.
     */
    window.fbFotoFalhou = function (img) {
        if (img.dataset.tentou !== '1' && img.dataset.original) {
            img.dataset.tentou = '1';
            img.src = img.dataset.original;
            return;
        }
        img.onerror = null;
        img.src = 'https://placehold.co/600x800?text=Indispon%C3%ADvel';
    };

    function criarCard(prod) {
        // A primeira foto que passa por aqui serve de amostra.
        sondarVitrine((prod.images || [])[0]);
        const card = document.createElement('div');
        card.className = 'product-card';
        const [sLabel, sClass] = STATUS[prod.status] || ['',''];
        const catLabel = CAT_LABEL[prod.categoria] || prod.categoria.toUpperCase();
        const tagLabel = prod.marca || catLabel;
        const images = prod.images || [];
        const isSold = prod.status === 'vendido';
        const isFav = favoritos.includes(prod.id);
        let sizeLabel = '';
        if (TAMANHO_CATS.includes(prod.categoria) && prod.tamanhos?.length) sizeLabel = prod.tamanhos.join(' · ');
        else if (NUMERO_CATS.includes(prod.categoria) && prod.numeracao) sizeLabel = prod.numeracao;
        const statusHtml = prod.status !== 'disponiveis' ? `<span class="status-badge ${sClass}">${sLabel}</span>` : '';
        card.innerHTML = `
            <div class="product-image-container">
                <span class="product-tag">${escapeHtml(tagLabel)}</span>
                ${statusHtml}
                <img class="product-image" src="${images[0] ? escapeHtml(fotoVitrine(images[0])) : 'https://placehold.co/600x800?text=Sem+imagem'}" alt="${escapeHtml(prod.nome)}" loading="lazy" decoding="async" width="600" height="800" data-original="${escapeHtml(images[0]||'')}" onerror="fbFotoFalhou(this)">
                ${images.length>1 ? `<div class="nav-arrow nav-arrow-left" data-dir="prev"><i class="fas fa-chevron-left"></i></div><div class="nav-arrow nav-arrow-right" data-dir="next"><i class="fas fa-chevron-right"></i></div>` : ''}
                <button class="btn-favorite${isFav?' active':''}" title="Favoritar"><i class="${isFav?'fas':'far'} fa-heart"></i></button>
                <button class="btn-add-cart${isSold?' disabled':''}" ${isSold?'disabled':''}>${isSold?'Indisponível':'Adicionar à sacola'}</button>
            </div>
            <div class="product-info">
                <div class="product-info-main">
                    <h3 class="product-title">${escapeHtml(prod.nome)}</h3>
                    <div class="product-size-info">${sizeLabel}</div>
                </div>
                <div class="product-price">${prod.preco}</div>
            </div>`;
        card.querySelector('.btn-add-cart').addEventListener('click', e => { e.stopPropagation(); isSold ? showToast('❌ Item já vendido', true) : addToCart(prod); });
        card.querySelector('.btn-favorite').addEventListener('click', e => {
            e.stopPropagation();
            const btn = e.currentTarget;
            const fav = toggleFavorito(prod.id);
            btn.classList.toggle('active', fav);
            btn.querySelector('i').className = fav ? 'fas fa-heart' : 'far fa-heart';
        });
        card.querySelectorAll('.nav-arrow').forEach(a => a.addEventListener('click', e => { e.stopPropagation(); trocarImagem(prod, a.dataset.dir, card); }));
        card.addEventListener('click', e => { if (!e.target.closest('.btn-add-cart,.btn-favorite,.nav-arrow')) abrirProduto(prod); });
        return card;
    }

    function trocarImagem(prod, dir, card) {
        const imgs = prod.images || [];
        if (imgs.length <= 1) return;
        let idx = parseInt(card.dataset.currentIndex||'0');
        idx = dir==='prev' ? (idx-1+imgs.length)%imgs.length : (idx+1)%imgs.length;
        card.dataset.currentIndex = idx;
        const imgEl = card.querySelector('.product-image');
        if(imgEl){
            imgEl.style.opacity = '0';
            // Também pela vitrine: sem isto, a primeira foto era leve e a
            // segunda voltava a ser a original de vários MB — a lentidão
            // reapareceria assim que alguém usasse as setas.
            const vitrine = fotoVitrine(imgs[idx]);
            const tmp = new Image();
            tmp.onload = () => {
                imgEl.dataset.original = imgs[idx];
                imgEl.dataset.tentou = '';
                imgEl.src = vitrine;
                imgEl.style.opacity = '1';
            };
            // A vitrine pode não existir para esta foto: cai na original
            // em vez de deixar o card apagado (opacity 0) para sempre.
            tmp.onerror = () => {
                imgEl.dataset.original = imgs[idx];
                imgEl.dataset.tentou = '1';
                imgEl.src = imgs[idx];
                imgEl.style.opacity = '1';
            };
            tmp.src = vitrine;
        }
    }

    // ─── CATÁLOGO ─────────────────────────────────────────────────────────────
    // Tira acento e troca pontuação por espaço, dos dois lados da
    // comparação: assim "off white", "Off-White" e "OFF WHITE" encontram
    // as mesmas peças.
    const normalizarBusca = s => String(s||'')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .replace(/[^a-z0-9]+/g,' ')
        .trim();
    let ordenacao = 'newest';
    // "Mais Procurados" mostra 18 produtos no total, 6 por vez, navegados
    // pelas setas ao lado da grade (ver PROCURADOS_POR_PAGINA/PROCURADOS_MAX).
    const PROCURADOS_POR_PAGINA = 6;
    const PROCURADOS_MAX = 18;
    let procuradosPage = 0;
    function mudarPaginaProcurados(delta) {
        procuradosPage += delta;
        renderizarCatalogo();
    }
    function renderizarCatalogo() {
        const grid = document.getElementById('product-grid');
        // "Mais Procurados" é uma vitrine com produtos de todas as categorias
        // (sem filtro), diferente das demais abas que filtram por categoria real.
        // A busca é global de propósito: quem digita "Off-White" na lupa
        // quer a marca inteira, não o que sobrou dela dentro da aba que
        // por acaso estava aberta. Enquanto há texto no campo, a categoria
        // e os filtros laterais ficam de fora; voltam a valer sozinhos
        // assim que o campo esvazia.
        const buscando = termoBusca.trim().length > 0;
        // "Mais Procurados" mostra só as peças marcadas com o selecionável
        // do painel. Enquanto ninguém marcou nenhuma (catálogo migrado, ou
        // loja nova), cai pro catálogo inteiro — do jeito que era antes —
        // pra aba nunca aparecer vazia.
        const procuradas = filtroCategoria === 'procurados' ? produtos.filter(p => p.mais_procurado) : null;
        let f = buscando
            ? produtos.slice()
            : filtroCategoria === 'procurados'
                ? (procuradas.length ? procuradas : produtos.slice())
                : produtos.filter(p => p.categoria===filtroCategoria);
        if (buscando) {
            const b = normalizarBusca(termoBusca);
            // Segunda comparação sem espaço nenhum: as marcas são escritas
            // de um jeito no cadastro e de outro por quem procura —
            // "AllSaints" é uma palavra só, "Off-White" tem hífen. Sem isto,
            // quem digita "all saints" ou "offwhite" não acha nada.
            const bColado = b.replace(/ /g, '');
            // Procura no nome, na marca e na categoria. Só o nome não basta:
            // "Off-White" é a marca de dezenas de peças cujo nome não repete
            // a palavra.
            f = f.filter(p => {
                const alvo = normalizarBusca(`${p.nome} ${p.marca||''} ${CAT_LABEL[p.categoria]||''}`);
                return alvo.includes(b) || alvo.replace(/ /g, '').includes(bColado);
            });
        }
        if (!buscando && TAMANHO_CATS.includes(filtroCategoria) && filtroTamanho.length) {
            f = f.filter(p => Array.isArray(p.tamanhos) && p.tamanhos.some(t => filtroTamanho.includes(t)));
        }
        if (!buscando && NUMERO_CATS.includes(filtroCategoria) && filtroNumero.length) {
            f = f.filter(p => numeroMatches(p.numeracao, filtroNumero));
        }
        if (!buscando && BRANDS_BY_CAT[filtroCategoria] && filtroMarca.length) {
            f = f.filter(p => filtroMarca.includes(p.marca));
        }
        if (ordenacao==='preco_asc') f.sort((a,b) => precoNum(a.preco)-precoNum(b.preco));
        else if (ordenacao==='preco_desc') f.sort((a,b) => precoNum(b.preco)-precoNum(a.preco));
        else f.sort((a,b) => {
            // Ordem manual definida pelo admin (arrastar na aba Estoque) tem
            // prioridade; produtos sem ordem definida (novos, ainda não
            // organizados) caem pra depois, ordenados por mais recentes.
            const ao = Number.isFinite(a.ordem) ? a.ordem : Infinity;
            const bo = Number.isFinite(b.ordem) ? b.ordem : Infinity;
            if (ao !== bo) return ao - bo;
            return new Date(b.created_at) - new Date(a.created_at);
        });
        f.sort((a,b) => (a.status==='vendido'?1:0)-(b.status==='vendido'?1:0));

        const prevBtn = document.getElementById('procuradosPrev');
        const nextBtn = document.getElementById('procuradosNext');
        let totalCount = f.length;
        if (filtroCategoria === 'procurados' && !termoBusca.trim()) {
            const full = f.slice(0, PROCURADOS_MAX);
            totalCount = full.length;
            const totalPages = Math.max(1, Math.ceil(full.length / PROCURADOS_POR_PAGINA));
            if (procuradosPage >= totalPages) procuradosPage = totalPages - 1;
            if (procuradosPage < 0) procuradosPage = 0;
            f = full.slice(procuradosPage * PROCURADOS_POR_PAGINA, procuradosPage * PROCURADOS_POR_PAGINA + PROCURADOS_POR_PAGINA);
            const showArrows = totalPages > 1;
            if (prevBtn) { prevBtn.style.display = showArrows ? 'flex' : 'none'; prevBtn.disabled = procuradosPage === 0; }
            if (nextBtn) { nextBtn.style.display = showArrows ? 'flex' : 'none'; nextBtn.disabled = procuradosPage >= totalPages - 1; }
        } else {
            if (prevBtn) prevBtn.style.display = 'none';
            if (nextBtn) nextBtn.style.display = 'none';
        }

        const countEl = document.getElementById('plpCount');
        if (countEl) countEl.textContent = buscando
            ? `· ${totalCount} ${totalCount === 1 ? 'peça' : 'peças'}`
            : `(${totalCount})`;

        grid.innerHTML = '';
        if (!f.length) grid.innerHTML = '<div class="empty-message">✦ Nenhum produto encontrado ✦</div>';
        else f.forEach(p => grid.appendChild(criarCard(p)));
        renderizarFiltroMenu();
        renderizarCatTabs();
        aplicarModoBusca(buscando);
    }

    // Com texto na lupa a página vira uma página de resultados: o H1 diz o
    // que foi buscado e as vitrines de navegação saem da frente, para os
    // produtos aparecerem direto. Precisa rodar depois de
    // renderizarFiltroMenu(), que reescreve o H1 com o nome da categoria.
    function aplicarModoBusca(buscando) {
        const label = document.getElementById('filterMenuLabel');
        if (label && buscando) label.childNodes[0].nodeValue = `Resultados para “${termoBusca.trim()}” `;

        // String vazia devolve o controle ao CSS — importante no botão de
        // filtros, que só aparece a partir de certa largura de tela.
        const oculto = buscando ? 'none' : '';
        const showcase = document.querySelector('.cat-showcase');
        if (showcase) showcase.style.display = oculto;
        const abas = document.querySelector('.cat-tabs');
        if (abas) abas.style.display = oculto;
        const filtros = document.getElementById('filterMenuToggle');
        if (filtros) filtros.style.display = oculto;
        const lancamentos = document.getElementById('lancamentosSection');
        if (lancamentos) lancamentos.style.display = buscando ? 'none' : (lancamentosTemItens ? 'block' : 'none');
    }

    function mudarCategoria(cat) {
        filtroCategoria = cat;
        filtroTamanho = []; filtroNumero = []; filtroMarca = [];
        procuradosPage = 0;
        renderizarCatalogo();
        const grid = document.getElementById('product-grid');
        if (grid) grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ─── ABAS DE CATEGORIA (abaixo do banner) ──────────────────────────────────
    function renderizarCatTabs() {
        const wrap = document.getElementById('catTabsInner');
        if (!wrap) return;
        wrap.innerHTML = NAV_TABS.map(c => `<button type="button" class="cat-tab${c.value===filtroCategoria?' active':''}" data-cat-tab="${c.value}">${c.label}</button>`).join('');
        wrap.querySelectorAll('[data-cat-tab]').forEach(btn => btn.addEventListener('click', () => mudarCategoria(btn.dataset.catTab)));
    }

    // ─── VITRINE DE CATEGORIAS (abaixo de Mais procurados) ─────────────────────
    // Legado: antes de categories.cover_image existir, a imagem de cada categoria
    // vinha de uma coluna fixa em config (cat_img_*). Mantido só como fallback
    // para nunca deixar a vitrine sem imagem se a categoria ainda não tiver
    // cover_image cadastrado.
    const CAT_IMAGE_FIELDS = {
        casacos: 'cat_img_casacos', camisetas: 'cat_img_camisetas', shorts: 'cat_img_shorts',
        calcados: 'cat_img_calcados', acessorios: 'cat_img_acessorios', perfumes: 'cat_img_perfumes'
    };
    function renderizarCatShowcase(cfg) {
        const grid = document.getElementById('catShowcaseGrid');
        if (!grid) return;
        grid.innerHTML = CATS.map(c => {
            const img = CAT_COVER_IMAGES[c.value] || (cfg && cfg[CAT_IMAGE_FIELDS[c.value]]) || `https://placehold.co/500x650?text=${encodeURIComponent(c.label)}`;
            return `<button type="button" class="cat-tile" data-cat-tile="${c.value}">
                <img src="${img}" alt="${escapeHtml(c.label)}" loading="lazy" decoding="async">
                <span class="cat-tile-label">${c.label}</span>
            </button>`;
        }).join('');
        grid.querySelectorAll('[data-cat-tile]').forEach(btn => btn.addEventListener('click', () => mudarCategoria(btn.dataset.catTile)));
    }

    // ─── SIDEBAR DE FILTROS: peça / tamanho / número / marca ──────────────────
    let sidebarGroupsOpen = { peca: true, tamanho: true, marca: true };
    function sidebarGroup(key, label, options, ativos, group) {
        const open = sidebarGroupsOpen[key] !== false;
        return `<div class="plp-group${open?' open':''}">
            <div class="plp-group-head" data-toggle-group="${key}">${label}<i class="fas fa-chevron-down"></i></div>
            <div class="plp-group-body">${options.map(o => {
                const active = ativos.includes(o);
                return `<button type="button" class="plp-option${active?' active':''}" data-group="${group}" data-val="${escapeHtml(o)}"><span class="plp-option-box">${active?'<i class="fas fa-check"></i>':''}</span>${escapeHtml(o)}</button>`;
            }).join('')}</div>
        </div>`;
    }
    function renderizarFiltroMenu() {
        const label = document.getElementById('filterMenuLabel');
        const panel = document.getElementById('filterMenuPanelBody');
        const badge = document.getElementById('filterMenuBadge');
        const breadcrumb = document.getElementById('plpBreadcrumbCat');
        if (!label || !panel) return;

        const catObj = NAV_TABS.find(c => c.value === filtroCategoria);
        const catLabel = catObj ? catObj.label : filtroCategoria;
        label.childNodes[0].nodeValue = catLabel + ' ';
        if (breadcrumb) breadcrumb.textContent = catLabel;

        const activeCount = filtroTamanho.length + filtroNumero.length + filtroMarca.length;
        if (activeCount) { badge.style.display = 'inline-flex'; badge.textContent = activeCount; }
        else { badge.style.display = 'none'; }

        let html = '';

        const temTamanho = TAMANHO_CATS.includes(filtroCategoria);
        const temNumero = !temTamanho && NUMERO_CATS.includes(filtroCategoria);
        const temMarca = !!BRANDS_BY_CAT[filtroCategoria];
        if (temTamanho) {
            html += sidebarGroup('tamanho', 'Tamanho', SIZES, filtroTamanho, 'tamanho');
        } else if (temNumero) {
            html += sidebarGroup('tamanho', 'Número', NUMEROS, filtroNumero, 'numero');
        }
        if (temMarca) {
            html += sidebarGroup('marca', 'Marca', BRANDS_BY_CAT[filtroCategoria], filtroMarca, 'marca');
        }
        if (activeCount) {
            html += `<button type="button" class="chip-clear" id="filterMenuClear">Limpar filtros</button>`;
        }
        panel.innerHTML = html;

        // Categoria sem nenhum filtro disponível (ex: "Mais Procurados") —
        // não faz sentido reservar a coluna da sidebar nem deixar os produtos
        // grudados à esquerda quando a última linha não fecha; centraliza a
        // grade inteira (ver CSS .plp-body.no-filter / .product-grid.is-centered).
        const semFiltro = !temTamanho && !temNumero && !temMarca;
        const plpBody = document.querySelector('.plp-body');
        const grid = document.getElementById('product-grid');
        if (plpBody) plpBody.classList.toggle('no-filter', semFiltro);
        if (grid) grid.classList.toggle('is-centered', semFiltro);

        panel.querySelectorAll('[data-toggle-group]').forEach(head => head.addEventListener('click', (e) => {
            e.stopPropagation();
            const key = head.dataset.toggleGroup;
            sidebarGroupsOpen[key] = !(sidebarGroupsOpen[key] !== false);
            head.closest('.plp-group').classList.toggle('open', sidebarGroupsOpen[key]);
        }));
        panel.querySelectorAll('[data-group]').forEach(btn => btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const group = btn.dataset.group, val = btn.dataset.val;
            const arr = group==='tamanho' ? filtroTamanho : group==='numero' ? filtroNumero : filtroMarca;
            const idx = arr.indexOf(val);
            if (idx===-1) arr.push(val); else arr.splice(idx,1);
            renderizarCatalogo();
        }));
        const clearBtn = document.getElementById('filterMenuClear');
        if (clearBtn) clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            filtroTamanho = []; filtroNumero = []; filtroMarca = [];
            renderizarCatalogo();
        });
    }

    // ─── DISPATCHER: mobile sheet ou modal desktop ────────────────────────────
    function abrirProduto(prod) {
        marcarProdutoNoEndereco(prod);
        if (window.innerWidth <= 768) {
            abrirMobileSheet(prod);
        } else {
            abrirModal(prod);
        }
    }

    // Abre direto a peça pedida no endereço — é o que um link
    // compartilhado carrega ao chegar aqui.
    function abrirProdutoDoEndereco() {
        const id = new URLSearchParams(location.search).get('produto');
        if (!id) return;
        const prod = produtos.find(p => String(p.id) === String(id));
        if (prod) { abrirProduto(prod); return; }
        // Peça vendida ou removida: dizer isso é melhor do que largar a
        // pessoa na home sem explicação nenhuma.
        limparProdutoDoEndereco();
        showToast('Essa peça não está mais no catálogo', true);
    }

    // ─── MOBILE BOTTOM SHEET ─────────────────────────────────────────────────
    function abrirMobileSheet(prod) {
        const overlay  = document.getElementById('mobileSheet');
        const mainImg  = document.getElementById('mobileSheetImg');
        const thumbsDiv = document.getElementById('mobileSheetThumbs');
        const navLeft  = document.getElementById('mobileSheetNavLeft');
        const navRight = document.getElementById('mobileSheetNavRight');

        document.getElementById('mobileSheetTitle').innerText    = prod.nome;
        document.getElementById('mobileSheetCategory').innerText = CAT_LABEL[prod.categoria] || prod.categoria;
        document.getElementById('mobileSheetPrice').innerText    = prod.preco;
        document.getElementById('mobileSheetDesc').innerText     = prod.descricao_completa || '';
        document.getElementById('mobileSheetCopiarLink').onclick = () => copiarLinkDoProduto(prod);

        let st = '';
        if (TAMANHO_CATS.includes(prod.categoria)&&prod.tamanhos?.length) st = 'Tamanhos: '+prod.tamanhos.join(', ');
        else if (NUMERO_CATS.includes(prod.categoria)&&prod.numeracao) st = 'Numeração: '+prod.numeracao;
        const sizeEl = document.getElementById('mobileSheetSize');
        sizeEl.innerHTML = st ? `<i class="fas fa-ruler"></i> ${st}` : '';

        let extra = '';
        if (TAMANHO_CATS.includes(prod.categoria)&&prod.tamanhos) extra = ` - Tamanhos: ${prod.tamanhos.join(', ')}`;
        if (NUMERO_CATS.includes(prod.categoria)&&prod.numeracao) extra = ` - Numeração: ${prod.numeracao}`;
        document.getElementById('mobileSheetWhatsapp').href = `https://wa.me/${WHATSAPP_LOJA}?text=${encodeURIComponent('Olá! Tenho interesse: '+prod.nome+' - '+prod.preco+extra)}`;

        const imgs = prod.images || [];
        let currentIdx = 0;

        function goTo(idx) {
            if (!imgs.length) return;
            currentIdx = (idx + imgs.length) % imgs.length;
            mainImg.style.opacity = '0';
            const tmp = new Image();
            tmp.onload = () => { mainImg.src = imgs[currentIdx]; mainImg.style.opacity = '1'; };
            tmp.src = imgs[currentIdx];
            thumbsDiv.querySelectorAll('.mobile-sheet-thumb').forEach((t,i) => t.classList.toggle('active', i===currentIdx));
        }

        // Carrega imagem inicial
        if (imgs.length) {
            mainImg.style.opacity = '0';
            const tmp0 = new Image();
            tmp0.onload = () => { mainImg.src = imgs[0]; mainImg.style.opacity = '1'; };
            tmp0.src = imgs[0];
        } else {
            mainImg.src = 'https://placehold.co/600x450?text=Sem+imagem';
        }

        // Thumbnails
        thumbsDiv.innerHTML = '';
        imgs.forEach((src, i) => {
            const t = document.createElement('img');
            t.src = src; t.loading = 'lazy'; t.className = 'mobile-sheet-thumb';
            if (i === 0) t.classList.add('active');
            t.addEventListener('click', () => goTo(i));
            thumbsDiv.appendChild(t);
        });

        // Setas
        if (imgs.length <= 1) { navLeft.classList.add('hidden'); navRight.classList.add('hidden'); }
        else { navLeft.classList.remove('hidden'); navRight.classList.remove('hidden'); }
        navLeft.onclick = () => goTo(currentIdx - 1);
        navRight.onclick = () => goTo(currentIdx + 1);

        // Swipe touch na imagem
        let tStartX = 0, tStartY = 0, swiping = false;
        mainImg.addEventListener('touchstart', e => {
            tStartX = e.touches[0].clientX; tStartY = e.touches[0].clientY; swiping = false;
        }, { passive: true });
        mainImg.addEventListener('touchmove', e => {
            const dx = Math.abs(e.touches[0].clientX - tStartX);
            const dy = Math.abs(e.touches[0].clientY - tStartY);
            if (dx > dy && dx > 8) { swiping = true; e.preventDefault(); }
        }, { passive: false });
        mainImg.addEventListener('touchend', e => {
            if (!swiping) return;
            const dx = e.changedTouches[0].clientX - tStartX;
            if (Math.abs(dx) > 35) goTo(dx < 0 ? currentIdx + 1 : currentIdx - 1);
        }, { passive: true });

        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function fecharMobileSheet() {
        const overlay = document.getElementById('mobileSheet');
        const sheet = overlay.querySelector('.mobile-sheet');
        sheet.style.transform = 'translateY(100%)';
        setTimeout(() => {
            overlay.classList.remove('open');
            sheet.style.transform = '';
        }, 360);
        document.body.style.overflow = 'auto';
        limparProdutoDoEndereco();
    }

    document.getElementById('mobileSheetClose').addEventListener('click', fecharMobileSheet);
    document.getElementById('mobileSheet').addEventListener('click', e => {
        if (e.target === document.getElementById('mobileSheet')) fecharMobileSheet();
    });

    // ─── MODAL PRODUTO ────────────────────────────────────────────────────────
    function abrirModal(prod) {
        document.getElementById('modalTitle').innerText = prod.nome;
        document.getElementById('modalCategory').innerText = CAT_LABEL[prod.categoria] || prod.categoria;
        document.getElementById('modalPrice').innerText = prod.preco;
        document.getElementById('modalDesc').innerText = prod.descricao_completa || '';
        // onclick (e não addEventListener) porque abrirModal roda uma vez
        // por peça: com listener, cada abertura empilharia mais um.
        document.getElementById('modalCopiarLink').onclick = () => copiarLinkDoProduto(prod);
        let st = '';
        if (TAMANHO_CATS.includes(prod.categoria)&&prod.tamanhos?.length) st = 'Tamanhos: '+prod.tamanhos.join(', ');
        else if (NUMERO_CATS.includes(prod.categoria)&&prod.numeracao) st = 'Numeração: '+prod.numeracao;
        document.getElementById('modalSize').innerHTML = st ? `<i class="fas fa-ruler"></i> ${st}` : '';
        const imgs = prod.images||[];
        const mainImg = document.getElementById('modalMainImg');
        const thumbsDiv = document.getElementById('modalThumbs');
        let currentIdx = 0;
        function goToImg(idx) {
            if (!imgs.length) return;
            currentIdx = (idx + imgs.length) % imgs.length;
            const newSrc = imgs[currentIdx];
            // preload then fade in
            mainImg.style.opacity = '0';
            const tmp = new Image();
            tmp.onload = () => { mainImg.src = newSrc; mainImg.style.opacity = '1'; };
            tmp.src = newSrc;
            thumbsDiv.querySelectorAll('.modal-thumb').forEach((t,i) => t.classList.toggle('active', i===currentIdx));
        }
        if(imgs.length) { mainImg.style.opacity='0'; const tmp0=new Image(); tmp0.onload=()=>{ mainImg.src=imgs[0]; mainImg.style.opacity='1'; }; tmp0.src=imgs[0]; }
        thumbsDiv.innerHTML = '';
        imgs.forEach((img,i) => {
            const t = document.createElement('img'); t.src=img; t.loading='lazy'; t.className='modal-thumb'; if(i===0) t.classList.add('active');
            t.addEventListener('click', () => goToImg(i));
            thumbsDiv.appendChild(t);
        });
        // Setas desktop
        const navLeft = document.getElementById('modalNavLeft');
        const navRight = document.getElementById('modalNavRight');
        if (imgs.length <= 1) { navLeft.classList.add('hidden'); navRight.classList.add('hidden'); }
        else { navLeft.classList.remove('hidden'); navRight.classList.remove('hidden'); }
        navLeft.onclick = () => goToImg(currentIdx - 1);
        navRight.onclick = () => goToImg(currentIdx + 1);
        let touchStartX = 0, touchStartY = 0, isSwiping = false;
        mainImg.style.cursor = 'grab';
        mainImg.addEventListener('touchstart', e => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            isSwiping = false;
        }, { passive: true });
        mainImg.addEventListener('touchmove', e => {
            const dx = Math.abs(e.touches[0].clientX - touchStartX);
            const dy = Math.abs(e.touches[0].clientY - touchStartY);
            if (dx > dy && dx > 8) { isSwiping = true; e.preventDefault(); }
        }, { passive: false });
        mainImg.addEventListener('touchend', e => {
            if (!isSwiping) return;
            const dx = e.changedTouches[0].clientX - touchStartX;
            if (Math.abs(dx) > 35) goToImg(dx < 0 ? currentIdx + 1 : currentIdx - 1);
        }, { passive: true });
        let extra = '';
        if (TAMANHO_CATS.includes(prod.categoria)&&prod.tamanhos) extra = ` - Tamanhos: ${prod.tamanhos.join(', ')}`;
        if (NUMERO_CATS.includes(prod.categoria)&&prod.numeracao) extra = ` - Numeração: ${prod.numeracao}`;
        document.getElementById('modalWhatsappBtn').href = `https://wa.me/${WHATSAPP_LOJA}?text=${encodeURIComponent('Olá! Tenho interesse: '+prod.nome+' - '+prod.preco+extra)}`;
        document.getElementById('productModal').style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
    function fecharModal() { document.getElementById('productModal').style.display='none'; document.body.style.overflow='auto'; limparProdutoDoEndereco(); }
    document.getElementById('productModalClose').addEventListener('click', fecharModal);
    window.addEventListener('click', e => { if(e.target===document.getElementById('productModal')) fecharModal(); });

    // ─── ADMIN: CRUD ──────────────────────────────────────────────────────────
    async function atualizarProduto(id, updates) {
        try {
            const updated = await dbUpdate(id, updates);
            // atualiza local e normaliza
            const i = produtos.findIndex(p => p.id === id);
            if (i !== -1) produtos[i] = normalizeProduct(updated || { ...produtos[i], ...updates });
            renderizarCatalogo(); renderizarSecoesCuradas();
            if (adminVisible) {
                // recarrega os dados do admin para manter consistência
                if(typeof admLoadData === 'function') await admLoadData();
                renderizarAdminLista();
            }
            return true;
        } catch(e) { console.error(e); showToast('Erro ao atualizar: '+e.message, true); return false; }
    }

    async function excluirProduto(id) {
        if (!confirm('Excluir este produto permanentemente?')) return;
        try {
            await dbDelete(id);
            produtos = produtos.filter(p => p.id !== id);
            renderizarCatalogo(); renderizarSecoesCuradas();
            if (adminVisible) renderizarAdminLista();
            showToast('Produto removido.');
        } catch(e) { console.error(e); showToast('Erro ao remover: '+e.message, true); }
    }

    async function alternarVendido(id, statusAtual) {
        const novo = statusAtual==='vendido' ? 'disponiveis' : 'vendido';
        const ok = await atualizarProduto(id, { status: novo });
        if(ok){
            const p = produtos.find(x=>x.id===id);
            if(novo==='vendido' && p) addSaleRecord(p);
            if(novo!=='vendido') removeSaleRecord(id);
        }
    }

    // ─── ADMIN: LISTA ─────────────────────────────────────────────────────────
    function renderizarAdminLista() {
        const c = document.getElementById('adminListaContainer');
        if (!c) return;
        if (!produtos.length) { c.innerHTML='<div style="padding:20px;text-align:center;color:#aaa;">Nenhum produto cadastrado</div>'; return; }
        c.innerHTML = '';
        const ST = { disponiveis:'✓ Disponível', lancamentos:'⭐ Lançamento', embreve:'⏳ Em breve', vendido:'🔴 Vendido' };
        produtos.forEach(prod => {
            const div = document.createElement('div'); div.className='admin-item';
            div.innerHTML = `
                <div class="admin-item-info">
                    <strong>${escapeHtml(prod.nome)}</strong>
                    <span style="color:#B8924F">${prod.categoria.toUpperCase()}</span>
                    <span>${prod.preco}</span>
                    <span style="font-size:.7rem">📷 ${(prod.images||[]).length}</span>
                    <span style="font-size:.7rem">${ST[prod.status]||prod.status}</span>
                </div>
                <div class="admin-actions">
                    <button class="edit-ad" data-id="${prod.id}">✏️ Editar</button>
                    <button class="mark-sold" data-id="${prod.id}" data-status="${prod.status}">${prod.status==='vendido'?'🔄 Reativar':'🏷️ Marcar vendido'}</button>
                    <button class="delete-prod" data-id="${prod.id}">🗑️ Remover</button>
                </div>`;
            c.appendChild(div);
        });
        c.querySelectorAll('.edit-ad').forEach(b => b.addEventListener('click', () => { const p=produtos.find(x=>x.id===Number(b.dataset.id)); if(p) abrirEdicao(p); }));
        c.querySelectorAll('.mark-sold').forEach(b => b.addEventListener('click', () => alternarVendido(Number(b.dataset.id), b.dataset.status)));
        c.querySelectorAll('.delete-prod').forEach(b => b.addEventListener('click', () => excluirProduto(Number(b.dataset.id))));
    }

    // ─── ADMIN: ADICIONAR ─────────────────────────────────────────────────────
    async function adicionarProduto() {
        const nome = document.getElementById('prodNome').value.trim();
        const desc = document.getElementById('prodDesc').value.trim();
        let preco = document.getElementById('prodPreco').value.trim();
        const imagesText = document.getElementById('prodImagens').value.trim();
        const imageFilesEl = document.getElementById('prodImageFiles');
        const imageFiles = imageFilesEl ? imageFilesEl.files : null;
        const categoria = document.getElementById('prodCategoria').value;
        const status = document.getElementById('prodStatus').value;
        let images = imagesText.split('\n').map(u=>u.trim()).filter(Boolean);

        if (!nome || !preco || (images.length===0 && (!imageFiles||!imageFiles.length))) {
            alert('Preencha nome, preço e pelo menos uma imagem.'); return;
        }

        if (imageFiles && imageFiles.length) {
            showToast('Fazendo upload das imagens...');
            for (const f of imageFiles) {
                try { images.push(await uploadImage(f)); }
                catch(e) { showToast('Erro no upload: '+e.message, true); return; }
            }
        }

        const data = { nome, descricao_completa:desc, preco, images, categoria, status };
        if (TAMANHO_CATS.includes(categoria)) {
            const t = Array.from(document.querySelectorAll('#dynamicFieldsContainer input[type=checkbox]:checked')).map(cb=>cb.value);
            if (!t.length) { alert('Selecione pelo menos um tamanho.'); return; }
            data.tamanhos = t;
        } else if (categoria==='calcados') {
            const n = document.getElementById('numeracaoInput')?.value.trim();
            if (!n) { alert('Informe a numeração.'); return; }
            data.numeracao = n;
        }

        try {
            const result = await dbInsert(data);
            if (result) produtos.unshift(normalizeProduct(result));
            renderizarCatalogo(); renderizarSecoesCuradas();
            if (adminVisible && typeof admLoadData === 'function') await admLoadData();
            document.getElementById('prodNome').value = '';
            document.getElementById('prodDesc').value = '';
            document.getElementById('prodPreco').value = 'R$ 0,00';
            document.getElementById('prodImagens').value = '';
            if (imageFilesEl) imageFilesEl.value = '';
            updateDynamicFields();
            showToast('Produto adicionado com sucesso!');
        } catch(e) { console.error(e); showToast('Erro ao adicionar: '+e.message, true); }
    }

    // ─── ADMIN: EDITAR ────────────────────────────────────────────────────────
    async function abrirEdicao(prod) {
        currentEditId = prod.id;
        document.getElementById('editNome').value = prod.nome;
        document.getElementById('editDesc').value = prod.descricao_completa||'';
        document.getElementById('editPreco').value = prod.preco;
        document.getElementById('editCategoria').value = prod.categoria;
        document.getElementById('editStatus').value = prod.status;
        updateEditSizeFields(prod);
        const c = document.getElementById('editImagesContainer');
        c.innerHTML = '';
        (prod.images||[]).forEach((img,idx) => {
            const d = document.createElement('div'); d.className='image-preview-item';
            d.draggable = true;
            d.dataset.origIndex = idx;
            d.innerHTML = `<img src="${img}"><button class="remove-image-btn" data-orig-index="${idx}" data-removed="false">✕</button>`;
            // drag handlers
            d.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', String(idx)); d.classList.add('dragging'); });
            d.addEventListener('dragend', () => { d.classList.remove('dragging'); document.querySelectorAll('#editImagesContainer .image-preview-item').forEach(x=>x.classList.remove('drag-over')); });
            d.addEventListener('dragover', e => { e.preventDefault(); d.classList.add('drag-over'); });
            d.addEventListener('dragleave', () => d.classList.remove('drag-over'));
            d.addEventListener('drop', e => {
                e.preventDefault(); d.classList.remove('drag-over');
                const srcIdx = e.dataTransfer.getData('text/plain');
                if(!srcIdx) return;
                const srcEl = Array.from(c.children).find(x=>x.dataset.origIndex===String(srcIdx));
                if(!srcEl || srcEl===d) return;
                c.insertBefore(srcEl, d.nextSibling);
            });
            c.appendChild(d);
        });
        document.getElementById('editNewImages').value = '';
        document.getElementById('editModal').style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    function updateEditSizeFields(prod) {
        const c = document.getElementById('editSizeContainer');
        c.innerHTML = '';
        if (TAMANHO_CATS.includes(prod.categoria)) {
            c.innerHTML = `<label>Tamanhos:</label><div class="edit-checkbox-group" id="editTamanhosGroup">${['XXS','XS','S','M','L','XL','XXL'].map(t=>`<label><input type="checkbox" value="${t}" ${prod.tamanhos?.includes(t)?'checked':''}> ${t}</label>`).join('')}</div>`;
        } else if (prod.categoria==='calcados') {
            c.innerHTML = `<label>Numeração</label><input type="text" id="editNumeracao" value="${prod.numeracao||''}" placeholder="Ex: 35, 36, 37-40">`;
        }
    }

    document.getElementById('editCategoria').addEventListener('change', () => {
        const p = produtos.find(x=>x.id===currentEditId);
        if (p) updateEditSizeFields({...p, categoria:document.getElementById('editCategoria').value});
    });

    document.getElementById('editImagesContainer').addEventListener('click', e => {
        const btn = e.target.closest('.remove-image-btn');
        if (!btn) return;
        const removed = btn.dataset.removed === 'true';
        btn.dataset.removed = String(!removed);
        btn.textContent = !removed ? '↩' : '✕';
        const img = btn.previousElementSibling; if(img) img.style.opacity = !removed ? '0.25' : '1';
    });

    document.getElementById('editSaveBtn').addEventListener('click', async () => {
        const nome = document.getElementById('editNome').value.trim();
        const desc = document.getElementById('editDesc').value.trim();
        let preco = document.getElementById('editPreco').value.trim();
        const categoria = document.getElementById('editCategoria').value;
        const status = document.getElementById('editStatus').value;
        if (!nome||!preco) { alert('Nome e preço são obrigatórios'); return; }

        let tamanhos=null, numeracao=null;
        if (TAMANHO_CATS.includes(categoria)) {
            tamanhos = Array.from(document.querySelectorAll('#editTamanhosGroup input:checked')).map(cb=>cb.value);
            if (!tamanhos.length) { alert('Selecione pelo menos um tamanho'); return; }
        } else if (categoria==='calcados') {
            numeracao = document.getElementById('editNumeracao')?.value.trim();
            if (!numeracao) { alert('Informe a numeração'); return; }
        }

        const prodAtual = produtos.find(p=>p.id===currentEditId);
        // build images array following DOM order and excluding removed
        const container = document.getElementById('editImagesContainer');
        const imgs = [];
        const origImgs = prodAtual.images || [];
        Array.from(container.querySelectorAll('.image-preview-item')).forEach(item => {
            const btn = item.querySelector('.remove-image-btn');
            const isRemoved = btn && btn.dataset.removed === 'true';
            if (!isRemoved){
                const oi = item.dataset.origIndex ? parseInt(item.dataset.origIndex,10) : null;
                if (oi !== null && origImgs[oi]) imgs.push(origImgs[oi]);
            }
        });
        const newFiles = document.getElementById('editNewImages').files;
        if (newFiles&&newFiles.length) {
            showToast('Fazendo upload...');
            for (const f of newFiles) {
                try { imgs.push(await uploadImage(f)); }
                catch(e) { showToast('Erro no upload: '+e.message, true); return; }
            }
        }

        const updates = { nome, descricao_completa:desc, preco, categoria, status, images:imgs, tamanhos, numeracao };
        const ok = await atualizarProduto(currentEditId, updates);
        if (ok) { document.getElementById('editModal').style.display='none'; document.body.style.overflow='auto'; showToast('Produto atualizado!'); }
    });

    document.getElementById('editCancelBtn').addEventListener('click', () => { document.getElementById('editModal').style.display='none'; document.body.style.overflow='auto'; });
    document.getElementById('editModalClose').addEventListener('click', () => { document.getElementById('editModal').style.display='none'; document.body.style.overflow='auto'; });

    // ─── CAMPOS DINÂMICOS ─────────────────────────────────────────────────────
    function updateDynamicFields() {
        const cat = document.getElementById('prodCategoria').value;
        const c = document.getElementById('dynamicFieldsContainer');
        c.innerHTML = '';
        if (TAMANHO_CATS.includes(cat)) c.innerHTML = `<div class="dynamic-field"><label>Tamanhos:</label><div class="size-checkbox-group"><label><input type="checkbox" value="XXS"> XXS</label><label><input type="checkbox" value="XS"> XS</label><label><input type="checkbox" value="S"> S</label><label><input type="checkbox" value="M"> M</label><label><input type="checkbox" value="L"> L</label><label><input type="checkbox" value="XL"> XL</label><label><input type="checkbox" value="XXL"> XXL</label></div></div>`;
        else if (cat==='calcados') c.innerHTML = `<div class="dynamic-field"><input type="text" id="numeracaoInput" placeholder="Numeração (ex: 35, 36, 37-40)"></div>`;
    }

    function escapeHtml(s) {
        return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    }

    // ─── EVENTOS ──────────────────────────────────────────────────────────────
    // ─── LOGIN ADMIN ──────────────────────────────────────────────────────────
    const loginModal = document.getElementById('loginModal');
    let logoTimer = null;
    // Sessão de admin ativa: permite reabrir o painel (botão flutuante ou
    // duplo-clique na logo) sem pedir a senha de novo, até clicar em "Sair".
    let admSessionActive = false;
    document.getElementById('adminTriggerLogo').addEventListener('click', () => {
        if (logoTimer) clearTimeout(logoTimer);
        logoTimer = setTimeout(() => { logoTimer=null; window.location.reload(); }, 350);
    });
    document.getElementById('adminTriggerLogo').addEventListener('dblclick', async () => {
        if (logoTimer) { clearTimeout(logoTimer); logoTimer=null; }

        // Sessão ainda válida → entra direto, sem pedir a senha de novo.
        // O token é revalidado no SERVIDOR a cada abertura: substitui o
        // antigo `admSessionActive`, que era só um booleano em memória e
        // portanto não sabia se a conta ainda existe ou foi desativada.
        // A flag continua sendo mantida porque o botão "voltar ao painel"
        // depende dela.
        if (getToken()) {
            try {
                sessaoUsuario = await apiFetch('GET', '/api/auth/me');
                admSessionActive = true;
                abrirAdminOverlay();
                return;
            } catch (e) {
                limparSessao();
                admSessionActive = false;
            }
        }
        document.getElementById('loginErro').style.display = 'none';
        loginModal.style.display='flex'; document.body.style.overflow='hidden';
    });
    document.getElementById('loginModalClose').addEventListener('click', () => { loginModal.style.display='none'; document.body.style.overflow='auto'; });
    window.addEventListener('click', e => { if(e.target===loginModal) { loginModal.style.display='none'; document.body.style.overflow='auto'; } });
    // Login de verdade: quem valida é a API. A senha nunca é comparada
    // aqui — antes, `=== 'fbadmin'` no navegador era toda a "segurança",
    // legível por qualquer visitante em Exibir código-fonte.
    async function fazerLogin() {
        const btn = document.getElementById('loginAdminBtn');
        const erroEl = document.getElementById('loginErro');
        const email = (document.getElementById('adminEmail').value || '').trim();
        const senha = document.getElementById('adminPassword').value || '';

        erroEl.style.display = 'none';
        if (!email || !senha) {
            erroEl.textContent = 'Informe e-mail e senha.';
            erroEl.style.display = 'block';
            return;
        }

        btn.disabled = true;
        const textoOriginal = btn.textContent;
        btn.textContent = 'Entrando...';
        try {
            const r = await apiFetch('POST', '/api/auth/login', { email, senha });
            setToken(r.token);
            sessaoUsuario = r.usuario;
            admSessionActive = true;
            loginModal.style.display = 'none';
            document.body.style.overflow = 'hidden';
            document.getElementById('adminPassword').value = '';
            document.getElementById('adminEmail').value = '';
            abrirAdminOverlay();
        } catch (e) {
            erroEl.textContent = e.message || 'Não foi possível entrar.';
            erroEl.style.display = 'block';
        } finally {
            btn.disabled = false;
            btn.textContent = textoOriginal;
        }
    }

    document.getElementById('loginAdminBtn').addEventListener('click', fazerLogin);
    // Enter em qualquer um dos dois campos envia — sem isto o usuário
    // digita a senha, aperta Enter e nada acontece.
    ['adminEmail', 'adminPassword'].forEach((id) => {
        document.getElementById(id).addEventListener('keydown', (e) => {
            if (e.key === 'Enter') fazerLogin();
        });
    });

    // Ícones (Tabler) e gráfico (Chart.js) só existem pro painel — carregar
    // os dois de cara pra todo visitante custaria uma folha de estilo e um
    // script inteiros que 99% de quem entra no site nunca usa. Ficam pra
    // trás do primeiro clique em "entrar no admin", e a promise em cache
    // evita reinjetar as tags se o painel for reaberto na mesma sessão.
    let adminAssetsPromise = null;
    function carregarAdminAssets() {
        if (adminAssetsPromise) return adminAssetsPromise;
        const carregarLink = () => new Promise((resolve, reject) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css';
            link.onload = resolve;
            link.onerror = reject;
            document.head.appendChild(link);
        });
        const carregarScript = () => new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
        adminAssetsPromise = Promise.all([carregarLink(), carregarScript()]);
        return adminAssetsPromise;
    }

    async function abrirAdminOverlay() {
        const overlay = document.getElementById('adminOverlay');
        overlay.style.display = 'block';
        document.body.style.overflow = 'hidden';
        document.getElementById('backToAdminBtn').style.display = 'none';
        adminVisible = true;
        await carregarAdminAssets();
        admInit();
        // Fora do admInit de propósito: ele só roda por completo na
        // primeira abertura, e as permissões podem ter mudado desde
        // então (o admin alterou, a pessoa reabriu).
        admAplicarPermissoesNaNav();
    }

    document.getElementById('viewSiteAdminBtn').addEventListener('click', () => {
        document.getElementById('adminOverlay').style.display = 'none';
        document.body.style.overflow = 'auto';
        adminVisible = false;
        document.getElementById('backToAdminBtn').style.display = 'flex';
    });
    document.getElementById('backToAdminBtn').addEventListener('click', abrirAdminOverlay);

    document.getElementById('logoutAdminBtn').addEventListener('click', () => {
        // Descarta a credencial, não só fecha a tela: antes o "Sair"
        // apenas escondia o painel, e reabrir voltava a dar acesso.
        limparSessao();
        document.getElementById('adminOverlay').style.display = 'none';
        document.body.style.overflow = 'auto';
        adminVisible = false;
        admSessionActive = false;
        document.getElementById('backToAdminBtn').style.display = 'none';
    });

    // ─── DASHBOARD v2 ────────────────────────────────────────────────────────
    let admProds = [], admEditId = null, admRevChart = null, admTab = 'dashboard', admDragSrcId = null;
    let admNewFiles = []; // arquivos selecionados no modal admin (preview)
    let admInited = false;

    // Derivados de CATS (agora carregada do banco) — recalculados em
    // recalcularDerivadosDeCategorias() sempre que as categorias mudam.
    let ADM_CATS = {casacos:'Casacos',camisetas:'Camisetas',shorts:'Shorts',calcados:'Calçados',acessorios:'Acessórios',perfumes:'Perfumes'};
    let ADM_ICONS = {casacos:'ti-hanger',camisetas:'ti-shirt',shorts:'ti-layout-rows',calcados:'ti-shoe',acessorios:'ti-diamond',perfumes:'ti-spray'};
    const ADM_COLORS = ['#B8924F','#7a5c2e','#d4a85a','#c8a87a','#8f6a35','#e0c48a'];
    const ADM_STATUS_OPTS = {disponiveis:'Disponível',lancamentos:'Lançamento',vendido:'Vendido',embreve:'Em breve'};
    const ADM_STATUS_CLS = {disponiveis:'adm-p-disp',lancamentos:'adm-p-lanc',vendido:'adm-p-vend',embreve:'adm-p-brev'};

    const admPn = p => parseFloat((p||'').replace('R$','').replace(/\./g,'').replace(',','.').trim())||0;
    const admFR = v => 'R$ '+v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
    const admRt = d => { if(!d)return'—'; const s=(Date.now()-new Date(d))/1000; if(s<60)return'agora'; if(s<3600)return Math.floor(s/60)+'min atrás'; if(s<86400)return Math.floor(s/3600)+'h atrás'; return Math.floor(s/86400)+'d atrás'; };
    const admEsc = s => { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; };
    const admEl = id => document.getElementById(id);

    function admToast(msg) { const t=admEl('adm-toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2600); }

    async function admLoadData() {
        try { admProds = await dbGetAll(); } catch { admProds = []; }
        // Normaliza os produtos e sincroniza com a visão pública
        admProds = Array.isArray(admProds) ? admProds.map(normalizeProduct) : [];
        produtos = admProds.slice();
        renderizarCatalogo();
        renderizarSecoesCuradas();
    }

    // Seletor de tamanho/numeração por botões no formulário de produto. Os
    // botões são renderizados dinamicamente a partir de SIZES/NUMEROS (vindos
    // do banco — ver carregarSizeOptions()), então adicionar um novo tamanho
    // ou numeração no admin passa a aparecer aqui sem editar código. Antes só
    // "Tamanhos" tinha esse seletor; "Numeração" (calçados) era texto livre
    // e por isso não alimentava o filtro do site corretamente — esse era o
    // bug relatado.
    function renderSizeButtonGroup(containerId, values, onToggle){
        const el = admEl(containerId);
        if (!el) return;
        el.innerHTML = values.map(v => `<button type="button" class="size-opt" data-size="${admEsc(v)}">${admEsc(v)}</button>`).join('');
        el.querySelectorAll('.size-opt').forEach(b => b.addEventListener('click', () => { b.classList.toggle('active'); onToggle(); }));
    }
    function syncButtonGroupToInput(containerId, inputId){
        const sel = Array.from(document.querySelectorAll(`#${containerId} .size-opt.active`)).map(b=>b.dataset.size);
        admEl(inputId).value = sel.join(',');
    }
    function updateButtonGroupFromValue(containerId, val){
        const arr = String(val||'').split(',').map(x=>x.trim()).filter(Boolean);
        document.querySelectorAll(`#${containerId} .size-opt`).forEach(b=>{
            b.classList.toggle('active', arr.includes(b.dataset.size));
        });
    }
    function syncSizesToInput(){ syncButtonGroupToInput('adm-f-tamanhos-buttons', 'adm-f-tamanhos'); }
    function updateSizeButtonsFromValue(val){ updateButtonGroupFromValue('adm-f-tamanhos-buttons', val); }
    function syncNumerosToInput(){ syncButtonGroupToInput('adm-f-numeracao-buttons', 'adm-f-numeracao'); }
    function updateNumeroButtonsFromValue(val){ updateButtonGroupFromValue('adm-f-numeracao-buttons', val); }
    function refreshNumSizeVisibility(){
        const cat = admEl('adm-f-cat').value;
        const rowNum = admEl('adm-row-numeracao');
        const rowSizes = admEl('adm-row-tamanhos');
        const rowMarca = admEl('adm-row-marca');
        if(NUMERO_CATS.includes(cat)){
            if(rowNum) rowNum.style.display='block';
            if(rowSizes) rowSizes.style.display='none';
        } else if(TAMANHO_CATS.includes(cat)){
            if(rowNum) rowNum.style.display='none';
            if(rowSizes) rowSizes.style.display='block';
        } else {
            if(rowNum) rowNum.style.display='none';
            if(rowSizes) rowSizes.style.display='none';
        }
        if (rowMarca) {
            const brands = BRANDS_BY_CAT[cat];
            const sel = admEl('adm-f-marca');
            if (brands) {
                rowMarca.style.display = 'block';
                const currentVal = sel.value;
                sel.innerHTML = '<option value="">Selecione</option>' + brands.map(b=>`<option value="${b}">${b}</option>`).join('');
                if (brands.includes(currentVal)) sel.value = currentVal;
            } else {
                rowMarca.style.display = 'none';
                sel.innerHTML = '<option value="">Selecione</option>';
            }
        }
    }


    // ─── GESTÃO DE USUÁRIOS (somente admin) ──────────────────────────────────

    const PERM_ROTULOS = {
        produtos: 'Produtos', categorias: 'Categorias',
        marcas: 'Marcas', tamanhos: 'Tamanhos', config: 'Site',
        feedbacks: 'Feedbacks'
    };
    let admPermsDisponiveis = ['produtos', 'categorias', 'marcas', 'tamanhos', 'config', 'feedbacks'];

    function admRenderPermCheckboxes() {
        const box = admEl('adm-u-perms');
        if (!box) return;
        box.innerHTML = admPermsDisponiveis.map((p) => `
            <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
                <input type="checkbox" value="${p}" class="adm-u-perm-cb"> ${PERM_ROTULOS[p] || p}
            </label>`).join('');
    }

    // ─── FEEDBACKS (painel) ───────────────────────────────────────────────────
    let admFeedbacks = [];

    async function admRenderFeedbacks() {
        const wrap = admEl('adm-fb-lista');
        if (!wrap) return;
        wrap.innerHTML = '<p style="opacity:.6;font-size:13px">Carregando...</p>';
        try {
            admFeedbacks = await apiFetch('GET', '/api/feedbacks/todos');
        } catch (err) {
            wrap.innerHTML = `<p style="color:#ff6b6b;font-size:13px">${admEsc(err.message)}</p>`;
            return;
        }
        if (!admFeedbacks.length) {
            wrap.innerHTML = '<p style="opacity:.6;font-size:13px">Nenhum feedback cadastrado ainda.</p>';
            return;
        }
        wrap.innerHTML = admFeedbacks.map((f, i) => {
            const resumo = f.tipo === 'print'
                ? `<img src="${admEsc(f.imagem || '')}" style="width:54px;height:72px;object-fit:cover;border-radius:6px;border:1px solid #262626">`
                : `<div style="font-size:12px;opacity:.75;max-width:340px;line-height:1.5">${admEsc((f.texto || '').slice(0, 160))}${(f.texto || '').length > 160 ? '…' : ''}</div>`;
            const autor = [f.nome, f.cidade].filter(Boolean).join(' · ');
            return `
            <div style="border:1px solid #262626;border-radius:10px;padding:14px;margin-bottom:10px;background:#111;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
              ${resumo}
              <div style="flex:1;min-width:160px">
                <div style="font-size:12px;opacity:.55">${f.tipo === 'print' ? 'Print da conversa' : 'Depoimento escrito'}</div>
                ${autor ? `<div style="font-size:13px;margin-top:3px">${admEsc(autor)}</div>` : ''}
              </div>
              <div style="display:flex;gap:8px;align-items:center">
                <button type="button" class="adm-fb-mover" data-id="${f.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''}
                    style="background:#1a1a1a;color:#eaeaea;border:1px solid #262626;border-radius:8px;padding:5px 9px;font-size:12px;cursor:pointer">↑</button>
                <button type="button" class="adm-fb-mover" data-id="${f.id}" data-dir="1" ${i === admFeedbacks.length - 1 ? 'disabled' : ''}
                    style="background:#1a1a1a;color:#eaeaea;border:1px solid #262626;border-radius:8px;padding:5px 9px;font-size:12px;cursor:pointer">↓</button>
                <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
                  <input type="checkbox" class="adm-fb-ativo" data-id="${f.id}" ${f.ativo ? 'checked' : ''}> No site
                </label>
                <button type="button" class="adm-fb-del" data-id="${f.id}"
                    style="background:#2a1212;color:#ff6b6b;border:1px solid #4a1f1f;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer">Excluir</button>
              </div>
            </div>`;
        }).join('');

        wrap.querySelectorAll('.adm-fb-ativo').forEach(cb => cb.addEventListener('change', async () => {
            const fd = new FormData();
            fd.append('ativo', cb.checked ? 'true' : 'false');
            try {
                await apiFetch('PUT', `/api/feedbacks/${cb.dataset.id}`, fd);
                admToast(cb.checked ? 'Aparecendo no site' : 'Escondido do site');
                renderizarFeedbacks();
            } catch (err) { cb.checked = !cb.checked; admToast(err.message); }
        }));

        wrap.querySelectorAll('.adm-fb-del').forEach(b => b.addEventListener('click', async () => {
            if (!confirm('Excluir este feedback? Não dá para desfazer.')) return;
            try {
                await apiFetch('DELETE', `/api/feedbacks/${b.dataset.id}`);
                admToast('Feedback excluído');
                admRenderFeedbacks();
                renderizarFeedbacks();
            } catch (err) { admToast(err.message); }
        }));

        // Reordenar troca a posição com o vizinho: duas gravações, que é
        // o suficiente para uma lista desse tamanho.
        wrap.querySelectorAll('.adm-fb-mover').forEach(b => b.addEventListener('click', async () => {
            const dir = parseInt(b.dataset.dir, 10);
            const idx = admFeedbacks.findIndex(f => String(f.id) === String(b.dataset.id));
            const alvo = idx + dir;
            if (idx < 0 || alvo < 0 || alvo >= admFeedbacks.length) return;
            const a = admFeedbacks[idx], c = admFeedbacks[alvo];
            try {
                const fdA = new FormData(); fdA.append('ordem', String(c.ordem));
                const fdC = new FormData(); fdC.append('ordem', String(a.ordem));
                await apiFetch('PUT', `/api/feedbacks/${a.id}`, fdA);
                await apiFetch('PUT', `/api/feedbacks/${c.id}`, fdC);
                admRenderFeedbacks();
                renderizarFeedbacks();
            } catch (err) { admToast(err.message); }
        }));
    }

    async function admCriarFeedback() {
        const btn = admEl('adm-fb-criar');
        const tipo = admEl('adm-fb-tipo').value;
        const arquivo = admEl('adm-fb-imagem').files[0];
        const texto = admEl('adm-fb-texto').value.trim();

        if (tipo === 'print' && !arquivo) { admToast('Escolha a imagem do print'); return; }
        if (tipo === 'texto' && !texto) { admToast('Escreva o depoimento'); return; }

        const fd = new FormData();
        fd.append('tipo', tipo);
        if (arquivo) fd.append('imagem', arquivo);
        fd.append('texto', tipo === 'texto' ? texto : '');
        fd.append('nome', admEl('adm-fb-nome').value.trim());
        fd.append('cidade', admEl('adm-fb-cidade').value.trim());

        btn.disabled = true;
        try {
            await apiFetch('POST', '/api/feedbacks', fd);
            admToast('Feedback adicionado');
            admEl('adm-fb-imagem').value = '';
            admEl('adm-fb-texto').value = '';
            admEl('adm-fb-nome').value = '';
            admEl('adm-fb-cidade').value = '';
            admRenderFeedbacks();
            renderizarFeedbacks();
        } catch (err) {
            admToast(err.message);
        } finally {
            btn.disabled = false;
        }
    }

    async function admRenderUsuarios() {
        const lista = admEl('adm-u-lista');
        if (!lista) return;
        lista.innerHTML = '<p style="opacity:.6;font-size:13px">Carregando...</p>';
        try {
            const r = await apiFetch('GET', '/api/usuarios');
            if (Array.isArray(r.permissoesDisponiveis) && r.permissoesDisponiveis.length) {
                admPermsDisponiveis = r.permissoesDisponiveis;
                admRenderPermCheckboxes();
            }
            const usuarios = r.usuarios || [];
            lista.innerHTML = usuarios.map((u) => {
                const perms = Array.isArray(u.permissoes) ? u.permissoes : [];
                const ehAdmin = u.papel === 'admin';
                const souEu = sessaoUsuario && sessaoUsuario.id === u.id;
                const chips = ehAdmin
                    ? '<span style="opacity:.7;font-size:12px">Acesso total (administrador)</span>'
                    : admPermsDisponiveis.map((p) => `
                        <label style="display:inline-flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;margin-right:10px">
                            <input type="checkbox" data-uid="${u.id}" data-perm="${p}" class="adm-u-toggle-perm"
                                   ${perms.includes(p) ? 'checked' : ''}> ${PERM_ROTULOS[p] || p}
                        </label>`).join('');
                return `
                <div style="border:1px solid #262626;border-radius:10px;padding:14px;margin-bottom:10px;background:#111">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
                    <div>
                      <div style="font-weight:600">${u.nome} ${souEu ? '<span style="opacity:.5;font-size:12px">(você)</span>' : ''}</div>
                      <div style="font-size:12px;opacity:.65">${u.email} · ${ehAdmin ? 'Administrador' : 'Usuário'}</div>
                    </div>
                    <div style="display:flex;gap:8px;align-items:center">
                      <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
                        <input type="checkbox" class="adm-u-toggle-ativo" data-uid="${u.id}" ${u.ativo ? 'checked' : ''}
                               ${souEu ? 'disabled' : ''}> Ativo
                      </label>
                      ${souEu ? '' : `<button type="button" class="adm-u-del" data-uid="${u.id}"
                          style="background:#2a1212;color:#ff6b6b;border:1px solid #4a1f1f;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer">Excluir</button>`}
                    </div>
                  </div>
                  <div style="margin-top:10px">${chips}</div>
                </div>`;
            }).join('') || '<p style="opacity:.6;font-size:13px">Nenhum usuário.</p>';

            lista.querySelectorAll('.adm-u-toggle-perm').forEach((cb) => {
                cb.addEventListener('change', async () => {
                    const uid = cb.dataset.uid;
                    const marcadas = Array.from(
                        lista.querySelectorAll(`.adm-u-toggle-perm[data-uid="${uid}"]`)
                    ).filter((x) => x.checked).map((x) => x.dataset.perm);
                    try {
                        await apiFetch('PUT', `/api/usuarios/${uid}`, { permissoes: marcadas });
                    } catch (e) {
                        alert('Não foi possível salvar: ' + e.message);
                        admRenderUsuarios();
                    }
                });
            });
            lista.querySelectorAll('.adm-u-toggle-ativo').forEach((cb) => {
                cb.addEventListener('change', async () => {
                    try {
                        await apiFetch('PUT', `/api/usuarios/${cb.dataset.uid}`, { ativo: cb.checked });
                    } catch (e) {
                        alert(e.message);
                        admRenderUsuarios();
                    }
                });
            });
            lista.querySelectorAll('.adm-u-del').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    if (!confirm('Excluir este usuário? A ação não pode ser desfeita.')) return;
                    try {
                        await apiFetch('DELETE', `/api/usuarios/${btn.dataset.uid}`);
                        admRenderUsuarios();
                    } catch (e) { alert(e.message); }
                });
            });
        } catch (e) {
            lista.innerHTML = `<p style="color:#ff6b6b;font-size:13px">${e.message}</p>`;
        }
    }

    async function admCriarUsuario() {
        const erro = admEl('adm-u-erro');
        const btn = admEl('adm-u-criar');
        erro.style.display = 'none';
        const nome = (admEl('adm-u-nome').value || '').trim();
        const email = (admEl('adm-u-email').value || '').trim();
        const senha = admEl('adm-u-senha').value || '';
        const papel = admEl('adm-u-papel').value;
        const permissoes = Array.from(document.querySelectorAll('.adm-u-perm-cb'))
            .filter((c) => c.checked).map((c) => c.value);

        if (!nome || !email || !senha) {
            erro.textContent = 'Preencha nome, e-mail e senha.';
            erro.style.display = 'block'; return;
        }
        if (senha.length < 8) {
            erro.textContent = 'A senha precisa ter ao menos 8 caracteres.';
            erro.style.display = 'block'; return;
        }
        btn.disabled = true;
        try {
            await apiFetch('POST', '/api/usuarios', { nome, email, senha, papel, permissoes });
            admEl('adm-u-nome').value = '';
            admEl('adm-u-email').value = '';
            admEl('adm-u-senha').value = '';
            document.querySelectorAll('.adm-u-perm-cb').forEach((c) => { c.checked = false; });
            admRenderUsuarios();
        } catch (e) {
            erro.textContent = e.message;
            erro.style.display = 'block';
        } finally {
            btn.disabled = false;
        }
    }

    /** Esconde as abas que o usuário não pode acessar.
     *  É conveniência de interface, não segurança: quem editar o HTML
     *  reexibe a aba, mas a API recusa a chamada de qualquer forma. */
    function admAplicarPermissoesNaNav() {
        const mapa = { estoque: 'produtos', categorias: 'categorias', site: 'config', feedbacks: 'feedbacks' };
        document.querySelectorAll('.adm-n[data-adm-tab]').forEach((el) => {
            const tab = el.dataset.admTab;
            if (tab === 'usuarios') {
                el.style.display = (sessaoUsuario && sessaoUsuario.papel === 'admin') ? '' : 'none';
                return;
            }
            const area = mapa[tab];
            if (!area) return;                       // dashboard: todos veem
            el.style.display = podeAcessar(area) ? '' : 'none';
        });
    }

    function admInit() {
        if (admInited) { admLoadData().then(() => { admRenderDash(); admRenderStock(); }); return; }
        admInited = true;

        admRenderPermCheckboxes();
        admAplicarPermissoesNaNav();
        const btnCriarUsuario = admEl('adm-u-criar');

        const btnCriarFeedback = admEl('adm-fb-criar');
        if (btnCriarFeedback) btnCriarFeedback.addEventListener('click', admCriarFeedback);
        const seletorTipoFb = admEl('adm-fb-tipo');
        if (seletorTipoFb) seletorTipoFb.addEventListener('change', () => {
            const ehPrint = seletorTipoFb.value === 'print';
            admEl('adm-fb-campo-print').style.display = ehPrint ? '' : 'none';
            admEl('adm-fb-campo-texto').style.display = ehPrint ? 'none' : '';
        });
        if (btnCriarUsuario) btnCriarUsuario.addEventListener('click', admCriarUsuario);

        // NAV
        document.querySelectorAll('.adm-n[data-adm-tab]').forEach(el => {
            el.addEventListener('click', () => {
                document.querySelectorAll('.adm-n').forEach(n=>n.classList.remove('active'));
                el.classList.add('active');
                admTab = el.dataset.admTab;
                document.querySelectorAll('.adm-panel').forEach(p=>p.classList.remove('active'));
                admEl('adm-tab-'+admTab).classList.add('active');
                const titles = {dashboard:'Dashboard de vendas',estoque:'Controle de estoque',categorias:'Categorias',site:'Site',feedbacks:'Feedbacks de clientes',usuarios:'Usuários e permissões'};
                admEl('adm-tb-title').textContent = titles[admTab]||admTab;
                admEl('adm-ptabs').style.display = admTab==='dashboard'?'flex':'none';
                admEl('adm-btn-add').style.display = (admTab==='categorias'||admTab==='site'||admTab==='feedbacks'||admTab==='usuarios')?'none':'flex';
                if(admTab==='dashboard') admRenderDash();
                if(admTab==='categorias') { admRenderCats(); admRenderCatsManage(); admRenderSizeOpts(); admRenderBrands(); }
                if(admTab==='estoque') admRenderStock();
                if(admTab==='site') admRenderSite();
                if(admTab==='feedbacks') admRenderFeedbacks();
                if(admTab==='usuarios') admRenderUsuarios();
            });
        });

        // Período tabs
        document.querySelectorAll('.adm-ptab').forEach(t => {
            t.addEventListener('click', () => {
                document.querySelectorAll('.adm-ptab').forEach(x=>x.classList.remove('active'));
                t.classList.add('active'); admRenderDash();
            });
        });

        // Botão novo item
        const admAddBtn = admEl('adm-btn-add');
        if (admAddBtn) {
            admAddBtn.addEventListener('click', () => admOpenModal(null));
            admAddBtn.type = 'button';
        }

        // Modal
        admEl('adm-m-close').addEventListener('click', admCloseModal);
        admEl('adm-m-cancel').addEventListener('click', admCloseModal);
        admEl('adm-modal-bg').addEventListener('click', e => { if(e.target===admEl('adm-modal-bg')) admCloseModal(); });

        admEl('adm-m-save').addEventListener('click', async () => {
            const nome = admEl('adm-f-nome').value.trim();
            if(!nome){admToast('Nome obrigatório');return;}
            const preco = admEl('adm-f-preco').value.trim();
            const categoria = admEl('adm-f-cat').value;
            const status = admEl('adm-f-status').value;
            const descricao_completa = admEl('adm-f-desc').value.trim();
            const numeracao = admEl('adm-f-numeracao')?.value.trim() || '';
            const tamanhosStr = admEl('adm-f-tamanhos')?.value.trim() || '';
            const tamanhos = tamanhosStr ? tamanhosStr.split(',').map(x=>x.trim()).filter(Boolean) : [];
            const marca = admEl('adm-f-marca')?.value.trim() || '';
            const maisProcurado = admEl('adm-f-mais-procurado')?.checked || false;

            const pv = admEl('adm-f-images-preview');
            const existing = (admProds.find(x=>x.id===admEditId)||{}).images||[];
            let finalImgs = [];
            if(pv){
                Array.from(pv.children).forEach(child=>{
                    const btn = child.querySelector('.remove-image-btn');
                    if(btn && btn.dataset.removed==='true') return;
                    if(child.dataset.origIndex!==undefined){ const oi = parseInt(child.dataset.origIndex,10); if(existing[oi]) finalImgs.push(existing[oi]); }
                });
            }

            const fd = new FormData();
            fd.append('nome', nome);
            fd.append('preco', preco);
            fd.append('categoria', categoria);
            fd.append('status', status);
            fd.append('descricao_completa', descricao_completa);
            if(numeracao) fd.append('numeracao', numeracao);
            if(tamanhos.length) fd.append('tamanhos', JSON.stringify(tamanhos));
            if(marca) fd.append('marca', marca);
            fd.append('mais_procurado', maisProcurado ? 'true' : 'false');

            if(admEditId){
                fd.append('existingImages', JSON.stringify(finalImgs));
                if(admNewFiles && admNewFiles.length){
                    admToast('Fazendo upload das imagens...');
                    for(const f of admNewFiles){ fd.append('newImages', f); }
                }
            } else {
                if(!admNewFiles || !admNewFiles.length){admToast('Pelo menos uma imagem é obrigatória');return;}
                for(const f of admNewFiles){ fd.append('images', f); }
            }

            try {
                if(admEditId){await apiFetch('PUT', `/api/produtos/${admEditId}`, fd);admToast('Produto atualizado');}
                else{await apiFetch('POST', '/api/produtos', fd);admToast('Produto adicionado');}
                admCloseModal();
                await admLoadData();
                if(admTab==='estoque') admRenderStock();
                if(admTab==='dashboard') admRenderDash();
            } catch(e){admToast('Erro: '+e.message);}        
        });

        // Cliques nos botões de tamanho/numeração já são conectados em
        // renderSizeButtonGroup() (chamado na carga inicial e sempre que
        // SIZES/NUMEROS são recarregados de carregarSizeOptions()).
        admEl('adm-f-cat').addEventListener('change', ()=>{ refreshNumSizeVisibility(); });

        // Filtros estoque
        ['adm-s-search','adm-s-cat','adm-s-status','adm-s-sort'].forEach(id => {
            const el = admEl(id);
            el.addEventListener('input', admRenderStock);
            el.addEventListener('change', admRenderStock);
        });

        admLoadData().then(() => { admRenderDash(); admRenderStock(); });

        // Preview de imagens no modal admin (arrastável, com remoção)
        const admFilesEl = admEl('adm-f-images');
        if(admFilesEl){
            admFilesEl.addEventListener('change', () => {
                admNewFiles = Array.from(admFilesEl.files||[]);
                const pv = admEl('adm-f-images-preview'); pv.innerHTML='';
                admNewFiles.forEach((f,idx)=>{
                    const wrapper = document.createElement('div'); wrapper.className='image-preview-item draggable';
                    wrapper.dataset.newIndex = idx;
                    const img = document.createElement('img'); img.src = URL.createObjectURL(f); wrapper.appendChild(img);
                    const btn = document.createElement('button'); btn.className='remove-image-btn'; btn.textContent='✕'; btn.dataset.removed='false'; btn.addEventListener('click', () => { btn.dataset.removed = String(btn.dataset.removed!=='true'); img.style.opacity = btn.dataset.removed==='true' ? '0.25' : '1'; });
                    wrapper.appendChild(btn);
                    // drag
                    wrapper.draggable = true;
                    wrapper.addEventListener('dragstart', e=>{ e.dataTransfer.setData('text/plain', 'new:'+idx); wrapper.classList.add('dragging'); });
                    wrapper.addEventListener('dragend', ()=>wrapper.classList.remove('dragging'));
                    wrapper.addEventListener('dragover', e=>{ e.preventDefault(); wrapper.classList.add('drag-over'); });
                    wrapper.addEventListener('dragleave', ()=>wrapper.classList.remove('drag-over'));
                    wrapper.addEventListener('drop', e=>{ e.preventDefault(); wrapper.classList.remove('drag-over'); const data = e.dataTransfer.getData('text/plain'); handleAdmDrop(pv, data, wrapper); });
                    pv.appendChild(wrapper);
                });
            });
        }
    }

    function admOpenModal(p) {
        admEditId = p?p.id:null;
        admNewFiles = [];
        admEl('adm-m-title').textContent = p?'Editar produto':'Novo produto';
        admEl('adm-f-nome').value = p?p.nome||'':'';
        admEl('adm-f-preco').value = p?p.preco||'R$ 0,00':'R$ 0,00';
        admEl('adm-f-cat').value = p?p.categoria||'casacos':'casacos';
        admEl('adm-f-status').value = p?p.status||'disponiveis':'disponiveis';
        admEl('adm-f-desc').value = p?p.descricao_completa||'':'';
        if (admEl('adm-f-mais-procurado')) admEl('adm-f-mais-procurado').checked = p ? !!p.mais_procurado : false;
        // campos novos
        admEl('adm-f-numeracao').value = p? (p.numeracao||'') : '';
        admEl('adm-f-tamanhos').value = p? (Array.isArray(p.tamanhos)?p.tamanhos.join(','):(p.tamanhos||'')) : '';
        // atualizar botões e visibilidade. Numeração legada em texto livre
        // (ex: "41BR", "42 ITÁLIA / 41 BR") não bate com nenhum botão — fica
        // sem nenhum marcado, mas o valor original é preservado no campo
        // oculto até o admin realmente clicar em algum número (só então o
        // valor é substituído pela seleção limpa, compatível com o filtro).
        updateSizeButtonsFromValue(admEl('adm-f-tamanhos').value);
        updateNumeroButtonsFromValue(admEl('adm-f-numeracao').value);
        refreshNumSizeVisibility();
        if (admEl('adm-f-marca')) admEl('adm-f-marca').value = p ? (p.marca||'') : '';
        // preview imagens existentes (wrappers arrastáveis)
        const pv = admEl('adm-f-images-preview'); if(pv){ pv.innerHTML=''; const existing = (p?.images||[]);
            existing.forEach((u,idx)=>{
                const wrapper = document.createElement('div'); wrapper.className='image-preview-item draggable'; wrapper.dataset.origIndex = idx;
                const img = document.createElement('img'); img.src = u; wrapper.appendChild(img);
                const btn = document.createElement('button'); btn.className='remove-image-btn'; btn.textContent='✕'; btn.dataset.removed='false'; btn.addEventListener('click', ()=>{ btn.dataset.removed = String(btn.dataset.removed!=='true'); img.style.opacity = btn.dataset.removed==='true' ? '0.25' : '1'; });
                wrapper.appendChild(btn);
                // drag handlers
                wrapper.draggable = true;
                wrapper.addEventListener('dragstart', e=>{ e.dataTransfer.setData('text/plain', 'orig:'+idx); wrapper.classList.add('dragging'); });
                wrapper.addEventListener('dragend', ()=>wrapper.classList.remove('dragging'));
                wrapper.addEventListener('dragover', e=>{ e.preventDefault(); wrapper.classList.add('drag-over'); });
                wrapper.addEventListener('dragleave', ()=>wrapper.classList.remove('drag-over'));
                wrapper.addEventListener('drop', e=>{ e.preventDefault(); wrapper.classList.remove('drag-over'); const data = e.dataTransfer.getData('text/plain'); handleAdmDrop(pv, data, wrapper); });
                pv.appendChild(wrapper);
            }); }
        admEl('adm-modal-bg').classList.add('open');
        // ensure on mobile the admin overlay is scrolled to top so modal appears immediately at top
        const admOverlayEl = document.getElementById('adminOverlay'); if(admOverlayEl) admOverlayEl.scrollTop = 0;
    }
    
    // Helper to handle drop in admin preview: data format 'orig:idx' or 'new:idx'
    function handleAdmDrop(container, data, targetEl){
        if(!data) return;
        const [type, idxStr] = data.split(':');
        const idx = parseInt(idxStr,10);
        if(isNaN(idx)) return;
        // find source element
        const srcSelector = type==='orig' ? `[data-orig-index="${idx}"]` : `[data-new-index="${idx}"]`;
        const src = container.querySelector(srcSelector);
        if(!src || src===targetEl) return;
        // insert src after targetEl
        container.insertBefore(src, targetEl.nextSibling);
    }
    function admCloseModal() { admEl('adm-modal-bg').classList.remove('open'); }

    async function admMoveStatus(id, newStatus) {
        try {
            await dbUpdate(id,{status:newStatus});
            const p = admProds.find(x=>x.id===id);
            if(p){p.status=newStatus;}
            admToast('Status → '+ADM_STATUS_OPTS[newStatus]);
            if(admTab==='estoque') admRenderStock();
            if(admTab==='dashboard') admRenderDash();
            renderizarCatalogo();
        } catch(e){admToast('Erro: '+e.message);}
    }

    function admPeriod() { const a=document.querySelector('.adm-ptab.active'); return a?a.dataset.p:'all'; }
    function admFilterP(list) {
        const p=admPeriod(); if(p==='all') return list;
        const cut=Date.now()-parseInt(p)*86400000;
        return list.filter(x=>new Date(x.created_at)>=cut);
    }

    function admRenderDash() {
        const all = admFilterP(admProds);
        const vend = all.filter(p=>p.status==='vendido');
        const atv = all.filter(p=>p.status!=='vendido');
        const rec = vend.reduce((s,p)=>s+admPn(p.preco),0);
        const tick = vend.length?rec/vend.length:0;

        admEl('adm-k-rec').textContent = admFR(rec);
        admEl('adm-k-at').textContent = atv.length;
        admEl('adm-k-vend').textContent = vend.length;
        admEl('adm-k-tick').textContent = vend.length?admFR(tick):'—';
        admEl('adm-k-rec-d').textContent = vend.length+' peças vendidas';
        admEl('adm-k-at-d').textContent = all.length+' total no período';
        admEl('adm-k-vend-d').className='adm-kdelta up';
        admEl('adm-k-vend-d').textContent = all.length?Math.round(vend.length/all.length*100)+'% do acervo':'';

        const cats=Object.keys(ADM_CATS);
        const cd=cats.map((c,i)=>({
            c,label:ADM_CATS[c],color:ADM_COLORS[i],
            total:all.filter(p=>p.categoria===c).length,
            vend:vend.filter(p=>p.categoria===c).length,
            rec:vend.filter(p=>p.categoria===c).reduce((s,p)=>s+admPn(p.preco),0)
        }));

        if(admRevChart) admRevChart.destroy();
        admRevChart = new Chart(admEl('adm-revChart').getContext('2d'),{
            type:'bar',
            data:{labels:cd.map(x=>x.label),datasets:[{label:'Receita',data:cd.map(x=>x.rec),backgroundColor:ADM_COLORS,borderRadius:4,borderSkipped:false}]},
            options:{responsive:true,maintainAspectRatio:false,
                plugins:{legend:{display:false},tooltip:{callbacks:{label:v=>'  '+admFR(v.raw)}}},
                scales:{
                    x:{grid:{display:false},ticks:{color:'#666',font:{size:11}}},
                    y:{grid:{color:'rgba(255,255,255,.06)'},ticks:{color:'#666',font:{size:11},callback:v=>v===0?'0':'R$'+Math.round(v/1000)+'k'}}
                }}
        });

        admEl('adm-chartLeg').innerHTML=cd.map(x=>`<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:${x.color}"></span>${x.label} ${admFR(x.rec)}</span>`).join('');

        const maxT=Math.max(...cd.map(x=>x.total),1);
        admEl('adm-funnel').innerHTML=cd.map(x=>`<div class="adm-fi">
            <div class="adm-fih"><span><i class="ti ${ADM_ICONS[x.c]}" style="font-size:12px;margin-right:3px"></i>${x.label}</span><span>${x.total}</span></div>
            <div class="adm-ftrack"><div class="adm-ffill" style="width:${Math.max(4,Math.round(x.total/maxT*100))}%"></div></div>
            <div class="adm-fsub">${x.vend} vendidos · ${x.total?Math.round(x.vend/x.total*100):0}%</div>
        </div>`).join('');

        admEl('adm-dash-tbl').innerHTML=cd.map(x=>`<tr><td>${x.label}</td><td>${x.total}</td><td class="adm-td-g">${x.total-x.vend}</td><td style="color:#B8924F;font-weight:500">${x.vend}</td></tr>`).join('');

        const rec5=[...all].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,5);
        admEl('adm-dash-act').innerHTML=rec5.length?rec5.map(p=>`<div class="adm-ai">
            <div class="adm-ai-ic"><i class="ti ${ADM_ICONS[p.categoria]||'ti-box'}" style="font-size:14px;color:#B8924F"></i></div>
            <div class="adm-ai-body"><div class="adm-ai-name">${admEsc(p.nome)}</div><div class="adm-ai-time">${admRt(p.created_at)} · ${ADM_CATS[p.categoria]||p.categoria}</div></div>
            <div class="adm-ai-price">${p.preco||'—'}</div>
        </div>`).join(''):'<div style="color:#555;font-size:12px;padding:8px 0">Nenhum produto neste período</div>';
    }

    function admRenderStock() {
        const srch=(admEl('adm-s-search').value||'').toLowerCase();
        const catF=admEl('adm-s-cat').value;
        const stF=admEl('adm-s-status').value;
        const sort=admEl('adm-s-sort').value;
        let list=admProds.filter(p=>{
            if(srch&&!(p.nome||'').toLowerCase().includes(srch))return false;
            // "__procurados" não é categoria de produto — é o recorte do
            // que aparece na aba Mais Procurados da vitrine. Fica aqui
            // junto dos outros filtros para o arrastar continuar valendo:
            // filtro só esconde linha, não muda a ordem relativa.
            if(catF==='__procurados'){ if(!p.mais_procurado) return false; }
            else if(catF&&p.categoria!==catF)return false;
            if(stF&&p.status!==stF)return false;
            return true;
        });
        if(sort==='nome')list.sort((a,b)=>(a.nome||'').localeCompare(b.nome||''));
        else if(sort==='preco_asc')list.sort((a,b)=>admPn(a.preco)-admPn(b.preco));
        else if(sort==='preco_desc')list.sort((a,b)=>admPn(b.preco)-admPn(a.preco));

        const body=admEl('adm-stbl-body');
        const empty=admEl('adm-s-empty');
        if(!list.length){body.innerHTML='';empty.style.display='block';return;}
        empty.style.display='none';

        body.innerHTML=list.map(p=>{
            const icon=ADM_ICONS[p.categoria]||'ti-box';
            const sCls=ADM_STATUS_CLS[p.status]||'adm-p-brev';
            const sLbl=ADM_STATUS_OPTS[p.status]||p.status;
            const otherOpts=Object.entries(ADM_STATUS_OPTS).filter(([k])=>k!==p.status);
            // Filtro de categoria/status/busca não muda a ordem relativa dos itens
            // (só esconde os que não batem), então não atrapalha o drag — o índice
            // em admProds continua correto. Só a ORDENAÇÃO (nome/preço) desalinha
            // a posição visual do índice real, por isso só ela desabilita o arrastar.
            const podeArrastar = sort === 'newest';
            return `<tr draggable="${podeArrastar}" data-id="${p.id}">
                <td style="color:#444;text-align:center" ${podeArrastar?'title="Arraste para reordenar"':''}><i class="ti ti-grip-vertical" style="font-size:14px;${podeArrastar?'cursor:grab':'opacity:.25'}"></i></td>
                <td>
                    <div style="display:flex;align-items:center;gap:8px">
                        ${admMiniatura(p, icon)}
                        <div style="min-width:0">
                            <div style="font-weight:500;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#fff">${p.mais_procurado?'<i class="ti ti-star-filled" style="color:#B8924F;font-size:11px" title="Em Mais Procurados"></i> ':''}${admEsc(p.nome)}</div>
                            ${p.descricao_completa?`<div style="font-size:10px;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px">${admEsc(p.descricao_completa)}</div>`:''}
                        </div>
                    </div>
                </td>
                <td><span class="adm-catpill">${ADM_CATS[p.categoria]||p.categoria||'—'}</span>${p.marca?`<div style="font-size:10px;color:#555;margin-top:2px">${admEsc(p.marca)}</div>`:''}</td>
                <td style="font-weight:500;color:#B8924F">${p.preco||'—'}</td>
                <td>
                    <div style="display:flex;align-items:center;gap:6px">
                        <span class="adm-pill ${sCls}">${sLbl}</span>
                        <select class="adm-move-sel" data-moveid="${p.id}">
                            <option value="">Mover →</option>
                            ${otherOpts.map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}
                        </select>
                    </div>
                </td>
                <td>
                    <button class="adm-abtn" data-edit="${p.id}"><i class="ti ti-edit"></i></button>
                    <button class="adm-abtn del" data-del="${p.id}"><i class="ti ti-trash"></i></button>
                </td>
            </tr>`;
        }).join('');

        body.querySelectorAll('[data-edit]').forEach(btn=>{
            btn.addEventListener('click',()=>{const p=admProds.find(x=>x.id===Number(btn.dataset.edit));if(p)admOpenModal(p);});
        });
        body.querySelectorAll('[data-del]').forEach(btn=>{
            btn.addEventListener('click',async()=>{
                const p=admProds.find(x=>x.id===Number(btn.dataset.del));
                if(!p||!confirm(`Excluir "${p.nome}"?`))return;
                try{await dbDelete(p.id);admToast('Produto excluído');await admLoadData();admRenderStock();}
                catch(e){admToast('Erro: '+e.message);}
            });
        });
        body.querySelectorAll('.adm-move-sel').forEach(sel=>{
            sel.addEventListener('change',async()=>{
                const ns=sel.value; if(!ns)return;
                await admMoveStatus(sel.dataset.moveid,ns);
                sel.value='';
            });
        });

        // Drag & drop — só habilitado com "Mais recentes" e sem filtros ativos
        // (ver podeArrastar acima), pra posição visual e índice em admProds
        // sempre baterem. A nova ordem é persistida via PUT /api/produtos/reorder,
        // e o site público passa a respeitá-la (ver campo "ordem" em renderizarCatalogo()).
        body.querySelectorAll('tr[draggable="true"]').forEach(row=>{
            row.addEventListener('dragstart',e=>{admDragSrcId=Number(row.dataset.id);e.dataTransfer.effectAllowed='move';});
            row.addEventListener('dragover',e=>{e.preventDefault();row.classList.add('drag-over');});
            row.addEventListener('dragleave',()=>row.classList.remove('drag-over'));
            row.addEventListener('drop',async e=>{
                e.preventDefault();row.classList.remove('drag-over');
                const targetId=Number(row.dataset.id);
                if(!admDragSrcId||admDragSrcId===targetId)return;
                const si=admProds.findIndex(x=>x.id===admDragSrcId);
                const ti=admProds.findIndex(x=>x.id===targetId);
                if(si<0||ti<0)return;
                const [item]=admProds.splice(si,1);
                admProds.splice(ti,0,item);
                admRenderStock();
                try {
                    await dbReorderProdutos(admProds.map(p=>p.id));
                    admProds.forEach((p,idx)=>{ p.ordem = idx; });
                    admToast('Ordem atualizada');
                } catch(err) {
                    admToast('Erro ao salvar ordem: '+err.message);
                }
            });
            row.addEventListener('dragend',()=>body.querySelectorAll('tr').forEach(r=>r.classList.remove('drag-over')));
        });
    }

    /**
     * Miniatura do produto na tabela do painel.
     *
     * Usa a versão reduzida gerada pelo servidor (~6 KB) e não a foto
     * original (500 a 700 KB): com 20 linhas na tela, a diferença é entre
     * 120 KB e 10 MB para simplesmente listar produtos.
     *
     * `loading="lazy"` é o que garante que abrir o painel não puxe as fotos
     * de tudo: o navegador só busca as das linhas que aparecem. Filtrando
     * por categoria, só aquelas existem na tela — então só elas carregam.
     *
     * `width`/`height` reservam o espaço antes de a imagem chegar, senão a
     * tabela pula enquanto carrega — e pular no meio de um arrastar é
     * péssimo.
     *
     * Sem miniatura (produto antigo, ou geração que falhou), cai no ícone
     * da categoria em vez de mostrar imagem quebrada.
     */
    function admMiniatura(p, icon) {
        const original = (p.images && p.images[0]) || '';
        const cai = `<div class="adm-mini adm-mini-fallback"><i class="ti ${icon}"></i></div>`;
        if (!original) return cai;

        // .../uploads/produtos/foto.jpg  →  .../uploads/produtos/thumbs/foto.jpg.webp
        const thumb = original.replace(/\/uploads\/produtos\/([^/]+)$/, '/uploads/produtos/thumbs/$1.webp');

        // Sem `onerror` embutido: o HTML de reserva tem aspas duplas
        // (class="..."), e dentro de um atributo que também usa aspas
        // duplas a primeira delas fechava o atributo antes da hora — o
        // resto vazava como texto visível na página. Quem troca a imagem
        // quebrada pelo ícone é o ouvinte de erro logo abaixo.
        return `<img class="adm-mini" src="${admEsc(thumb)}" alt=""
                     loading="lazy" decoding="async" width="34" height="34"
                     data-full="${admEsc(original)}" data-nome="${admEsc(p.nome || '')}"
                     data-icon="${admEsc(icon)}"
                     title="Clique para ampliar">`;
    }

    /** Abre a foto em tamanho real. Só aqui a imagem original é baixada. */
    function admAbrirFoto(src, nome) {
        const fundo = document.createElement('div');
        fundo.className = 'adm-lightbox';
        fundo.innerHTML = `
            <button class="adm-lightbox-x" aria-label="Fechar">&times;</button>
            <figure>
                <img src="${admEsc(src)}" alt="${admEsc(nome)}">
                ${nome ? `<figcaption>${admEsc(nome)}</figcaption>` : ''}
            </figure>`;

        const fechar = () => { fundo.remove(); document.removeEventListener('keydown', porEsc); };
        const porEsc = (e) => { if (e.key === 'Escape') fechar(); };

        // Clicar fora fecha; clicar na própria foto, não — senão fecha ao
        // tentar olhar de perto.
        fundo.addEventListener('click', (e) => { if (e.target === fundo || e.target.closest('.adm-lightbox-x')) fechar(); });
        document.addEventListener('keydown', porEsc);
        document.body.appendChild(fundo);
    }

    // Miniatura que não carrega (3 arquivos do acervo estão corrompidos)
    // vira o ícone da categoria, em vez de mostrar imagem quebrada.
    //
    // Fase de captura (`true`) porque evento de erro em <img> não sobe a
    // árvore — sem isso o ouvinte no document nunca seria chamado.
    document.addEventListener('error', (e) => {
        const img = e.target;
        if (!(img instanceof HTMLImageElement) || !img.classList.contains('adm-mini')) return;
        const div = document.createElement('div');
        div.className = 'adm-mini adm-mini-fallback';
        const i = document.createElement('i');
        i.className = `ti ${img.dataset.icon || 'ti-box'}`;
        div.appendChild(i);
        img.replaceWith(div);
    }, true);

    // Um só ouvinte para a tabela inteira, em vez de um por linha: a lista
    // e redesenhada a cada filtro, e prender ouvinte em cada imagem
    // vazaria memoria a cada redesenho.
    document.addEventListener('click', (e) => {
        const img = e.target.closest('img.adm-mini[data-full]');
        if (img) admAbrirFoto(img.dataset.full, img.dataset.nome || '');
    });

    function admRenderCats() {
        const cats=Object.keys(ADM_CATS);
        admEl('adm-cat-cards').innerHTML=cats.map(cat=>{
            const list=admProds.filter(p=>p.categoria===cat);
            const vd=list.filter(p=>p.status==='vendido');
            const rec=vd.reduce((s,p)=>s+admPn(p.preco),0);
            return `<div class="adm-dc" style="cursor:pointer" onclick="document.querySelector('[data-adm-tab=estoque]').click();document.getElementById('adm-s-cat').value='${cat}';document.getElementById('adm-s-cat').dispatchEvent(new Event('change'))">
                <div style="display:flex;align-items:center;gap:9px;margin-bottom:11px">
                    <div style="width:34px;height:34px;border-radius:8px;background:#1a1a1a;display:flex;align-items:center;justify-content:center"><i class="ti ${ADM_ICONS[cat]}" style="font-size:17px;color:#B8924F"></i></div>
                    <div><div style="font-weight:500;font-size:13px;color:#fff">${ADM_CATS[cat]}</div><div style="font-size:11px;color:#555">${list.length} produtos</div></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
                    <span style="color:#555">Receita</span><span style="color:#B8924F;font-weight:500">${admFR(rec)}</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:11px">
                    <span style="color:#555">Vendidos</span><span style="color:#ccc">${vd.length} de ${list.length}</span>
                </div>
            </div>`;
        }).join('');
    }

    // ─── GERENCIAR CATEGORIAS (add/editar/excluir — não mexe em produtos) ─────
    // Categorias eram fixas no código (CATS/ADM_CATS/ADM_ICONS/TAMANHO_CATS);
    // agora vivem em categories no banco e são administráveis aqui. Excluir é
    // bloqueado pelo backend se algum produto ainda usa a categoria — ver
    // DELETE /api/categories/:id no server.js.
    function admRenderCatsManage() {
        const wrap = admEl('adm-cats-manage-wrap');
        if (!wrap) return;
        wrap.innerHTML = CATS.map(c => `<div class="adm-dc" data-catrow="${admEsc(c.value)}">
            <div style="display:grid;grid-template-columns:auto 1fr 1fr 1fr auto auto;gap:8px;align-items:center">
                <div style="width:30px;height:30px;border-radius:7px;background:#1a1a1a;display:flex;align-items:center;justify-content:center"><i class="ti ${admEsc(c.icon||'ti-tag')}" style="font-size:15px;color:#B8924F"></i></div>
                <input type="text" data-cat-field="label" value="${admEsc(c.label)}" placeholder="Nome exibido">
                <input type="text" data-cat-field="icon" value="${admEsc(c.icon||'')}" placeholder="Ícone Tabler">
                <select data-cat-field="size_mode">
                    <option value="nenhum" ${c.size_mode==='nenhum'?'selected':''}>Sem seletor</option>
                    <option value="tamanho" ${c.size_mode==='tamanho'?'selected':''}>Tamanho</option>
                    <option value="numero" ${c.size_mode==='numero'?'selected':''}>Numeração</option>
                </select>
                <button type="button" class="adm-btn-ghost" data-cat-save="${admEsc(c.value)}">Salvar</button>
                <button type="button" class="adm-btn-ghost" data-cat-del="${admEsc(c.value)}" title="Excluir categoria">✕</button>
            </div>
            <div style="font-size:10px;color:#555;margin-top:6px">slug: ${admEsc(c.value)}</div>
        </div>`).join('');

        wrap.querySelectorAll('[data-cat-save]').forEach(btn => btn.addEventListener('click', () => admSaveCategory(btn.dataset.catSave)));
        wrap.querySelectorAll('[data-cat-del]').forEach(btn => btn.addEventListener('click', () => admDeleteCategory(btn.dataset.catDel)));
    }

    async function admSaveCategory(slug) {
        const c = CATS.find(x => x.value === slug);
        if (!c || !c.id) return;
        const row = admEl('adm-cats-manage-wrap').querySelector(`[data-catrow="${slug}"]`);
        const label = row.querySelector('[data-cat-field="label"]').value.trim();
        const icon = row.querySelector('[data-cat-field="icon"]').value.trim() || 'ti-tag';
        const size_mode = row.querySelector('[data-cat-field="size_mode"]').value;
        if (!label) { admToast('Nome da categoria é obrigatório'); return; }
        try {
            await dbUpdateCategory(c.id, (() => { const fd = new FormData(); fd.append('label', label); fd.append('icon', icon); fd.append('size_mode', size_mode); return fd; })());
            await carregarCategorias();
            admToast('Categoria atualizada');
        } catch (e) { admToast('Erro ao salvar categoria: ' + e.message); }
    }

    async function admDeleteCategory(slug) {
        const c = CATS.find(x => x.value === slug);
        if (!c || !c.id) return;
        if (!confirm(`Excluir a categoria "${c.label}"? Só é permitido se nenhum produto estiver usando ela.`)) return;
        try {
            await dbDeleteCategory(c.id);
            await carregarCategorias();
            admToast('Categoria excluída');
        } catch (e) { admToast('Erro: ' + e.message); }
    }

    admEl('adm-newcat-add')?.addEventListener('click', async () => {
        const slug = admEl('adm-newcat-slug').value.trim().toLowerCase().replace(/\s+/g, '-');
        const label = admEl('adm-newcat-label').value.trim();
        const icon = admEl('adm-newcat-icon').value.trim() || 'ti-tag';
        const size_mode = admEl('adm-newcat-mode').value;
        if (!slug || !label) { admToast('Preencha slug e nome da categoria'); return; }
        try {
            const fd = new FormData();
            fd.append('slug', slug); fd.append('label', label); fd.append('icon', icon); fd.append('size_mode', size_mode);
            fd.append('sort_order', String(CATS.length));
            await dbAddCategory(fd);
            await carregarCategorias();
            admEl('adm-newcat-slug').value = ''; admEl('adm-newcat-label').value = ''; admEl('adm-newcat-icon').value = ''; admEl('adm-newcat-mode').value = 'nenhum';
            admToast(`Categoria "${label}" adicionada`);
        } catch (e) { admToast('Erro ao adicionar categoria: ' + e.message); }
    });

    // ─── GERENCIAR ESCALAS DE TAMANHO/NUMERAÇÃO ────────────────────────────────
    function admRenderSizeOpts() {
        const renderGroup = (containerId, values, modo) => {
            const wrap = admEl(containerId);
            if (!wrap) return;
            wrap.innerHTML = values.map(v => `<span class="adm-chip">${admEsc(v)}<button type="button" class="adm-chip-x" data-sizeopt-del="${admEsc(modo)}" data-valor="${admEsc(v)}" title="Remover">✕</button></span>`).join('') || '<span style="color:#555;font-size:11px">Nenhum valor cadastrado</span>';
            wrap.querySelectorAll('[data-sizeopt-del]').forEach(btn => btn.addEventListener('click', () => admDeleteSizeOption(btn.dataset.sizeoptDel, btn.dataset.valor)));
        };
        renderGroup('adm-sizeopts-tamanho', SIZES, 'tamanho');
        renderGroup('adm-sizeopts-numero', NUMEROS, 'numero');
    }

    async function admAddSizeOption(modo, inputId) {
        const inp = admEl(inputId);
        const valor = inp.value.trim();
        if (!valor) return;
        try {
            await dbAddSizeOption(modo, valor);
            await carregarSizeOptions();
            admRenderSizeOpts();
            inp.value = '';
            admToast(`"${valor}" adicionado`);
        } catch (e) { admToast('Erro ao adicionar: ' + e.message); }
    }

    async function admDeleteSizeOption(modo, valor) {
        if (!confirm(`Remover "${valor}"? Produtos já cadastrados com esse valor não são alterados.`)) return;
        // A API só aceita exclusão por id — o carregamento mais recente
        // (carregarSizeOptions) não guarda os ids localmente, então busca de
        // novo antes de excluir, pra sempre remover o registro certo.
        try {
            const rows = await dbGetSizeOptions();
            const row = rows.find(r => r.modo === modo && r.valor === valor);
            if (!row) { admToast('Valor não encontrado — recarregue e tente de novo'); return; }
            await dbDeleteSizeOption(row.id);
            await carregarSizeOptions();
            admRenderSizeOpts();
            admToast('Removido');
        } catch (e) { admToast('Erro ao remover: ' + e.message); }
    }

    admEl('adm-sizeopt-tamanho-add')?.addEventListener('click', () => admAddSizeOption('tamanho', 'adm-sizeopt-tamanho-input'));
    admEl('adm-sizeopt-numero-add')?.addEventListener('click', () => admAddSizeOption('numero', 'adm-sizeopt-numero-input'));
    admEl('adm-sizeopt-tamanho-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); admAddSizeOption('tamanho', 'adm-sizeopt-tamanho-input'); } });
    admEl('adm-sizeopt-numero-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); admAddSizeOption('numero', 'adm-sizeopt-numero-input'); } });

    // ─── MARCAS (gerenciadas aqui, não mexem em produto/categoria nenhum) ─────
    function admRenderBrands() {
        const wrap = admEl('adm-brands-wrap');
        if (!wrap) return;
        const cats = Object.keys(ADM_CATS);
        wrap.innerHTML = cats.map(cat => {
            const brands = (BRANDS_BY_CAT[cat] || []).slice().sort((a,b) => a.localeCompare(b, 'pt-BR'));
            return `<div class="adm-dc">
                <div class="adm-dc-title">${ADM_CATS[cat]}</div>
                <div class="adm-dc-sub">${brands.length ? `${brands.length} marca${brands.length===1?'':'s'}` : 'Nenhuma marca cadastrada'}</div>
                <div class="adm-brand-chips">
                    ${brands.map(b => `<span class="adm-chip">${admEsc(b)}<button type="button" class="adm-chip-x" data-cat="${admEsc(cat)}" data-nome="${admEsc(b)}" title="Remover marca">✕</button></span>`).join('')}
                </div>
                <div class="adm-brand-add-row">
                    <input type="text" placeholder="Nova marca" data-brand-input="${cat}" maxlength="60">
                    <button type="button" class="adm-btn-ghost" data-brand-add="${cat}">+ Adicionar</button>
                </div>
            </div>`;
        }).join('');

        wrap.querySelectorAll('[data-brand-add]').forEach(btn => btn.addEventListener('click', () => admAddBrand(btn.dataset.brandAdd)));
        wrap.querySelectorAll('[data-brand-input]').forEach(inp => inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); admAddBrand(inp.dataset.brandInput); }
        }));
        wrap.querySelectorAll('.adm-chip-x').forEach(btn => btn.addEventListener('click', () => admRemoveBrand(btn.dataset.cat, btn.dataset.nome)));
    }

    async function admAddBrand(cat) {
        const wrap = admEl('adm-brands-wrap');
        const inp = wrap.querySelector(`[data-brand-input="${cat}"]`);
        const nome = inp.value.trim();
        if (!nome) return;
        try {
            await dbAddBrand(cat, nome);
            await carregarBrands();
            admRenderBrands();
            admToast(`Marca "${nome}" adicionada em ${ADM_CATS[cat]}`);
        } catch (e) {
            admToast('Erro ao adicionar marca: ' + e.message);
        }
    }

    async function admRemoveBrand(cat, nome) {
        if (!confirm(`Remover a marca "${nome}" de ${ADM_CATS[cat]}?\n\nProdutos já cadastrados com essa marca não são alterados — só deixa de aparecer como opção pra novos cadastros e no filtro do site.`)) return;
        const id = BRAND_IDS[`${cat}::${nome}`];
        if (!id) { admToast('Marca não encontrada — recarregue a página e tente de novo'); return; }
        try {
            await dbDeleteBrand(id);
            await carregarBrands();
            admRenderBrands();
            admToast('Marca removida');
        } catch (e) {
            admToast('Erro ao remover marca: ' + e.message);
        }
    }

    let admSiteNewFiles = [];
    let admCatNewFiles = {};

    // Grade de miniaturas do carrossel. Clicar em ✕ numa imagem já salva
    // remove na hora (chama a API e some da tela) — não é só "marcar pra
    // remover depois", pra nunca ficar uma remoção pendente que o admin
    // esqueceu de salvar.
    function admRenderHeroPreview(urls) {
        const preview = admEl('adm-site-preview');
        preview.innerHTML = urls.map(url => `<div class="image-preview-item" data-url="${url}">
            <img src="${url}">
            <button type="button" class="remove-image-btn">✕</button>
        </div>`).join('');
        preview.querySelectorAll('.image-preview-item').forEach(item => {
            item.querySelector('.remove-image-btn').addEventListener('click', () => admRemoveHeroImage(item.dataset.url, item));
        });
    }

    // IMPORTANTE: só conta como "imagem existente mantida" quem realmente
    // tem data-url (veio do servidor). As miniaturas de arquivo novo, recém
    // selecionadas no input (ver listener de 'adm-site-cover' abaixo), não
    // têm esse atributo — contá-las aqui gerava um "null" no meio da lista
    // enviada (a imagem corrompida que aparecia no carrossel), porque cada
    // arquivo novo acabava entrando duas vezes: uma vez certo (via
    // admSiteNewFiles) e outra errado, como data-url inexistente virando
    // null no JSON.
    function admSiteHeroKeptUrls() {
        const preview = admEl('adm-site-preview');
        return Array.from(preview.querySelectorAll('.image-preview-item[data-url]')).map(item => item.dataset.url);
    }

    async function admRemoveHeroImage(url, item) {
        if (!confirm('Remover esta imagem do carrossel? Não dá pra desfazer depois.')) return;
        const keep = admSiteHeroKeptUrls().filter(u => u !== url);
        try {
            const fd = new FormData();
            fd.append('hero_images_keep', JSON.stringify(keep));
            await apiFetch('PUT', '/api/config', fd);
            item.remove();
            admToast('Imagem removida do carrossel');
        } catch (e) {
            admToast('Erro ao remover: ' + e.message);
        }
    }

    async function admRenderSite() {
        try {
            const cfg = await dbGetConfig();
            admSiteNewFiles = [];
            admEl('adm-site-cover').value = '';
            const heroImages = ((Array.isArray(cfg?.hero_images) && cfg.hero_images.length)
                ? cfg.hero_images
                : (cfg?.hero_image ? [cfg.hero_image] : [])).filter(Boolean);
            admRenderHeroPreview(heroImages);
            admEl('adm-site-shuffle').checked = !!cfg?.hero_shuffle;
            admEl('adm-site-interval').value = Math.round((cfg?.hero_interval_ms || 5000) / 1000);
            admEl('adm-site-eyebrow').value = cfg?.hero_eyebrow || '';
            admEl('adm-site-title1').value = cfg?.hero_title1 || '';
            admEl('adm-site-title2').value = cfg?.hero_title2 || '';
            admEl('adm-site-title3').value = cfg?.hero_title3 || '';
            admEl('adm-site-desc').value = cfg?.hero_desc || '';
            admEl('adm-site-tag-eyebrow').value = cfg?.hero_tag_eyebrow || '';
            admEl('adm-site-tag-title').value = cfg?.hero_tag_title || '';
            admEl('adm-sobre-titulo').value = cfg?.sobre_titulo || '';
            admEl('adm-sobre-texto').value = cfg?.sobre_texto || SOBRE_PADRAO;
            admSobreNewFile = null;
            admEl('adm-sobre-imagem').value = '';
            const sobrePrev = admEl('adm-sobre-preview-img');
            if (sobrePrev) {
                sobrePrev.src = cfg?.sobre_imagem || '';
                sobrePrev.style.display = cfg?.sobre_imagem ? 'block' : 'none';
            }

            admCatNewFiles = {};
            const catsWrap = admEl('adm-site-cats');
            catsWrap.innerHTML = CATS.map(c => {
                const url = CAT_COVER_IMAGES[c.value] || (cfg && cfg[CAT_IMAGE_FIELDS[c.value]]);
                return `<div>
                    <div style="width:100%;aspect-ratio:3/4;background:#1a1a1a;border:1px solid #1e1e1e;border-radius:8px;overflow:hidden;margin-bottom:6px">
                        <img data-cat-preview="${c.value}" src="${url||''}" style="width:100%;height:100%;object-fit:cover;display:${url?'block':'none'}">
                    </div>
                    <div style="font-size:11px;color:#aaa;margin-bottom:4px">${c.label}</div>
                    <input type="file" accept="image/*" data-cat-input="${c.value}" style="width:100%;font-size:10px;color:#eaeaea">
                </div>`;
            }).join('');
            catsWrap.querySelectorAll('[data-cat-input]').forEach(inp => inp.addEventListener('change', () => {
                const cat = inp.dataset.catInput;
                const f = inp.files[0];
                admCatNewFiles[cat] = f || null;
                if (f) {
                    const prev = catsWrap.querySelector(`[data-cat-preview="${cat}"]`);
                    prev.src = URL.createObjectURL(f);
                    prev.style.display = 'block';
                }
            }));

            const featImg = admEl('adm-feat-preview-img');
            if (cfg && cfg.feat_image) { featImg.src = cfg.feat_image; featImg.style.display = 'block'; }
            else { featImg.style.display = 'none'; }
            admEl('adm-feat-badge').value = cfg?.feat_badge || '';
            admEl('adm-feat-name').value = cfg?.feat_name || '';
            admEl('adm-feat-desc').value = cfg?.feat_desc || '';
            admEl('adm-feat-link').value = cfg?.feat_link || '';

            const featureBannerImg = admEl('adm-feature-banner-preview-img');
            if (cfg && cfg.feature_banner_image) { featureBannerImg.src = cfg.feature_banner_image; featureBannerImg.style.display = 'block'; }
            else { featureBannerImg.style.display = 'none'; }

            admEl('adm-feature1-title').value = cfg?.feature1_title || '';
            admEl('adm-feature1-desc').value = cfg?.feature1_desc || '';
            admEl('adm-feature2-title').value = cfg?.feature2_title || '';
            admEl('adm-feature2-desc').value = cfg?.feature2_desc || '';
            admEl('adm-feature3-title').value = cfg?.feature3_title || '';
            admEl('adm-feature3-desc').value = cfg?.feature3_desc || '';
        } catch(e) { admRenderHeroPreview([]); }
    }
    admEl('adm-site-cover').addEventListener('change', () => {
        const files = Array.from(admEl('adm-site-cover').files || []);
        const preview = admEl('adm-site-preview');
        files.forEach(f => {
            admSiteNewFiles.push(f);
            const div = document.createElement('div');
            div.className = 'image-preview-item';
            div.innerHTML = `<img src="${URL.createObjectURL(f)}"><button type="button" class="remove-image-btn">✕</button>`;
            div.querySelector('.remove-image-btn').addEventListener('click', () => {
                const idx = admSiteNewFiles.indexOf(f);
                if (idx > -1) admSiteNewFiles.splice(idx, 1);
                div.remove();
            });
            preview.appendChild(div);
        });
        // Limpa o input pra permitir escolher mais arquivos depois sem
        // duplicar os que já foram adicionados na lista.
        admEl('adm-site-cover').value = '';
    });
    let admFeatNewFile = null;
    admEl('adm-feat-image').addEventListener('change', () => {
        const f = admEl('adm-feat-image').files[0];
        admFeatNewFile = f || null;
        if (f) {
            const img = admEl('adm-feat-preview-img');
            img.src = URL.createObjectURL(f);
            img.style.display = 'block';
        }
    });
    let admSobreNewFile = null;
    admEl('adm-sobre-imagem').addEventListener('change', () => {
        const f = admEl('adm-sobre-imagem').files[0];
        admSobreNewFile = f || null;
        if (f) {
            const img = admEl('adm-sobre-preview-img');
            img.src = URL.createObjectURL(f);
            img.style.display = 'block';
        }
    });
    let admFeatureBannerNewFile = null;
    admEl('adm-feature-banner-image').addEventListener('change', () => {
        const f = admEl('adm-feature-banner-image').files[0];
        admFeatureBannerNewFile = f || null;
        if (f) {
            const img = admEl('adm-feature-banner-preview-img');
            img.src = URL.createObjectURL(f);
            img.style.display = 'block';
        }
    });
    admEl('adm-site-save').addEventListener('click', async () => {
        const fd = new FormData();
        fd.append('hero_images_keep', JSON.stringify(admSiteHeroKeptUrls()));
        admSiteNewFiles.forEach(f => fd.append('hero_images', f));
        fd.append('hero_shuffle', admEl('adm-site-shuffle').checked ? 'true' : 'false');
        const intervalSec = Math.max(2, parseInt(admEl('adm-site-interval').value, 10) || 5);
        fd.append('hero_interval_ms', String(intervalSec * 1000));
        fd.append('hero_eyebrow', admEl('adm-site-eyebrow').value.trim());
        fd.append('hero_title1', admEl('adm-site-title1').value.trim());
        fd.append('hero_title2', admEl('adm-site-title2').value.trim());
        fd.append('hero_title3', admEl('adm-site-title3').value.trim());
        fd.append('hero_desc', admEl('adm-site-desc').value.trim());
        fd.append('hero_tag_eyebrow', admEl('adm-site-tag-eyebrow').value.trim());
        fd.append('hero_tag_title', admEl('adm-site-tag-title').value.trim());
        if (admFeatNewFile) fd.append('feat_image', admFeatNewFile);
        fd.append('feat_badge', admEl('adm-feat-badge').value.trim());
        fd.append('feat_name', admEl('adm-feat-name').value.trim());
        fd.append('feat_desc', admEl('adm-feat-desc').value.trim());
        fd.append('feat_link', admEl('adm-feat-link').value.trim());
        if (admFeatureBannerNewFile) fd.append('feature_banner_image', admFeatureBannerNewFile);
        fd.append('feature1_title', admEl('adm-feature1-title').value.trim());
        fd.append('feature1_desc', admEl('adm-feature1-desc').value.trim());
        fd.append('feature2_title', admEl('adm-feature2-title').value.trim());
        fd.append('feature2_desc', admEl('adm-feature2-desc').value.trim());
        fd.append('feature3_title', admEl('adm-feature3-title').value.trim());
        fd.append('feature3_desc', admEl('adm-feature3-desc').value.trim());
        if (admSobreNewFile) fd.append('sobre_imagem', admSobreNewFile);
        fd.append('sobre_titulo', admEl('adm-sobre-titulo').value.trim());
        fd.append('sobre_texto', admEl('adm-sobre-texto').value.trim());
        try {
            await apiFetch('PUT', '/api/config', fd);
            // Imagem de capa por categoria agora é campo próprio de cada
            // categoria (categories.cover_image), não mais de config — uma
            // chamada PUT /api/categories/:id por categoria com arquivo novo.
            const catUpdates = CATS.filter(c => admCatNewFiles[c.value] && c.id).map(c => {
                const catFd = new FormData();
                catFd.append('cover_image', admCatNewFiles[c.value]);
                return dbUpdateCategory(c.id, catFd);
            });
            if (catUpdates.length) await Promise.all(catUpdates);
            admToast('Capa do site atualizada');
            admSiteNewFiles = [];
            admCatNewFiles = {};
            admFeatNewFile = null;
            admFeatureBannerNewFile = null;
            admEl('adm-site-cover').value = '';
            admEl('adm-feat-image').value = '';
            admEl('adm-feature-banner-image').value = '';
            admSobreNewFile = null;
            admEl('adm-sobre-imagem').value = '';
            carregarCapaDoSite();
            carregarCategorias();
        } catch(e) { admToast('Erro: ' + e.message); }
    });

    function abrirMenuFiltros() {
        filterMenuOpen = true;
        document.getElementById('filterMenuPanel').classList.add('open');
        document.getElementById('plpSidebarBackdrop').classList.add('open');
        document.body.style.overflow = 'hidden';
    }
    function fecharMenuFiltros() {
        filterMenuOpen = false;
        document.getElementById('filterMenuPanel').classList.remove('open');
        document.getElementById('plpSidebarBackdrop').classList.remove('open');
        document.body.style.overflow = 'auto';
    }
    document.getElementById('filterMenuToggle').addEventListener('click', (e) => {
        e.stopPropagation();
        filterMenuOpen ? fecharMenuFiltros() : abrirMenuFiltros();
    });
    document.getElementById('plpSidebarClose').addEventListener('click', fecharMenuFiltros);
    document.getElementById('plpSidebarBackdrop').addEventListener('click', fecharMenuFiltros);
    document.getElementById('plpSort').addEventListener('change', e => { ordenacao = e.target.value; renderizarCatalogo(); });
    const irParaResultados = () => document.querySelector('.plp-headrow')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('searchInput').addEventListener('input', e => {
        const buscavaAntes = termoBusca.trim().length > 0;
        termoBusca = e.target.value;
        renderizarCatalogo();
        // Só na primeira letra: rolar a cada tecla deixaria a página
        // saltando enquanto a pessoa ainda está digitando.
        if (!buscavaAntes && termoBusca.trim()) irParaResultados();
    });
    document.getElementById('searchInput').addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        e.target.blur(); // fecha o teclado no celular
        if (termoBusca.trim()) irParaResultados();
    });
    document.getElementById('procuradosPrev')?.addEventListener('click', () => mudarPaginaProcurados(-1));
    document.getElementById('procuradosNext')?.addEventListener('click', () => mudarPaginaProcurados(1));

    const cartModal = document.getElementById('cartModal');
    document.getElementById('cartIcon').addEventListener('click', () => { renderCartModal(); cartModal.style.display='flex'; });
    document.getElementById('closeCart').addEventListener('click', () => cartModal.style.display='none');
    document.getElementById('clearCartBtn').addEventListener('click', () => { clearCart(); renderCartModal(); });
    document.getElementById('sendCartWhatsapp').addEventListener('click', () => { sendCartToWhatsApp(); cartModal.style.display='none'; });
    window.addEventListener('click', e => { if(e.target===cartModal) cartModal.style.display='none'; });

    // ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────
    window.addEventListener('scroll', () => document.querySelector('.header').classList.toggle('shrink', window.scrollY > 10));
    bindPreco(document.getElementById('prodPreco'));
    bindPreco(document.getElementById('adm-f-preco'));
    bindPreco(document.getElementById('editPreco'));
    if (typeof renderSizeButtonGroup === 'function') {
        renderSizeButtonGroup('adm-f-tamanhos-buttons', SIZES, syncSizesToInput);
        renderSizeButtonGroup('adm-f-numeracao-buttons', NUMEROS, syncNumerosToInput);
    }
    carregarCategorias();
    carregarSizeOptions();
    carregarProdutos();
    renderizarFeedbacks();
    carregarCapaDoSite();
    carregarBrands();
    updateCartUI();
})();
