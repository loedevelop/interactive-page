/**
 * 📂 檔案路徑：020_js_core/profile-form.js
 * 共用個人資料表單：姓名組裝、Drive 顯示、密碼更新
 */

(function() {
    function calculateDisplayName(rawData, effectiveMode) {
        const enName = (rawData.nameEN || '').trim();
        const passLast = (rawData.passportLast || '').trim();
        const lastCN = (rawData.lastNameCN || '').trim();
        const firstCN = (rawData.firstNameCN || '').trim();
        const fullCN = (lastCN + firstCN).trim();

        if (effectiveMode === 'cn_first') {
            if (fullCN && enName) return fullCN + ' (' + enName + ')';
            if (fullCN) return fullCN;
            if (enName) return enName;
            return '未命名';
        }
        if (enName && passLast) return enName + ' ' + passLast;
        if (enName) return enName;
        if (passLast) return passLast;
        if (fullCN) return fullCN;
        return '未命名';
    }

    function getDriveDisplay(rawData) {
        if (!rawData) return '尚未綁定雲端硬碟';
        if (rawData.drive_url) return rawData.drive_url;
        if (rawData.driveLink) return rawData.driveLink;
        return '尚未綁定雲端硬碟';
    }

    function readNameFieldsFromDom(prefix) {
        return {
            nameEN: document.getElementById(prefix + '-nameEN') ? document.getElementById(prefix + '-nameEN').value.trim() : '',
            passportLast: document.getElementById(prefix + '-passLast') ? document.getElementById(prefix + '-passLast').value.trim() : '',
            passportFirst: document.getElementById(prefix + '-passFirst') ? document.getElementById(prefix + '-passFirst').value.trim() : '',
            lastNameCN: document.getElementById(prefix + '-lastCN') ? document.getElementById(prefix + '-lastCN').value.trim() : '',
            firstNameCN: document.getElementById(prefix + '-firstCN') ? document.getElementById(prefix + '-firstCN').value.trim() : ''
        };
    }

    function bindPasswordToggle(toggleBtnId, inputId) {
        const btn = document.getElementById(toggleBtnId);
        const input = document.getElementById(inputId);
        if (!btn || !input) return;
        btn.addEventListener('click', function() {
            if (input.getAttribute('type') === 'password') {
                input.setAttribute('type', 'text');
                btn.textContent = '🙈';
                btn.title = '隱藏密碼';
            } else {
                input.setAttribute('type', 'password');
                btn.textContent = '👁️';
                btn.title = '顯示密碼';
            }
        });
    }

    async function updatePasswordIfProvided(newPwd) {
        if (!newPwd) return null;
        if (!window.supabaseClient) throw new Error('連線未就緒');
        const { error } = await window.supabaseClient.auth.updateUser({ password: newPwd });
        if (error) throw error;
        return true;
    }

    function passwordFieldHtml(inputId, toggleBtnId) {
        return [
            '<label style="display:block; font-weight:800; color:#475569; margin-bottom:5px;">修改密碼 (若不修改請留白)</label>',
            '<div style="position:relative;">',
            '  <input type="password" id="' + inputId + '" class="form-control" placeholder="輸入新密碼" style="width:100%; padding-right:45px; box-sizing:border-box;">',
            '  <button type="button" id="' + toggleBtnId + '" style="position:absolute; right:12px; top:50%; transform:translateY(-50%); background:none; border:none; cursor:pointer; font-size:1.1rem; color:#888;" title="顯示密碼">👁️</button>',
            '</div>'
        ].join('');
    }

    window.ProfileForm = {
        calculateDisplayName,
        getDriveDisplay,
        readNameFieldsFromDom,
        bindPasswordToggle,
        updatePasswordIfProvided,
        passwordFieldHtml
    };
})();
