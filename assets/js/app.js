// NineX Admin Panel — Direct Supabase (No Middleman)

class NineXAdmin {
    constructor() {
        this.user = null;
        this.users = [];
        this.page = { offset: 0, limit: 50, total: 0 };
        this.sort = 'latest';
        this.search = '';
        this.maint = false;
        this.init();
    }

    async init() {
        if (Session.ok()) {
            this.user = Session.get();
            this.showDashboard();
            this.loadAll();
        } else {
            this.showLogin();
        }
    }

    // ══════════════════════════════════════════
    // LOGIN
    // ══════════════════════════════════════════

    async handleLogin() {
        const u = document.getElementById('loginUser')?.value?.trim()?.toLowerCase();
        const p = document.getElementById('loginPass')?.value;
        if (!u || !p) return this.err('Enter username and password');

        this.showLoad('Authenticating...');
        const res = await SB.rpc('admin_panel_login', { p_username: u, p_password: p });
        this.hideLoad();

        if (!res.ok || !res.data?.success) return this.err(res.data?.message || 'Login failed');

        const userData = res.data.user;

        if (userData.telegram_id) {
            const otp = String(Math.floor(100000 + Math.random() * 900000));
            const exp = new Date(Date.now() + 5 * 60 * 1000).toISOString();
            await SB.update('users', `id=eq.${userData.id}`, { otp, otp_expires_at: exp, otp_attempts: 0 });
            const sent = await sendTelegramOTP(userData.telegram_id, otp, u);
            if (sent) {
                this._tempUser = userData;
                document.getElementById('loginStep').style.display = 'none';
                document.getElementById('otpStep').style.display = 'block';
                return this.ok('OTP sent to Telegram');
            }
        }
        this.completeLogin(userData);
    }

    async handleOTP() {
        const otp = document.getElementById('loginOtp')?.value?.trim();
        if (!otp) return this.err('Enter OTP');
        this.showLoad('Verifying...');
        const res = await SB.query('users', `id=eq.${this._tempUser.id}&select=otp,otp_expires_at,otp_attempts`);
        this.hideLoad();
        if (!res.ok || !res.data?.[0]) return this.err('Verification failed');
        const u = res.data[0];
        if ((u.otp_attempts || 0) >= 3) {
            await SB.update('users', `id=eq.${this._tempUser.id}`, { otp: null, otp_expires_at: null, otp_attempts: null });
            this.err('Too many attempts. Login again.');
            document.getElementById('otpStep').style.display = 'none';
            document.getElementById('loginStep').style.display = 'block';
            return;
        }
        if (!u.otp || new Date(u.otp_expires_at) < new Date()) {
            this.err('OTP expired');
            document.getElementById('otpStep').style.display = 'none';
            document.getElementById('loginStep').style.display = 'block';
            return;
        }
        if (String(u.otp) !== String(otp)) {
            await SB.update('users', `id=eq.${this._tempUser.id}`, { otp_attempts: (u.otp_attempts || 0) + 1 });
            return this.err('Incorrect OTP');
        }
        await SB.update('users', `id=eq.${this._tempUser.id}`, { otp: null, otp_expires_at: null, otp_attempts: null });
        this.completeLogin(this._tempUser);
    }

    completeLogin(u) { Session.set(u); this.user = u; this.showDashboard(); this.loadAll(); }

    // ══════════════════════════════════════════
    // UI
    // ══════════════════════════════════════════

    showLogin() {
        document.getElementById('loginView').style.display = 'flex';
        document.getElementById('dashView').style.display = 'none';
    }

    showDashboard() {
        document.getElementById('loginView').style.display = 'none';
        document.getElementById('dashView').style.display = 'flex';

        const roleColors = { owner: 'gold', admin: 'purple', seller: 'blue', reseller: 'cyan' };
        document.getElementById('topRole').textContent = this.user.role.toUpperCase();
        document.getElementById('topRole').className = `badge badge-${roleColors[this.user.role] || 'gray'}`;
        document.getElementById('topUser').textContent = this.user.username;

        // Credits badge (seller/reseller)
        const h = CONFIG.HIERARCHY[this.user.role];
        const cb = document.getElementById('topCredits');
        if (h && !h.unlimited) {
            cb.style.display = 'inline-flex';
            cb.textContent = `${this.user.credits} Credits`;
        } else cb.style.display = 'none';

        // Admin credits_used badge
        const cuBadge = document.getElementById('topCreditsUsed');
        if (this.user.role === 'admin') {
            cuBadge.style.display = 'inline-flex';
            cuBadge.textContent = `${this.user.credits_used || 0} Used`;
        } else cuBadge.style.display = 'none';

        // Assigned mod badge for non-owner
        const modBadge = document.getElementById('topMod');
        if (this.user.role !== 'owner') {
            modBadge.style.display = 'inline-flex';
            const mods = (this.user.mod || 'all').toUpperCase();
            modBadge.textContent = mods.replace(/,/g, ', ');
        } else modBadge.style.display = 'none';

        // Owner-only sections
        document.getElementById('btnMaint').style.display = this.user.role === 'owner' ? 'inline-flex' : 'none';
        document.getElementById('btnResetAll').style.display = ['owner', 'admin'].includes(this.user.role) ? 'inline-flex' : 'none';
        document.getElementById('statsCard').style.display = this.user.role === 'owner' ? 'block' : 'none';
        document.getElementById('adminUsageCard').style.display = this.user.role === 'owner' ? 'block' : 'none';

        this.setupCreateForm();
    }

    setupCreateForm() {
        const roleSelect = document.getElementById('cRole');
        const canCreate = CONFIG.HIERARCHY[this.user.role]?.canCreate || [];
        roleSelect.innerHTML = canCreate.map(r => `<option value="${r}">${r.charAt(0).toUpperCase() + r.slice(1)}</option>`).join('');
        this.setupUserModDropdown();
        this.onRoleChange();
    }

    // Setup user mod dropdown — restricted by creator's assigned mods
    setupUserModDropdown() {
        const modSelect = document.getElementById('cMod');
        const myMods = (this.user.mod || 'all').split(',').map(m => m.trim());
        if (this.user.role === 'owner' || myMods.includes('all')) {
            modSelect.innerHTML = '<option value="all">All Apps</option><option value="brutal">Brutal</option><option value="ninex">NineX</option><option value="safe">Safe (Sensi)</option>';
        } else {
            const labels = { brutal: 'Brutal', ninex: 'NineX', safe: 'Safe (Sensi)' };
            modSelect.innerHTML = myMods.map(m => `<option value="${m}">${labels[m] || m}</option>`).join('');
        }
    }

    // Build mod checkboxes for admin/seller/reseller creation — restricted by creator's mods
    buildModCheckboxes() {
        const container = document.getElementById('modCheckboxes');
        const myMods = (this.user.mod || 'all').split(',').map(m => m.trim());
        const allMods = [
            { value: 'all', label: 'All Apps', icon: '🌐' },
            { value: 'brutal', label: 'Brutal', icon: '💀' },
            { value: 'ninex', label: 'NineX', icon: '⚡' },
            { value: 'safe', label: 'Safe', icon: '🛡️' }
        ];

        // Owner sees all options; others see only their assigned mods
        let available;
        if (this.user.role === 'owner' || myMods.includes('all')) {
            available = allMods;
        } else {
            available = allMods.filter(m => myMods.includes(m.value));
        }

        container.innerHTML = available.map(m => `
            <label class="mod-check" data-mod="${m.value}" onclick="app.toggleModCheck(this)">
                <input type="checkbox" value="${m.value}">
                <span class="check-icon"></span>
                <span>${m.icon} ${m.label}</span>
            </label>
        `).join('');
    }

    toggleModCheck(el) {
        const cb = el.querySelector('input[type="checkbox"]');
        cb.checked = !cb.checked;
        el.classList.toggle('active', cb.checked);

        // If 'all' is checked, uncheck others. If others checked, uncheck 'all'.
        const container = document.getElementById('modCheckboxes');
        if (cb.value === 'all' && cb.checked) {
            container.querySelectorAll('.mod-check').forEach(mc => {
                if (mc !== el) { mc.classList.remove('active'); mc.querySelector('input').checked = false; }
            });
        } else if (cb.value !== 'all' && cb.checked) {
            const allCheck = container.querySelector('[data-mod="all"]');
            if (allCheck) { allCheck.classList.remove('active'); allCheck.querySelector('input').checked = false; }
        }
    }

    getSelectedMods() {
        const checks = document.querySelectorAll('#modCheckboxes input[type="checkbox"]:checked');
        const vals = Array.from(checks).map(c => c.value);
        if (vals.length === 0 || vals.includes('all')) return 'all';
        return vals.join(',');
    }

    onRoleChange() {
        const role = document.getElementById('cRole').value;
        const isUser = role === 'user';

        document.getElementById('grpDays').style.display = isUser ? 'block' : 'none';
        document.getElementById('grpMod').style.display = isUser ? 'block' : 'none';
        document.getElementById('grpTelegram').style.display = !isUser ? 'block' : 'none';
        // Show credits field for admin/seller/reseller (giving credits costs you)
        document.getElementById('grpCredits').style.display = !isUser ? 'block' : 'none';
        // Show mod checkboxes for ALL non-user creation (any role can assign mods they have)
        document.getElementById('grpAdminMod').style.display = !isUser ? 'block' : 'none';
        if (!isUser) this.buildModCheckboxes();
        document.getElementById('grpCount').style.display = isUser ? 'block' : 'none';
        if (!isUser) document.getElementById('cCount').value = '1';
        document.getElementById('passGroup').style.display = 'block';
        this.updateCreateBtn();
    }

    updateCreateBtn() {
        const role = document.getElementById('cRole').value;
        const btn = document.getElementById('btnCreate');
        const count = parseInt(document.getElementById('cCount').value) || 1;
        const roleName = role.charAt(0).toUpperCase() + role.slice(1);
        if (role === 'user') {
            const days = parseInt(document.getElementById('cDays').value) || 10;
            const cost = (CONFIG.CREDITS[days] || 1) * count;
            if (!CONFIG.HIERARCHY[this.user.role]?.unlimited) {
                btn.textContent = `Create ${count > 1 ? count + ' Users' : 'User'} (${cost} credit${cost !== 1 ? 's' : ''})`;
            } else if (count > 1) {
                btn.textContent = `Create ${count} Users`;
            } else {
                btn.textContent = `Create User`;
            }
        } else {
            // Cost = credits you give them
            const cGive = parseInt(document.getElementById('cCreditsGive')?.value) || 0;
            if (!CONFIG.HIERARCHY[this.user.role]?.unlimited && cGive > 0) {
                btn.textContent = `Create ${roleName} (${cGive} credit${cGive !== 1 ? 's' : ''})`;
            } else {
                btn.textContent = `Create ${roleName}`;
            }
        }
    }

    // ══════════════════════════════════════════
    // LOAD DATA
    // ══════════════════════════════════════════

    async loadAll() {
        this.loadUsers();
        if (this.user.role === 'owner') { this.loadStats(); this.loadAdminUsage(); }
        this.loadMaint();
        if (this.user.role === 'admin') {
            const r = await SB.query('users', `id=eq.${this.user.id}&select=credits_used`);
            if (r.ok && r.data?.[0]) {
                this.user.credits_used = r.data[0].credits_used || 0;
                Session.set(this.user);
                document.getElementById('topCreditsUsed').textContent = `${this.user.credits_used} Used`;
            }
        }
    }

    async loadStats() {
        const r = await SB.rpc('admin_get_stats');
        if (r.ok && r.data) {
            document.getElementById('sTotal').textContent = r.data.total_users || 0;
            document.getElementById('sSessions').textContent = r.data.active_sessions || 0;
            document.getElementById('sBanned').textContent = r.data.banned_users || 0;
            document.getElementById('sUsers').textContent = r.data.users || 0;
        }
    }

    async loadAdminUsage() {
        const r = await SB.rpc('admin_get_admin_usage');
        if (!r.ok || !r.data) return;
        const admins = r.data || [];
        const tbody = document.getElementById('adminUsageTbody');
        if (!admins.length) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:1rem;color:var(--text-muted);">No admins yet</td></tr>';
            return;
        }
        tbody.innerHTML = admins.map(a => {
            const modStr = (a.mod || 'all').toUpperCase().replace(/,/g, ', ');
            return `<tr>
                <td><strong>${esc(a.username)}</strong></td>
                <td><span class="badge badge-purple">${modStr}</span></td>
                <td style="font-weight:700;font-size:1.1rem;">${a.credits_used || 0}</td>
                <td>${fmtDate(a.created_at)}</td>
                <td><button class="btn btn-sm btn-warning" onclick="app.resetAdminUsage('${a.username}')">Reset to 0</button></td>
            </tr>`;
        }).join('');
    }

    async loadMaint() {
        const r = await SB.query('server_config', 'key=eq.maintenance&select=value');
        if (r.ok && r.data?.[0]) {
            this.maint = r.data[0].value === 'true';
            const btn = document.getElementById('btnMaint');
            btn.textContent = this.maint ? '🟢 Maint: ON' : '🔴 Maint: OFF';
            btn.className = 'btn btn-sm ' + (this.maint ? 'btn-success' : 'btn-danger');
        }
    }

    async loadUsers() {
        const r = await SB.rpc('admin_list_users');
        if (!r.ok || !r.data) return;
        let users = r.data || [];

        // Visibility
        if (this.user.role !== 'owner') {
            users = users.filter(u => u.created_by === this.user.username);
        }
        if (this.search) {
            const q = this.search.toLowerCase();
            users = users.filter(u => u.username.toLowerCase().includes(q));
        }
        switch (this.sort) {
            case 'oldest': users.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); break;
            case 'az': users.sort((a, b) => a.username.localeCompare(b.username)); break;
            case 'za': users.sort((a, b) => b.username.localeCompare(a.username)); break;
            default: users.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }
        this.page.total = users.length;
        this.users = users.slice(this.page.offset, this.page.offset + this.page.limit);
        this.renderTable();
    }

    renderTable() {
        const tb = document.getElementById('tbody');
        if (!this.users.length) {
            tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--text-muted);">No users found</td></tr>';
            this.updatePag(); return;
        }
        const roleColors = { owner: 'gold', admin: 'purple', seller: 'blue', reseller: 'cyan', user: 'gray' };
        const modColors = { all: 'green', brutal: 'red', ninex: 'purple', safe: 'cyan' };

        tb.innerHTML = this.users.map(u => {
            const isUserRole = u.role === 'user';
            const expired = u.expires_at && new Date(u.expires_at) < new Date();
            const waitingFirstLogin = isUserRole && !u.hwid && u.subscription_days && !u.expires_at;

            let statusBadge;
            if (u.banned) statusBadge = '<span class="badge badge-red">Banned</span>';
            else if (waitingFirstLogin) statusBadge = '<span class="badge badge-cyan">Waiting</span>';
            else if (expired && isUserRole) statusBadge = '<span class="badge badge-yellow">Expired</span>';
            else statusBadge = '<span class="badge badge-green">Active</span>';

            const roleBadge = `<span class="badge badge-${roleColors[u.role] || 'gray'}">${(u.role || 'user').toUpperCase()}</span>`;

            const mods = (u.mod || 'all').split(',').map(m => m.trim());
            const modBadges = mods.map(m => `<span class="badge badge-${modColors[m] || 'gray'}" style="font-size:10px;">${m.toUpperCase()}</span>`).join(' ');

            // Column 7: HWID for users, Credits for seller/reseller, Used for admin
            let col7;
            if (isUserRole) {
                col7 = `<span class="hwid-text">${u.hwid ? u.hwid.substring(0, 10) + '…' : 'Unbound'}</span>`;
            } else if (u.role === 'admin') {
                col7 = `<span class="badge badge-yellow" style="font-size:11px;">⚡ ${u.credits_used || 0} Used</span>`;
            } else {
                col7 = `<span class="badge badge-green" style="font-size:11px;">💰 ${u.credits || 0} Cr</span>`;
            }

            // Expires column
            let expiresCol;
            if (!isUserRole) {
                expiresCol = 'Lifetime';
            } else if (waitingFirstLogin) {
                expiresCol = `<span style="color:var(--cyan);font-weight:600;">${u.subscription_days}d (pending)</span>`;
            } else if (u.expires_at) {
                expiresCol = fmtDate(u.expires_at);
            } else {
                expiresCol = 'Lifetime';
            }

            // Actions
            let acts = '';

            // HWID reset: only for user accounts
            if (isUserRole) {
                acts += `<button class="btn btn-sm btn-warning" onclick="app.resetHwid('${u.username}')">HWID</button>`;
            }

            // Ban/Unban
            if (u.banned) acts += `<button class="btn btn-sm btn-success" onclick="app.unban('${u.username}')">Unban</button>`;
            else acts += `<button class="btn btn-sm btn-danger" onclick="app.ban('${u.username}')">Ban</button>`;

            // +Cr: for seller/reseller sub-accounts
            if (['seller', 'reseller'].includes(u.role)) {
                acts += `<button class="btn btn-sm btn-success" onclick="app.addCredits('${u.username}')">+Cr</button>`;
            }

            // Delete
            if (['owner', 'admin', 'seller'].includes(this.user.role)) {
                acts += `<button class="btn btn-sm btn-danger" onclick="app.deleteUser('${u.username}')">Del</button>`;
            }

            return `<tr>
                <td><strong>${esc(u.username)}</strong></td>
                <td>${roleBadge}</td>
                <td>${modBadges}</td>
                <td>${statusBadge}</td>
                <td>${expiresCol}</td>
                <td>${u.created_by || '—'}</td>
                <td>${col7}</td>
                <td><div class="actions">${acts}</div></td>
            </tr>`;
        }).join('');
        this.updatePag();
    }

    updatePag() {
        const { offset, limit, total } = this.page;
        document.getElementById('pagInfo').textContent = total > 0 ? `${offset + 1}–${Math.min(offset + limit, total)} of ${total}` : '0 users';
        document.getElementById('pagPrev').disabled = offset === 0;
        document.getElementById('pagNext').disabled = offset + limit >= total;
    }
    prevPage() { this.page.offset = Math.max(0, this.page.offset - this.page.limit); this.loadUsers(); }
    nextPage() { this.page.offset += this.page.limit; this.loadUsers(); }
    doSearch() { this.search = document.getElementById('searchInput').value; this.page.offset = 0; this.loadUsers(); }
    doSort(v) { this.sort = v; this.loadUsers(); }
    doPageSize(v) { this.page.limit = parseInt(v); this.page.offset = 0; this.loadUsers(); }

    // ══════════════════════════════════════════
    // CREATE
    // ══════════════════════════════════════════

    async handleCreate() {
        const role = document.getElementById('cRole').value;
        const username = document.getElementById('cUser').value.trim().toLowerCase();
        const password = document.getElementById('cPass').value;
        const count = role === 'user' ? (parseInt(document.getElementById('cCount').value) || 1) : 1;
        const days = parseInt(document.getElementById('cDays')?.value) || 10;
        const telegramId = document.getElementById('cTelegram')?.value?.trim() || '';
        const creditsToGive = parseInt(document.getElementById('cCreditsGive')?.value) || 10;
        const isBulk = count > 1;

        // Mod selection: for users use dropdown, for admin/seller/reseller use checkboxes
        let mod;
        if (role === 'user') {
            mod = document.getElementById('cMod')?.value || 'all';
        } else {
            mod = this.getSelectedMods();
        }

        if (!isBulk && (!username || !password)) return this.err('Username and password required');
        if (!isBulk && username.length < 3) return this.err('Username min 3 chars');
        if (!isBulk && password.length < 4) return this.err('Password min 4 chars');

        const canCreate = CONFIG.HIERARCHY[this.user.role]?.canCreate || [];
        if (!canCreate.includes(role)) return this.err(`Cannot create ${role}`);
        if (['admin', 'seller', 'reseller'].includes(role) && !telegramId) return this.err('Telegram ID required');

        // Credit cost: users = days-based, seller/reseller = credits you give them
        let totalCost = 0;
        if (role === 'user') {
            totalCost = (CONFIG.CREDITS[days] || 1) * count;
        } else if (['seller', 'reseller'].includes(role)) {
            // Cost = whatever credits you're giving them
            totalCost = creditsToGive;
        }
        // Admin creation is free (only owner creates admins, owner is unlimited)
        if (!CONFIG.HIERARCHY[this.user.role]?.unlimited && this.user.credits < totalCost)
            return this.err(`Need ${totalCost} credits, have ${this.user.credits}`);

        this.showLoad('Creating...');
        const created = [];

        for (let i = 0; i < count; i++) {
            const uname = isBulk ? (username || 'user_') + genRand(6) : username;
            const upass = isBulk ? genRand(10) : password;

            const res = await SB.rpc('admin_create_user', {
                p_username: uname, p_password: upass, p_account_type: 'standard',
                p_days: role === 'user' ? days : null,
                p_mod: mod,
                p_role: role, p_created_by: this.user.username
            });

            if (res.ok && res.data?.success) {
                created.push({ username: uname, password: upass, role, mod, days: role === 'user' ? days : '∞' });
                if (['admin', 'seller', 'reseller'].includes(role)) {
                    const updates = { telegram_id: telegramId || null, mod: mod };
                    if (['seller', 'reseller'].includes(role)) updates.credits = creditsToGive;
                    await SB.update('users', `username=eq.${uname}`, updates);
                }
            } else if (!isBulk) {
                this.hideLoad();
                return this.err(res.data?.message || 'Failed');
            }
        }

        // ── Credit deduction for seller/reseller (they have finite credits) ──
        if (totalCost > 0 && !CONFIG.HIERARCHY[this.user.role]?.unlimited) {
            this.user.credits -= totalCost;
            await SB.update('users', `id=eq.${this.user.id}`, { credits: this.user.credits });
        }

        // ── Track admin credits_used (unlimited but tracked) ──
        if (totalCost > 0 && CONFIG.HIERARCHY[this.user.role]?.unlimited && this.user.role !== 'owner') {
            this.user.credits_used = (this.user.credits_used || 0) + totalCost;
            await SB.update('users', `id=eq.${this.user.id}`, { credits_used: this.user.credits_used });
        }

        // ── Refresh credits/used from DB to stay in sync ──
        const freshUser = await SB.query('users', `id=eq.${this.user.id}&select=credits,credits_used`);
        if (freshUser.ok && freshUser.data?.[0]) {
            this.user.credits = freshUser.data[0].credits ?? this.user.credits;
            this.user.credits_used = freshUser.data[0].credits_used ?? this.user.credits_used;
            Session.set(this.user);
            // Update UI badges
            if (!CONFIG.HIERARCHY[this.user.role]?.unlimited) {
                document.getElementById('topCredits').textContent = `${this.user.credits} Credits`;
            }
            if (this.user.role === 'admin') {
                document.getElementById('topCreditsUsed').textContent = `${this.user.credits_used} Used`;
            }
        }

        this.hideLoad();
        if (isBulk && created.length > 0) {
            document.getElementById('bulkText').value = created.map(a => `${a.username} | ${a.password} | ${a.mod} | ${a.days} days`).join('\n');
            document.getElementById('bulkModal').classList.add('show');
        }
        this.ok(`Created ${created.length} account(s)`);
        document.getElementById('cUser').value = '';
        document.getElementById('cPass').value = '';
        document.getElementById('cCount').value = '1';
        this.loadAll();
    }

    // ══════════════════════════════════════════
    // ACTIONS
    // ══════════════════════════════════════════

    async ban(u) { const r = prompt('Ban reason:'); const res = await SB.rpc('admin_ban_user',{p_username:u,p_reason:r||'Banned'}); if(res.ok){this.ok('Banned');this.loadUsers();}else this.err('Failed'); }
    async unban(u) { const r = await SB.rpc('admin_unban_user',{p_username:u}); if(r.ok){this.ok('Unbanned');this.loadUsers();}else this.err('Failed'); }
    async resetHwid(u) { if(!confirm('Reset HWID?'))return; const r=await SB.rpc('admin_reset_hwid',{p_username:u}); if(r.ok){this.ok('HWID reset');this.loadUsers();}else this.err('Failed'); }
    async extend(u) { const d=prompt('Days (10, 20, 30):','10'); if(![10,20,30].includes(parseInt(d)))return this.err('Must be 10/20/30'); const r=await SB.rpc('admin_extend_user',{p_username:u,p_days:parseInt(d)}); if(r.ok){this.ok(`+${d} days`);this.loadUsers();}else this.err('Failed'); }
    async deleteUser(u) { if(!confirm(`Delete ${u}?`))return; const r=await SB.rpc('admin_delete_user',{p_username:u}); if(r.ok){this.ok('Deleted');this.loadAll();}else this.err('Failed'); }
    async addCredits(u) {
        const c = prompt('Credits to add:', '10');
        if (!c || isNaN(c) || parseInt(c) <= 0) return this.err('Invalid amount');
        const amount = parseInt(c);

        // Check if giver has enough credits (skip for unlimited/owner)
        if (!CONFIG.HIERARCHY[this.user.role]?.unlimited) {
            if (this.user.credits < amount) return this.err(`Need ${amount} credits, have ${this.user.credits}`);
        }

        // Add to receiver
        const r = await SB.rpc('admin_add_credits', { p_username: u, p_amount: amount });
        if (!r.ok) return this.err('Failed');

        // Deduct from giver (seller/reseller with finite credits)
        if (!CONFIG.HIERARCHY[this.user.role]?.unlimited) {
            this.user.credits -= amount;
            await SB.update('users', `id=eq.${this.user.id}`, { credits: this.user.credits });
        }

        // Track admin usage
        if (CONFIG.HIERARCHY[this.user.role]?.unlimited && this.user.role !== 'owner') {
            this.user.credits_used = (this.user.credits_used || 0) + amount;
            await SB.update('users', `id=eq.${this.user.id}`, { credits_used: this.user.credits_used });
        }

        // Refresh from DB
        const fresh = await SB.query('users', `id=eq.${this.user.id}&select=credits,credits_used`);
        if (fresh.ok && fresh.data?.[0]) {
            this.user.credits = fresh.data[0].credits ?? this.user.credits;
            this.user.credits_used = fresh.data[0].credits_used ?? this.user.credits_used;
            Session.set(this.user);
            if (!CONFIG.HIERARCHY[this.user.role]?.unlimited) document.getElementById('topCredits').textContent = `${this.user.credits} Credits`;
            if (this.user.role === 'admin') document.getElementById('topCreditsUsed').textContent = `${this.user.credits_used} Used`;
        }

        this.ok(`+${amount} credits to ${u}`);
        this.loadUsers();
    }
    async resetAllKeys() { if(!confirm('Reset ALL HWIDs?'))return; this.showLoad('Resetting...'); await SB.update('users','role=eq.user',{hwid:null}); await SB.del('sessions','is_valid=eq.true'); this.hideLoad(); this.ok('All HWIDs reset'); this.loadUsers(); }
    async toggleMaint() { this.maint=!this.maint; await SB.rpc('admin_set_maintenance',{p_enabled:this.maint}); const b=document.getElementById('btnMaint'); b.textContent=this.maint?'🟢 Maint: ON':'🔴 Maint: OFF'; b.className='btn btn-sm '+(this.maint?'btn-success':'btn-danger'); this.ok(`Maintenance ${this.maint?'ON':'OFF'}`); }
    async resetAdminUsage(u) { if(!confirm(`Reset usage for ${u}?`))return; const r=await SB.rpc('admin_reset_admin_usage',{p_username:u}); if(r.ok){this.ok(`${u} cleared`);this.loadAdminUsage();}else this.err('Failed'); }
    logout() { Session.clear(); this.user=null; location.reload(); }

    // Toast
    ok(m){const t=document.getElementById('toast');t.textContent='✓ '+m;t.className='toast toast-success show';setTimeout(()=>t.className='toast',3000);}
    err(m){const le=document.getElementById('loginErr');if(le&&document.getElementById('loginView').style.display!=='none'){le.textContent=m;le.style.display='block';setTimeout(()=>le.style.display='none',5000);}else{const t=document.getElementById('toast');t.textContent='✗ '+m;t.className='toast toast-error show';setTimeout(()=>t.className='toast',4000);}}
    showLoad(m){document.getElementById('loadText').textContent=m;document.getElementById('loadOverlay').classList.add('show');}
    hideLoad(){document.getElementById('loadOverlay').classList.remove('show');}
}

let app;
document.addEventListener('DOMContentLoaded',()=>{app=new NineXAdmin();window.app=app;});
