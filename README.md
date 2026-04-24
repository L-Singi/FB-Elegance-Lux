# FB Elegance Lux

E-commerce site for FB Elegance Lux, separated into frontend and backend.

## Structure

- `server.js`: Node.js backend server with Express and Supabase integration
- `public/index.html`: Frontend HTML
- `public/style.css`: Frontend CSS
- `public/script.js`: Frontend JavaScript
- `package.json`: Dependencies

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Open http://localhost:3000 in your browser.

## Features

- Product catalog with filtering and search
- Shopping cart
- Admin panel for managing products
- WhatsApp integration for orders

## Backend API

- GET /api/products: Get all products
- POST /api/products: Add new product
- PUT /api/products/:id: Update product
- DELETE /api/products/:id: Delete product