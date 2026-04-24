const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase config
const SUPABASE_URL = "https://bachgtlwmaroytvhhvfn.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJhY2hndGx3bWFyb3l0dmhodmZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0OTQ4MDAsImV4cCI6MjA5MDA3MDgwMH0.J8ajqwCRrAPLkfYMuXYWs82eO6x6s4A_HteoqOtNFFI";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Multer config for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Middleware
app.use(express.json());
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.get('/api/products', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('produtos')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', upload.array('images'), async (req, res) => {
  try {
    const { nome, descricao_completa, preco, categoria, status, tamanhos, numeracao, images } = req.body;
    let uploadedUrls = [];
    if (req.files && req.files.length) {
      // FormData com files
      for (let file of req.files) {
        const fileName = `${Date.now()}_${file.originalname}`;
        const { error } = await supabase.storage.from('produtos').upload(fileName, file.buffer, { contentType: file.mimetype });
        if (error) throw error;
        const { data: pub } = supabase.storage.from('produtos').getPublicUrl(fileName);
        uploadedUrls.push(pub.publicUrl);
      }
    } else if (images) {
      // JSON com URLs
      uploadedUrls = Array.isArray(images) ? images : [images];
    }
    const novoProduto = { nome, descricao_completa, preco, images: uploadedUrls, categoria, status };
    if (categoria === 'vestuario' && tamanhos) novoProduto.tamanhos = Array.isArray(tamanhos) ? tamanhos : JSON.parse(tamanhos);
    if (categoria === 'calcados' && numeracao) novoProduto.numeracao = numeracao;
    const { data, error } = await supabase.from('produtos').insert([novoProduto]).select();
    if (error) throw error;
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('produtos')
      .update(req.body)
      .eq('id', req.params.id)
      .select();
    if (error) throw error;
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('produtos')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});