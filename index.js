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
            return;
        }

        const data = await response.json();

        if (data.isUpToDate) {
            if (!quiet) {
                toastr.success('扩展已是最新版本');
            }
        } else {
            toastr.success(`扩展 ${extensionName} 已更新到 ${data.shortCommitHash}`, "请刷新页面以应用更新");
        }
    } catch (error) {
        console.error('Extension update error:', error);
        toastr.error('更新失败: ' + error.message, "扩展更新错误");
    }
}

const defaultSettings = {};

const extensionName = "Olivia-s-Toolkit";
const extensionFolderPath = `extensions/third-party/${extensionName}`;

// GitHub仓库信息
const GITHUB_REPO = "Liu-fucheng/Olivia-s-Toolkit";
const GITHUB_MANIFEST_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/manifest.json`;

// 版本信息
let localVersion = "未知";
let remoteVersion = "未知";
let hasUpdate = false;

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
            localVersion = manifest.version || "未知";
            console.log(`橄榄工具箱本地版本: ${localVersion}`);
            updateVersionDisplay(); // 立即更新显示
        }
    } catch (error) {
        console.error('无法读取本地manifest.json:', error);
        localVersion = "未知";
        updateVersionDisplay(); // 即使失败也更新显示
    }
}

// 获取GitHub远程版本
async function loadRemoteVersion() {
    try {
        const response = await fetch(GITHUB_MANIFEST_URL);
        if (response.ok) {
            const manifest = await response.json();
            remoteVersion = manifest.version || "未知";
            console.log(`橄榄工具箱远程版本: ${remoteVersion}`);
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
    if (localVersion !== "未知" && remoteVersion !== "未知" && 
        localVersion !== "读取失败" && remoteVersion !== "获取失败") {
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
    
    // 始终显示当前版本
    if (currentVersionElement.length > 0) {
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

async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
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
            await updateExtension(`${extensionName}`, false);
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



jQuery(async () => {
    // 从HTML文件加载设置界面
    const settingsHtml = await $.get(`${extensionFolderPath}/index.html`);
    $("#extensions_settings").append(settingsHtml);

    // 绑定事件监听器
    $("#update_plugin_button").on("click", onUpdatePluginClick);

    // 加载设置
    loadSettings();
    
    // 加载版本信息
    await loadLocalVersion();
    
    // 异步检查远程版本（不阻塞界面加载）
    setTimeout(async () => {
        await loadRemoteVersion();
    }, 1000);
});
