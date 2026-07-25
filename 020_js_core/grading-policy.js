/**
 * 📂 020_js_core/grading-policy.js
 * 🌟 班級 AI 批改策略引擎（前後端共用邏輯）
 */

window.GradingPolicy = (function() {
    'use strict';

    const ALL_STAFF_ROLES = ['primary_teacher', 'co_teacher', 'ta_senior', 'ta_junior'];

    const DEFAULT_POLICY = {
        configured: false,
        final_authority: 'human_confirm',
        override_roles: ['primary_teacher', 'co_teacher', 'ta_senior', 'ta_junior'],
        publish_roles: ['primary_teacher', 'co_teacher', 'ta_senior'],
        speech_engine: 'speechace',
        accent: 'en-us',
        phonetic_format: 'kk'
    };

    function parsePolicy(rawData) {
        let raw = rawData;
        if (!raw) raw = {};
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (e) { raw = {}; }
        }
        const gp = raw.grading_policy;
        if (!gp || typeof gp !== 'object') {
            return Object.assign({}, DEFAULT_POLICY, { configured: false });
        }

        const policy = Object.assign({}, DEFAULT_POLICY);
        policy.configured = gp.configured === true;

        if (gp.final_authority === 'ai_auto' || gp.final_authority === 'human_confirm') {
            policy.final_authority = gp.final_authority;
        }

        if (Array.isArray(gp.override_roles)) {
            policy.override_roles = gp.override_roles.filter(function(r) {
                return ALL_STAFF_ROLES.indexOf(r) > -1;
            });
        }
        if (Array.isArray(gp.publish_roles)) {
            policy.publish_roles = gp.publish_roles.filter(function(r) {
                return ALL_STAFF_ROLES.indexOf(r) > -1;
            });
        }

        if (gp.speech_engine) policy.speech_engine = String(gp.speech_engine);
        if (gp.accent) policy.accent = String(gp.accent);
        if (gp.phonetic_format) policy.phonetic_format = String(gp.phonetic_format);

        return policy;
    }

    function buildPolicyFromForm(formState) {
        const policy = {
            configured: true,
            final_authority: formState.final_authority,
            override_roles: [],
            publish_roles: [],
            speech_engine: formState.speech_engine ? formState.speech_engine : 'speechace',
            accent: formState.accent ? formState.accent : 'en-us',
            phonetic_format: formState.phonetic_format ? formState.phonetic_format : 'kk'
        };

        ALL_STAFF_ROLES.forEach(function(role) {
            if (formState.overrideRoles && formState.overrideRoles[role]) {
                policy.override_roles.push(role);
            }
            if (formState.publishRoles && formState.publishRoles[role]) {
                policy.publish_roles.push(role);
            }
        });

        if (policy.override_roles.length === 0) {
            policy.override_roles = DEFAULT_POLICY.override_roles.slice();
        }
        if (policy.publish_roles.length === 0) {
            policy.publish_roles = DEFAULT_POLICY.publish_roles.slice();
        }

        return policy;
    }

    function roleCanOverride(policy, role) {
        if (!role) return false;
        const p = policy ? policy : DEFAULT_POLICY;
        return p.override_roles.indexOf(role) > -1;
    }

    function roleCanPublish(policy, role) {
        if (!role) return false;
        const p = policy ? policy : DEFAULT_POLICY;
        return p.publish_roles.indexOf(role) > -1;
    }

    function resolveEffectiveScore(policy, rawData) {
        const p = policy ? policy : DEFAULT_POLICY;
        const raw = rawData ? rawData : {};
        const override = raw.teacher_override ? raw.teacher_override : {};
        const aiEval = raw.ai_evaluation ? raw.ai_evaluation : {};

        if (override.final_score !== undefined && override.final_score !== null && override.overridden_at) {
            return override.final_score;
        }

        let aiScore = null;
        if (aiEval.pronunciation_score !== undefined && aiEval.pronunciation_score !== null) {
            if (aiEval.fluency_score !== undefined && aiEval.fluency_score !== null) {
                aiScore = Math.round((Number(aiEval.pronunciation_score) + Number(aiEval.fluency_score)) / 2);
            } else {
                aiScore = Number(aiEval.pronunciation_score);
            }
        }

        if (p.final_authority === 'ai_auto') {
            return aiScore;
        }

        if (override.final_score !== undefined && override.final_score !== null) {
            return override.final_score;
        }

        return aiScore;
    }

    function isFinalized(policy, rawData, status) {
        const p = policy ? policy : DEFAULT_POLICY;
        const raw = rawData ? rawData : {};
        const override = raw.teacher_override ? raw.teacher_override : {};

        if (override.overridden_at) return true;
        if (p.final_authority === 'ai_auto' && (status === 'ai_ready' || status === 'graded')) return true;
        return status === 'graded' && override.overridden_at;
    }

    function studentScoreDisclaimer(policy, rawData, status) {
        const p = policy ? policy : DEFAULT_POLICY;
        const raw = rawData ? rawData : {};
        const override = raw.teacher_override ? raw.teacher_override : {};

        if (p.final_authority !== 'human_confirm') return '';
        if (override.overridden_at) return '';
        if (status === 'ai_ready' || status === 'graded') {
            if (!override.overridden_at) {
                return '可能非最終成績';
            }
        }
        return '';
    }

    function providerLabel(aiEval) {
        if (!aiEval) return '';
        const provider = aiEval.grading_provider ? String(aiEval.grading_provider) : '';
        if (provider === 'gemini_fallback') {
            return '⚠️ 非首選引擎（Gemini）評分，建議人工覆核';
        }
        if (provider === 'speechace') return 'Speechace 語音引擎';
        if (provider === 'azure') return 'Azure 語音引擎';
        return '';
    }

    return {
        ALL_STAFF_ROLES: ALL_STAFF_ROLES,
        DEFAULT_POLICY: DEFAULT_POLICY,
        parsePolicy: parsePolicy,
        buildPolicyFromForm: buildPolicyFromForm,
        roleCanOverride: roleCanOverride,
        roleCanPublish: roleCanPublish,
        resolveEffectiveScore: resolveEffectiveScore,
        isFinalized: isFinalized,
        studentScoreDisclaimer: studentScoreDisclaimer,
        providerLabel: providerLabel
    };
})();
