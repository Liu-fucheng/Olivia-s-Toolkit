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
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

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
        toastr.info("正在检查插件更新...", "更新插件");
        
        // 调用系统的更新函数，需要使用完整的第三方扩展名称
        await updateExtension(`${extensionName}`, false);
        
    } catch (error) {
        console.error('Update failed:', error);
        toastr.error('更新失败: ' + error.message, "更新错误");
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
});
