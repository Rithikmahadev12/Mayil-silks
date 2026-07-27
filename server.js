require('dotenv').config();

const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Images are handled in memory, then streamed straight to Supabase Storage —
// nothing is written to local disk, so it survives redeploys.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed (jpg, png, webp, gif).'));
  },
});

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

// If Supabase isn't configured yet, show a clear setup message instead of a stack trace.
// (Admin login/logout don't touch the database, so they're allowed through.)
const SUPABASE_EXEMPT_PATHS = ['/admin/login', '/admin/logout'];
app.use((req, res, next) => {
  if (SUPABASE_EXEMPT_PATHS.includes(req.path)) return next();
  if (!db.isConfigured()) {
    return res.status(500).send(
      `<div style="font-family:sans-serif; max-width:640px; margin:60px auto; line-height:1.6;">
        <h1>Setup needed</h1>
        <p>${db.configError()}</p>
        <p>See the README for the Supabase setup steps (create the project, run the SQL, add the environment variables).</p>
      </div>`
    );
  }
  next();
});

// ======================================================
// PUBLIC ROUTES
// ======================================================

app.get('/', async (req, res, next) => {
  try {
    const [products, settings] = await Promise.all([db.getProducts(), db.getSettings()]);
    res.render('index', { products, settings });
  } catch (err) {
    next(err);
  }
});

// ======================================================
// ADMIN AUTH ROUTES
// ======================================================

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

// ======================================================
// ADMIN DASHBOARD ROUTES (protected)
// ======================================================

app.get('/admin', requireAdmin, async (req, res, next) => {
  try {
    const [products, settings] = await Promise.all([db.getProducts(), db.getSettings()]);
    res.render('admin-dashboard', {
      products,
      settings,
      message: req.query.message || null,
      error: req.query.error || null,
    });
  } catch (err) {
    next(err);
  }
});

// Add a new product/saree
app.post('/admin/products', requireAdmin, (req, res, next) => {
  upload.single('image')(req, res, async (err) => {
    if (err) return res.redirect(`/admin?error=${encodeURIComponent(err.message)}`);

    try {
      const { name, price, description } = req.body;
      if (!name || !req.file) {
        return res.redirect(
          `/admin?error=${encodeURIComponent('Name and photo are required.')}`
        );
      }

      const { url, path: imagePath } = await db.uploadImage(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );

      await db.createProduct({
        name: name.trim(),
        price: price ? price.trim() : '',
        description: description ? description.trim() : '',
        imageUrl: url,
        imagePath,
      });

      res.redirect(`/admin?message=${encodeURIComponent('Saree added successfully.')}`);
    } catch (e) {
      next(e);
    }
  });
});

// Edit product form
app.get('/admin/products/:id/edit', requireAdmin, async (req, res, next) => {
  try {
    const product = await db.getProduct(req.params.id);
    res.render('admin-edit', { product });
  } catch (err) {
    res.redirect(`/admin?error=${encodeURIComponent('Product not found.')}`);
  }
});

// Update product
app.post('/admin/products/:id', requireAdmin, (req, res, next) => {
  upload.single('image')(req, res, async (err) => {
    if (err) return res.redirect(`/admin?error=${encodeURIComponent(err.message)}`);

    try {
      const existing = await db.getProduct(req.params.id);
      const { name, price, description } = req.body;

      const fields = {
        name: name ? name.trim() : existing.name,
        price: price !== undefined ? price.trim() : existing.price,
        description: description !== undefined ? description.trim() : existing.description,
      };

      if (req.file) {
        const { url, path: imagePath } = await db.uploadImage(
          req.file.buffer,
          req.file.originalname,
          req.file.mimetype
        );
        fields.image_url = url;
        fields.image_path = imagePath;
        // Remove the old photo now that the new one is stored
        if (existing.image_path) {
          db.deleteImage(existing.image_path).catch(() => {});
        }
      }

      await db.updateProduct(req.params.id, fields);
      res.redirect(`/admin?message=${encodeURIComponent('Saree updated successfully.')}`);
    } catch (e) {
      next(e);
    }
  });
});

// Delete product
app.post('/admin/products/:id/delete', requireAdmin, async (req, res, next) => {
  try {
    const existing = await db.getProduct(req.params.id);
    await db.deleteProduct(req.params.id);
    if (existing && existing.image_path) {
      db.deleteImage(existing.image_path).catch(() => {});
    }
    res.redirect(`/admin?message=${encodeURIComponent('Saree removed.')}`);
  } catch (err) {
    next(err);
  }
});

// Update store settings
app.post('/admin/settings', requireAdmin, async (req, res, next) => {
  try {
    const { storeName, tagline, address, phone, website, status, hours, mapsUrl, about } =
      req.body;
    await db.updateSettings({
      store_name: storeName || '',
      tagline: tagline || '',
      address: address || '',
      phone: phone || '',
      website: website || '',
      status: status || '',
      hours: hours || '',
      maps_url: mapsUrl || '',
      about: about || '',
    });
    res.redirect(`/admin?message=${encodeURIComponent('Store info updated.')}`);
  } catch (err) {
    next(err);
  }
});

// ---------- Error handler ----------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send(
    `<div style="font-family:sans-serif; max-width:640px; margin:60px auto; line-height:1.6;">
      <h1>Something went wrong</h1>
      <p>${err.message || 'Unknown error'}</p>
      <p><a href="/">Go home</a></p>
    </div>`
  );
});

// ---------- 404 ----------
app.use((req, res) => {
  res.status(404).send('Page not found. <a href="/">Go home</a>');
});

app.listen(PORT, () => {
  console.log(`MayilSilks server running on port ${PORT}`);
});
