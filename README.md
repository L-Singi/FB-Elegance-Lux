# FB Elegance Lux - E-commerce Platform

Uma plataforma de e-commerce moderna para venda de produtos de luxo, construída com Supabase e Netlify Functions.

## Estrutura do Projeto

```
fb_vf/
├── src/                    # Código fonte JavaScript
│   └── app.js             # Aplicação principal do frontend
├── public/                # Arquivos estáticos
│   ├── index.html         # Página principal
│   ├── style.css          # Estilos CSS
│   └── config.js          # Configuração do frontend
├── functions/             # Funções serverless do Netlify
│   └── admin.js           # API de administração
├── .env                   # Variáveis de ambiente (não commitar)
├── .env.example           # Exemplo de variáveis de ambiente
├── netlify.toml           # Configuração do Netlify
├── package.json           # Dependências e scripts
└── README.md              # Este arquivo
```

## Configuração

1. **Clone o repositório e instale as dependências:**
   ```bash
   npm install
   ```

2. **Configure as variáveis de ambiente:**
   - Copie `.env.example` para `.env`
   - Preencha as variáveis com suas chaves do Supabase

3. **Para desenvolvimento local:**
   ```bash
   npm run dev
   ```
   Isso iniciará um servidor local em `http://localhost:3000`

4. **Deploy no Netlify:**
   - Conecte o repositório ao Netlify
   - Configure as variáveis de ambiente no painel do Netlify
   - O build será automático

## Variáveis de Ambiente

### Obrigatórias:
- `SUPABASE_URL`: URL do seu projeto Supabase
- `SUPABASE_ANON_KEY`: Chave anônima do Supabase (para operações públicas)
- `SUPABASE_SERVICE_KEY`: Chave de serviço do Supabase (para operações administrativas)


## Funcionalidades

- ✅ Catálogo de produtos organizado por categorias
- ✅ Carrinho de compras
- ✅ Painel administrativo para gestão de produtos
- ✅ Upload de imagens para produtos
- ✅ Integração com WhatsApp para pedidos
- ✅ Design responsivo e moderno

## Tecnologias Utilizadas

- **Frontend:** HTML5, CSS3, JavaScript (Vanilla)
- **Backend:** Netlify Functions (Node.js)
- **Banco de Dados:** Supabase (PostgreSQL)
- **Armazenamento:** Supabase Storage
- **Deploy:** Netlify

## Desenvolvimento

Para contribuir com o projeto:

1. Faça um fork do repositório
2. Crie uma branch para sua feature: `git checkout -b feature/nova-funcionalidade`
3. Commit suas mudanças: `git commit -m 'Adiciona nova funcionalidade'`
4. Push para a branch: `git push origin feature/nova-funcionalidade`
5. Abra um Pull Request

## Licença

Este projeto está sob a licença ISC.
