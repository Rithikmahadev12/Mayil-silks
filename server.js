require('dotenv').config();

const express = require('express');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Make sure required folders/files exist (important on first deploy)
[DATA_DIR, UPLOADS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});
if (!fs.existsSync(PRODUCTS_FILE)) fs.writeFileSync(PRODUCTS_FILE, '[]');
if (!fs.existsSync(SETTINGS_FILE)) {
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify(
      {
        storeName: 'MayilSilks',
        tagline: 'Sarees & Clothing, Handpicked with Love',
        address: '',
        phone: '',
        website: '',
        status: 'Open',
        hours: '',
        mapsUrl: '',
        about: '',
      },
      null,
      2
    )
  );
}


function readProducts() {
  return JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
}
function writeProducts(products) {
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
}
function readSettings() {
  return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
}
function writeSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}


app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8 hours
  })
);

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect('/admin/login');
}


const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safeName);
  },
});
function fileFilter(req, file, cb) {
  const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) cb(null, true);
  else cb(new Error('Only image files are allowed (jpg, png, webp, gif).'));
}
const upload = multer({ storage, fileFilter, limits: { fileSize: 8 * 1024 * 1024 } });



app.get('/', (req, res) => {
  const products = readProducts().sort((a, b) => b.createdAt - a.createdAt);
  const settings = readSettings();
  res.render('index', { products, settings });
});



app.get('/admin/login', (req, res) => {
  res.render('admin-login', { error: null });
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.ADMIN_USER || 'admin';
  const validPass = process.env.ADMIN_PASS || 'changeme123';

  if (username === validUser && password === validPass) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.render('admin-login', { error: 'Invalid username or password.' });
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});



app.get('/admin', requireAdmin, (req, res) => {
  const products = readProducts().sort((a, b) => b.createdAt - a.createdAt);
  const settings = readSettings();
  res.render('admin-dashboard', {
    products,
    settings,
    message: req.query.message || null,
    error: req.query.error || null,
  });
});

// Add a new product/saree
app.post('/admin/products', requireAdmin, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.redirect(`/admin?error=${encodeURIComponent(err.message)}`);

    const { name, price, description } = req.body;
    if (!name || !req.file) {
      return res.redirect(`/admin?error=${encodeURIComponent('Name and image are required.')}`);
    }

    const products = readProducts();
    const newProduct = {
      id: Date.now().toString(),
      name: name.trim(),
      price: price ? price.trim() : '',
      description: description ? description.trim() : '',
      image: `/uploads/${req.file.filename}`,
      createdAt: Date.now(),
    };
    products.push(newProduct);
    writeProducts(products);
    res.redirect(`/admin?message=${encodeURIComponent('Saree added successfully.')}`);
  });
});

// Edit product form
app.get('/admin/products/:id/edit', requireAdmin, (req, res) => {
  const products = readProducts();
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.redirect(`/admin?error=${encodeURIComponent('Product not found.')}`);
  res.render('admin-edit', { product });
});

// Update product
app.post('/admin/products/:id', requireAdmin, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.redirect(`/admin?error=${encodeURIComponent(err.message)}`);

    const products = readProducts();
    const idx = products.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      return res.redirect(`/admin?error=${encodeURIComponent('Product not found.')}`);
    }

    const { name, price, description } = req.body;
    products[idx].name = name ? name.trim() : products[idx].name;
    products[idx].price = price !== undefined ? price.trim() : products[idx].price;
    products[idx].description =
      description !== undefined ? description.trim() : products[idx].description;

    if (req.file) {
      const oldImagePath = path.join(__dirname, 'public', products[idx].image);
      if (fs.existsSync(oldImagePath)) fs.unlinkSync(oldImagePath);
      products[idx].image = `/uploads/${req.file.filename}`;
    }

    writeProducts(products);
    res.redirect(`/admin?message=${encodeURIComponent('Saree updated successfully.')}`);
  });
});

// Delete product
app.post('/admin/products/:id/delete', requireAdmin, (req, res) => {
  const products = readProducts();
  const idx = products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) {
    return res.redirect(`/admin?error=${encodeURIComponent('Product not found.')}`);
  }
  const [removed] = products.splice(idx, 1);
  const imagePath = path.join(__dirname, 'public', removed.image);
  if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
  writeProducts(products);
  res.redirect(`/admin?message=${encodeURIComponent('Saree removed.')}`);
});

// Update store settings (address, phone, status, etc.)
app.post('/admin/settings', requireAdmin, (req, res) => {
  const { storeName, tagline, address, phone, website, status, hours, mapsUrl, about } = req.body;
  const settings = {
    storeName: storeName || '',
    tagline: tagline || '',
    address: address || '',
    phone: phone || '',
    website: website || '',
    status: status || '',
    hours: hours || '',
    mapsUrl: mapsUrl || '',
    about: about || '',
  };
  writeSettings(settings);
  res.redirect(`/admin?message=${encodeURIComponent('Store info updated.')}`);
});


app.use((req, res) => {
  res.status(404).send('Page not found. <a href="/">Go home</a>');
});

app.listen(PORT, () => {
  console.log(`MayilSilks server running on port ${PORT}`);
});
