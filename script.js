(function(){
    // ─── CONFIGURAÇÃO API ─────────────────────────────────────────────────────
    const API_BASE = "https://api.fbelegancelux.com.br";

    // ─── CLIENTE API (fetch nativo) ──────────────────────────────────────────
    async function apiFetch(method, path, body) {
        const opts = { method, headers: {} };
        if (body !== undefined && !(body instanceof FormData)) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        } else if (body instanceof FormData) {
            opts.body = body;
        }
        const res = await fetch(API_BASE + path, opts);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || res.statusText);
        }
        return res.json();
    }

    async function dbGetAll()        { return apiFetch('GET', '/api/produtos'); }
    async function dbInsert(data)    { return apiFetch('POST', '/api/produtos', data); }
    async function dbUpdate(id, data){ return apiFetch('PUT', `/api/produtos/${id}`, data); }
    async function dbDelete(id)      { return apiFetch('DELETE', `/api/produtos/${id}`); }
    async function dbGetConfig()     { return apiFetch('GET', '/api/config'); }

    // Upload de imagem para o servidor
    async function uploadImage(file) {
        const fd = new FormData();
        fd.append('imagem', file);
        const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: fd });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error('Upload falhou: ' + (err.message || res.statusText));
        }
        const data = await res.json();
        return data.url;
    }

    // ─── ESTADO ───────────────────────────────────────────────────────────────
    let produtos = [];
    let filtroCategoria = 'casacos';
    let filtroTamanho = [];
    let filtroNumero = [];
    let filtroMarca = [];
    let termoBusca = '';
    let adminVisible = false;
    let currentEditId = null;

    let filterMenuOpen = false;

    const CATS = [
        { value: "casacos", label: "Casacos" },
        { value: "camisetas", label: "Camisetas" },
        { value: "shorts", label: "Shorts" },
        { value: "calcados", label: "Calçados" },
        { value: "acessorios", label: "Acessórios" },
        { value: "perfumes", label: "Perfumes" }
    ];

    // Categorias que usam grade de tamanhos (P/M/G) vs. numeração (calçados) vs. nenhuma (acessórios/perfumes)
    const TAMANHO_CATS = ['casacos','camisetas','shorts'];
    const SIZES = ['XXS','XS','S','M','L','XL','XXL'];
    const NUMEROS = ['34','35','36','37','38','39','40','41','42','43','44','45'];
    const BRANDS_BY_CAT = {
        casacos: ['AllSaints','Off-White','Palm Angels','Ralph Lauren','Moncler','Diesel'],
        camisetas: ['AllSaints','Off-White','Palm Angels','Ralph Lauren','Moncler','Diesel','Boss'],
        shorts: ['Vilebrequin','Sundek'],
        calcados: ['Golden Goose','Off-White','Zegna','Gucci','Bottega Veneta','Louis Vuitton']
    };

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
        showToast('✓ ' + prod.nome + ' adicionado ao carrinho');
    }
    function removeFromCart(id) { cart = cart.filter(i => i.id !== id); saveCart(); }
    function clearCart()        { cart = []; saveCart(); }

    function precoNum(p) { return parseFloat((p||'').replace('R$ ','').replace(/\./g,'').replace(',','.')) || 0; }

    function renderCartModal() {
        const c = document.getElementById('cartItemsList');
        if (!c) return;
        if (!cart.length) { c.innerHTML = '<div style="text-align:center;padding:20px;">Seu carrinho está vazio.</div>'; document.getElementById('cartTotal').innerHTML = ''; return; }
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
        if (!cart.length) { showToast('Seu carrinho está vazio', true); return; }
        let msg = "🛍️ *Meu pedido:*%0A";
        cart.forEach(item => {
            let extra = '';
            if (TAMANHO_CATS.includes(item.categoria) && item.tamanhos) extra = ` (Tam: ${item.tamanhos.join(',')})`;
            if (item.categoria==='calcados'  && item.numeracao) extra = ` (Num: ${item.numeracao})`;
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
        } catch(err) {
            console.error('Erro Supabase:', err);
            document.getElementById('product-grid').innerHTML = `<div class="empty-message">Erro ao carregar: ${err.message}</div>`;
            showToast('Erro ao carregar estoque: ' + err.message, true);
        }
    }

    async function carregarCapaDoSite() {
        try {
            const cfg = await dbGetConfig();
            if (!cfg) return;
            const heroImg = document.querySelector('.hero-img');
            if (heroImg && cfg.hero_image) heroImg.src = cfg.hero_image;
            const setText = (id, val) => { const el = document.getElementById(id); if (el && val) el.textContent = val; };
            setText('heroEyebrow', cfg.hero_eyebrow);
            setText('heroTitle1', cfg.hero_title1);
            setText('heroTitle2', cfg.hero_title2);
            setText('heroTitle3', cfg.hero_title3);
            setText('heroDesc', cfg.hero_desc);
            setText('heroTagEyebrow', cfg.hero_tag_eyebrow);
            setText('heroTagTitle', cfg.hero_tag_title);
        } catch(err) { console.warn('capa do site: usando conteúdo padrão', err); }
    }

    // ─── SEÇÕES CURADAS ───────────────────────────────────────────────────────
    function renderizarSecoesCuradas() {
        const lancs = produtos.filter(p => p.status === 'lancamentos');
        const recentes = [...produtos].filter(p => p.status !== 'vendido').sort((a,b) => new Date(b.created_at)-new Date(a.created_at)).slice(0,6);
        const lancSec = document.getElementById('lancamentosSection');
        const lancGrid = document.getElementById('lancamentosGrid');
        const procSec = document.getElementById('procuradosSection');
        const procGrid = document.getElementById('procuradosGrid');
        if (lancs.length) { lancSec.style.display='block'; lancGrid.innerHTML=''; lancs.slice(0,6).forEach(p => lancGrid.appendChild(criarCard(p))); }
        else lancSec.style.display = 'none';
        if (recentes.length) { procSec.style.display='block'; procGrid.innerHTML=''; recentes.forEach(p => procGrid.appendChild(criarCard(p))); }
        else procSec.style.display = 'none';
    }

    // ─── CARD ─────────────────────────────────────────────────────────────────
    const STATUS = { disponiveis:['DISPONÍVEL','disponivel'], lancamentos:['LANÇAMENTO','lancamento'], embreve:['EM BREVE','embreve'], vendido:['VENDIDO','vendido'] };
    const CAT_LABEL = { casacos:'CASACOS', camisetas:'CAMISETAS', shorts:'SHORTS', calcados:'CALÇADOS', acessorios:'ACESSÓRIOS', perfumes:'PERFUMES', vestuario:'VESTUÁRIO', lifestyle:'LIFESTYLE' };

    function criarCard(prod) {
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
        else if (prod.categoria==='calcados' && prod.numeracao) sizeLabel = prod.numeracao;
        const statusHtml = prod.status !== 'disponiveis' ? `<span class="status-badge ${sClass}">${sLabel}</span>` : '';
        card.innerHTML = `
            <div class="product-image-container">
                <span class="product-tag">${escapeHtml(tagLabel)}</span>
                ${statusHtml}
                <img class="product-image" src="${images[0]||'https://placehold.co/600x800?text=Sem+imagem'}" alt="${escapeHtml(prod.nome)}" onerror="this.src='https://placehold.co/600x800?text=Indisponível'">
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
            const tmp = new Image(); tmp.onload = () => { imgEl.src = imgs[idx]; imgEl.style.opacity = '1'; }; tmp.src = imgs[idx];
        }
    }

    // ─── CATÁLOGO ─────────────────────────────────────────────────────────────
    let ordenacao = 'newest';
    function renderizarCatalogo() {
        const grid = document.getElementById('product-grid');
        let f = produtos.filter(p => p.categoria===filtroCategoria);
        if (termoBusca.trim()) {
            const b = termoBusca.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
            f = f.filter(p => p.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes(b));
        }
        if (TAMANHO_CATS.includes(filtroCategoria) && filtroTamanho.length) {
            f = f.filter(p => Array.isArray(p.tamanhos) && p.tamanhos.some(t => filtroTamanho.includes(t)));
        }
        if (filtroCategoria==='calcados' && filtroNumero.length) {
            f = f.filter(p => numeroMatches(p.numeracao, filtroNumero));
        }
        if (BRANDS_BY_CAT[filtroCategoria] && filtroMarca.length) {
            f = f.filter(p => filtroMarca.includes(p.marca));
        }
        if (ordenacao==='preco_asc') f.sort((a,b) => precoNum(a.preco)-precoNum(b.preco));
        else if (ordenacao==='preco_desc') f.sort((a,b) => precoNum(b.preco)-precoNum(a.preco));
        else f.sort((a,b) => new Date(b.created_at)-new Date(a.created_at));
        f.sort((a,b) => (a.status==='vendido'?1:0)-(b.status==='vendido'?1:0));

        const countEl = document.getElementById('plpCount');
        if (countEl) countEl.textContent = `(${f.length})`;

        grid.innerHTML = '';
        if (!f.length) grid.innerHTML = '<div class="empty-message">✦ Nenhum produto encontrado ✦</div>';
        else f.forEach(p => grid.appendChild(criarCard(p)));
        renderizarFiltroMenu();
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

        const catObj = CATS.find(c => c.value === filtroCategoria);
        const catLabel = catObj ? catObj.label : filtroCategoria;
        label.childNodes[0].nodeValue = catLabel + ' ';
        if (breadcrumb) breadcrumb.textContent = catLabel;

        const activeCount = filtroTamanho.length + filtroNumero.length + filtroMarca.length;
        if (activeCount) { badge.style.display = 'inline-flex'; badge.textContent = activeCount; }
        else { badge.style.display = 'none'; }

        let html = `<div class="plp-group${sidebarGroupsOpen.peca!==false?' open':''}">
            <div class="plp-group-head" data-toggle-group="peca">Peça<i class="fas fa-chevron-down"></i></div>
            <div class="plp-group-body">${CATS.map(c => `<button type="button" class="plp-option${c.value===filtroCategoria?' active':''}" data-menu-cat="${c.value}"><span class="plp-option-box">${c.value===filtroCategoria?'<i class="fas fa-check"></i>':''}</span>${c.label}</button>`).join('')}</div>
        </div>`;

        if (TAMANHO_CATS.includes(filtroCategoria)) {
            html += sidebarGroup('tamanho', 'Tamanho', SIZES, filtroTamanho, 'tamanho');
        } else if (filtroCategoria === 'calcados') {
            html += sidebarGroup('tamanho', 'Número', NUMEROS, filtroNumero, 'numero');
        }
        if (BRANDS_BY_CAT[filtroCategoria]) {
            html += sidebarGroup('marca', 'Marca', BRANDS_BY_CAT[filtroCategoria], filtroMarca, 'marca');
        }
        if (activeCount) {
            html += `<button type="button" class="chip-clear" id="filterMenuClear">Limpar filtros</button>`;
        }
        panel.innerHTML = html;

        panel.querySelectorAll('[data-toggle-group]').forEach(head => head.addEventListener('click', (e) => {
            e.stopPropagation();
            const key = head.dataset.toggleGroup;
            sidebarGroupsOpen[key] = !(sidebarGroupsOpen[key] !== false);
            head.closest('.plp-group').classList.toggle('open', sidebarGroupsOpen[key]);
        }));
        panel.querySelectorAll('[data-menu-cat]').forEach(btn => btn.addEventListener('click', (e) => {
            e.stopPropagation();
            filtroCategoria = btn.dataset.menuCat;
            filtroTamanho = []; filtroNumero = []; filtroMarca = [];
            renderizarCatalogo();
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
        if (window.innerWidth <= 768) {
            abrirMobileSheet(prod);
        } else {
            abrirModal(prod);
        }
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

        let st = '';
        if (TAMANHO_CATS.includes(prod.categoria)&&prod.tamanhos?.length) st = 'Tamanhos: '+prod.tamanhos.join(', ');
        else if (prod.categoria==='calcados'&&prod.numeracao) st = 'Numeração: '+prod.numeracao;
        const sizeEl = document.getElementById('mobileSheetSize');
        sizeEl.innerHTML = st ? `<i class="fas fa-ruler"></i> ${st}` : '';

        let extra = '';
        if (TAMANHO_CATS.includes(prod.categoria)&&prod.tamanhos) extra = ` - Tamanhos: ${prod.tamanhos.join(', ')}`;
        if (prod.categoria==='calcados'&&prod.numeracao) extra = ` - Numeração: ${prod.numeracao}`;
        document.getElementById('mobileSheetWhatsapp').href = `https://wa.me/5543996179533?text=${encodeURIComponent('Olá! Tenho interesse: '+prod.nome+' - '+prod.preco+extra)}`;

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
        let st = '';
        if (TAMANHO_CATS.includes(prod.categoria)&&prod.tamanhos?.length) st = 'Tamanhos: '+prod.tamanhos.join(', ');
        else if (prod.categoria==='calcados'&&prod.numeracao) st = 'Numeração: '+prod.numeracao;
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
        if (prod.categoria==='calcados'&&prod.numeracao) extra = ` - Numeração: ${prod.numeracao}`;
        document.getElementById('modalWhatsappBtn').href = `https://wa.me/5543996179533?text=${encodeURIComponent('Olá! Tenho interesse: '+prod.nome+' - '+prod.preco+extra)}`;
        document.getElementById('productModal').style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
    function fecharModal() { document.getElementById('productModal').style.display='none'; document.body.style.overflow='auto'; }
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
    document.getElementById('adminTriggerLogo').addEventListener('click', () => {
        if (logoTimer) clearTimeout(logoTimer);
        logoTimer = setTimeout(() => { logoTimer=null; window.location.reload(); }, 350);
    });
    document.getElementById('adminTriggerLogo').addEventListener('dblclick', () => {
        if (logoTimer) { clearTimeout(logoTimer); logoTimer=null; }
        loginModal.style.display='flex'; document.body.style.overflow='hidden';
    });
    document.getElementById('loginModalClose').addEventListener('click', () => { loginModal.style.display='none'; document.body.style.overflow='auto'; });
    window.addEventListener('click', e => { if(e.target===loginModal) { loginModal.style.display='none'; document.body.style.overflow='auto'; } });
    document.getElementById('loginAdminBtn').addEventListener('click', () => {
        if (document.getElementById('adminPassword').value==='fbadmin') {
            loginModal.style.display='none';
            document.body.style.overflow='hidden';
            document.getElementById('adminPassword').value='';
            abrirAdminOverlay();
        } else alert('Senha incorreta');
    });

    function abrirAdminOverlay() {
        const overlay = document.getElementById('adminOverlay');
        overlay.style.display = 'block';
        document.body.style.overflow = 'hidden';
        adminVisible = true;
        admInit();
    }

    document.getElementById('logoutAdminBtn').addEventListener('click', () => {
        document.getElementById('adminOverlay').style.display = 'none';
        document.body.style.overflow = 'auto';
        adminVisible = false;
    });

    // ─── DASHBOARD v2 ────────────────────────────────────────────────────────
    let admProds = [], admEditId = null, admRevChart = null, admTab = 'dashboard', admDragSrcId = null;
    let admNewFiles = []; // arquivos selecionados no modal admin (preview)
    let admInited = false;

    const ADM_CATS = {casacos:'Casacos',camisetas:'Camisetas',shorts:'Shorts',calcados:'Calçados',acessorios:'Acessórios',perfumes:'Perfumes'};
    const ADM_ICONS = {casacos:'ti-hanger',camisetas:'ti-shirt',shorts:'ti-layout-rows',calcados:'ti-shoe',acessorios:'ti-diamond',perfumes:'ti-spray'};
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

    function syncSizesToInput(){
        const sel = Array.from(document.querySelectorAll('#adm-f-tamanhos-buttons .size-opt.active')).map(b=>b.dataset.size);
        admEl('adm-f-tamanhos').value = sel.join(',');
    }
    function updateSizeButtonsFromValue(val){
        const arr = String(val||'').split(',').map(x=>x.trim()).filter(Boolean);
        document.querySelectorAll('#adm-f-tamanhos-buttons .size-opt').forEach(b=>{
            b.classList.toggle('active', arr.includes(b.dataset.size));
        });
    }
    function refreshNumSizeVisibility(){
        const cat = admEl('adm-f-cat').value;
        const rowNum = admEl('adm-row-numeracao');
        const rowSizes = admEl('adm-row-tamanhos');
        const rowMarca = admEl('adm-row-marca');
        if(cat==='calcados'){
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

    function admInit() {
        if (admInited) { admLoadData().then(() => { admRenderDash(); admRenderStock(); }); return; }
        admInited = true;

        // NAV
        document.querySelectorAll('.adm-n[data-adm-tab]').forEach(el => {
            el.addEventListener('click', () => {
                document.querySelectorAll('.adm-n').forEach(n=>n.classList.remove('active'));
                el.classList.add('active');
                admTab = el.dataset.admTab;
                document.querySelectorAll('.adm-panel').forEach(p=>p.classList.remove('active'));
                admEl('adm-tab-'+admTab).classList.add('active');
                const titles = {dashboard:'Dashboard de vendas',estoque:'Controle de estoque',categorias:'Categorias',site:'Site'};
                admEl('adm-tb-title').textContent = titles[admTab]||admTab;
                admEl('adm-ptabs').style.display = admTab==='dashboard'?'flex':'none';
                admEl('adm-btn-add').style.display = (admTab==='categorias'||admTab==='site')?'none':'flex';
                if(admTab==='dashboard') admRenderDash();
                if(admTab==='categorias') admRenderCats();
                if(admTab==='estoque') admRenderStock();
                if(admTab==='site') admRenderSite();
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

        // Inicializa seletor de tamanhos e lógica de visibilidade para numeração/tamanhos
        document.querySelectorAll('#adm-f-tamanhos-buttons .size-opt').forEach(b=>{
            b.addEventListener('click', ()=>{ b.classList.toggle('active'); syncSizesToInput(); });
        });
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
        // campos novos
        admEl('adm-f-numeracao').value = p? (p.numeracao||'') : '';
        admEl('adm-f-tamanhos').value = p? (Array.isArray(p.tamanhos)?p.tamanhos.join(','):(p.tamanhos||'')) : '';
        // atualizar botões e visibilidade
        updateSizeButtonsFromValue(admEl('adm-f-tamanhos').value);
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
            if(catF&&p.categoria!==catF)return false;
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
            return `<tr draggable="true" data-id="${p.id}">
                <td style="color:#444;text-align:center"><i class="ti ti-grip-vertical" style="font-size:14px"></i></td>
                <td>
                    <div style="display:flex;align-items:center;gap:8px">
                        <div style="width:26px;height:26px;border-radius:6px;background:#1a1a1a;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                            <i class="ti ${icon}" style="font-size:13px;color:#B8924F"></i>
                        </div>
                        <div style="min-width:0">
                            <div style="font-weight:500;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#fff">${admEsc(p.nome)}</div>
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

        // Drag & drop
        body.querySelectorAll('tr[draggable]').forEach(row=>{
            row.addEventListener('dragstart',e=>{admDragSrcId=Number(row.dataset.id);e.dataTransfer.effectAllowed='move';});
            row.addEventListener('dragover',e=>{e.preventDefault();row.classList.add('drag-over');});
            row.addEventListener('dragleave',()=>row.classList.remove('drag-over'));
            row.addEventListener('drop',e=>{
                e.preventDefault();row.classList.remove('drag-over');
                const targetId=Number(row.dataset.id);
                if(!admDragSrcId||admDragSrcId===targetId)return;
                const si=admProds.findIndex(x=>x.id===admDragSrcId);
                const ti=admProds.findIndex(x=>x.id===targetId);
                if(si<0||ti<0)return;
                const [item]=admProds.splice(si,1);
                admProds.splice(ti,0,item);
                admRenderStock();
                admToast('Ordem atualizada');
            });
            row.addEventListener('dragend',()=>body.querySelectorAll('tr').forEach(r=>r.classList.remove('drag-over')));
        });
    }

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

    let admSiteNewFile = null;
    async function admRenderSite() {
        const img = admEl('adm-site-preview-img');
        try {
            const cfg = await dbGetConfig();
            if (cfg && cfg.hero_image) { img.src = cfg.hero_image; img.style.display = 'block'; }
            else { img.style.display = 'none'; }
            admEl('adm-site-eyebrow').value = cfg?.hero_eyebrow || '';
            admEl('adm-site-title1').value = cfg?.hero_title1 || '';
            admEl('adm-site-title2').value = cfg?.hero_title2 || '';
            admEl('adm-site-title3').value = cfg?.hero_title3 || '';
            admEl('adm-site-desc').value = cfg?.hero_desc || '';
            admEl('adm-site-tag-eyebrow').value = cfg?.hero_tag_eyebrow || '';
            admEl('adm-site-tag-title').value = cfg?.hero_tag_title || '';
        } catch(e) { img.style.display = 'none'; }
    }
    admEl('adm-site-cover').addEventListener('change', () => {
        const f = admEl('adm-site-cover').files[0];
        admSiteNewFile = f || null;
        if (f) {
            const img = admEl('adm-site-preview-img');
            img.src = URL.createObjectURL(f);
            img.style.display = 'block';
        }
    });
    admEl('adm-site-save').addEventListener('click', async () => {
        const fd = new FormData();
        if (admSiteNewFile) fd.append('hero_image', admSiteNewFile);
        fd.append('hero_eyebrow', admEl('adm-site-eyebrow').value.trim());
        fd.append('hero_title1', admEl('adm-site-title1').value.trim());
        fd.append('hero_title2', admEl('adm-site-title2').value.trim());
        fd.append('hero_title3', admEl('adm-site-title3').value.trim());
        fd.append('hero_desc', admEl('adm-site-desc').value.trim());
        fd.append('hero_tag_eyebrow', admEl('adm-site-tag-eyebrow').value.trim());
        fd.append('hero_tag_title', admEl('adm-site-tag-title').value.trim());
        try {
            await apiFetch('PUT', '/api/config', fd);
            admToast('Capa do site atualizada');
            admSiteNewFile = null;
            admEl('adm-site-cover').value = '';
            carregarCapaDoSite();
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
    document.getElementById('searchInput').addEventListener('input', e => { termoBusca=e.target.value; renderizarCatalogo(); });

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
    carregarProdutos();
    carregarCapaDoSite();
    updateCartUI();
})();
