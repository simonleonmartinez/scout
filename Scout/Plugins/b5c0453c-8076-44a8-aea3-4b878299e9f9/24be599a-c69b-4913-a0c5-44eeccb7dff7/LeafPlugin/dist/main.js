import { PanelPlugin } from "LensStudio:PanelPlugin";
import * as Ui from "LensStudio:Ui";
import * as HierarchyUtils from "LensStudio:HierarchyUtils.js";
import { createScriptComponentFromAsset, findScriptAsset, getPreviews, MESSAGING_BRIDGE_SCRIPT_PATH, } from "./Utils.js";
import { LeafPlugin } from "./LeafPlugin.js";
import { IDeviceMessageBus, IPushToDevice } from "LensStudio:PushToDevice";
import { Logger } from "./Common/Logger.js";
import { ResetSuppression } from "./Common/ResetSuppression.js";
import { setActiveViewModel } from "./LeafToolHost.js";
/* The public MCP tools live in the built-in LEAF ChatTools plugin, which calls this hidden bridge. */
export { LeafBridgeTool } from "./LeafChatTool.js";
const PLUGIN_SCENE_OBJECT_NAME = "LEAF Plugin Bridge";
const RESET_SUPPRESSION_MS = 1500;
const LOG = new Logger("LeafPluginPanel");
export class LeafPluginPanel extends PanelPlugin {
    /**
     * @param {Editor.PluginSystem} pluginSystem
     */
    constructor(pluginSystem, descriptor) {
        super(pluginSystem, descriptor);
        this.lensResetConnections = [];
        this.leafPlugin = null;
        this.scrollArea = null;
        this.resetSuppression = new ResetSuppression(RESET_SUPPRESSION_MS);
        // Flag to prevent duplicate plugin resets during async recreation
        this.isResettingPlugin = false;
        this.model = pluginSystem.findInterface(Editor.Model.IModel);
        this.assetManager = this.model.project.assetManager;
        this.scene = this.model.project.scene;
        const messagingBridge = findScriptAsset(this.assetManager, MESSAGING_BRIDGE_SCRIPT_PATH);
        if (!messagingBridge) {
            throw Error("MessagingBridge script asset not found. Please ensure the Leaf package is installed in the project's Assets folder.");
        }
        const pluginSceneObjects = HierarchyUtils.findInRootObjectsByName(this.scene, PLUGIN_SCENE_OBJECT_NAME);
        // Destroy any leaked bridge object(s) before rebuilding: reusing one would stack a second MessagingBridge component, double-running every scenario and corrupting the result protocol.
        pluginSceneObjects === null || pluginSceneObjects === void 0 ? void 0 : pluginSceneObjects.forEach((obj) => obj.destroy());
        this.pluginSceneObject = this.scene.createSceneObject(PLUGIN_SCENE_OBJECT_NAME);
        createScriptComponentFromAsset(this.pluginSceneObject, messagingBridge);
        /* Adding the bridge object reloads the preview. Rebuilding the plugin for that reset would cancel the call that opened the panel. */
        this.resetSuppression.arm(Date.now());
    }
    static descriptor() {
        return {
            id: "com.snap.leaf.LeafPlugin",
            name: "LEAF",
            description: "Plugin to run scenarios for integration testing.",
            dependencies: [Ui.IGui],
        };
    }
    /**
     * Cleans up the plugin resources.
     * Called when the plugin is closed/deinitialized.
     */
    deinit() {
        var _a;
        setActiveViewModel(null);
        this.lensResetConnections.forEach(({ connection }) => connection.disconnect());
        this.lensResetConnections = [];
        // Destroy the plugin so it saves state and releases timers before closing.
        (_a = this.leafPlugin) === null || _a === void 0 ? void 0 : _a.destroy();
        this.leafPlugin = null;
        // The native object can be destroyed while the JS reference is still set.
        if (!Editor.isNull(this.pluginSceneObject)) {
            this.pluginSceneObject.destroy();
        }
        super.deinit();
    }
    /**
     * @returns {Ui.IGui} - The GUI interface for the plugin system.
     */
    gui() {
        return this.pluginSystem.findInterface(Ui.IGui);
    }
    createWidget(parentWidget) {
        // Hold the scroll area in a local so its non-null type narrows cleanly
        // (this.scrollArea is declared `VerticalScrollArea | null` to allow
        // reassignment during plugin reset).
        const scrollArea = new Ui.VerticalScrollArea(parentWidget);
        this.scrollArea = scrollArea;
        scrollArea.setSizePolicy(Ui.SizePolicy.Policy.Preferred, Ui.SizePolicy.Policy.Preferred);
        // Create the LeafPlugin inside the scroll area (loads saved state if exists)
        this.createLeafPlugin();
        this.connectLensResetListeners();
        return scrollArea;
    }
    /**
     * Creates a new LeafPlugin instance and adds it to the scroll area.
     * Always loads saved state from the auto-save file if it exists.
     */
    createLeafPlugin() {
        if (!this.scrollArea) {
            throw new Error("Cannot create LeafPlugin: scroll area not available");
        }
        /*
         * Both interfaces are null when the PushToDevice plugin is not loaded; the
         * LEAF plugin then reports execute-on-device as unavailable and stays on
         * the preview.
         */
        const deviceMessageBus = this.pluginSystem.findInterface(IDeviceMessageBus.interfaceId);
        const pushToDevice = this.pluginSystem.findInterface(IPushToDevice.interfaceId);
        this.leafPlugin = LeafPlugin.create(this.scrollArea, this.model.project.projectDirectory, this.model.project.cacheDirectory, 
        // Lazy provider: on a cold start no preview exists yet, so the broker must query on each send rather than bind an empty snapshot.
        () => getPreviews(this.gui()), this.gui(), () => this.resetSceneFromScenario(), deviceMessageBus, pushToDevice, (needed) => this.openPreviewPanels(needed));
        setActiveViewModel(this.leafPlugin.viewModel);
    }
    /** Refresh reset subscriptions as preview panels open and close. */
    connectLensResetListeners() {
        const previews = getPreviews(this.gui());
        /* Enumeration returns fresh wrappers; isSame compares native identity. */
        this.lensResetConnections = this.lensResetConnections.filter(({ panel, connection }) => {
            if (connection.isConnected &&
                previews.some((preview) => preview.isSame(panel)))
                return true;
            connection.disconnect();
            return false;
        });
        previews.forEach((preview) => {
            if (this.lensResetConnections.some(({ panel }) => preview.isSame(panel))) {
                return;
            }
            const connection = preview.onLensReset.connect(() => this.onLensReset());
            this.lensResetConnections.push({ panel: preview, connection });
        });
    }
    /**
     * Ensure at least `needed` Preview panels are open, opening more if it can.
     * Used before a ConnectedRun, which needs one preview per Participant.
     * Best-effort: the ViewModel re-checks the count and surfaces an actionable
     * message if it is still short (e.g. the preview descriptor is unavailable).
     */
    openPreviewPanels(needed) {
        const dockManager = this.pluginSystem.findInterface(Editor.Dock.IDockManager);
        if (!dockManager) {
            return;
        }
        const previewDescriptor = this.pluginSystem.descriptors.find((d) => d.id === "Snap.Plugin.Gui.PreviewPanel");
        if (!previewDescriptor) {
            return;
        }
        const missing = needed - getPreviews(this.gui()).length;
        for (let i = 0; i < missing; i++) {
            try {
                const panel = this.pluginSystem.create(previewDescriptor);
                dockManager.add(panel);
            }
            catch (error) {
                LOG.error(`Failed to open a Preview panel: ${error}`);
                return;
            }
        }
    }
    /** Refresh previews while suppressing the reset events they emit. */
    resetSceneFromScenario() {
        this.connectLensResetListeners();
        /* onLensReset can fire synchronously during refresh. */
        this.resetSuppression.arm(Date.now());
        this.resetScene();
    }
    /** Recreate the plugin once for a reset outside the suppression window. */
    onLensReset() {
        if (this.resetSuppression.checkAndExtend(Date.now())) {
            return;
        }
        this.handlePluginReset();
    }
    /**
     * Handles plugin reset (called by manual lens reset):
     * 1. Saves the old plugin state to a file
     * 2. Destroys the old LeafPlugin instance (including ViewModel)
     * 3. Creates a new LeafPlugin instance (with new ViewModel)
     * 4. The new LeafPlugin loads the state from file
     */
    handlePluginReset() {
        // If already resetting, ignore duplicate events
        if (this.isResettingPlugin) {
            return;
        }
        if (!this.leafPlugin) {
            LOG.warn("Plugin not available for recreation");
            return;
        }
        this.isResettingPlugin = true;
        // Clear the tool singleton before destroying, so an in-flight tool call
        // cannot land on the about-to-be-destroyed ViewModel.
        setActiveViewModel(null);
        /*
         * Destroy the old LeafPlugin instance (saves state, unless it never finished
         * loading — see LeafPlugin.destroy). This guards against the follow-up
         * onLensReset events a single reset fires clobbering the saved sessions.
         */
        this.leafPlugin.destroy();
        this.leafPlugin = null;
        try {
            // Create a new LeafPlugin instance (with fresh ViewModel, loads saved state)
            this.createLeafPlugin();
        }
        finally {
            this.isResettingPlugin = false;
        }
    }
    /**
     * Resets the scene by refreshing all preview panels.
     */
    resetScene() {
        const dockManager = this.pluginSystem.findInterface(Editor.Dock.IDockManager);
        if (!dockManager) {
            LOG.error("dockManager is undefined!");
            return;
        }
        dockManager.panels.forEach((item) => {
            if (item.id == "Snap.Plugin.Gui.PreviewPanel") {
                item.refresh();
            }
        });
    }
}
