// V2 — Quiet Cards (refreshed)
// Combines:
//  - V2's quiet card aesthetic (Notion-like, status-only color)
//  - V4's centered floating action dock at the bottom
//  - V3's light-tone session palette with legend
//  - A redesigned collapsible left nav rail (replaces the dark blue one)

const v2Tokens = {
  bg: '#fcfcfa',
  surface: '#ffffff',
  surfaceAlt: '#fafaf7',
  surfaceMuted: '#f4f4f0',
  border: 'rgba(15,15,12,0.08)',
  borderStrong: 'rgba(15,15,12,0.14)',
  text: '#191917',
  textMuted: '#6b6b66',
  textSubtle: '#9a9a93',
  good: '#17855a',
  goodSoft: '#e6f5ed',
  danger: '#c4321a',
  dangerSoft: '#fdecea',
  proposed: '#2563eb',
  proposedSoft: '#e8f0fe',
  navBg: '#0f1115',
  navBgGrad: 'linear-gradient(180deg, #14171d 0%, #0d1014 100%)',
  navBgHover: 'rgba(255,255,255,0.045)',
  navText: 'rgba(232,234,240,0.78)',
  navTextActive: '#0f1115',
  navTextDim: 'rgba(232,234,240,0.42)',
  navAccent: '#7ea2ff',
  font: '"Geist", "Inter", ui-sans-serif, system-ui, -apple-system, sans-serif',
  fontHead: '"Geist", "Inter Tight", ui-sans-serif, system-ui, sans-serif',
  fontMono: '"Geist Mono", "JetBrains Mono", ui-monospace, "SF Mono", monospace',
};

// ────────────────────────────────────────────────────────────
// Left nav rail — collapsed by default (52px), expands on hover (224px)
// ────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard',       icon: 'grid' },
  { id: 'schedule',  label: 'Schedule',        icon: 'calendar', active: true, badge: '17' },
  { id: 'recurring', label: 'Recurring events',icon: 'repeat' },
  { id: 'clients',   label: 'Clients',         icon: 'users' },
  { id: 'providers', label: 'Providers',       icon: 'usercog' },
  { id: 'comms',     label: 'Communications',  icon: 'chat' },
  { id: 'audit',     label: 'Coverage audit',  icon: 'shield' },
];

function NavIcon({ name }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'grid':     return <svg {...p}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>;
    case 'calendar': return <svg {...p}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>;
    case 'repeat':   return <svg {...p}><path d="M3 12V8a3 3 0 0 1 3-3h11"/><path d="M14 2l3 3-3 3"/><path d="M21 12v4a3 3 0 0 1-3 3H7"/><path d="M10 22l-3-3 3-3"/></svg>;
    case 'users':    return <svg {...p}><circle cx="9" cy="8" r="3.5"/><path d="M3 21c0-3.5 3-6 6-6s6 2.5 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M21 19c0-2.5-2-4.5-4.5-4.5"/></svg>;
    case 'usercog':  return <svg {...p}><circle cx="9" cy="8" r="3.5"/><path d="M3 21c0-3.5 3-6 6-6 1 0 1.9.2 2.7.5"/><circle cx="17" cy="17" r="2.5"/><path d="M17 13v1.5M17 19.5V21M21 17h-1.5M14.5 17H13"/></svg>;
    case 'chat':     return <svg {...p}><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/></svg>;
    case 'shield':   return <svg {...p}><path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>;
    case 'settings': return <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.4.6 1 1 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>;
    default: return null;
  }
}

function V2NavRail({ forceExpanded }) {
  const t = v2Tokens;
  const [hoverExpanded, setHoverExpanded] = React.useState(false);
  const expanded = forceExpanded || hoverExpanded;
  const W_COLLAPSED = 60;
  const W_EXPANDED = 232;

  const itemStyle = (active, hovered) => ({
    position: 'relative',
    display: 'flex', alignItems: 'center', gap: 13,
    height: 34, padding: '0 11px',
    margin: '0 8px',
    borderRadius: 7, cursor: 'pointer',
    color: active ? '#ffffff' : t.navText,
    background: active
      ? 'linear-gradient(180deg, rgba(126,162,255,0.14), rgba(126,162,255,0.08))'
      : (hovered ? t.navBgHover : 'transparent'),
    boxShadow: active ? 'inset 0 0 0 1px rgba(126,162,255,0.22)' : 'none',
    fontSize: 13, fontWeight: active ? 500 : 400,
    transition: 'background 0.12s, color 0.12s',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    letterSpacing: '-0.005em',
  });

  return (
    <div
      onMouseEnter={() => setHoverExpanded(true)}
      onMouseLeave={() => setHoverExpanded(false)}
      style={{
        width: expanded ? W_EXPANDED : W_COLLAPSED,
        flexShrink: 0,
        background: t.navBgGrad,
        color: t.navText,
        fontFamily: t.font,
        display: 'flex', flexDirection: 'column',
        transition: 'width 0.2s cubic-bezier(.2,.7,.3,1)',
        borderRight: '1px solid rgba(255,255,255,0.04)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Brand */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 11,
        padding: '0 14px', height: 56, flexShrink: 0,
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 7,
          background: 'linear-gradient(135deg, #fff 0%, #d8dde8 100%)',
          color: t.navBg, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 1px 0 rgba(255,255,255,0.18) inset, 0 2px 4px rgba(0,0,0,0.4)',
        }}>
          {/* Linked-rings mark, evoking the original logo */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="9" cy="12" r="4.5"/>
            <circle cx="15" cy="12" r="4.5"/>
          </svg>
        </div>
        <div style={{
          opacity: expanded ? 1 : 0,
          transition: 'opacity 0.15s',
          display: 'flex', flexDirection: 'column', minWidth: 0,
          lineHeight: 1.15,
        }}>
          <div style={{
            fontFamily: t.fontHead, fontSize: 13, fontWeight: 600,
            color: '#fff', letterSpacing: '-0.015em', whiteSpace: 'nowrap',
          }}>All Together Autism</div>
          <div style={{
            fontSize: 10.5, color: t.navTextDim, whiteSpace: 'nowrap',
            letterSpacing: '0.02em', marginTop: 1,
          }}>Bay Area · Clinical</div>
        </div>
      </div>

      {/* Org switcher hint when expanded */}
      <div style={{
        margin: '10px 12px 6px',
        height: expanded ? 32 : 0,
        opacity: expanded ? 1 : 0,
        transition: 'all 0.15s',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 7,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: expanded ? '0 10px' : 0,
        fontSize: 11.5, color: t.navTextDim,
        cursor: 'pointer',
        overflow: 'hidden',
      }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
        <span style={{ flex: 1, whiteSpace: 'nowrap' }}>Quick search…</span>
        <kbd style={{
          fontFamily: t.fontMono, fontSize: 9.5, padding: '1px 5px',
          background: 'rgba(255,255,255,0.06)', borderRadius: 3,
          color: t.navTextDim, border: '1px solid rgba(255,255,255,0.06)',
        }}>⌘K</kbd>
      </div>

      <div style={{ height: expanded ? 4 : 12 }}/>
      {expanded && (
        <div style={{
          fontSize: 9.5, fontWeight: 600, letterSpacing: '0.14em',
          color: t.navTextDim, textTransform: 'uppercase',
          padding: '4px 20px 8px',
        }}>Workspace</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {NAV_ITEMS.map(item => (
          <NavRow key={item.id} item={item} expanded={expanded} t={t} itemStyle={itemStyle}/>
        ))}
      </div>

      <div style={{ flex: 1 }}/>

      {/* Quick stat chip */}
      {expanded && (
        <div style={{
          margin: '0 12px 10px',
          padding: '10px 12px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 8,
          opacity: expanded ? 1 : 0,
          transition: 'opacity 0.15s',
        }}>
          <div style={{
            fontSize: 9.5, fontWeight: 600, letterSpacing: '0.12em',
            color: t.navTextDim, textTransform: 'uppercase', marginBottom: 4,
          }}>Today · Apr 28</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontFamily: t.fontHead, fontSize: 16, color: '#fff', fontWeight: 500 }}>86%</span>
            <span style={{ fontSize: 10.5, color: t.navTextDim }}>scheduled</span>
          </div>
          <div style={{
            marginTop: 6, height: 3, borderRadius: 2,
            background: 'rgba(255,255,255,0.06)', overflow: 'hidden',
          }}>
            <div style={{ width: '86%', height: '100%', background: t.navAccent, borderRadius: 2 }}/>
          </div>
        </div>
      )}

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', padding: '8px 0' }}>
        <NavRow
          item={{ label: 'Settings', icon: 'settings' }}
          expanded={expanded} t={t} itemStyle={itemStyle}
        />
      </div>

      {/* Account chip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 11,
        padding: '12px 14px',
        borderTop: '1px solid rgba(255,255,255,0.04)',
        background: 'rgba(255,255,255,0.02)',
        cursor: 'pointer',
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: '50%',
          background: 'linear-gradient(135deg, #c8a8ff 0%, #7ea2ff 100%)',
          color: '#0f1115',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 600, flexShrink: 0,
          boxShadow: '0 1px 0 rgba(255,255,255,0.18) inset',
        }}>NW</div>
        <div style={{
          opacity: expanded ? 1 : 0, transition: 'opacity 0.12s',
          display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1,
          lineHeight: 1.2,
        }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: '#fff', whiteSpace: 'nowrap' }}>Nick Wallace</div>
          <div style={{ fontSize: 10.5, color: t.navTextDim, whiteSpace: 'nowrap' }}>BCBA · Admin</div>
        </div>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{
          opacity: expanded ? 0.5 : 0, transition: 'opacity 0.12s', flexShrink: 0,
        }}><path d="M9 18l6-6-6-6"/></svg>
      </div>
    </div>
  );
}

function NavRow({ item, expanded, t, itemStyle }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      style={itemStyle(item.active, hover)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {item.active && (
        <div style={{
          position: 'absolute', left: -8, top: 7, bottom: 7, width: 2,
          borderRadius: '0 2px 2px 0', background: t.navAccent,
          boxShadow: `0 0 8px ${t.navAccent}88`,
        }}/>
      )}
      <span style={{ flexShrink: 0, display: 'flex', color: item.active ? t.navAccent : 'inherit' }}>
        <NavIcon name={item.icon}/>
      </span>
      <span style={{ opacity: expanded ? 1 : 0, transition: 'opacity 0.12s', flex: 1 }}>{item.label}</span>
      {item.badge && expanded && (
        <span style={{
          fontSize: 10, fontWeight: 600,
          background: 'rgba(126,162,255,0.18)', color: t.navAccent,
          padding: '1px 6px', borderRadius: 10,
        }}>{item.badge}</span>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Top toolbar — slimmed; primary actions move to bottom dock
// ────────────────────────────────────────────────────────────
function V2Toolbar() {
  const t = v2Tokens;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '12px 18px',
      background: t.surface,
      borderBottom: `1px solid ${t.border}`,
      fontFamily: t.font, fontSize: 13, color: t.text,
      height: 56, boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button style={v2GhostBtn()}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <button style={{ ...v2GhostBtn(), padding: '0 10px', fontSize: 12, fontWeight: 500 }}>Today</button>
        <button style={v2GhostBtn()}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>

      <div style={{ width: 1, height: 18, background: t.border }} />

      <div style={{ display: 'inline-flex', padding: 2, borderRadius: 8, background: t.surfaceMuted }}>
        <button style={v2SegBtn(true)}>Day</button>
        <button style={v2SegBtn(false)}>Week</button>
      </div>

      <div style={{
        fontFamily: t.fontHead, fontSize: 15, fontWeight: 500,
        letterSpacing: '-0.015em',
      }}>
        Tue, Apr 28
        <span style={{ color: t.textSubtle, marginLeft: 6, fontWeight: 400 }}>2026</span>
      </div>

      <div style={{ flex: 1 }} />

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '5px 10px 5px 12px',
        background: t.surfaceAlt, borderRadius: 8,
        border: `1px solid ${t.border}`,
      }}>
        <span style={{ fontSize: 11, color: t.textMuted, letterSpacing: '0.01em' }}>Efficiency</span>
        <span style={{ fontFamily: t.fontMono, fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>86%</span>
        <div style={{ width: 56, height: 4, borderRadius: 2, background: t.surfaceMuted, overflow: 'hidden' }}>
          <div style={{ width: '86%', height: '100%', background: t.good, borderRadius: 2 }} />
        </div>
        <span style={{ color: t.textSubtle, fontFamily: t.fontMono, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>71.5/83h</span>
      </div>

      <button style={v2GhostBtn(true)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <span style={{ position: 'absolute', top: 4, right: 4, minWidth: 6, height: 6, borderRadius: 3, background: t.danger, border: `1.5px solid ${t.surface}` }}/>
      </button>
    </div>
  );
}

function v2GhostBtn(rel) {
  return {
    height: 28, minWidth: 28, padding: 0, borderRadius: 6,
    border: 'none', background: 'transparent',
    color: v2Tokens.text, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13,
    position: rel ? 'relative' : undefined,
  };
}
function v2SegBtn(active) {
  return {
    height: 24, padding: '0 12px', borderRadius: 6, border: 'none',
    background: active ? v2Tokens.surface : 'transparent',
    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06), 0 0 0 0.5px rgba(15,15,12,0.08)' : 'none',
    color: active ? v2Tokens.text : v2Tokens.textMuted,
    fontSize: 12, fontWeight: active ? 500 : 400, cursor: 'pointer',
  };
}

// ────────────────────────────────────────────────────────────
// Palette — light-tone (V3-style) + legend at bottom
// ────────────────────────────────────────────────────────────
function V2Palette() {
  const t = v2Tokens;
  return (
    <div style={{
      width: 196, flexShrink: 0,
      borderRight: `1px solid ${t.border}`,
      background: t.surfaceAlt,
      fontFamily: t.font,
      padding: '14px 0',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px 10px',
      }}>
        <div style={{
          fontSize: 10, fontWeight: 600, letterSpacing: '0.1em',
          color: t.textMuted, textTransform: 'uppercase',
        }}>Session types</div>
        <button style={{
          fontSize: 14, color: t.textMuted, background: 'transparent',
          border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1,
        }}>+</button>
      </div>

      <div style={{ padding: '0 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {SESSION_TYPES.map(s => (
          <div key={s.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '7px 10px', borderRadius: 6, cursor: 'grab',
            fontSize: 12.5, color: t.text,
          }}
          onMouseEnter={e => e.currentTarget.style.background = t.surface}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            {/* light-tone swatch — V3 style */}
            <div style={{
              width: 14, height: 14, borderRadius: 3,
              border: `1.5px solid ${s.status === 'danger' ? t.danger : `oklch(58% 0.13 ${s.hue})`}`,
              background: s.status === 'danger'
                ? `oklch(94% 0.04 25)`
                : `oklch(95% 0.022 ${s.hue})`,
              flexShrink: 0,
            }}/>
            <span style={{ flex: 1 }}>{s.label}</span>
            {s.cred && (
              <span style={{
                fontSize: 9, fontWeight: 600, letterSpacing: '0.04em',
                color: t.textMuted, fontFamily: t.fontMono,
              }}>{s.cred}</span>
            )}
          </div>
        ))}
      </div>

      <div style={{ flex: 1 }}/>

      <div style={{ padding: '12px 16px', borderTop: `1px solid ${t.border}` }}>
        <div style={{
          fontSize: 10, fontWeight: 600, letterSpacing: '0.1em',
          color: t.textMuted, textTransform: 'uppercase', marginBottom: 8,
        }}>Status</div>
        <V2LegendRow color={t.proposed} kind="dashed" label="Proposed" t={t}/>
        <V2LegendRow color={t.danger} kind="striped" label="Cancelled" t={t}/>
        <V2LegendRow color={t.good} kind="solid" label="Confirmed" t={t}/>
      </div>
    </div>
  );
}

function V2LegendRow({ color, kind, label, t }) {
  let bg, border;
  if (kind === 'striped') {
    bg = `repeating-linear-gradient(135deg, ${color}1f 0 4px, ${color}33 4px 8px)`;
    border = `1px solid ${color}66`;
  } else if (kind === 'dashed') {
    bg = 'transparent';
    border = `1px dashed ${color}`;
  } else {
    bg = `${color}14`;
    border = `1px solid ${color}66`;
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 5 }}>
      <div style={{ width: 22, height: 11, borderRadius: 3, background: bg, border, flexShrink: 0 }}/>
      <span style={{ fontSize: 11, color: t.textMuted }}>{label}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Grid — same as before (quiet cards)
// ────────────────────────────────────────────────────────────
function V2Grid() {
  const t = v2Tokens;
  const COL_LABEL = 176;
  const HOUR_W = 60;
  const ROW_H = 34;

  function blockStyle(s) {
    const left = (s.start - HOURS[0]) * HOUR_W;
    const width = (s.end - s.start) * HOUR_W - 3;
    const stype = getSessionType(s.type);
    const accent = stype.status === 'danger' ? t.danger : `oklch(58% 0.12 ${stype.hue})`;
    if (s.cancelled) {
      return {
        left, width,
        background: `repeating-linear-gradient(135deg, ${t.dangerSoft} 0 5px, #f7d8d4 5px 10px)`,
        border: `1px solid ${t.danger}55`, color: t.danger,
      };
    }
    if (s.proposed) {
      return { left, width, background: t.surface, border: `1px dashed ${t.proposed}`, color: t.proposed };
    }
    return {
      left, width, background: t.surface,
      border: `1px solid ${t.border}`,
      borderLeft: `2px solid ${accent}`,
      color: t.text, boxShadow: '0 1px 2px rgba(15,15,12,0.04)',
    };
  }

  function Row({ name, cred, sessions, alt }) {
    return (
      <div style={{ display: 'flex', height: ROW_H, position: 'relative', background: alt ? t.surfaceAlt : t.surface }}>
        <div style={{
          width: COL_LABEL, flexShrink: 0, padding: '0 16px',
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 13, color: t.text,
          borderRight: `1px solid ${t.border}`,
          borderBottom: `1px solid ${t.border}`,
          position: 'sticky', left: 0, zIndex: 1,
          background: alt ? t.surfaceAlt : t.surface,
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          {cred && <span style={{ fontSize: 9, fontWeight: 600, color: t.textSubtle, letterSpacing: '0.04em' }}>{cred}</span>}
        </div>
        <div style={{ position: 'relative', flex: 1, height: '100%', borderBottom: `1px solid ${t.border}` }}>
          {HOURS.slice(0, -1).map((h, i) => (
            <div key={h} style={{ position: 'absolute', top: 0, bottom: 0, left: (i+1)*HOUR_W, width: 1, background: 'rgba(15,15,12,0.04)' }}/>
          ))}
          {sessions.map((s, i) => {
            const style = blockStyle(s);
            return (
              <div key={i} style={{
                position: 'absolute', top: 5, height: ROW_H - 10,
                borderRadius: 6,
                display: 'flex', alignItems: 'center',
                padding: '0 9px', gap: 7,
                fontSize: 12, fontWeight: 450,
                overflow: 'hidden', whiteSpace: 'nowrap',
                ...style,
              }}>
                {!s.cancelled && !s.proposed && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, opacity: 0.55 }}>
                    {s.location === 'Home'
                      ? <><path d="M3 12L12 3l9 9"/><path d="M5 10v10h14V10"/></>
                      : <><rect x="4" y="6" width="16" height="14" rx="1"/><path d="M9 6V3h6v3"/></>}
                  </svg>
                )}
                <span style={{
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  textDecoration: s.cancelled ? 'line-through' : 'none',
                }}>
                  {s.proposed ? `Proposed · ${s.label} · ${fmtHour(s.start)}–${fmtHour(s.end)}`
                    : s.cancelled ? `${name} · Cancellation · 9am–3pm`
                    : `${name.split(',')[0]} · ${s.label}`}
                </span>
                <span style={{
                  marginLeft: 'auto', fontFamily: t.fontMono, fontSize: 10,
                  color: t.textMuted, fontVariantNumeric: 'tabular-nums', flexShrink: 0,
                }}>{!s.cancelled && !s.proposed && `${fmtHour(s.start).replace('am','').replace('pm','')}–${fmtHour(s.end)}`}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', background: t.bg, position: 'relative' }}>
      <div style={{
        display: 'flex', position: 'sticky', top: 0, zIndex: 5,
        background: t.surfaceAlt, borderBottom: `1px solid ${t.border}`,
      }}>
        <div style={{
          width: COL_LABEL, flexShrink: 0,
          borderRight: `1px solid ${t.border}`, background: t.surfaceAlt,
          position: 'sticky', left: 0, zIndex: 1,
          padding: '8px 16px',
          fontSize: 10, color: t.textSubtle,
          letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 500,
        }}>Schedule</div>
        <div style={{ display: 'flex' }}>
          {HOURS.slice(0, -1).map((h, i) => (
            <div key={h} style={{
              width: HOUR_W, height: 34,
              fontSize: 11, color: t.textMuted,
              fontVariantNumeric: 'tabular-nums', fontFamily: t.fontMono,
              padding: '10px 0 0 8px',
            }}>{fmtHour(h)}</div>
          ))}
        </div>
      </div>

      <V2SectionHeader label="Clients" count={CLIENTS.length} t={t}/>
      {CLIENTS.map((c, i) => <Row key={c.name} name={c.name} sessions={c.sessions} alt={i % 2 === 1}/>)}
      <V2SectionHeader label="Providers" count={PROVIDERS.length} t={t}/>
      {PROVIDERS.map((p, i) => <Row key={p.name} name={p.name} cred={p.cred} sessions={p.sessions} alt={i % 2 === 1}/>)}

      <div style={{
        position: 'absolute', top: 34,
        left: COL_LABEL + (17 - HOURS[0]) * HOUR_W,
        width: 1, bottom: 0, background: t.danger, opacity: 0.4, pointerEvents: 'none',
      }}>
        <div style={{ position: 'absolute', top: -3, left: -3, width: 7, height: 7, borderRadius: 4, background: t.danger }}/>
      </div>
    </div>
  );
}

function V2SectionHeader({ label, count, t }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', height: 28,
      padding: '0 16px', gap: 8,
      background: '#f0efea',
      borderBottom: `1px solid ${t.border}`, borderTop: `1px solid ${t.border}`,
      fontSize: 11, fontWeight: 500, color: t.textMuted,
      position: 'sticky', left: 0,
    }}>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M6 9l6 6 6-6"/></svg>
      <span style={{ color: t.text, fontWeight: 500 }}>{label}</span>
      <span style={{ color: t.textSubtle, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Floating action dock (V4-style)
// ────────────────────────────────────────────────────────────
function V2Dock() {
  const t = v2Tokens;
  return (
    <div style={{
      position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', alignItems: 'center', gap: 4,
      background: '#191917', color: '#fff',
      padding: 4, borderRadius: 11,
      boxShadow: '0 10px 28px rgba(15,15,12,0.22), 0 1px 3px rgba(15,15,12,0.10)',
      fontFamily: t.font, fontSize: 12,
      zIndex: 4,
    }}>
      <button style={v2DockBtn()}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
        Add session
      </button>
      <button style={v2DockBtn()}>Clear day</button>
      <button style={v2DockBtn()}>Analyze week</button>
      <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.16)' }}/>
      <button style={{ ...v2DockBtn(), background: '#fff', color: '#191917' }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></svg>
        Auto-complete
      </button>
    </div>
  );
}

function v2DockBtn() {
  return {
    height: 30, padding: '0 12px', borderRadius: 7,
    border: 'none', background: 'transparent', color: 'inherit',
    fontSize: 12, fontWeight: 500, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 6,
  };
}

function V2({ navExpanded }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex',
      background: v2Tokens.bg,
      fontFamily: v2Tokens.font, color: v2Tokens.text,
      overflow: 'hidden', position: 'relative',
    }}>
      <V2NavRail forceExpanded={navExpanded}/>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', minWidth: 0 }}>
        <V2Toolbar/>
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
          <V2Palette/>
          <V2Grid/>
        </div>
        <V2Dock/>
      </div>
    </div>
  );
}

window.V2 = V2;
