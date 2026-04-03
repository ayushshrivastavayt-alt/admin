// NineX Admin Panel — Config (reads secrets from env.js)

const SUPABASE_URL = window.__ENV?.SUPABASE_URL || '';
const SUPABASE_KEY = window.__ENV?.SUPABASE_KEY || '';
const TELEGRAM_BOT_TOKEN = window.__ENV?.TELEGRAM_BOT_TOKEN || '';

const CONFIG = {
    HIERARCHY: {
        owner:    { level: 4, canCreate: ['admin', 'seller', 'reseller', 'user'], unlimited: true },
        admin:    { level: 3, canCreate: ['seller', 'reseller', 'user'], unlimited: true },
        seller:   { level: 2, canCreate: ['reseller', 'user'], unlimited: false },
        reseller: { level: 1, canCreate: ['user'], unlimited: false },
        user:     { level: 0, canCreate: [], unlimited: false }
    },
    CREDITS: { 10: 1, 20: 2, 30: 3 },
    DURATION_LABELS: { 10: '10 Days', 20: '20 Days', 30: '30 Days' },
    MODS: ['all', 'brutal', 'ninex', 'safe']
};

// ── Supabase Direct Client ──
const SB = {
    async rpc(fn, params = {}) {
        try {
            const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
                body: JSON.stringify(params)
            });
            return { ok: r.ok, data: await r.json() };
        } catch (e) { return { ok: false, data: { message: 'Network error' } }; }
    },
    async query(table, q = '') {
        try {
            const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${q}`, {
                headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
            });
            return { ok: r.ok, data: await r.json() };
        } catch { return { ok: false, data: [] }; }
    },
    async update(table, match, body) {
        try {
            const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${match}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'return=minimal' },
                body: JSON.stringify(body)
            });
            return { ok: r.ok };
        } catch { return { ok: false }; }
    },
    async del(table, match) {
        try {
            const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${match}`, {
                method: 'DELETE',
                headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'return=minimal' }
            });
            return { ok: r.ok };
        } catch { return { ok: false }; }
    }
};

// ── Telegram ──
async function sendTelegramOTP(chatId, otp, username) {
    const msg = `🔐 *Admin Panel Login*\n\nYour OTP: \`${otp}\`\nAccount: ${username}\nTime: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n\n_Valid for 5 minutes._`;
    try {
        const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' })
        });
        return r.ok;
    } catch { return false; }
}

// ── Session ──
const Session = {
    get() { try { return JSON.parse(localStorage.getItem('nx_user')); } catch { return null; } },
    set(u) { localStorage.setItem('nx_user', JSON.stringify(u)); },
    clear() { localStorage.removeItem('nx_user'); },
    ok() { return !!this.get(); }
};

// ── Helpers ──
function genRand(n) { const c = 'abcdefghijklmnopqrstuvwxyz0123456789'; return Array.from({length:n}, () => c[Math.floor(Math.random()*c.length)]).join(''); }
function fmtDate(d) { if(!d) return 'Lifetime'; try { return new Date(d).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}); } catch { return d; } }
function esc(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
