/**
 * auth.js — Shared auth + user-hydration utility
 * Include this script on every protected page (dashboard, upload-report, etc.)
 *
 * Expectations in the HTML:
 *   id="user-name"    → full name text node
 *   id="user-sub"     → surgery type text node
 *   id="user-avatar"  → initials badge
 *   id="user-greeting"→ topbar greeting (optional, dashboard only)
 *   id="logout-btn"   → logout anchor/button
 */

(async function initAuth() {
  const userId = localStorage.getItem('user_id');

  // ── 1. Guard: no session → back to login ──────────────────────────────────
  if (!userId) {
    window.location.replace('login.html');
    return;
  }

  // ── 2. Wire logout ────────────────────────────────────────────────────────
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      localStorage.removeItem('user_id');
      localStorage.removeItem('user_name');
      window.location.href = 'index.html';
    });
  }

  // ── 3. Try fast-path from localStorage first (instant paint) ─────────────
  const cachedName = localStorage.getItem('user_name');
  if (cachedName) applyUser({ name: cachedName, surgery_type: '' });

  // ── 4. Fetch full profile from API ────────────────────────────────────────
  try {
    const res  = await fetch(`/api/users/${userId}`);
    if (!res.ok) throw new Error('fetch failed');
    const user = await res.json();
    localStorage.setItem('user_name', user.name);   // keep cache fresh
    applyUser(user);
  } catch (_) {
    // server down — already painted from cache, silently continue
  }
})();

function applyUser(user) {
  const name    = user.name        || 'User';
  const surgery = user.surgery_type || '';
  const initials = name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
  const firstName = name.split(' ')[0];

  // Sidebar pill
  const nameEl   = document.getElementById('user-name');
  const subEl    = document.getElementById('user-sub');
  const avatarEl = document.getElementById('user-avatar');
  if (nameEl)   nameEl.textContent   = name;
  if (subEl)    subEl.textContent    = surgery || 'Recovery Plan';
  if (avatarEl) avatarEl.textContent = initials;

  // Dashboard topbar greeting (optional)
  const greetEl = document.getElementById('user-greeting');
  if (greetEl) {
    const hour = new Date().getHours();
    const part = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
    greetEl.textContent = `Good ${part}, ${firstName} 👋`;
  }
}
