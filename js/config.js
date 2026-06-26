// CDM Central - Supabase Configuration
// Em produção, substitua via variáveis de ambiente no deploy

export const SUPABASE_URL = 'https://dsutsjvqrjtkextwcpgl.supabase.co';

export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzdXRzanZxcmp0a2V4dHdjcGdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NDM0MDIsImV4cCI6MjA5NzIxOTQwMn0.bH7jFqFCDb0qvA6SmhDiEVugaMhp-V8SFxDQCcpWUCc';

export const ROLES = {
  ADMIN: 'admin',
  GESTOR: 'gestor',
  COLABORADOR: 'colaborador',
  CLIENTE: 'cliente'
};

export const ROLE_LABELS = {
  admin: 'Administrador',
  gestor: 'Gestor',
  colaborador: 'Colaborador',
  cliente: 'Cliente'
};

export const STORAGE_BUCKETS = {
  files: 'files',
  images: 'images',
  videos: 'videos',
  contracts: 'contracts',
  invoices: 'invoices'
};

/** Subpastas dentro de cada cliente */
export const FILE_CATEGORIES = [
  { id: 'videos', label: 'Vídeos', icon: '🎬', folder: 'videos/', bucket: 'videos' },
  { id: 'imagens', label: 'Imagens', icon: '🖼️', folder: 'imagens/', bucket: 'images' }
];

export function getFileCategory(id) {
  return FILE_CATEGORIES.find(c => c.id === id) || FILE_CATEGORIES[0];
}

/** Agrupamento de clientes na raiz de Arquivos */
export const FILE_CLIENT_GROUPS = [
  {
    id: 'distribuidoras',
    label: 'Distribuidoras',
    icon: '📁',
    clientNames: [
      'R5 São Paulo',
      'R5 Santa Catarina',
      'R5 Paraná',
      'R5 Rio Grande do Sul'
    ]
  }
];

export function findClientGroupForName(companyName) {
  return FILE_CLIENT_GROUPS.find(g => g.clientNames.includes(companyName)) || null;
}

export function parseAssigneeNames(str = '') {
  return str.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
}

export function resolveAssigneeColorKeys(assigneeName = '', colorOwnerFallback = '') {
  const names = parseAssigneeNames(assigneeName);
  const keys = [];
  for (const name of names) {
    const member = findTeamMemberByName(name);
    if (member?.color) keys.push(member.color);
    else {
      const inferred = inferColorOwner(name, '');
      if (inferred) keys.push(inferred);
    }
  }
  if (!keys.length && colorOwnerFallback && OWNER_COLORS[colorOwnerFallback]) {
    keys.push(colorOwnerFallback);
  }
  return [...new Set(keys.filter(k => k && k !== 'default'))];
}

export function inferColorOwner(assigneeName = '', title = '') {
  const assignee = (assigneeName || '').toLowerCase();
  const text = (title || '').toLowerCase();
  if (assignee.includes('juan')) return 'juan';
  if (assignee.includes('mariah')) return 'mariah';
  if (assignee.includes('waness') || assignee.includes('wanes')) return 'wanessa';
  if (assignee.includes('bernardo')) return 'bernardo';
  if (assignee.includes('ney')) return 'ney';
  if (/\bney\b/.test(text)) return 'ney';
  if (text.includes('mariah')) return 'mariah';
  if (text.includes('waness') || text.includes('wanes')) return 'wanessa';
  if (text.includes('juan') || text.includes('regis')) return 'juan';
  if (text.includes('bernardo') || text.includes('leandro')) return 'bernardo';
  return '';
}

export const TEAM_MEMBERS = [
  { id: 'juan', name: 'Juan Canada', email: 'juan@cdmmkt.com.br', color: 'juan', label: 'Azul — Juan' },
  { id: 'mariah', name: 'Mariah Caciatore', email: 'mariah@cdmmkt.com.br', color: 'mariah', label: 'Rosa — Mariah' },
  { id: 'wanessa', name: 'Wanessa', email: 'wanessasilvawg977@gmail.com', color: 'wanessa', label: 'Roxo — Wanessa' },
  { id: 'bernardo', name: 'Bernardo', email: 'bernardo@cdmmkt.com.br', color: 'bernardo', label: 'Laranja — Bernardo' },
  { id: 'ney', name: 'Ney', email: 'ney@r5wf.com.br', color: 'ney', label: 'Vermelho — Ney' }
];

export function findTeamMemberByName(name = '') {
  const n = name.toLowerCase();
  return TEAM_MEMBERS.find(m =>
    m.name.toLowerCase() === n
    || n.includes(m.id)
    || (m.id === 'mariah' && n.includes('mariah'))
    || (m.id === 'wanessa' && (n.includes('waness') || n.includes('wanes')))
    || (m.id === 'juan' && n.includes('juan'))
    || (m.id === 'ney' && /\bney\b/.test(n))
    || (m.id === 'bernardo' && n.includes('bernardo'))
  );
}

export function resolveProfileForTeamMember(member, profiles = []) {
  if (!member) return null;
  const emails = [member.email, ...(member.altEmails || [])].map(e => e.toLowerCase());
  return profiles.find(p => emails.includes((p.email || '').toLowerCase())) || null;
}

export const OWNER_COLORS = {
  boleto: { label: 'Boleto', cls: 'owner-boleto' },
  juan: { label: 'Juan', cls: 'owner-juan' },
  mariah: { label: 'Mariah', cls: 'owner-mariah' },
  wanessa: { label: 'Wanessa', cls: 'owner-wanessa' },
  bernardo: { label: 'Bernardo', cls: 'owner-bernardo' },
  ney: { label: 'Ney', cls: 'owner-ney' },
  default: { label: 'Equipe CDM', cls: 'owner-default' }
};

export const OWNER_HEX = {
  boleto: '#22c55e',
  juan: '#3b82f6',
  mariah: '#ec4899',
  wanessa: '#a855f7',
  bernardo: '#f97316',
  ney: '#ef4444',
  default: '#787774'
};

export const INTEGRATION_PROVIDERS = [
  { id: 'meta_ads', name: 'Meta Ads', icon: '📘' },
  { id: 'google_ads', name: 'Google Ads', icon: '🔍' },
  { id: 'google_analytics', name: 'Google Analytics', icon: '📊' },
  { id: 'google_search_console', name: 'Google Search Console', icon: '🔎' },
  { id: 'tiktok_ads', name: 'TikTok Ads', icon: '🎵' },
  { id: 'whatsapp_business', name: 'WhatsApp Business', icon: '💬' },
  { id: 'canva', name: 'Canva', icon: '🎨' },
  { id: 'google_calendar', name: 'Google Calendar', icon: '📅' }
];
