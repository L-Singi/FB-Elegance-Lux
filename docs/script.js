(function(){
    let produtos = [];
    let filtroCategoria = 'todos';
    let termoBusca = '';
    let adminVisible = false;
    let currentEditId = null;

    const API_BASE = '/api/products';

    async function apiFetch(path = '', options = {}) {
        const res = await fetch(API_BASE + path, options);
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(err.error || res.statusText);
        }
        return res.json();
    }

    const adminPanel = document.getElementById('adminPanel');
    const toast = document.getElementById('toastNotification');
    const toastMessage = document.getElementById('toastMessage');
    
    function showToast(msg, isError = false) {
        toastMessage.innerText = msg;
        toast.style.borderLeftColor = isError ? '#c0392b' : '#b88b4a';
        toast.querySelector('i:first-child').className = isError ? 'fas fa-exclamation-circle' : 'fas fa-check-circle';
        toast.classList.add('show');
        setTimeout(() => { toast.classList.remove('show'); }, 3000);
    }
    
    document.getElementById('toastClose').addEventListener('click', () => toast.classList.remove('show'));

    // Carrinho
    let cart = JSON.parse(localStorage.getItem('fb_cart')) || [];
    function saveCart() { localStorage.setItem('fb_cart', JSON.stringify(cart)); updateCartUI(); }
    function updateCartUI() { document.getElementById('cartCount').innerText = cart.reduce((sum,item)=>sum+item.quantity,0); renderCartModal(); }
    
    function addToCart(prod, qty=1) {
        if (prod.status === 'vendido') { showToast('❌ Item já vendido!', true); return; }
        const existing = cart.find(item=>item.id===prod.id);
        if(existing) existing.quantity += qty;
        else cart.push({id:prod.id, nome:prod.nome, preco:prod.preco, images:prod.images, tamanhos:prod.tamanhos, numeracao:prod.numeracao, categoria:prod.categoria, quantity:qty});
        saveCart();
        showToast(`✓ ${prod.nome} adicionado ao carrinho`);
    }
    
    function removeFromCart(id) { cart = cart.filter(item=>item.id!==id); saveCart(); }
    function clearCart() { cart = []; saveCart(); }
    
    function renderCartModal() {
        const container = document.getElementById('cartItemsList');
        if(!container) return;
        if(cart.length===0) { container.innerHTML='<div style="text-align:center;padding:20px;">Seu carrinho está vazio.</div>'; document.getElementById('cartTotal').innerHTML=''; return; }
        let html='', total=0;
        cart.forEach(item=>{
            const precoNum = parseFloat(item.preco.replace('R$ ','').replace('.','').replace(',','.')) || 0;
            total += precoNum * item.quantity;
            const imgUrl = item.images && item.images[0] ? item.images[0] : 'https://placehold.co/100x100?text=Sem+imagem';
            html += `
                <div class="cart-item">
                    <img class="cart-item-img" src="${imgUrl}" alt="${escapeHtml(item.nome)}">
                    <div class="cart-item-info">
                        <strong>${escapeHtml(item.nome)}</strong>
                        <span>${item.preco} x ${item.quantity}</span>
                    </div>
                    <button class="cart-item-remove" data-id="${item.id}"><i class="fas fa-trash-alt"></i></button>
                </div>
            `;
        });
        container.innerHTML = html;
        document.getElementById('cartTotal').innerHTML = `Total: R$ ${total.toFixed(2).replace('.',',')}`;
        document.querySelectorAll('.cart-item-remove').forEach(btn=>{ btn.addEventListener('click',(e)=>{ removeFromCart(btn.getAttribute('data-id')); renderCartModal(); }); });
    }
    
    function sendCartToWhatsApp() {
        if(cart.length===0) { showToast('Seu carrinho está vazio', true); return; }
        let msg = "🛍️ *Meu pedido:*%0A";
        cart.forEach(item=>{
            let extra = '';
            if(item.categoria==='vestuario' && item.tamanhos) extra = ` (Tam: ${item.tamanhos.join(',')})`;
            if(item.categoria==='calcados' && item.numeracao) extra = ` (Num: ${item.numeracao})`;
            msg += `- ${item.nome}${extra} - ${item.preco} x ${item.quantity}%0A`;
        });
        const total = cart.reduce((sum,item)=>sum + (parseFloat(item.preco.replace('R$ ','').replace('.','').replace(',','.'))||0)*item.quantity,0);
        msg += `%0A*Total:* R$ ${total.toFixed(2).replace('.',',')}`;
        window.open(`https://wa.me/5543996179533?text=${msg}`, '_blank');
    }

    async function carregarProdutos() {
        try {
            const data = await apiFetch();
            produtos = Array.isArray(data) ? data : [];
            renderizarCatalogo();
            renderizarSecoesCuradas();
            if (adminVisible) renderizarAdminLista();
        } catch(err) {
            console.error('Falha ao carregar produtos:', err);
            const grid = document.getElementById('product-grid');
            if (grid) grid.innerHTML = '<div class="empty-message">Erro ao carregar produtos. Veja o console do navegador.</div>';
            showToast('Erro ao carregar o estoque.', true);
        }
    }

    function renderizarSecoesCuradas() {
        const lancamentos = produtos.filter(p=>p.status==='lancamentos' && p.status!=='vendido');
        const recentes = [...produtos].filter(p=>p.status!=='vendido').sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,6);
        const lancGrid = document.getElementById('lancamentosGrid');
        const procGrid = document.getElementById('procuradosGrid');
        if(lancamentos.length) {
            document.getElementById('lancamentosSection').style.display = 'block';
            lancGrid.innerHTML = '';
            lancamentos.slice(0,6).forEach(prod=>lancGrid.appendChild(criarCardProduto(prod)));
        } else document.getElementById('lancamentosSection').style.display = 'none';
        if(recentes.length) {
            document.getElementById('procuradosSection').style.display = 'block';
            procGrid.innerHTML = '';
            recentes.forEach(prod=>procGrid.appendChild(criarCardProduto(prod)));
        } else document.getElementById('procuradosSection').style.display = 'none';
    }

    function criarCardProduto(prod) {
        const card = document.createElement('div'); card.className = 'product-card'; card.setAttribute('data-id', prod.id);
        let categoriaLabel = '', statusLabel='', statusClass='';
        if(prod.categoria==='calcados') categoriaLabel='CALÇADOS';
        else if(prod.categoria==='vestuario') categoriaLabel='VESTUÁRIO';
        else categoriaLabel='LIFESTYLE';
        if(prod.status==='disponiveis') { statusLabel='DISPONÍVEL'; statusClass='disponivel'; }
        else if(prod.status==='lancamentos') { statusLabel='LANÇAMENTO'; statusClass='lancamento'; }
        else if(prod.status==='embreve') { statusLabel='EM BREVE'; statusClass='embreve'; }
        else if(prod.status==='vendido') { statusLabel='VENDIDO'; statusClass='vendido'; }
        let sizeHtml = '';
        if(prod.categoria==='vestuario' && prod.tamanhos?.length) sizeHtml = `<div class="product-size-info">Tamanhos: ${prod.tamanhos.join(', ')}</div>`;
        else if(prod.categoria==='calcados' && prod.numeracao) sizeHtml = `<div class="product-size-info">Numeração: ${prod.numeracao}</div>`;
        const isSold = prod.status === 'vendido';
        card.innerHTML = `
            <div class="product-image-container">
                <span class="status-badge ${statusClass}">${statusLabel}</span>
                <img class="product-image" src="${prod.images[0]}" alt="${escapeHtml(prod.nome)}" onerror="this.src='https://placehold.co/600x800?text=Imagem+indisponível'">
                ${prod.images.length>1?`<div class="nav-arrow nav-arrow-left" data-id="${prod.id}" data-dir="prev"><i class="fas fa-chevron-left"></i></div><div class="nav-arrow nav-arrow-right" data-id="${prod.id}" data-dir="next"><i class="fas fa-chevron-right"></i></div>`:''}
            </div>
            <div class="product-info">
                <div class="product-category">${categoriaLabel}</div>
                <h3 class="product-title">${escapeHtml(prod.nome)}</h3>
                <p class="product-price">${prod.preco}</p>
                ${sizeHtml}
                <button class="btn-add-cart ${isSold ? 'disabled' : ''}" data-id="${prod.id}" ${isSold ? 'disabled' : ''}><i class="fas fa-cart-plus"></i> ${isSold ? 'Indisponível' : 'Adicionar'}</button>
                <button class="btn-details" data-id="${prod.id}"><i class="fas fa-expand-alt"></i> Detalhes</button>
            </div>
        `;
        const addBtn = card.querySelector('.btn-add-cart');
        if (!isSold) addBtn.addEventListener('click', (e) => { e.stopPropagation(); addToCart(prod); });
        else addBtn.addEventListener('click', (e) => { e.stopPropagation(); showToast('❌ Este item já foi vendido', true); });
        const detailsBtn = card.querySelector('.btn-details');
        detailsBtn.addEventListener('click', (e) => { e.stopPropagation(); abrirModal(prod); });
        const arrows = card.querySelectorAll('.nav-arrow');
        arrows.forEach(arrow=>arrow.addEventListener('click',(e)=>{e.stopPropagation(); handleArrowClickProd(prod, arrow.getAttribute('data-dir'), card);}));
        card.addEventListener('click', (e) => { if(e.target===addBtn||e.target===detailsBtn||e.target.closest('.nav-arrow')) return; abrirModal(prod); });
        return card;
    }

    function handleArrowClickProd(prod, dir, card) {
        if(!prod.images||prod.images.length<=1) return;
        let idx = parseInt(card.dataset.currentIndex||'0');
        idx = dir==='prev' ? (idx-1+prod.images.length)%prod.images.length : (idx+1)%prod.images.length;
        card.dataset.currentIndex = idx;
        card.querySelector('.product-image').src = prod.images[idx];
    }

    function renderizarCatalogo() {
        const grid = document.getElementById('product-grid');
        let filtrados = produtos.filter(p=> filtroCategoria==='todos'||p.categoria===filtroCategoria);
        if(termoBusca.trim()) {
            const busca = termoBusca.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
            filtrados = filtrados.filter(p=>p.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes(busca));
        }
        filtrados.sort((a,b)=> (a.status==='vendido'?1:0) - (b.status==='vendido'?1:0));
        if(filtrados.length===0) grid.innerHTML='<div class="empty-message">✦ Nenhum produto encontrado ✦</div>';
        else { grid.innerHTML=''; filtrados.forEach(p=>grid.appendChild(criarCardProduto(p))); }
    }

    function abrirModal(prod) {
        const modal = document.getElementById('productModal');
        document.getElementById('modalTitle').innerText = prod.nome;
        let cat = prod.categoria==='calcados'?'CALÇADOS':prod.categoria==='vestuario'?'VESTUÁRIO':'LIFESTYLE';
        document.getElementById('modalCategory').innerText = cat;
        document.getElementById('modalPrice').innerText = prod.preco;
        document.getElementById('modalDesc').innerText = prod.descricao_completa||'';
        let sizeText = '';
        if(prod.categoria==='vestuario'&&prod.tamanhos?.length) sizeText = `Tamanhos: ${prod.tamanhos.join(', ')}`;
        else if(prod.categoria==='calcados'&&prod.numeracao) sizeText = `Numeração: ${prod.numeracao}`;
        document.getElementById('modalSize').innerHTML = sizeText ? `<i class="fas fa-ruler"></i> ${sizeText}` : '';
        const images = prod.images||[];
        const mainImg = document.getElementById('modalMainImg');
        const thumbsDiv = document.getElementById('modalThumbs');
        if(images.length) {
            mainImg.src = images[0];
            thumbsDiv.innerHTML = '';
            images.forEach((img,idx)=>{
                const thumb = document.createElement('img');
                thumb.src = img; thumb.classList.add('modal-thumb');
                if(idx===0) thumb.classList.add('active');
                thumb.addEventListener('click',()=>{ mainImg.src=img; document.querySelectorAll('.modal-thumb').forEach(t=>t.classList.remove('active')); thumb.classList.add('active'); });
                thumbsDiv.appendChild(thumb);
            });
        }
        let extra = '';
        if(prod.categoria==='vestuario'&&prod.tamanhos) extra = ` - Tamanhos: ${prod.tamanhos.join(', ')}`;
        if(prod.categoria==='calcados'&&prod.numeracao) extra = ` - Numeração: ${prod.numeracao}`;
        const msg = `Olá! Tenho interesse no produto: ${prod.nome} - ${prod.preco}${extra}`;
        document.getElementById('modalWhatsappBtn').href = `https://wa.me/5543996179533?text=${encodeURIComponent(msg)}`;
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    document.getElementById('productModalClose').addEventListener('click', () => {
        document.getElementById('productModal').style.display = 'none';
        document.body.style.overflow = 'auto';
    });
    window.addEventListener('click', e => { if (e.target === document.getElementById('productModal')) { document.getElementById('productModal').style.display = 'none'; document.body.style.overflow = 'auto'; } });

    async function atualizarProduto(id, updates) {
        try {
            const updated = await apiFetch(`/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            const index = produtos.findIndex(p => p.id === id);
            if (index !== -1) produtos[index] = updated;
            renderizarCatalogo(); renderizarSecoesCuradas();
            if (adminVisible) renderizarAdminLista();
            return true;
        } catch(err) { console.error(err); showToast('Erro ao atualizar produto.', true); return false; }
    }

    async function excluirProduto(id) {
        if (!confirm('Excluir este produto permanentemente?')) return;
        try {
            await apiFetch(`/${id}`, { method: 'DELETE' });
            produtos = produtos.filter(p => p.id !== id);
            renderizarCatalogo(); renderizarSecoesCuradas();
            if (adminVisible) renderizarAdminLista();
            showToast('Produto removido.');
        } catch(err) { console.error(err); showToast('Erro ao remover produto.', true); }
    }

    async function salvarEdicaoComImagens() {
        const nome = document.getElementById('editNome').value.trim();
        const desc = document.getElementById('editDesc').value.trim();
        let preco = document.getElementById('editPreco').value.trim();
        const categoria = document.getElementById('editCategoria').value;
        const status = document.getElementById('editStatus').value;
        const newImagesFiles = document.getElementById('editNewImages').files;
        
        if (!nome || !preco) {
            showToast('Nome e preço são obrigatórios', true);
            return;
        }
        
        if (!preco.startsWith('R$')) {
            preco = 'R$ ' + preco.replace(/[^\d,]/g, '').replace(',', '.');
        }
        
        const existingImages = [];
        document.querySelectorAll('#editImagesContainer .image-preview-item img').forEach(img => {
            if (img.src && !img.src.startsWith('blob:')) {
                existingImages.push(img.src);
            }
        });
        
        const formData = new FormData();
        formData.append('nome', nome);
        formData.append('descricao_completa', desc);
        formData.append('preco', preco);
        formData.append('categoria', categoria);
        formData.append('status', status);
        formData.append('existingImages', JSON.stringify(existingImages));
        
        if (categoria === 'vestuario') {
            const checkboxes = document.querySelectorAll('#editTamanhosGroup input[type="checkbox"]');
            const tamanhos = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
            if (!tamanhos.length) {
                showToast('Selecione pelo menos um tamanho', true);
                return;
            }
            formData.append('tamanhos', JSON.stringify(tamanhos));
        } else if (categoria === 'calcados') {
            const numeracao = document.getElementById('editNumeracao')?.value.trim();
            if (!numeracao) {
                showToast('Informe a numeração', true);
                return;
            }
            formData.append('numeracao', numeracao);
        }
        
        for (let i = 0; i < newImagesFiles.length; i++) {
            formData.append('newImages', newImagesFiles[i]);
        }
        
        try {
            const response = await fetch(`${API_BASE}/${currentEditId}`, {
                method: 'PUT',
                body: formData
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Erro ao atualizar');
            }
            
            const updated = await response.json();
            const index = produtos.findIndex(p => p.id === currentEditId);
            if (index !== -1) produtos[index] = updated;
            
            renderizarCatalogo();
            renderizarSecoesCuradas();
            if (adminVisible) renderizarAdminLista();
            
            document.getElementById('editModal').style.display = 'none';
            document.body.style.overflow = 'auto';
            showToast('Produto atualizado com sucesso!');
            
        } catch (err) {
            console.error(err);
            showToast(err.message || 'Erro ao atualizar produto.', true);
        }
    }

    function abrirEdicao(prod) {
        currentEditId = prod.id;
        document.getElementById('editNome').value = prod.nome;
        document.getElementById('editDesc').value = prod.descricao_completa || '';
        document.getElementById('editPreco').value = prod.preco;
        document.getElementById('editCategoria').value = prod.categoria;
        document.getElementById('editStatus').value = prod.status;
        updateEditSizeFields(prod);
        const container = document.getElementById('editImagesContainer');
        container.innerHTML = '';
        if (prod.images && prod.images.length) {
            prod.images.forEach((img, idx) => {
                const div = document.createElement('div'); div.className = 'image-preview-item';
                div.innerHTML = `<img src="${img}"><button class="remove-image-btn" data-index="${idx}">✕</button>`;
                container.appendChild(div);
            });
        }
        document.getElementById('editModal').style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    function updateEditSizeFields(prod) {
        const container = document.getElementById('editSizeContainer');
        container.innerHTML = '';
        if (prod.categoria === 'vestuario') {
            container.innerHTML = `<label>Tamanhos disponíveis:</label><div class="edit-checkbox-group" id="editTamanhosGroup"></div>`;
            const group = document.getElementById('editTamanhosGroup');
            const tamanhosList = ['PP','P','M','G','GG'];
            tamanhosList.forEach(t => {
                const checked = prod.tamanhos && prod.tamanhos.includes(t);
                group.innerHTML += `<label><input type="checkbox" value="${t}" ${checked ? 'checked' : ''}> ${t}</label>`;
            });
        } else if (prod.categoria === 'calcados') {
            container.innerHTML = `<label>Numeração</label><input type="text" id="editNumeracao" value="${prod.numeracao || ''}" placeholder="Ex: 35, 36, 37-40">`;
        }
    }

    document.getElementById('editCategoria').addEventListener('change', () => {
        const prod = produtos.find(p => p.id === currentEditId);
        if (prod) updateEditSizeFields({ ...prod, categoria: document.getElementById('editCategoria').value });
    });

    document.getElementById('editSaveBtn').addEventListener('click', salvarEdicaoComImagens);
    document.getElementById('editCancelBtn').addEventListener('click', () => {
        document.getElementById('editModal').style.display = 'none';
        document.body.style.overflow = 'auto';
    });
    document.getElementById('editModalClose').addEventListener('click', () => {
        document.getElementById('editModal').style.display = 'none';
        document.body.style.overflow = 'auto';
    });

    function renderizarAdminLista() {
        const container = document.getElementById('adminListaContainer');
        if (!container) return;
        if (produtos.length === 0) { container.innerHTML = '<div style="padding:20px; text-align:center; color:#aaa;">Nenhum produto cadastrado</div>'; return; }
        container.innerHTML = '';
        produtos.forEach(prod => {
            const div = document.createElement('div'); div.className = 'admin-item';
            div.innerHTML = `
                <div class="admin-item-info">
                    <strong>${escapeHtml(prod.nome)}</strong>
                    <span style="color:#b88b4a;">${prod.categoria.toUpperCase()}</span>
                    <span>${prod.preco}</span>
                    <span style="font-size:0.7rem;">📷 ${prod.images ? prod.images.length : 1}</span>
                    <span style="font-size:0.7rem;">${prod.status === 'disponiveis' ? '✓ Disponível' : (prod.status === 'lancamentos' ? '⭐ Lançamento' : (prod.status === 'embreve' ? '⏳ Em breve' : '🔴 Vendido'))}</span>
                </div>
                <div class="admin-actions">
                    <button class="edit-ad" data-id="${prod.id}">✏️ Editar anúncio</button>
                    <button class="mark-sold" data-id="${prod.id}" data-status="${prod.status}">${prod.status === 'vendido' ? '🔄 Reativar' : '🏷️ Marcar vendido'}</button>
                    <button class="delete-prod" data-id="${prod.id}">🗑️ Remover</button>
                </div>
            `;
            container.appendChild(div);
        });
        document.querySelectorAll('.edit-ad').forEach(btn => btn.addEventListener('click', (e) => { const id = btn.getAttribute('data-id'); const prod = produtos.find(p => p.id === id); if (prod) abrirEdicao(prod); }));
        document.querySelectorAll('.mark-sold').forEach(btn => btn.addEventListener('click', (e) => { const id = btn.getAttribute('data-id'); const statusAtual = btn.getAttribute('data-status'); alternarStatusVendido(id, statusAtual); }));
        document.querySelectorAll('.delete-prod').forEach(btn => btn.addEventListener('click', (e) => { const id = btn.getAttribute('data-id'); excluirProduto(id); }));
    }

    async function alternarStatusVendido(id, statusAtual) {
        let novoStatus = (statusAtual === 'vendido') ? 'disponiveis' : 'vendido';
        await atualizarProduto(id, { status: novoStatus });
    }

    async function adicionarProduto() {
        const nome = document.getElementById('prodNome').value.trim();
        const desc = document.getElementById('prodDesc').value.trim();
        let preco = document.getElementById('prodPreco').value.trim();
        const files = document.getElementById('prodImagensFile').files;
        const categoria = document.getElementById('prodCategoria').value;
        const status = document.getElementById('prodStatus').value;
        
        if (!nome || !preco || files.length === 0) {
            showToast('Preencha nome, preço e selecione pelo menos uma imagem.', true);
            return;
        }
        
        if (!preco.startsWith('R$')) {
            preco = formatPrice(preco);
        }
        
        const formData = new FormData();
        formData.append('nome', nome);
        formData.append('descricao_completa', desc);
        formData.append('preco', preco);
        formData.append('categoria', categoria);
        formData.append('status', status);
        
        if (categoria === 'vestuario') {
            const checkboxes = document.querySelectorAll('#dynamicFieldsContainer input[type="checkbox"]');
            const tamanhos = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
            if (tamanhos.length === 0) {
                showToast('Selecione pelo menos um tamanho.', true);
                return;
            }
            formData.append('tamanhos', JSON.stringify(tamanhos));
        } else if (categoria === 'calcados') {
            const numeracao = document.getElementById('numeracaoInput')?.value.trim();
            if (!numeracao) {
                showToast('Informe a numeração.', true);
                return;
            }
            formData.append('numeracao', numeracao);
        }
        
        for (let i = 0; i < files.length; i++) {
            formData.append('images', files[i]);
        }
        
        try {
            const response = await fetch(API_BASE, {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Erro ao adicionar produto');
            }
            
            const result = await response.json();
            produtos.unshift(result);
            renderizarCatalogo();
            renderizarSecoesCuradas();
            if (adminVisible) renderizarAdminLista();
            
            document.getElementById('prodNome').value = '';
            document.getElementById('prodDesc').value = '';
            document.getElementById('prodPreco').value = 'R$ ';
            document.getElementById('prodImagensFile').value = '';
            document.getElementById('imagePreviewContainer').innerHTML = '';
            updateDynamicFields();
            
            showToast('Produto adicionado com sucesso!');
        } catch (err) {
            console.error(err);
            showToast(err.message || 'Erro ao adicionar produto.', true);
        }
    }

    function setupImagePreview() {
        const fileInput = document.getElementById('prodImagensFile');
        const previewContainer = document.getElementById('imagePreviewContainer');
        
        if (!fileInput || !previewContainer) return;
        
        fileInput.addEventListener('change', function() {
            previewContainer.innerHTML = '';
            const files = Array.from(this.files);
            
            files.forEach((file, index) => {
                const reader = new FileReader();
                const previewDiv = document.createElement('div');
                previewDiv.className = 'image-preview-item';
                
                reader.onload = function(e) {
                    const img = document.createElement('img');
                    img.src = e.target.result;
                    img.style.width = '80px';
                    img.style.height = '80px';
                    img.style.objectFit = 'cover';
                    
                    const removeBtn = document.createElement('button');
                    removeBtn.innerHTML = '✕';
                    removeBtn.className = 'remove-preview-btn';
                    removeBtn.onclick = () => {
                        const dt = new DataTransfer();
                        const newFiles = Array.from(fileInput.files).filter((_, i) => i !== index);
                        newFiles.forEach(f => dt.items.add(f));
                        fileInput.files = dt.files;
                        previewDiv.remove();
                        setupImagePreview();
                    };
                    
                    previewDiv.appendChild(img);
                    previewDiv.appendChild(removeBtn);
                    previewContainer.appendChild(previewDiv);
                };
                
                reader.readAsDataURL(file);
            });
        });
    }

    function formatPrice(v) {
        let n = v.replace(/\D/g, '');
        if (!n) return 'R$ ';

        // Trata como valor em reais
        // Sempre adiciona ",00" para valores inteiros
        let num = parseFloat(n);

        return 'R$ ' + num.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    }
    
    function updateDynamicFields() { 
        const cat = document.getElementById('prodCategoria').value; 
        const cont = document.getElementById('dynamicFieldsContainer'); 
        cont.innerHTML = ''; 
        if (cat === 'vestuario') cont.innerHTML = `<div class="dynamic-field"><label>Tamanhos disponíveis:</label><div class="size-checkbox-group"><label><input type="checkbox" value="PP"> PP</label><label><input type="checkbox" value="P"> P</label><label><input type="checkbox" value="M"> M</label><label><input type="checkbox" value="G"> G</label><label><input type="checkbox" value="GG"> GG</label></div></div>`; 
        else if (cat === 'calcados') cont.innerHTML = `<div class="dynamic-field"><input type="text" id="numeracaoInput" placeholder="Numeração (ex: 35, 36, 37-40)"></div>`; 
    }
    
    function escapeHtml(s) { if (!s) return ''; return s.replace(/[&<>]/g, m => { if (m === '&') return '&amp;'; if (m === '<') return '&lt;'; if (m === '>') return '&gt;'; return m; }); }

    const header = document.querySelector('.header');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 10) header.classList.add('shrink');
        else header.classList.remove('shrink');
    });

    const loginModal = document.getElementById('loginModal');
    function showLoginModal() { loginModal.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
    function hideLoginModal() { loginModal.style.display = 'none'; document.body.style.overflow = 'auto'; }
    
    let logoClickTimer = null;
    const logoElement = document.getElementById('adminTriggerLogo');
    logoElement.addEventListener('click', () => {
        if (logoClickTimer) clearTimeout(logoClickTimer);
        logoClickTimer = setTimeout(() => { logoClickTimer = null; window.location.reload(); }, 350);
    });
    logoElement.addEventListener('dblclick', () => {
        if (logoClickTimer) { clearTimeout(logoClickTimer); logoClickTimer = null; }
        showLoginModal();
    });
    
    document.getElementById('loginModalClose').addEventListener('click', hideLoginModal);
    window.addEventListener('click', e => { if (e.target === loginModal) hideLoginModal(); });
    
    document.getElementById('loginAdminBtn').addEventListener('click', () => {
        const pass = document.getElementById('adminPassword').value;
        if (pass === "fbadmin") {
            adminPanel.style.display = 'block';
            adminVisible = true;
            renderizarAdminLista();
            hideLoginModal();
            document.getElementById('adminPassword').value = '';
        } else {
            alert("Senha incorreta");
        }
    });

    document.getElementById('logoutAdminBtn').addEventListener('click', () => { adminPanel.style.display = 'none'; adminVisible = false; });
    document.getElementById('btnAdicionarProduto').addEventListener('click', adicionarProduto);
    document.getElementById('prodCategoria').addEventListener('change', updateDynamicFields);
    document.getElementById('prodPreco').addEventListener('input', function(e){
        let raw = e.target.value;
        let formatted = formatPrice(raw);
        e.target.value = formatted;
        // Posiciona o cursor no final do valor formatado
        e.target.setSelectionRange(formatted.length, formatted.length);
    });
    
    document.querySelectorAll('.cat-btn').forEach(btn => btn.addEventListener('click', () => { filtroCategoria = btn.getAttribute('data-cat'); document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); renderizarCatalogo(); }));
    document.getElementById('searchInput').addEventListener('input', e => { termoBusca = e.target.value; renderizarCatalogo(); });
    
    const cartModal = document.getElementById('cartModal');
    document.getElementById('cartIcon').addEventListener('click', () => { renderCartModal(); cartModal.style.display = 'flex'; });
    document.getElementById('closeCart').addEventListener('click', () => cartModal.style.display = 'none');
    document.getElementById('clearCartBtn').addEventListener('click', () => { clearCart(); renderCartModal(); });
    document.getElementById('sendCartWhatsapp').addEventListener('click', () => { sendCartToWhatsApp(); cartModal.style.display = 'none'; });
    window.addEventListener('click', e => { if (e.target === cartModal) cartModal.style.display = 'none'; });
    
    adminPanel.style.display = 'none';
    updateDynamicFields();
    setupImagePreview();
    carregarProdutos();
    updateCartUI();
})();