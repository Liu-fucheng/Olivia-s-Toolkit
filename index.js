import {
    getBase64Async,
    getStringHash,
    saveBase64AsFile,
} from "../../../utils.js";

import {
    extension_settings,
    getContext,
    loadExtensionSettings,
} from "../../../extensions.js";

import { saveSettingsDebounced } from "../../../../script.js";

const defaultSettings = { plugin_enabled: true };

const extensionName = "Olivia-s-Toolkit";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

window.extension_settings = window.extension_settings || {};
window.extension_settings[extensionName] =
    window.extension_settings[extensionName] || {};
const extensionSettings = window.extension_settings[extensionName];

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

async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }

    $("#plugin_enable_switch").prop(
        "checked",
        extension_settings[extensionName].plugin_enabled
    );

    $("#my_button").prop(
        "disabled",
        !extension_settings[extensionName].plugin_enabled
    );
    $("#example_setting").prop(
        "disabled",
        !extension_settings[extensionName].plugin_enabled
    );

    $("#example_setting").prop(
        "checked",
        extension_settings[extensionName].example_setting
    );
}

function onExampleInput(event) {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].example_setting = value;
    saveSettingsDebounced();
}

function onButtonClick() {
    toastr.info(
        `The checkbox is ${
            extension_settings[extensionName].example_setting
                ? "checked"
                : "not checked"
        }`,
        "A popup appeared because you clicked the button!"
    );
}

let pluginEnableSwitchInitialized = false;

function onPluginEnableSwitch(event) {
    const enabled = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].plugin_enabled = enabled;
    saveSettingsDebounced?.();

    $("#my_button").prop("disabled", !enabled);
    $("#example_setting").prop("disabled", !enabled);

    if (pluginEnableSwitchInitialized) {
        if (enabled) {
            toastr.success("本地图片保存功能已开启", "提示");
        } else {
            toastr.warning("本地图片保存功能已关闭", "提示");
        }
    }
    pluginEnableSwitchInitialized = true;
}

jQuery(async () => {
    $("#plugin_enable_switch").on("input", onPluginEnableSwitch);
    $("#my_button").on("click", onButtonClick);
    $("#example_setting").on("input", onExampleInput);

    loadSettings();
});
