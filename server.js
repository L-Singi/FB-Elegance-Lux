const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3002;

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
    const { nome, descricao_completa, preco, categoria, status, tamanhos, numeracao } = req.body;
    let uploadedUrls = [];
    
    if (req.files && req.files.length) {
      for (let file of req.files) {
        const fileName = `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`;
        const { error: uploadError } = await supabase.storage
          .from('produtos')
          .upload(fileName, file.buffer, { contentType: file.mimetype });
        if (uploadError) throw uploadError;
        const { data: pub } = supabase.storage.from('produtos').getPublicUrl(fileName);
        uploadedUrls.push(pub.publicUrl);
      }
    }
    
    if (uploadedUrls.length === 0) {
      return res.status(400).json({ error: 'Pelo menos uma imagem é obrigatória' });
    }
    
    const novoProduto = { 
      nome, 
      descricao_completa, 
      preco, 
      images: uploadedUrls, 
      categoria, 
      status 
    };
    
    if (categoria === 'vestuario' && tamanhos) {
      novoProduto.tamanhos = Array.isArray(tamanhos) ? tamanhos : JSON.parse(tamanhos);
    }
    if (categoria === 'calcados' && numeracao) {
      novoProduto.numeracao = numeracao;
    }
    
    const { data, error } = await supabase.from('produtos').insert([novoProduto]).select();
    if (error) throw error;
    res.json(data[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', upload.array('newImages'), async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, descricao_completa, preco, categoria, status, tamanhos, numeracao, existingImages } = req.body;
    
    const { data: currentProduct, error: fetchError } = await supabase
      .from('produtos')
      .select('*')
      .eq('id', id)
      .single();
    
    if (fetchError) throw fetchError;
    
    let newImageUrls = [];
    if (req.files && req.files.length) {
      for (let file of req.files) {
        const fileName = `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`;
        const { error: uploadError } = await supabase.storage
          .from('produtos')
          .upload(fileName, file.buffer, { contentType: file.mimetype });
        if (uploadError) throw uploadError;
        const { data: pub } = supabase.storage.from('produtos').getPublicUrl(fileName);
        newImageUrls.push(pub.publicUrl);
      }
    }
    
    let oldImages = [];
    if (existingImages) {
      oldImages = JSON.parse(existingImages);
    } else {
      oldImages = currentProduct.images || [];
    }
    
    const allImages = [...oldImages, ...newImageUrls];
    
    const updates = {
      nome,
      descricao_completa,
      preco,
      categoria,
      status,
      images: allImages
    };
    
    if (categoria === 'vestuario' && tamanhos) {
      updates.tamanhos = JSON.parse(tamanhos);
    } else if (categoria === 'calcados' && numeracao) {
      updates.numeracao = numeracao;
    } else {
      updates.tamanhos = null;
      updates.numeracao = null;
    }
    
    const { data, error } = await supabase
      .from('produtos')
      .update(updates)
      .eq('id', id)
      .select();
    
    if (error) throw error;
    res.json(data[0]);
  } catch (err) {
    console.error(err);
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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});