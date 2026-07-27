const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || 'saree-photos';

let supabase = null;
let configError = null;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  configError =
    'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY as environment variables.';
} else {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

function assertConfigured() {
  if (configError) throw new Error(configError);
}

// ---------- Products ----------

async function getProducts() {
  assertConfigured();
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function getProduct(id) {
  assertConfigured();
  const { data, error } = await supabase.from('products').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

async function createProduct({ name, price, description, imageUrl, imagePath }) {
  assertConfigured();
  const { data, error } = await supabase
    .from('products')
    .insert([{ name, price, description, image_url: imageUrl, image_path: imagePath }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateProduct(id, fields) {
  assertConfigured();
  const { data, error } = await supabase
    .from('products')
    .update(fields)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteProduct(id) {
  assertConfigured();
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Settings (single row, id = 1) ----------

async function getSettings() {
  assertConfigured();
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single();
  if (error) throw error;
  return data;
}

async function updateSettings(fields) {
  assertConfigured();
  const { data, error } = await supabase
    .from('settings')
    .update(fields)
    .eq('id', 1)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ---------- Storage (photos) ----------

async function uploadImage(buffer, originalName, mimetype) {
  assertConfigured();
  const ext = (originalName.split('.').pop() || 'jpg').toLowerCase();
  const path = `${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: mimetype, upsert: false });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

async function deleteImage(path) {
  assertConfigured();
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

module.exports = {
  isConfigured: () => !configError,
  configError: () => configError,
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getSettings,
  updateSettings,
  uploadImage,
  deleteImage,
};
