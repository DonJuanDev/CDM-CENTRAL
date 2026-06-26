import { supabase } from '../supabase-client.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, FILE_CATEGORIES } from '../config.js';
import { invalidatePrefix } from '../cache.js';
import { fileFoldersApi } from '../api/crud.js?v=20260621a';

function getBucket(mimeType, category, folderCategory, bucketHint) {
  if (bucketHint) return bucketHint;
  if (folderCategory?.bucket) return folderCategory.bucket;
  if (category) return category;
  if (mimeType?.startsWith('image/')) return 'images';
  if (mimeType?.startsWith('video/')) return 'videos';
  return 'files';
}

function storageUploadWithProgress(bucket, path, file, onProgress) {
  return new Promise(async (resolve, reject) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      reject(new Error('Sessão expirada. Faça login novamente.'));
      return;
    }

    const xhr = new XMLHttpRequest();
    const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-upsert', 'false');

    const startTime = Date.now();
    xhr.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable) return;
      const elapsed = Math.max(0.001, (Date.now() - startTime) / 1000);
      const speed = event.loaded / elapsed;
      const remaining = speed > 0 ? (event.total - event.loaded) / speed : null;
      onProgress({
        loaded: event.loaded,
        total: event.total,
        percent: (event.loaded / event.total) * 100,
        etaSeconds: remaining
      });
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let msg = xhr.responseText || xhr.statusText;
        try {
          const parsed = JSON.parse(xhr.responseText);
          msg = parsed.message || parsed.error || msg;
        } catch {}
        reject(new Error(msg || 'Falha no upload'));
      }
    };
    xhr.onerror = () => reject(new Error('Erro de rede durante o upload'));
    xhr.onabort = () => reject(new Error('Upload cancelado'));
    xhr.send(file);
  });
}

export async function uploadFile(file, { clientId, projectId, category, folder = '', folderCategoryId, folderSlug, onProgress } = {}) {
  let folderCategory = folderCategoryId ? FILE_CATEGORIES.find(c => c.id === folderCategoryId) : null;
  let bucketHint = folderCategory?.bucket || null;
  const slug = folderSlug || folderCategoryId || normalizeSlugFromFolder(folder);

  if (clientId && slug) {
    const folders = await fileFoldersApi.list({
      filter: { client_id: clientId, slug },
      limit: 1
    });
    if (folders[0]) {
      bucketHint = folders[0].bucket_hint;
      if (!folderCategory) {
        folderCategory = {
          id: folders[0].slug,
          folder: `${folders[0].slug}/`,
          bucket: folders[0].bucket_hint
        };
      }
    }
  }

  const storageFolder = folder || folderCategory?.folder || (slug ? `${slug}/` : '');
  const bucket = getBucket(file.type, category, folderCategory, bucketHint);
  const ext = file.name.split('.').pop();
  const path = `${clientId || 'geral'}/${storageFolder}${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const folderPath = storageFolder ? `/${storageFolder.replace(/\/$/, '')}/` : '/';

  if (onProgress) {
    await storageUploadWithProgress(bucket, path, file, onProgress);
  } else {
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(path, file, { cacheControl: '3600', upsert: false });
    if (uploadError) throw uploadError;
  }

  const fileType = file.type.startsWith('image/') ? 'imagem'
    : file.type.startsWith('video/') ? 'video'
    : file.type === 'application/pdf' ? 'pdf'
    : file.name.endsWith('.zip') ? 'zip' : 'documento';

  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase.from('files').insert({
    client_id: clientId || null,
    project_id: projectId || null,
    folder_path: folderPath,
    name: file.name,
    file_type: fileType,
    storage_path: `${bucket}/${path}`,
    size_bytes: file.size,
    mime_type: file.type,
    uploaded_by: user?.id
  }).select().single();

  if (error) throw error;
  invalidatePrefix('list:files');
  return data;
}

function normalizeSlugFromFolder(folder = '') {
  return folder.replace(/^\/+|\/+$/g, '').replace(/\/.*$/, '');
}

export async function moveFileToFolder(fileRecord, folderSlug) {
  const folderPath = `/${folderSlug}/`;
  const { data, error } = await supabase.from('files')
    .update({ folder_path: folderPath })
    .eq('id', fileRecord.id)
    .select()
    .single();
  if (error) throw error;
  invalidatePrefix('list:files');
  return data;
}

export async function uploadContract(file, clientId) {
  const bucket = 'contracts';
  const path = `${clientId}/${Date.now()}_${file.name}`;

  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file);
  if (uploadError) throw uploadError;

  return `${bucket}/${path}`;
}

export async function uploadInvoicePdf(file, clientId, invoiceId) {
  const bucket = 'invoices';
  const path = `${clientId}/${invoiceId}_${file.name}`;

  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file);
  if (uploadError) throw uploadError;

  const pdfPath = `${bucket}/${path}`;
  await supabase.from('invoices').update({ pdf_path: pdfPath }).eq('id', invoiceId);
  return pdfPath;
}

export async function getSignedUrl(storagePath, expiresIn = 3600) {
  const [bucket, ...rest] = storagePath.split('/');
  const path = rest.join('/');

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error) throw error;
  return data.signedUrl;
}

export async function deleteFileRecord(fileRecord) {
  const isDrive = fileRecord.source === 'drive' || fileRecord.external_url;
  if (!isDrive && fileRecord.storage_path) {
    const [bucket, ...rest] = fileRecord.storage_path.split('/');
    await supabase.storage.from(bucket).remove([rest.join('/')]);
  }
  await supabase.from('files').delete().eq('id', fileRecord.id);
  invalidatePrefix('list:files');
}

export async function deleteFilesInFolder(clientId, folderSlug) {
  const folderPath = `/${folderSlug}/`;
  const { data: files, error } = await supabase.from('files')
    .select('*')
    .eq('client_id', clientId)
    .eq('folder_path', folderPath);
  if (error) throw error;

  for (const file of files || []) {
    await deleteFileRecord(file);
  }
  return (files || []).length;
}

export function isDriveFile(file) {
  return file?.source === 'drive' || Boolean(file?.external_url);
}

export function normalizeDriveUrl(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) throw new Error('Informe o link do Google Drive');

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Link inválido');
  }

  const host = parsed.hostname.replace(/^www\./, '');
  if (!['drive.google.com', 'docs.google.com'].includes(host)) {
    throw new Error('Use um link do Google Drive (drive.google.com)');
  }

  const fileId = trimmed.match(/\/file\/d\/([^/]+)/)?.[1] || parsed.searchParams.get('id');
  if (fileId) return `https://drive.google.com/file/d/${fileId}/view`;

  const folderId = trimmed.match(/\/folders\/([^/?]+)/)?.[1];
  if (folderId) return `https://drive.google.com/drive/folders/${folderId}`;

  return trimmed.split('?')[0];
}

function inferFileTypeFromLink(name, url) {
  const lower = (name || '').toLowerCase();
  if (url.includes('/folders/')) return 'pasta';
  if (/\.(mp4|mov|webm|mkv|mxf|r3d|braw)$/.test(lower)) return 'video';
  if (/\.(jpg|jpeg|png|webp|gif)$/.test(lower)) return 'imagem';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.zip')) return 'zip';
  return 'documento';
}

export async function linkDriveFile({ clientId, folderSlug, name, url }) {
  const externalUrl = normalizeDriveUrl(url);
  const folderPath = folderSlug ? `/${folderSlug}/` : '/';
  const fileType = inferFileTypeFromLink(name, externalUrl);
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase.from('files').insert({
    client_id: clientId,
    folder_path: folderPath,
    name: name.trim(),
    file_type: fileType,
    source: 'drive',
    external_url: externalUrl,
    storage_path: null,
    size_bytes: 0,
    mime_type: null,
    uploaded_by: user?.id
  }).select().single();

  if (error) throw error;
  invalidatePrefix('list:files');
  return data;
}

export async function resolveFileOpenUrl(fileRecord) {
  if (isDriveFile(fileRecord)) return fileRecord.external_url;
  return getSignedUrl(fileRecord.storage_path, 3600);
}
