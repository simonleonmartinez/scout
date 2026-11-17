import { ChatTool, Result } from "LensStudio:ChatTool";
import { Logger } from "./Common/Logger.js";
import { getActiveViewModel } from "./LeafToolHost.js";
import { findScriptAsset, MESSAGING_BRIDGE_SCRIPT_PATH } from "./Utils.js";
import { describeConnectedRunFailure, describeDiscoveryFailure, } from "./ViewModel/ConnectedRunService.js";
import { MAX_RUN_TIMEOUT_MS } from "./ViewModel/ConnectedRunController.js";
const MS_PER_SEC = 1000;
const LOG = new Logger("LeafChatTool");
/** Registry id of the hidden tool the built-in LEAF ChatTools call into. */
export const LEAF_BRIDGE_TOOL_ID = "leaf_plugin_bridge";
/** Bridge protocol version. Bump it on any incompatible request or reply change. */
export const LEAF_BRIDGE_PROTOCOL = 1;
const LEAF_PANEL_DESCRIPTOR_ID = "com.snap.leaf.LeafPlugin";
/**
 * The C++ binding for LensStudio:ChatTool expects an actual Result instance.
 * Returning a plain `{data, error}` object trips the snap::async coroutine in
 * McpHttpServer::handleToolsCall and surfaces as "Last trigger of unfinished
 * task is lost". Always build the return value through this helper.
 */
function toResult(data, error) {
    const result = new Result();
    result.data = data;
    result.error = error;
    return result;
}
/** `panelOpen: false` tells the built-in LEAF ChatTools to open the panel and retry. */
function missingPanelError() {
    return toResult({ panelOpen: false }, "LEAF panel is not open. Open the LEAF plugin panel in Lens Studio (Window → LEAF) before invoking this tool.");
}
function isOnDeviceValue(value) {
    return (typeof value === "boolean" ||
        value === "true" ||
        value === "false" ||
        value === 0 ||
        value === 1);
}
function parseOnDeviceArg(viewModel, onDevice) {
    if (onDevice === undefined)
        return undefined;
    if (!isOnDeviceValue(onDevice)) {
        throw new Error(`onDevice must be a boolean (received ${typeof onDevice}: ${JSON.stringify(onDevice)})`);
    }
    const enabled = onDevice === true || onDevice === "true" || onDevice === 1;
    if (enabled && !viewModel.isDeviceMessagingAvailable()) {
        throw new Error("Cannot execute on device: the PushToDevice interface is not available in this Lens Studio build.");
    }
    return enabled;
}
/** Apply the per-call target for tools that do not own a Scenario run. */
function applyOnDeviceArg(viewModel, onDevice) {
    try {
        const enabled = parseOnDeviceArg(viewModel, onDevice);
        if (enabled !== undefined)
            viewModel.setExecuteOnDevice(enabled);
    }
    catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    return undefined;
}
function parseStringOverrides(value) {
    if (!value || typeof value !== "object")
        return {};
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (typeof v !== "string") {
            throw new Error(`Override "${k}" must be a string`);
        }
        out[k] = v;
    }
    return out;
}
/** run_leaf_scenario: runs a Scenario or Ensemble by id via the active panel's ViewModel. */
async function runScenario(args) {
    var _a;
    const { scenarioId, timeoutSeconds } = args;
    if (typeof scenarioId !== "string" || scenarioId.length === 0) {
        return toResult({}, "scenarioId is required and must be a non-empty string");
    }
    const viewModel = getActiveViewModel();
    if (!viewModel)
        return missingPanelError();
    try {
        const overrides = parseStringOverrides(args.parameters);
        if (timeoutSeconds !== undefined &&
            (typeof timeoutSeconds !== "number" ||
                (timeoutSeconds !== -1 &&
                    (!Number.isFinite(timeoutSeconds * MS_PER_SEC) ||
                        timeoutSeconds <= 0 ||
                        timeoutSeconds * MS_PER_SEC > MAX_RUN_TIMEOUT_MS)))) {
            return toResult({}, `timeoutSeconds must be -1 or a positive, finite number up to ${MAX_RUN_TIMEOUT_MS / MS_PER_SEC}`);
        }
        const result = await viewModel.runScenarioById(scenarioId, overrides, {
            timeoutMs: timeoutSeconds === undefined
                ? undefined
                : timeoutSeconds === -1
                    ? -1
                    : timeoutSeconds * MS_PER_SEC,
            onDevice: parseOnDeviceArg(viewModel, args.onDevice),
        });
        const connected = result.connectedRun;
        return toResult({
            scenarioId,
            status: result.status,
            target: viewModel.getExecutionTarget(),
            ...(connected
                ? {
                    runId: connected.runId,
                    ok: connected.ok,
                    participants: connected.participants,
                    error: (_a = connected.error) !== null && _a !== void 0 ? _a : "",
                }
                : {}),
        }, connected && !connected.ok
            ? `ConnectedRun "${scenarioId}" failed (${connected.runId}): ${describeConnectedRunFailure(connected)}`
            : "");
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        LOG.error(`run_leaf_scenario failed: ${message}`);
        return toResult({ scenarioId, status: "failed" }, message);
    }
}
/** list_leaf_scenarios: lists scenarios registered by the active panel's lens. */
async function listScenarios(args) {
    const viewModel = getActiveViewModel();
    if (!viewModel)
        return missingPanelError();
    const onDeviceError = applyOnDeviceArg(viewModel, args.onDevice);
    if (onDeviceError)
        return toResult({}, onDeviceError);
    try {
        // In device mode this pushes the lens if none is running and loads its list.
        const discovery = await viewModel.ensureTargetReady();
        return toResult({
            scenarios: viewModel.listAvailableScenarios().map((scenario) => {
                var _a;
                const roles = discovery.kind === "answered"
                    ? (_a = discovery.ensembles.find((ensemble) => ensemble.id === scenario.id)) === null || _a === void 0 ? void 0 : _a.roles
                    : undefined;
                return roles ? { ...scenario, roles } : scenario;
            }),
            ensembleDiscovery: discovery.kind,
            ...(discovery.kind === "answered"
                ? {}
                : {
                    warning: discovery.kind === "no-preview"
                        ? "Ensembles are not listed because no Preview panel is open. Ordinary Scenario discovery succeeded."
                        : `Ordinary Scenarios are listed; Ensembles could not be included. ${describeDiscoveryFailure(discovery)}`,
                }),
            target: viewModel.getExecutionTarget(),
        }, "");
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        LOG.error(`list_leaf_scenarios failed: ${message}`);
        return toResult({}, message);
    }
}
/** set_leaf_execution_target: switches execution between the preview and the device. */
async function setExecutionTarget(args) {
    const viewModel = getActiveViewModel();
    if (!viewModel)
        return missingPanelError();
    if (args.onDevice === undefined) {
        return toResult({}, "onDevice is required and must be a boolean");
    }
    const onDeviceError = applyOnDeviceArg(viewModel, args.onDevice);
    if (onDeviceError)
        return toResult({}, onDeviceError);
    return toResult({
        executeOnDevice: viewModel.getExecuteOnDevice(),
        target: viewModel.getExecutionTarget(),
    }, "");
}
/** push_leaf_lens: pushes the current lens to the paired device. */
async function pushLens() {
    const viewModel = getActiveViewModel();
    if (!viewModel)
        return missingPanelError();
    try {
        await viewModel.pushLens();
        return toResult({ pushed: true, target: viewModel.getExecutionTarget() }, "");
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        LOG.error(`push_leaf_lens failed: ${message}`);
        return toResult({ pushed: false }, message);
    }
}
/**
 * open_leaf_panel: opens the LEAF panel in the current dock. Runs in this
 * module because pluginSystem.create() rejects plugins from other modules.
 */
async function openPanel(_args, pluginSystem) {
    const dockManager = pluginSystem.findInterface(Editor.Dock.IDockManager);
    if (!dockManager) {
        return toResult({}, "Dock manager interface unavailable");
    }
    const panelDescriptor = pluginSystem.descriptors.find((d) => d.id === LEAF_PANEL_DESCRIPTOR_ID);
    if (!panelDescriptor) {
        return toResult({}, "LEAF panel descriptor not registered");
    }
    try {
        let existing = dockManager.findPanel(LEAF_PANEL_DESCRIPTOR_ID);
        let created = false;
        if (!existing) {
            const panel = pluginSystem.create(panelDescriptor);
            dockManager.add(panel);
            existing = panel;
            created = true;
        }
        dockManager.activate(existing);
        return toResult({ opened: true, created }, "");
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        /* Lens Studio keeps the first plugin loaded with a given id, so an older LEAF copy can own the panel. */
        if (message.includes("loaded in a different module")) {
            return toResult({ opened: false }, "The LEAF panel belongs to another copy of the LEAF plugin. Remove the older copy in Plugin Manager, then restart Lens Studio.");
        }
        LOG.error(`open_leaf_panel failed: ${message}`);
        return toResult({ opened: false }, message);
    }
}
function isLeafPackageInstalled(pluginSystem) {
    const model = pluginSystem.findInterface(Editor.Model.IModel);
    return (findScriptAsset(model.project.assetManager, MESSAGING_BRIDGE_SCRIPT_PATH) !== undefined);
}
/** leaf_status: reports the panel and LEAF package state without opening anything. */
async function status(_args, pluginSystem) {
    const panelOpen = getActiveViewModel() !== null;
    const leafPackageInstalled = isLeafPackageInstalled(pluginSystem);
    const nextStep = !leafPackageInstalled
        ? "Add the LEAF package to the project from the Lens Studio Asset Library."
        : !panelOpen
            ? "The LEAF panel opens on the next LEAF tool call, or call open_leaf_panel."
            : undefined;
    return toResult({
        protocol: LEAF_BRIDGE_PROTOCOL,
        panelOpen,
        leafPackageInstalled,
        ...(nextStep ? { nextStep } : {}),
    }, "");
}
const TOOL_HANDLERS = new Map([
    ["run_leaf_scenario", runScenario],
    ["list_leaf_scenarios", listScenarios],
    ["set_leaf_execution_target", setExecutionTarget],
    ["push_leaf_lens", pushLens],
    ["open_leaf_panel", openPanel],
    ["leaf_status", status],
]);
const BRIDGE_SCHEMA = {
    name: LEAF_BRIDGE_TOOL_ID,
    displayName: "LEAF Tool Bridge",
    modelDescription: "Internal transport for the built-in LEAF ChatTools. Do not call it directly: " +
        "use run_leaf_scenario, list_leaf_scenarios and the other LEAF tools instead.",
    // Hidden from MCP clients. In-editor assistants still list it, hence the description.
    notForMcp: true,
    inputSchema: {
        type: "object",
        properties: {
            protocol: { type: "number", description: "Bridge protocol version." },
            tool: {
                type: "string",
                description: "Public LEAF tool name.",
            },
            args: { type: "object", description: "Arguments of the public LEAF tool." },
        },
        required: ["protocol", "tool"],
    },
};
/**
 * Hidden ChatTool that runs the LEAF tools for the built-in LEAF ChatTools
 * plugin, which forwards each public tool call here through
 * `IChatToolRegistry.execute()`. Requests are `{protocol, tool, args}`.
 */
export class LeafBridgeTool extends ChatTool {
    static descriptor() {
        return {
            // Editor enforces id === schema.name for ChatTool descriptors.
            id: BRIDGE_SCHEMA.name,
            name: "LEAF Tool Bridge",
            description: "Runs LEAF tools on behalf of the built-in LEAF ChatTools.",
            schema: BRIDGE_SCHEMA,
            // IDockManager is Gui-tagged; declaring it grants the Gui capability open_leaf_panel needs.
            dependencies: [Editor.Dock.IDockManager, Editor.Model.IModel],
        };
    }
    async execute(parameters) {
        var _a;
        const request = ((_a = parameters.data) !== null && _a !== void 0 ? _a : {});
        if (request.protocol !== LEAF_BRIDGE_PROTOCOL) {
            return toResult({ protocol: LEAF_BRIDGE_PROTOCOL }, `Unsupported LEAF bridge protocol ${JSON.stringify(request.protocol)}. This LEAF plugin speaks protocol ${LEAF_BRIDGE_PROTOCOL}.`);
        }
        const handler = typeof request.tool === "string"
            ? TOOL_HANDLERS.get(request.tool)
            : undefined;
        if (!handler) {
            return toResult({ unknownTool: true }, `Unknown LEAF tool ${JSON.stringify(request.tool)}`);
        }
        const args = request.args && typeof request.args === "object"
            ? request.args
            : {};
        return handler(args, this.pluginSystem);
    }
}
