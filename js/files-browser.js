import { $, $$, formatFileSize, formatDuration, showToast, handleError } from './utils.js';
import { writeViewHash } from './router.js';

export function showUploadProgress({ fileName, percent = 0, loaded = 0, total = 0, etaSeconds = null, phase = 'upload' }) {
  const overlay = $('#upload-progress');
  if (!overlay) return;

  overlay.classList.remove('hidden');
  $('#upload-progress-name').textContent = fileName || 'Arquivo';
  $('#upload-progress-fill').style.width = `${Math.min(100, Math.max(0, percent))}%`;

  const phaseLabel = phase === 'save' ? 'Salvando registro...' : 'Enviando arquivo...';
  $('#upload-progress-title').textContent = phaseLabel;

  const meta = [];
  if (total > 0) meta.push(`${formatFileSize(loaded)} de ${formatFileSize(total)}`);
  if (percent > 0 && percent < 100) meta.push(`${Math.round(percent)}%`);
  if (etaSeconds != null && phase === 'upload' && percent > 2 && percent < 100) {
    meta.push(`~${formatDuration(etaSeconds)} restantes`);
  }
  $('#upload-progress-meta').textContent = meta.join(' · ') || 'Preparando upload...';
}

export function hideUploadProgress() {
  $('#upload-progress')?.classList.add('hidden');
}

export function bindArquivosEvents({ refresh, canManageFolders }) {
  const contextMenu = $('#file-context-menu');
  let contextTarget = null;
  let dragActive = false;

  function hideContextMenu() {
    contextMenu?.classList.add('hidden');
    contextTarget = null;
  }

  document.addEventListener('click', hideContextMenu);
  document.addEventListener('scroll', hideContextMenu, true);

  $$('[data-file-nav]').forEach(btn => {
    btn.onclick = (e) => {
      if (dragActive || e.defaultPrevented) return;
      const client = btn.dataset.client || '';
      const pasta = btn.dataset.pasta || '';
      const grupo = btn.dataset.grupo || '';
      const query = {};
      if (grupo) query.grupo = grupo;
      if (client) query.client = client;
      if (pasta) query.pasta = pasta;
      writeViewHash('arquivos', query);
      refresh();
    };
  });

  $$('[data-file-folder]').forEach(folderEl => {
    if (canManageFolders) {
      folderEl.setAttribute('draggable', 'true');
      folderEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        contextTarget = folderEl;
        if (!contextMenu) return;
        contextMenu.style.left = `${e.clientX}px`;
        contextMenu.style.top = `${e.clientY}px`;
        contextMenu.classList.remove('hidden');
      });

      folderEl.addEventListener('dragstart', (e) => {
        dragActive = true;
        e.dataTransfer.setData('application/x-folder-id', folderEl.dataset.folderId);
        e.dataTransfer.effectAllowed = 'move';
        folderEl.classList.add('is-dragging');
      });
      folderEl.addEventListener('dragend', () => {
        folderEl.classList.remove('is-dragging');
        setTimeout(() => { dragActive = false; }, 50);
      });
    }

    folderEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/x-file-id') ? 'move' : 'none';
      if (e.dataTransfer.types.includes('application/x-file-id')) {
        folderEl.classList.add('is-drop-target');
      }
    });
    folderEl.addEventListener('dragleave', () => folderEl.classList.remove('is-drop-target'));
    folderEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      folderEl.classList.remove('is-drop-target');
      const fileId = e.dataTransfer.getData('application/x-file-id');
      const pasta = folderEl.dataset.pasta;
      const clientId = folderEl.dataset.client;
      if (!fileId || !pasta || !clientId) return;

      try {
        const { filesApi } = await import('./api/crud.js?v=20260621a');
        const { moveFileToFolder } = await import('./services/storage.js?v=20260621a');
        const record = await filesApi.get(fileId);
        await moveFileToFolder(record, pasta);
        showToast(`Movido para ${folderEl.querySelector('.file-name')?.textContent || 'pasta'}`, 'success');
        refresh();
      } catch (err) { handleError(err); }
    });
  });

  const folderGrid = $('#file-folder-grid');
  if (folderGrid && canManageFolders) {
    folderGrid.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-folder-id')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
    });
    folderGrid.addEventListener('drop', async (e) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData('application/x-folder-id');
      const targetFolder = e.target.closest('[data-file-folder]');
      if (!draggedId || !targetFolder || targetFolder.dataset.folderId === draggedId) return;

      try {
        const { fileFoldersApi } = await import('./api/crud.js?v=20260621a');
        const clientId = targetFolder.dataset.client;
        const folders = await fileFoldersApi.list({
          filter: { client_id: clientId },
          order: { column: 'sort_order', asc: true }
        });
        const fromIdx = folders.findIndex(f => f.id === draggedId);
        const toIdx = folders.findIndex(f => f.id === targetFolder.dataset.folderId);
        if (fromIdx < 0 || toIdx < 0) return;

        const reordered = [...folders];
        const [moved] = reordered.splice(fromIdx, 1);
        reordered.splice(toIdx, 0, moved);

        await Promise.all(reordered.map((f, i) => fileFoldersApi.update(f.id, { sort_order: i })));
        showToast('Ordem das pastas atualizada', 'success');
        refresh();
      } catch (err) { handleError(err); }
    });
  }

  $$('[data-file-doc]').forEach(card => {
    if (!canManageFolders) return;
    card.setAttribute('draggable', 'true');
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-file-id', card.dataset.fileId);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('is-dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
  });

  $$('[data-file-download]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.dataset.fileDownload;
      try {
        const { filesApi } = await import('./api/crud.js?v=20260621a');
        const { resolveFileOpenUrl } = await import('./services/storage.js?v=20260621a');
        const record = await filesApi.get(id);
        const url = await resolveFileOpenUrl(record);
        window.open(url, '_blank', 'noopener');
      } catch (err) { handleError(err); }
    };
  });

  $$('[data-file-delete]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const isDrive = btn.dataset.fileDrive === '1';
      const msg = isDrive
        ? 'Remover este link do Drive? (O arquivo continua no Google Drive)'
        : 'Excluir este arquivo permanentemente?';
      if (!confirm(msg)) return;
      const id = btn.dataset.fileDelete;
      try {
        const { filesApi } = await import('./api/crud.js?v=20260621a');
        const { deleteFileRecord } = await import('./services/storage.js?v=20260621a');
        const record = await filesApi.get(id);
        await deleteFileRecord(record);
        showToast('Arquivo excluído', 'success');
        refresh();
      } catch (err) { handleError(err); }
    };
  });

  $('#file-context-delete')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!contextTarget) return;
    const folderId = contextTarget.dataset.folderId;
    const clientId = contextTarget.dataset.client;
    const slug = contextTarget.dataset.pasta;
    const label = contextTarget.querySelector('.file-name')?.textContent || 'esta pasta';
    hideContextMenu();

    if (!confirm(`Excluir "${label}" e todos os arquivos dentro dela? Esta ação não pode ser desfeita.`)) return;

    try {
      const { fileFoldersApi } = await import('./api/crud.js?v=20260621a');
      const { deleteFilesInFolder } = await import('./services/storage.js?v=20260621a');
      const count = await deleteFilesInFolder(clientId, slug);
      await fileFoldersApi.remove(folderId);
      showToast(`Pasta excluída${count ? ` (${count} arquivo${count !== 1 ? 's' : ''})` : ''}`, 'success');
      refresh();
    } catch (err) { handleError(err); }
  });

  $('#btn-new-folder')?.addEventListener('click', async () => {
    const clientId = $('#btn-new-folder')?.dataset.clientId;
    if (!clientId) return;
    const label = prompt('Nome da nova pasta:');
    if (!label?.trim()) return;

    const slug = label.trim()
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `pasta-${Date.now()}`;

    try {
      const { fileFoldersApi } = await import('./api/crud.js?v=20260621a');
      const existing = await fileFoldersApi.list({ filter: { client_id: clientId } });
      await fileFoldersApi.create({
        client_id: clientId,
        slug,
        label: label.trim(),
        icon: '📁',
        bucket_hint: 'files',
        sort_order: existing.length
      });
      showToast('Pasta criada', 'success');
      refresh();
    } catch (err) { handleError(err); }
  });

  const driveLinkBtn = $('#btn-drive-link');
  if (driveLinkBtn) {
    driveLinkBtn.onclick = async () => {
      const { loadClientsCache, openDriveLinkModal } = await import('./forms.js?v=20260621a');
      await loadClientsCache();
      const clientId = driveLinkBtn.dataset.driveClient || null;
      let folders = [];
      if (clientId) {
        const { ensureClientFolders } = await import('./services/file-folders.js?v=20260621a');
        folders = await ensureClientFolders(clientId);
      }
      openDriveLinkModal({
        clientId,
        folderCategoryId: driveLinkBtn.dataset.drivePasta || null,
        folders
      }, refresh);
    };
  }

  const uploadBtn = $('#btn-upload');
  if (uploadBtn) {
    uploadBtn.onclick = async () => {
      const { loadClientsCache, openUploadModal } = await import('./forms.js?v=20260621a');
      await loadClientsCache();
      const clientId = uploadBtn.dataset.uploadClient || null;
      let folders = [];
      if (clientId) {
        const { ensureClientFolders } = await import('./services/file-folders.js?v=20260621a');
        folders = await ensureClientFolders(clientId);
      }
      openUploadModal({
        clientId,
        folderCategoryId: uploadBtn.dataset.uploadPasta || null,
        folders
      }, refresh);
    };
  }
}
