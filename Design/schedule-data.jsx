// Shared schedule data + session-type tokens for all variations.
// Times: 8a–7p (11 hours). Each row = one client/provider.

const SESSION_TYPES = [
  { id: 'admin',       label: 'Admin',              cred: null,    hue: 215, neutral: false },
  { id: 'assessment',  label: 'Assessment',         cred: 'BCBA',  hue: 195, neutral: false },
  { id: 'break',       label: 'Break',              cred: null,    hue: 145, neutral: true  },
  { id: 'cancel',      label: 'Cancellation',       cred: null,    hue: 10,  neutral: false, status: 'danger' },
  { id: 'direct',      label: 'Direct Therapy',     cred: null,    hue: 265, neutral: false },
  { id: 'directhome',  label: 'Direct Therapy Home',cred: null,    hue: 230, neutral: false },
  { id: 'drive',       label: 'Drive Time',         cred: null,    hue: 35,  neutral: true  },
  { id: 'lunch',       label: 'Lunch',              cred: null,    hue: 90,  neutral: true  },
  { id: 'nap',         label: 'Nap',                cred: null,    hue: 280, neutral: true  },
  { id: 'parent',      label: 'Parent Training',    cred: 'BCBA',  hue: 320, neutral: false },
  { id: 'supervision', label: 'Supervision',        cred: 'BCBA',  hue: 175, neutral: false },
];

const CLIENTS = [
  { name: 'Anderson, Lucas',    sessions: [{ type: 'direct',     start: 11, end: 17, location: 'Center', label: 'Direct Therapy' }] },
  { name: 'Brown, Sofia',       sessions: [{ type: 'directhome', start: 11, end: 17, location: 'Home',   label: 'Direct Therapy Home' }] },
  { name: 'Clark, Benjamin',    sessions: [{ type: 'directhome', start: 9,  end: 16, location: 'Home',   label: 'Direct Therapy Home' }] },
  { name: 'Davis, Olivia',      sessions: [{ type: 'directhome', start: 9,  end: 15.5, location: 'Home', label: 'Direct Therapy Home' }] },
  { name: 'Gonzalez, Mateo',    sessions: [] },
  { name: 'Harris, Ethan',      sessions: [] },
  { name: 'Jackson, Mia',       sessions: [{ type: 'direct',     start: 9,  end: 16.5, location: 'Center', label: 'Direct Therapy' }] },
  { name: 'Johnson, Emma',      sessions: [] },
  { name: 'Lee, James',         sessions: [{ type: 'direct',     start: 9,  end: 15, location: 'Center', label: 'Direct Therapy' }] },
  { name: 'Lewis, Amelia',      sessions: [{ type: 'direct',     start: 10, end: 16, location: 'Center', label: 'Direct Therapy' }] },
  { name: 'Martinez, Aiden',    sessions: [] },
  { name: 'Moore, Charlotte',   sessions: [{ type: 'directhome', start: 11, end: 17, location: 'Home',   label: 'Direct Therapy Home' }] },
  { name: 'Rivera, Alexia',     sessions: [{ type: 'direct',     start: 9,  end: 17, location: 'Center', label: 'Direct Therapy' }] },
  { name: 'Thompson, Ava',      sessions: [{ type: 'directhome', start: 11, end: 15, location: 'Home',   label: 'Direct Therapy Home', proposed: true }] },
  { name: 'Torres, Liam',       sessions: [] },
  { name: 'White, Isabella',    sessions: [{ type: 'cancel',     start: 9,  end: 15, location: '',       label: 'Cancellation', cancelled: true }] },
  { name: 'Williams, Noah',     sessions: [{ type: 'directhome', start: 10, end: 16.5, location: 'Home', label: 'Direct Therapy Home' }] },
];

const PROVIDERS = [
  { name: 'Brooks, Davon',  cred: 'RBT',  sessions: [{ type: 'directhome', start: 9,  end: 15.5, label: 'Davis, Olivia · Direct Therapy Home' }] },
  { name: 'Chen, Ashley',   cred: 'RBT',  sessions: [{ type: 'directhome', start: 10, end: 16.5, label: 'Williams, Noah · Direct Therapy Home' }] },
  { name: 'Johnson, Tyler', cred: 'RBT',  sessions: [{ type: 'direct',     start: 9,  end: 16.5, label: 'Jackson, Mia · Direct Therapy' }] },
];

// Hour labels for the timeline header
const HOURS = [8,9,10,11,12,13,14,15,16,17,18,19];
function fmtHour(h) {
  if (h === 12) return '12pm';
  if (h === 24 || h === 0) return '12am';
  return h > 12 ? `${h-12}pm` : `${h}am`;
}

function getSessionType(id) {
  return SESSION_TYPES.find(s => s.id === id);
}

Object.assign(window, {
  SESSION_TYPES, CLIENTS, PROVIDERS, HOURS, fmtHour, getSessionType
});
