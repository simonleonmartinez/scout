import * as AssetUtils from "LensStudio:AssetUtils.js";
/** Script the plugin attaches to the scene to talk to the lens. Ships in the LEAF package. */
export const MESSAGING_BRIDGE_SCRIPT_PATH = "Leaf.lspkg/Scenarios/scenario/MessagingBridge.ts";
/**
 * Find a TypeScript script asset by its project-relative path.
 *
 * Uses {@link AssetUtils.findAsset}, which searches inside packed `.lspkg`
 * packages as well as the top-level project — so the LEAF plugin can attach
 * its bridge script whether or not Leaf.lspkg is unpacked.
 */
export function findScriptAsset(assetManager, scriptPath) {
    var _a, _b;
    const assetName = ((_a = scriptPath.split("/").pop()) !== null && _a !== void 0 ? _a : "").replace(/\.ts$/, "");
    const results = AssetUtils.findAsset(assetManager, "TypeScriptAsset", assetName);
    return (_b = results === null || results === void 0 ? void 0 : results[0]) !== null && _b !== void 0 ? _b : undefined;
}
/**
 * Instantiates a script component given a path to a script asset.
 * @param scriptPath path to the typescript file, relative to Assets/ folder
 */
export function createScriptComponentFromAsset(sceneObject, scriptAsset) {
    const scriptComponent = sceneObject.addComponent("ScriptComponent");
    scriptComponent.scriptAsset = scriptAsset;
    return scriptComponent;
}
/**
 * Retrieves all preview panels in the current workspaces.
 * @returns {IPanelPlugin[]}
 */
export function getPreviews(gui) {
    const workspaces = gui.workspaces.all;
    if (!workspaces) {
        throw new Error("No workspaces found in the GUI, cannot extract preview panels.");
    }
    const previews = workspaces
        .flatMap((workspace) => {
        return workspace.dockManager.panels;
    })
        .filter((panel) => panel && panel.isOfType("IPreviewPanel"))
        .map((panel) => panel);
    return previews;
}
