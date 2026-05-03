(function(){
    // ─── CONFIGURAÇÃO SUPABASE ────────────────────────────────────────────────
    // A anon key do Supabase é SEGURA para ficar no frontend — é pública por design.
    // A proteção real vem do RLS configurado no Supabase (execute o disable_rls.sql).
    const SUPABASE_URL = "https://bachgtlwmaroytvhhvfn.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJhY2hndGx3bWFyb3l0dmhodmZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0OTQ4MDAsImV4cCI6MjA5MDA3MDgwMH0.J8ajqwCRrAPLkfYMuXYWs82eO6x6s4A_HteoqOtNFFI";

    // ─── CLIENTE SUPABASE (fetch nativo, sem npm) ─────────────────────────────
    async function sbFetch(method, path, body) {
        const opts = {
            method,
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            }
        };
        if (body !== undefined) opts.body = JSON.stringify(body);
        const res = await fetch(SUPABASE_URL + path, opts);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.message || err.hint || res.statusText);
        }
        const text = await res.text();
        return text ? JSON.parse(text) : [];
    }

    async function dbGetAll()        { return sbFetch('GET',    '/rest/v1/produtos?select=*&order=created_at.desc'); }
    async function dbInsert(data)    { const r = await sbFetch('POST',  '/rest/v1/produtos', data); return Array.isArray(r) ? r[0] : r; }
    async function dbUpdate(id, data){ const r = await sbFetch('PATCH', `/rest/v1/produtos?id=eq.${id}`, data); return Array.isArray(r) ? r[0] : r; }
    async function dbDelete(id)      { await sbFetch('DELETE', `/rest/v1/produtos?id=eq.${id}`); }

    // Upload de imagem pro Storage do Supabase
    async function uploadImage(file) {
        const ext = file.name.split('.').pop();
        const fileName = Date.now() + '_' + Math.random().toString(36).slice(2) + '.' + ext;
        const res = await fetch(`${SUPABASE_URL}/storage/v1/object/produtos/${fileName}`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
                'Content-Type': file.type,
                'x-upsert': 'false'
            },
            body: file
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error('Upload falhou: ' + (err.message || res.statusText));
        }
        return `${SUPABASE_URL}/storage/v1/object/public/produtos/${fileName}`;
    }

    // ─── ESTADO ───────────────────────────────────────────────────────────────
    let produtos = [];
    let filtroCategoria = 'todos';
    let termoBusca = '';
    let adminVisible = false;
    let currentEditId = null;

    // ─── TOAST ────────────────────────────────────────────────────────────────
    const toast = document.getElementById('toastNotification');
    const toastMsg = document.getElementById('toastMessage');
    function showToast(msg, isError) {
        toastMsg.innerText = msg;
        toast.style.borderLeftColor = isError ? '#c0392b' : '#b88b4a';
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
            if ((item.categoria==='vestuario'||item.categoria==='shorts') && item.tamanhos) extra = ` (Tam: ${item.tamanhos.join(',')})`;
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
            produtos = Array.isArray(data) ? data : [];
            renderizarCatalogo();
            renderizarSecoesCuradas();
            if (adminVisible) renderizarAdminLista();
        } catch(err) {
            console.error('Erro Supabase:', err);
            document.getElementById('product-grid').innerHTML = `<div class="empty-message">Erro ao carregar: ${err.message}</div>`;
            showToast('Erro ao carregar estoque: ' + err.message, true);
        }
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
    const CAT_LABEL = { calcados:'CALÇADOS', vestuario:'VESTUÁRIO', lifestyle:'LIFESTYLE', shorts:'SHORTS' };

    function criarCard(prod) {
        const card = document.createElement('div');
        card.className = 'product-card';
        const [sLabel, sClass] = STATUS[prod.status] || ['',''];
        const catLabel = CAT_LABEL[prod.categoria] || prod.categoria.toUpperCase();
        const images = prod.images || [];
        const isSold = prod.status === 'vendido';
        let sizeHtml = '';
        if ((prod.categoria==='vestuario'||prod.categoria==='shorts') && prod.tamanhos?.length) sizeHtml = `<div class="product-size-info">Tamanhos: ${prod.tamanhos.join(', ')}</div>`;
        else if (prod.categoria==='calcados' && prod.numeracao) sizeHtml = `<div class="product-size-info">Numeração: ${prod.numeracao}</div>`;
        const descHtml = prod.descricao_completa ? `<p class="product-desc-preview">${escapeHtml(prod.descricao_completa)}</p>` : '';
        card.innerHTML = `
            <div class="product-image-container">
                <span class="status-badge ${sClass}">${sLabel}</span>
                <img class="product-image" src="${images[0]||'https://placehold.co/600x800?text=Sem+imagem'}" alt="${escapeHtml(prod.nome)}" onerror="this.src='https://placehold.co/600x800?text=Indisponível'">
                ${images.length>1 ? `<div class="nav-arrow nav-arrow-left" data-dir="prev"><i class="fas fa-chevron-left"></i></div><div class="nav-arrow nav-arrow-right" data-dir="next"><i class="fas fa-chevron-right"></i></div>` : ''}
            </div>
            <div class="product-info">
                <div class="product-category">${catLabel}</div>
                <h3 class="product-title">${escapeHtml(prod.nome)}</h3>
                <p class="product-price">${prod.preco}</p>
                ${descHtml}
                ${sizeHtml}
                <button class="btn-add-cart${isSold?' disabled':''}" ${isSold?'disabled':''}><i class="fas fa-cart-plus"></i> ${isSold?'Indisponível':'Adicionar'}</button>
                <button class="btn-details"><i class="fas fa-expand-alt"></i> Detalhes</button>
            </div>`;
        card.querySelector('.btn-add-cart').addEventListener('click', e => { e.stopPropagation(); isSold ? showToast('❌ Item já vendido', true) : addToCart(prod); });
        card.querySelector('.btn-details').addEventListener('click', e => { e.stopPropagation(); abrirModal(prod); });
        card.querySelectorAll('.nav-arrow').forEach(a => a.addEventListener('click', e => { e.stopPropagation(); trocarImagem(prod, a.dataset.dir, card); }));
        card.addEventListener('click', e => { if (!e.target.closest('.btn-add-cart,.btn-details,.nav-arrow')) abrirModal(prod); });
        return card;
    }

    function trocarImagem(prod, dir, card) {
        const imgs = prod.images || [];
        if (imgs.length <= 1) return;
        let idx = parseInt(card.dataset.currentIndex||'0');
        idx = dir==='prev' ? (idx-1+imgs.length)%imgs.length : (idx+1)%imgs.length;
        card.dataset.currentIndex = idx;
        card.querySelector('.product-image').src = imgs[idx];
    }

    // ─── CATÁLOGO ─────────────────────────────────────────────────────────────
    function renderizarCatalogo() {
        const grid = document.getElementById('product-grid');
        let f = produtos.filter(p => filtroCategoria==='todos' || p.categoria===filtroCategoria);
        if (termoBusca.trim()) {
            const b = termoBusca.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
            f = f.filter(p => p.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes(b));
        }
        f.sort((a,b) => (a.status==='vendido'?1:0)-(b.status==='vendido'?1:0));
        grid.innerHTML = '';
        if (!f.length) grid.innerHTML = '<div class="empty-message">✦ Nenhum produto encontrado ✦</div>';
        else f.forEach(p => grid.appendChild(criarCard(p)));
    }

    // ─── MODAL PRODUTO ────────────────────────────────────────────────────────
    function abrirModal(prod) {
        document.getElementById('modalTitle').innerText = prod.nome;
        document.getElementById('modalCategory').innerText = CAT_LABEL[prod.categoria] || prod.categoria;
        document.getElementById('modalPrice').innerText = prod.preco;
        document.getElementById('modalDesc').innerText = prod.descricao_completa || '';
        let st = '';
        if ((prod.categoria==='vestuario'||prod.categoria==='shorts')&&prod.tamanhos?.length) st = 'Tamanhos: '+prod.tamanhos.join(', ');
        else if (prod.categoria==='calcados'&&prod.numeracao) st = 'Numeração: '+prod.numeracao;
        document.getElementById('modalSize').innerHTML = st ? `<i class="fas fa-ruler"></i> ${st}` : '';
        const imgs = prod.images||[];
        const mainImg = document.getElementById('modalMainImg');
        const thumbsDiv = document.getElementById('modalThumbs');
        mainImg.src = imgs[0]||'';
        thumbsDiv.innerHTML = '';
        imgs.forEach((img,i) => {
            const t = document.createElement('img'); t.src=img; t.className='modal-thumb'; if(i===0) t.classList.add('active');
            t.addEventListener('click', () => { mainImg.src=img; thumbsDiv.querySelectorAll('.modal-thumb').forEach(x=>x.classList.remove('active')); t.classList.add('active'); });
            thumbsDiv.appendChild(t);
        });
        let extra = '';
        if ((prod.categoria==='vestuario'||prod.categoria==='shorts')&&prod.tamanhos) extra = ` - Tamanhos: ${prod.tamanhos.join(', ')}`;
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
            const i = produtos.findIndex(p => p.id === id);
            if (i !== -1) produtos[i] = updated || { ...produtos[i], ...updates };
            renderizarCatalogo(); renderizarSecoesCuradas();
            if (adminVisible) renderizarAdminLista();
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
        await atualizarProduto(id, { status: statusAtual==='vendido' ? 'disponiveis' : 'vendido' });
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
                    <span style="color:#b88b4a">${prod.categoria.toUpperCase()}</span>
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
        c.querySelectorAll('.edit-ad').forEach(b => b.addEventListener('click', () => { const p=produtos.find(x=>x.id===b.dataset.id); if(p) abrirEdicao(p); }));
        c.querySelectorAll('.mark-sold').forEach(b => b.addEventListener('click', () => alternarVendido(b.dataset.id, b.dataset.status)));
        c.querySelectorAll('.delete-prod').forEach(b => b.addEventListener('click', () => excluirProduto(b.dataset.id)));
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
        if (categoria==='vestuario'||categoria==='shorts') {
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
            if (result) produtos.unshift(result);
            renderizarCatalogo(); renderizarSecoesCuradas();
            if (adminVisible) renderizarAdminLista();
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
            d.innerHTML = `<img src="${img}"><button class="remove-image-btn" data-index="${idx}" data-removed="false">✕</button>`;
            c.appendChild(d);
        });
        document.getElementById('editNewImages').value = '';
        document.getElementById('editModal').style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    function updateEditSizeFields(prod) {
        const c = document.getElementById('editSizeContainer');
        c.innerHTML = '';
        if (prod.categoria==='vestuario'||prod.categoria==='shorts') {
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
        btn.previousElementSibling.style.opacity = !removed ? '0.25' : '1';
    });

    document.getElementById('editSaveBtn').addEventListener('click', async () => {
        const nome = document.getElementById('editNome').value.trim();
        const desc = document.getElementById('editDesc').value.trim();
        let preco = document.getElementById('editPreco').value.trim();
        const categoria = document.getElementById('editCategoria').value;
        const status = document.getElementById('editStatus').value;
        if (!nome||!preco) { alert('Nome e preço são obrigatórios'); return; }

        let tamanhos=null, numeracao=null;
        if (categoria==='vestuario'||categoria==='shorts') {
            tamanhos = Array.from(document.querySelectorAll('#editTamanhosGroup input:checked')).map(cb=>cb.value);
            if (!tamanhos.length) { alert('Selecione pelo menos um tamanho'); return; }
        } else if (categoria==='calcados') {
            numeracao = document.getElementById('editNumeracao')?.value.trim();
            if (!numeracao) { alert('Informe a numeração'); return; }
        }

        const prodAtual = produtos.find(p=>p.id===currentEditId);
        const removidos = new Set(Array.from(document.querySelectorAll('#editImagesContainer .remove-image-btn[data-removed="true"]')).map(b=>parseInt(b.dataset.index)));
        let imgs = (prodAtual.images||[]).filter((_,i)=>!removidos.has(i));

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
        if (cat==='vestuario'||cat==='shorts') c.innerHTML = `<div class="dynamic-field"><label>Tamanhos:</label><div class="size-checkbox-group"><label><input type="checkbox" value="XXS"> XXS</label><label><input type="checkbox" value="XS"> XS</label><label><input type="checkbox" value="S"> S</label><label><input type="checkbox" value="M"> M</label><label><input type="checkbox" value="L"> L</label><label><input type="checkbox" value="XL"> XL</label><label><input type="checkbox" value="XXL"> XXL</label></div></div>`;
        else if (cat==='calcados') c.innerHTML = `<div class="dynamic-field"><input type="text" id="numeracaoInput" placeholder="Numeração (ex: 35, 36, 37-40)"></div>`;
    }

    function escapeHtml(s) {
        return String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    }

    // ─── EVENTOS ──────────────────────────────────────────────────────────────
    window.addEventListener('scroll', () => document.querySelector('.header').classList.toggle('shrink', window.scrollY > 10));

    // Formatar preço — vincula nos dois campos
    bindPreco(document.getElementById('prodPreco'));
    bindPreco(document.getElementById('editPreco'));

    // Login admin (duplo clique no logo)
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
            document.getElementById('adminPanel').style.display='block';
            adminVisible=true; renderizarAdminLista();
            loginModal.style.display='none'; document.body.style.overflow='auto';
            document.getElementById('adminPassword').value='';
        } else alert('Senha incorreta');
    });

    document.getElementById('logoutAdminBtn').addEventListener('click', () => { document.getElementById('adminPanel').style.display='none'; adminVisible=false; });
    document.getElementById('btnAdicionarProduto').addEventListener('click', adicionarProduto);
    document.getElementById('prodCategoria').addEventListener('change', updateDynamicFields);
    document.querySelectorAll('.cat-btn').forEach(btn => btn.addEventListener('click', () => {
        filtroCategoria = btn.dataset.cat;
        document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderizarCatalogo();
    }));
    document.getElementById('searchInput').addEventListener('input', e => { termoBusca=e.target.value; renderizarCatalogo(); });

    const cartModal = document.getElementById('cartModal');
    document.getElementById('cartIcon').addEventListener('click', () => { renderCartModal(); cartModal.style.display='flex'; });
    document.getElementById('closeCart').addEventListener('click', () => cartModal.style.display='none');
    document.getElementById('clearCartBtn').addEventListener('click', () => { clearCart(); renderCartModal(); });
    document.getElementById('sendCartWhatsapp').addEventListener('click', () => { sendCartToWhatsApp(); cartModal.style.display='none'; });
    window.addEventListener('click', e => { if(e.target===cartModal) cartModal.style.display='none'; });

    // ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────
    document.getElementById('adminPanel').style.display = 'none';
    document.getElementById('prodPreco').value = 'R$ 0,00';
    updateDynamicFields();
    carregarProdutos();
    updateCartUI();
})();
