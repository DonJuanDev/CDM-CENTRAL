import { fileFoldersApi } from '../api/crud.js?v=20260620c';
import { FILE_CATEGORIES } from '../config.js';
import { invalidatePrefix } from '../cache.js';

const DEFAULT_EXTRA_FOLDERS = [
  { slug: 'wanessa', label: 'Wanessa', icon: '📁', bucket_hint: 'files', sort_order: 2 }
];

export async function ensureClientFolders(clientId) {
  let folders = await fileFoldersApi.list({
    filter: { client_id: clientId },
    order: { column: 'sort_order', asc: true }
  });

  if (!folders.length) {
    await Promise.all(FILE_CATEGORIES.map((cat, i) =>
      fileFoldersApi.create({
        client_id: clientId,
        slug: cat.id,
        label: cat.label,
        icon: cat.icon,
        bucket_hint: cat.bucket,
        sort_order: i
      }).catch(() => null)
    ));
    await Promise.all(DEFAULT_EXTRA_FOLDERS.map(f =>
      fileFoldersApi.create({ client_id: clientId, ...f }).catch(() => null)
    ));
    invalidatePrefix('list:file_folders');
    folders = await fileFoldersApi.list({
      filter: { client_id: clientId },
      order: { column: 'sort_order', asc: true }
    });
  } else {
    for (const extra of DEFAULT_EXTRA_FOLDERS) {
      if (!folders.some(f => f.slug === extra.slug)) {
        await fileFoldersApi.create({ client_id: clientId, ...extra }).catch(() => null);
      }
    }
    invalidatePrefix('list:file_folders');
    folders = await fileFoldersApi.list({
      filter: { client_id: clientId },
      order: { column: 'sort_order', asc: true }
    });
  }

  return folders.length ? folders : FILE_CATEGORIES.map((cat, i) => ({
    id: cat.id,
    slug: cat.id,
    label: cat.label,
    icon: cat.icon,
    bucket_hint: cat.bucket,
    sort_order: i,
    _fallback: true
  }));
}

export function folderSlugFromPath(folderPath = '/') {
  return (folderPath || '/').replace(/^\/+|\/+$/g, '') || '';
}

export function fileMatchesFolder(file, slug) {
  if (!slug) return true;
  const pathSlug = folderSlugFromPath(file.folder_path);
  if (pathSlug === slug) return true;
  if (!pathSlug) {
    if (slug === 'videos' && file.file_type === 'video') return true;
    if (slug === 'imagens' && file.file_type === 'imagem') return true;
  }
  return false;
}

export function findFolderBySlug(folders, slug) {
  return folders.find(f => f.slug === slug) || null;
}
