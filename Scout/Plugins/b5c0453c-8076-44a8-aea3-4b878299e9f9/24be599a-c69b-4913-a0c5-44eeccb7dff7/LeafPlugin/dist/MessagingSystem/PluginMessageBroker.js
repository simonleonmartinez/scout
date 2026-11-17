import Event from "../Common/Event.js";
/**
 * PluginMessageBroker is the default implementation of the MessageBroker interface.
 * It manages message subscriptions and notifications between the Lens and Plugins.
 *
 * Resolves previews on each send, including panels opened after construction.
 *
 * Two send/receive surfaces coexist:
 * - The frozen {@link MessageBroker} interface ({@link notify} / {@link onMessageReceived})
 *   serves the legacy single-Participant path: it broadcasts to every preview
 *   and forwards every inbound reply.
 * - The panel-attributed surface ({@link postToPanel} / {@link onMessageFromPanel})
 *   serves ConnectedRuns and Ensemble discovery: they address one specific
 *   preview, and their inbound is typed to the wire's common shape so the
 *   ConnectedRun/discovery message types are not hidden behind the legacy
 *   surface's frozen `Response` typing. Correlation uses the Handle / probeId
 *   carried in the message, never panel identity.
 */
export class PluginMessageBroker {
    constructor(previewsProvider) {
        this.previewsProvider = previewsProvider;
        this.onMessageReceivedEvent = new Event();
        this.onMessageReceived = this.onMessageReceivedEvent.publicApi();
        this.onMessageFromPanelEvent = new Event();
        /** Every inbound reply, tagged with the preview it came from. */
        this.onMessageFromPanel = this.onMessageFromPanelEvent.publicApi();
        this.connections = [];
        this.destroyed = false;
        this.connectNewPreviews();
    }
    /** Attach onMessage to any preview we haven't connected to yet. Idempotent; safe to call on every notify. */
    connectNewPreviews() {
        var _a;
        const previews = (_a = this.previewsProvider()) !== null && _a !== void 0 ? _a : [];
        this.connections = this.connections.filter(({ panel, connection }) => {
            if (connection.isConnected &&
                previews.some((preview) => preview.isSame(panel)))
                return true;
            connection.disconnect();
            return false;
        });
        for (const preview of previews) {
            /* Editor enumeration creates fresh wrappers; isSame compares native identity. */
            if (this.connections.some(({ panel }) => preview.isSame(panel))) {
                continue;
            }
            const connection = preview.onMessage.connect((messageObject) => {
                const message = messageObject.data;
                // Attributed surface (ConnectedRun): fire, tagged with the sender.
                this.onMessageFromPanelEvent.invoke({
                    panel: preview,
                    message,
                });
                /* Ordinary MessageClient requests still accept the first matching preview reply. */
                this.onMessageReceivedEvent.invoke(message);
            });
            this.connections.push({ panel: preview, connection });
        }
    }
    /** Disconnect native listeners and prevent late requests from reconnecting them. */
    destroy() {
        this.destroyed = true;
        this.connections.forEach(({ connection }) => connection.disconnect());
        this.connections = [];
    }
    /**
     * Posts a message to all currently-available previews, connecting to any that
     * appeared since the last call so the channel recovers after a cold start.
     * @param message - The message to post.
     */
    notify(message) {
        var _a;
        if (this.destroyed)
            return;
        this.connectNewPreviews();
        const previews = (_a = this.previewsProvider()) !== null && _a !== void 0 ? _a : [];
        if (previews.length === 0) {
            // No preview yet (cold start); drop and let the next send retry once one appears.
            return;
        }
        previews.forEach((preview) => {
            preview.postMessage(message);
        });
    }
    /**
     * Post one message to one specific preview, regardless of the others — the
     * per-Participant counterpart of {@link notify}. Deliberately typed to the
     * wire's common shape rather than to `LeafMessages`: ConnectedRun start
     * requests, Rendezvous releases, and Ensemble-discovery probes are three
     * protocols sharing this one Transport — the lens
     * routes by `type`.
     * @param panel - The preview to post to.
     * @param message - The message to post (must carry a `type`).
     */
    postToPanel(panel, message) {
        if (this.destroyed)
            return;
        this.connectNewPreviews();
        panel.postMessage(message);
    }
}
