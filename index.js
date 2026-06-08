import {
    getBase64Async,
    getStringHash,
    saveBase64AsFile,
} from "../../../utils.js";

import {
    extension_settings,
    getContext,
    loadExtensionSettings,
    extensionTypes,
} from "../../../extensions.js";

import { saveSettingsDebounced, getRequestHeaders } from "../../../../script.js";

// =======================================================================
// localStorage 早期偏好（在 extension_settings 加载之前可读）
// =======================================================================
const OLIVIA_LS_KEY = 'olivia-toolkit-prefs';

function getLocalPrefs() {
    try { return JSON.parse(localStorage.getItem(OLIVIA_LS_KEY) || '{}'); } catch { return {}; }
}

function saveLocalPrefs(patch) {
    try {
        const current = getLocalPrefs();
        localStorage.setItem(OLIVIA_LS_KEY, JSON.stringify({ ...current, ...patch }));
    } catch {}
}

// 尽早隐藏并移除启动页 Logo 与初始化文案
function hideSplashBranding() {
    const styleId = 'olivia-hide-splash-branding';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
.splash-logo,
.splash-message {
    display: none !important;
}
`;
        (document.head || document.documentElement).appendChild(style);
    }

    const removeSplashNodes = () => {
        const splashNodes = document.querySelectorAll('.splash-logo, .splash-message');
        if (splashNodes.length === 0) return false;

        splashNodes.forEach((node) => node.remove());
        return true;
    };

    removeSplashNodes();

    let rafId = 0;

    const observer = new MutationObserver(() => {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
            rafId = 0;
            removeSplashNodes();
        });
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
}

// 读取 localStorage 早期偏好决定是否执行（默认 true，第一次加载时 localStorage 中无值同样执行）
if (getLocalPrefs().enableSplashHide !== false) {
    hideSplashBranding();
}

// 获取扩展类型的函数
function getExtensionType(externalId) {
    const id = Object.keys(extensionTypes).find(id => id === externalId || (id.startsWith('third-party') && id.endsWith(externalId)));
    return id ? extensionTypes[id] : '';
}

// 导入系统的更新函数
async function updateExtension(extensionName, quiet, timeout = null) {
    try {
        const signal = timeout ? AbortSignal.timeout(timeout) : undefined;
        const response = await fetch('/api/extensions/update', {
            method: 'POST',
            signal: signal,
            headers: getRequestHeaders(),
            body: JSON.stringify({
                extensionName,
                global: getExtensionType(extensionName) === 'global',
            }),
        });

        if (!response.ok) {
            const text = await response.text();
            toastr.error(text || response.statusText, "扩展更新失败", { timeOut: 5000 });
            console.error('Extension update failed', response.status, response.statusText, text);
            return false;
        }

        const data = await response.json();

        if (data.isUpToDate) {
            if (!quiet) {
                toastr.success('扩展已是最新版本');
            }
            return false; // 没有更新
        } else {
            toastr.success(`扩展 ${extensionName} 已更新到 ${data.shortCommitHash}`, "更新成功，即将刷新页面");
            return true; // 有更新
        }
    } catch (error) {
        console.error('Extension update error:', error);
        toastr.error('更新失败: ' + error.message, "扩展更新错误");
        return false;
    }
}

const defaultSettings = {
    backendApiPrefix: '/api/plugins/olivia-s-toolkit',
    autoProbeBackend: true,
    enableKeyboardFix: true,
    enableSplashHide: true,
};

const extensionName = "Olivia-s-Toolkit";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// GitHub仓库信息
const GITHUB_REPO = "Liu-fucheng/Olivia-s-Toolkit";
const GITHUB_MANIFEST_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/manifest.json`;

// 版本信息
let localVersion = "";
let remoteVersion = "";
let hasUpdate = false;

const backendState = {
    available: false,
    bridgeInstalled: null,
    probing: false,
};

window.extension_settings = window.extension_settings || {};
window.extension_settings[extensionName] =
    window.extension_settings[extensionName] || {};
const extensionSettings = window.extension_settings[extensionName];

/**
 * 插件提供的图片上传函数
 * @param {File} file 图片文件对象
 * @returns {Promise<{url: string}>} 返回包含图片URL的对象
 */
window.__uploadImageByPlugin = async function (file) {
    if (!file || typeof file !== "object" || !file.type.startsWith("image/")) {
        throw new Error("请选择图片文件！");
    }
    const fileBase64 = await getBase64Async(file);
    const base64Data = fileBase64.split(",")[1];
    const extension = file.type.split("/")[1] || "png";
    const fileNamePrefix = `${Date.now()}_${getStringHash(file.name)}`;
    const ctx = window.SillyTavern.getContext();
    const currentCharacterId = ctx.characterId;
    const characters = await ctx.characters;
    const character = characters[currentCharacterId];
    const characterName = character["name"];
    const imageUrl = await saveBase64AsFile(
        base64Data,
        characterName,
        fileNamePrefix,
        extension
    );

    return { url: imageUrl };
};

/**
 * 插件提供的音频上传函数
 * @param {File} file 音频文件对象
 * @returns {Promise<{url: string}>} 返回包含音频URL的对象
 */
window.__uploadFileByPlugin = async function (file) {
    if (!file || typeof file !== "object" || !file.type.startsWith("audio/")) {
        throw new Error("请选择一个音频文件！");
    }
    const fileBase64 = await getBase64Async(file);
    const base64Data = fileBase64.split(",")[1];
    const extension = file.type.split("/")[1] || "mp3";
    const fileNamePrefix = `${Date.now()}_${getStringHash(file.name)}`;
    const ctx = window.SillyTavern.getContext();
    const currentCharacterId = ctx.characterId;
    const characters = await ctx.characters;
    const character = characters[currentCharacterId];
    const characterName = character["name"];
    const fileUrl = await saveBase64AsFile(
        base64Data,
        characterName,
        fileNamePrefix,
        extension
    );

    return { url: fileUrl };
};
// =======================================================================

// 读取本地manifest.json (从本地文件 manifest.json 获取当前版本)
async function loadLocalVersion() {
    try {
        const response = await fetch(`/${extensionFolderPath}/manifest.json`);
        if (response.ok) {
            const manifest = await response.json();
            localVersion = manifest.version || "";
            if (localVersion) {
                console.log(`橄榄百宝箱本地版本: ${localVersion}`);
                updateVersionDisplay(); // 只有获取到版本才更新显示
            }
        }
    } catch (error) {
        console.error('无法读取本地manifest.json:', error);
        localVersion = "";
    }
}

// 获取GitHub远程版本
async function loadRemoteVersion() {
    try {
        const response = await fetch(GITHUB_MANIFEST_URL);
        if (response.ok) {
            const manifest = await response.json();
            remoteVersion = manifest.version || "未知";
            console.log(`橄榄百宝箱远程版本: ${remoteVersion}`);
            checkForUpdates();
        }
    } catch (error) {
        console.error('无法获取远程版本信息:', error);
        remoteVersion = "获取失败";
        // 获取失败时不显示任何内容
    }
}

// 比较版本
function checkForUpdates() {
    if (localVersion && remoteVersion) {
        hasUpdate = localVersion !== remoteVersion;
        console.log(`版本对比: 本地${localVersion} vs 远程${remoteVersion} => ${hasUpdate ? '有更新' : '无更新'}`);
    }
    updateVersionDisplay();
}

// 更新版本显示
function updateVersionDisplay() {
    const currentVersionElement = $("#current-version");
    const updateBadgeElement = $("#update-badge");
    const updateButton = $("#update_plugin_button");
    
    // 只有获取到版本信息才显示
    if (currentVersionElement.length > 0 && localVersion) {
        currentVersionElement.text(`v${localVersion}`);
    }
    
    // 只在有更新时显示徽章和改变按钮样式
    if (hasUpdate) {
        updateBadgeElement.show();
        updateBadgeElement.attr('title', `远程版本: v${remoteVersion}`);
        
        // 更新按钮样式和文本
        if (updateButton.length > 0) {
            updateButton.val(`更新到 v${remoteVersion}`);
            updateButton.css({
                'background-color': '#ff6b6b',
                'color': 'white',
                'font-weight': 'bold'
            });
            updateButton.attr('title', `发现新版本 v${remoteVersion}，点击更新`);
        }
    } else {
        updateBadgeElement.hide();
        
        // 恢复按钮原始样式
        if (updateButton.length > 0) {
            updateButton.val('检查更新');
            updateButton.css({
                'background-color': '',
                'color': '',
                'font-weight': ''
            });
            updateButton.attr('title', '检查是否有新版本');
        }
    }
}

function getToolkitSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    return extension_settings[extensionName];
}

function normalizeApiPrefix(value) {
    const raw = String(value || '').trim();
    if (!raw) return defaultSettings.backendApiPrefix;

    const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
    return withLeadingSlash.replace(/\/+$/, '');
}

function getBackendApiPrefix() {
    const settings = getToolkitSettings();
    settings.backendApiPrefix = normalizeApiPrefix(settings.backendApiPrefix);
    return settings.backendApiPrefix;
}

function getErrorMessage(error) {
    const raw = error instanceof Error ? error.message : String(error);
    const normalized = String(raw || '').trim();

    // Backend routes not mounted often return an HTML 404 page; show a clear hint instead.
    if (/<!doctype html>|<html|<body|Not found/i.test(normalized)) {
        return '接口未找到（后端插件可能未加载，请重启 SillyTavern）';
    }

    return normalized;
}

function setBackendStatus(text, tone = 'idle') {
    const status = $('#backend_status_text');
    if (status.length === 0) return;

    status.text(text);
    status.removeClass('is-ok is-error is-pending');

    if (tone === 'ok') status.addClass('is-ok');
    if (tone === 'error') status.addClass('is-error');
    if (tone === 'pending') status.addClass('is-pending');
}

function setBridgeStatus(text, tone = 'idle') {
    const status = $('#backend_bridge_status_text');
    if (status.length === 0) return;

    status.text(text);
    status.removeClass('is-ok is-error is-pending');

    if (tone === 'ok') status.addClass('is-ok');
    if (tone === 'error') status.addClass('is-error');
    if (tone === 'pending') status.addClass('is-pending');
}

function updateBackendActionButtons() {
    const installButton = $('#backend_install_bridge_button');
    const uninstallButton = $('#backend_uninstall_bridge_button');

    const backendReady = backendState.available;
    installButton.prop('disabled', !backendReady || backendState.bridgeInstalled === true);
    uninstallButton.prop('disabled', !backendReady || backendState.bridgeInstalled !== true);
}

function renderBackendSettings() {
    const settings = getToolkitSettings();
    $('#backend_api_prefix_input').val(getBackendApiPrefix());

    if (!settings.autoProbeBackend) {
        setBackendStatus('未检测（自动探测已关闭）');
    }

    updateBackendActionButtons();
}

function getBridgeInstallState(payload) {
    const status = payload?.status ?? payload;

    if (typeof status?.installed === 'boolean') return status.installed;
    if (typeof status?.enabled === 'boolean') return status.enabled;
    if (typeof status?.injected === 'boolean') return status.injected;
    if (typeof status?.present === 'boolean') return status.present;

    return null;
}

async function callBackendJson(path, body = {}, { timeoutMs = 8000 } = {}) {
    const apiPrefix = getBackendApiPrefix();
    const controller = new AbortController();
    const timeoutId = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
        const response = await fetch(`${apiPrefix}${path}`, {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(body),
            cache: 'no-store',
            signal: controller.signal,
        });

        const rawText = await response.text();
        let data = {};

        if (rawText) {
            try {
                data = JSON.parse(rawText);
            } catch {
                data = { ok: response.ok, rawText };
            }
        }

        if (!response.ok || data?.ok === false) {
            const errorMessage = data?.error || rawText || response.statusText || `HTTP ${response.status}`;
            throw new Error(errorMessage);
        }

        return data;
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new Error('请求超时，请检查后端插件是否已启用');
        }
        throw error;
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

async function refreshEarlyBridgeStatus({ silent = false } = {}) {
    if (!backendState.available) {
        setBridgeStatus('未知');
        backendState.bridgeInstalled = null;
        updateBackendActionButtons();
        return null;
    }

    setBridgeStatus('检测中...', 'pending');

    try {
        const data = await callBackendJson('/early/status', {}, { timeoutMs: 5000 });
        const installed = getBridgeInstallState(data);

        backendState.bridgeInstalled = installed;

        if (installed === true) {
            setBridgeStatus('已安装', 'ok');
        } else if (installed === false) {
            setBridgeStatus('未安装', 'error');
        } else {
            setBridgeStatus('未知');
        }

        updateBackendActionButtons();
        return data;
    } catch (error) {
        backendState.bridgeInstalled = null;
        setBridgeStatus('检测失败', 'error');
        updateBackendActionButtons();

        if (!silent) {
            toastr.error(`读取 Bridge 状态失败: ${getErrorMessage(error)}`, '后端接口错误');
        }

        return null;
    }
}

async function probeBackend({ silent = false } = {}) {
    if (backendState.probing) {
        return backendState.available;
    }

    backendState.probing = true;
    setBackendStatus('探测中...', 'pending');

    try {
        const data = await callBackendJson('/probe', {}, { timeoutMs: 5000 });
        backendState.available = true;

        const version = data?.version || data?.plugin?.version || data?.data?.version || '';
        setBackendStatus(version ? `在线 (v${version})` : '在线', 'ok');

        await refreshEarlyBridgeStatus({ silent: true });

        if (!silent) {
            toastr.success('已检测到后端插件，可启用 Early Bridge');
        }

        return true;
    } catch (error) {
        backendState.available = false;
        backendState.bridgeInstalled = null;

        setBackendStatus('离线（未检测到）', 'error');
        setBridgeStatus('未知');
        updateBackendActionButtons();

        if (!silent) {
            toastr.info(`后端不可用，当前保持前端模式: ${getErrorMessage(error)}`);
        }

        return false;
    } finally {
        backendState.probing = false;
    }
}

async function onProbeBackendClick() {
    const button = $('#probe_backend_button');
    const originalText = button.val();

    button.prop('disabled', true).val('检测中...');

    try {
        await probeBackend({ silent: false });
    } finally {
        button.val(originalText);
        updateBackendActionButtons();
    }
}

async function onInstallBridgeClick() {
    const button = $('#backend_install_bridge_button');
    const originalText = button.val();

    button.prop('disabled', true).val('安装中...');
    setBridgeStatus('安装中...', 'pending');

    try {
        await callBackendJson('/early/install', {}, { timeoutMs: 15000 });
        await refreshEarlyBridgeStatus({ silent: true });
        toastr.success('Early Bridge 已安装。建议刷新页面验证首帧效果。', '安装成功');
    } catch (error) {
        setBridgeStatus('安装失败', 'error');
        toastr.error(`Bridge 安装失败: ${getErrorMessage(error)}`, '后端接口错误');
    } finally {
        button.val(originalText);
        updateBackendActionButtons();
    }
}

async function onUninstallBridgeClick() {
    const button = $('#backend_uninstall_bridge_button');
    const originalText = button.val();

    button.prop('disabled', true).val('卸载中...');
    setBridgeStatus('卸载中...', 'pending');

    try {
        await callBackendJson('/early/uninstall', {}, { timeoutMs: 15000 });
        await refreshEarlyBridgeStatus({ silent: true });
        toastr.success('Early Bridge 已卸载。建议刷新页面确认恢复。', '卸载成功');
    } catch (error) {
        setBridgeStatus('卸载失败', 'error');
        toastr.error(`Bridge 卸载失败: ${getErrorMessage(error)}`, '后端接口错误');
    } finally {
        button.val(originalText);
        updateBackendActionButtons();
    }
}

async function onSaveBackendPrefixClick() {
    const input = $('#backend_api_prefix_input');
    const settings = getToolkitSettings();

    settings.backendApiPrefix = normalizeApiPrefix(input.val());
    input.val(settings.backendApiPrefix);
    saveSettingsDebounced();

    toastr.success('后端 API 前缀已保存');
    await probeBackend({ silent: true });
}

async function loadSettings() {
    const settings = getToolkitSettings();

    // 在应用默认值之前先记录哪些 key 用户已明确保存过
    const explicitKeyboardFix = settings.enableKeyboardFix;
    const explicitSplashHide = settings.enableSplashHide;

    for (const [key, value] of Object.entries(defaultSettings)) {
        if (settings[key] === undefined) {
            settings[key] = value;
        }
    }

    settings.backendApiPrefix = normalizeApiPrefix(settings.backendApiPrefix);
    settings.autoProbeBackend = Boolean(settings.autoProbeBackend);
    settings.enableKeyboardFix = Boolean(settings.enableKeyboardFix);
    settings.enableSplashHide = Boolean(settings.enableSplashHide);

    // 仅当用户已明确保存过该设置时才同步到 localStorage
    // 避免用默认值覆盖用户刚刚在 localStorage 写入的偏好（如刷新前来不及 debounce 写盘）
    const lsPrefs = {};
    if (explicitKeyboardFix !== undefined) lsPrefs.enableKeyboardFix = settings.enableKeyboardFix;
    if (explicitSplashHide !== undefined) lsPrefs.enableSplashHide = settings.enableSplashHide;
    if (Object.keys(lsPrefs).length > 0) saveLocalPrefs(lsPrefs);

    // 渲染 checkbox 状态
    $('#olivia_keyboard_fix_enabled').prop('checked', settings.enableKeyboardFix);
    $('#olivia_splash_hide_enabled').prop('checked', settings.enableSplashHide);

    renderBackendSettings();
}

async function onUpdatePluginClick() {
    const button = $(this);
    const icon = button.find('i');
    
    // 添加加载动画
    if (icon.length === 0) {
        button.prepend('<i class="fa-solid fa-spinner fa-spin"></i> ');
    } else {
        icon.addClass('fa-spin');
    }
    
    button.prop('disabled', true);
    
    try {
        // 如果有更新可用，执行更新
        if (hasUpdate) {
            toastr.info("正在更新插件...", "更新插件");
            const updateSuccess = await updateExtension(`${extensionName}`, false);
            
            if (updateSuccess) {
                // 更新成功，2秒后自动刷新页面
                setTimeout(() => {
                    location.reload();
                }, 2000);
                return; // 不需要恢复按钮状态，因为要刷新页面了
            }
        } else {
            // 没有更新时，重新检查版本
            toastr.info("正在检查最新版本...", "检查更新");
            await loadRemoteVersion();
            
            if (!hasUpdate) {
                toastr.success("已是最新版本！", "检查完成");
            } else {
                toastr.info("发现新版本，请再次点击更新按钮进行更新", "有更新可用");
            }
        }
        
    } catch (error) {
        console.error('Update failed:', error);
        toastr.error('操作失败: ' + error.message, "错误");
    } finally {
        // 移除加载动画
        if (icon.length > 0) {
            icon.removeClass('fa-spin');
        } else {
            button.find('i').remove();
        }
        
        button.prop('disabled', false);
    }
}

// =======================================================================
// --- V4 键盘优化：仅更新 CSS 变量，避免全局重排 ---
let _keyboardFixInitialized = false;

function resetKeyboardFix() {
    const root = document.documentElement;
    root.style.removeProperty('--olivia-keyboard-inset');
    root.classList.remove('olivia-keyboard-visible');
}

function initKeyboardLagFix() {
    if (_keyboardFixInitialized) return; // 幂等，避免重复注册监听器
    const isTouchLike = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    if (!isTouchLike) return;

    _keyboardFixInitialized = true;

    const root = document.documentElement;
    const keyboardInsetVar = '--olivia-keyboard-inset';
    let lastInset = -1;
    let rafId = 0;
    let settleTimer = 0;  // 键盘停稳后的最终吸附定时器

    const setKeyboardInset = (value) => {
        // 若设置已关闭，立即清零并退出
        if (!getToolkitSettings().enableKeyboardFix) {
            if (lastInset !== 0) {
                lastInset = 0;
                root.style.removeProperty(keyboardInsetVar);
                root.classList.remove('olivia-keyboard-visible');
            }
            return;
        }

        const inset = Math.max(0, Math.round(value));
        if (inset === lastInset) return;

        lastInset = inset;
        if (inset > 0) {
            root.style.setProperty(keyboardInsetVar, `${inset}px`);
        } else {
            root.style.removeProperty(keyboardInsetVar);
        }
        root.classList.toggle('olivia-keyboard-visible', inset > 0);
    };

    const readInsetFromViewport = () => {
        if (!window.visualViewport) return 0;
        const viewport = window.visualViewport;
        const overlap = window.innerHeight - (viewport.height + viewport.offsetTop);
        return overlap > 0 ? overlap : 0;
    };

    const syncInsetByViewport = () => {
        const newInset = readInsetFromViewport();
        // inset 增大 = 键盘弹出；inset 减小或归零 = 键盘收起
        const isOpening = newInset > Math.max(0, lastInset);

        cancelAnimationFrame(rafId);
        clearTimeout(settleTimer);
        root.classList.add('olivia-keyboard-animating'); // 动画期间禁用 CSS transition

        if (isOpening) {
            // 键盘弹出：立即应用，不启动停稳计时器，不做平滑动画
            rafId = requestAnimationFrame(() => setKeyboardInset(newInset));
            return;
        }

        // 键盘收起：80ms 停稳后恢复 transition 并做最终吸附（平滑动画）
        settleTimer = setTimeout(() => {
            root.classList.remove('olivia-keyboard-animating');
            rafId = requestAnimationFrame(() => setKeyboardInset(readInsetFromViewport()));
        }, 80);
        rafId = requestAnimationFrame(() => setKeyboardInset(newInset));
    };

    const settleAfterBlur = () => {
        // blur 后兑等一帧，作为 visualViewport 没有及时触发时的保底
        requestAnimationFrame(syncInsetByViewport);
    };

    // overlaysContent = true：键盘弹出时浏览器不缩小视口，让我们自己检测惯性并处理收起平滑动画
    if ('virtualKeyboard' in navigator) {
        try {
            navigator.virtualKeyboard.overlaysContent = true;
            // 不用 geometrychange，统一走 visualViewport.resize 保持方向检测逻辑一致
        } catch (error) {
            console.warn('橄榄百宝箱：VirtualKeyboard overlaysContent 设置失败', error);
        }
    }

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', syncInsetByViewport, { passive: true });
        window.visualViewport.addEventListener('scroll', syncInsetByViewport, { passive: true });
    }

    // 不监听 focusin，避免点击输入框时触发布局调整
    document.addEventListener('focusout', settleAfterBlur, true);

    // 点空白区域时主动 blur，可减少“点屏幕收起”时的体感延迟
    document.addEventListener('pointerdown', (event) => {
        const activeElement = document.activeElement;
        if (!(activeElement instanceof HTMLElement)) return;
        if (!activeElement.matches('input, textarea, [contenteditable=""], [contenteditable="true"]')) return;

        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return;

        activeElement.blur();
    }, { passive: true });

    syncInsetByViewport();
    console.log('橄榄百宝箱：移动端键盘优化已加载（弹出立即应用，收起平滑动画）');
}
// =======================================================================
jQuery(async () => {
    // 从HTML文件加载设置界面
    const settingsHtml = await $.get(`${extensionFolderPath}/index.html`);
    $("#extensions_settings").append(settingsHtml);

    // 绑定事件监听器
    $("#update_plugin_button").on("click", onUpdatePluginClick);
    $('#probe_backend_button').on('click', onProbeBackendClick);
    $('#backend_install_bridge_button').on('click', onInstallBridgeClick);
    $('#backend_uninstall_bridge_button').on('click', onUninstallBridgeClick);
    $('#save_backend_api_prefix_button').on('click', onSaveBackendPrefixClick);

    $('#backend_api_prefix_input').on('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            void onSaveBackendPrefixClick();
        }
    });

    // 前端功能开关
    $('#olivia_keyboard_fix_enabled').on('change', function () {
        const settings = getToolkitSettings();
        settings.enableKeyboardFix = this.checked;
        saveLocalPrefs({ enableKeyboardFix: this.checked });
        saveSettingsDebounced();

        if (this.checked) {
            // 重新初始化（若尚未初始化）或触发一次同步
            if (!_keyboardFixInitialized) {
                initKeyboardLagFix();
            }
        } else {
            // 立即清除键盘偏移状态
            resetKeyboardFix();
        }
    });

    $('#olivia_splash_hide_enabled').on('change', function () {
        const settings = getToolkitSettings();
        settings.enableSplashHide = this.checked;
        saveLocalPrefs({ enableSplashHide: this.checked });
        saveSettingsDebounced();

        if (!this.checked) {
            // 撤掉本次会话注入的隐藏 CSS，如果开屏元素还在 DOM 里可立即恢复
            const styleEl = document.getElementById('olivia-hide-splash-branding');
            if (styleEl) styleEl.remove();
            toastr.info('已关闭，刷新页面后开屏 Logo 将恢复显示', '已保存');
        } else {
            toastr.info('已开启，下次启动时生效', '已保存');
        }
    });

    // 加载设置
    await loadSettings();

    // 键盘优化：在 loadSettings 之后按设置决定是否启用
    if (getToolkitSettings().enableKeyboardFix) {
        initKeyboardLagFix();
    }

    if (getToolkitSettings().autoProbeBackend) {
        setTimeout(() => {
            void probeBackend({ silent: true });
        }, 250);
    }
    
    // 加载版本信息
    await loadLocalVersion();
    
    // 异步检查远程版本（不阻塞界面加载）
    setTimeout(async () => {
        await loadRemoteVersion();
    }, 1000);
});