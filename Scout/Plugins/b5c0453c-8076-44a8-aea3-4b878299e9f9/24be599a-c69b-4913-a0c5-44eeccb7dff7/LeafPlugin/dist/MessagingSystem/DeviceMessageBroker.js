import { MessageRequest } from "LensStudio:PushToDevice";
import Event from "../Common/Event.js";
import { Logger } from "../Common/Logger.js";
import { LEAF_TOPIC, LEAF_MIME_TYPE, decodeReplyData } from "./DeviceWire.js";
const LEAF_REQUEST_TIMEOUT_MS = 120000;
// Log a persisting send failure once per this many suppressed retries.
const SEND_FAILURE_LOG_INTERVAL = 100;
const LOG = new Logger("DeviceMessageBroker");
/**
 * MessageBroker that routes Leaf messages to a lens running on a paired
 * device, via the PushToDevice IDeviceMessageBus.
 *
 * @template In - The type of incoming messages.
 * @template Out - The type of outgoing messages.
 */
export class DeviceMessageBroker {
    /**
     * @param deviceMessageBus - The device message bus (usually the sticky-lens-id
     *   decorator), or null when the PushToDevice interface is unavailable.
     */
    constructor(deviceMessageBus) {
        this.deviceMessageBus = deviceMessageBus;
        this.onMessageReceivedEvent = new Event();
        this.onMessageReceived = this.onMessageReceivedEvent.publicApi();
        /** Last logged send-failure reason; identical repeats are counted, not re-logged. */
        this.lastSendFailure = "";
        /** Consecutive failures suppressed since the last logged line. */
        this.suppressedSendFailures = 0;
    }
    notify(message) {
        if (!this.deviceMessageBus) {
            LOG.error("PushToDevice IDeviceMessageBus is unavailable: cannot execute on device.");
            return;
        }
        const lensId = this.deviceMessageBus.getActiveLensId();
        if (!lensId) {
            LOG.error("No active lens id. Pair a device and start a lens before running on device.");
            return;
        }
        const request = new MessageRequest();
        request.lensId = lensId;
        request.topic = LEAF_TOPIC;
        request.data = JSON.stringify(message);
        request.mimeType = LEAF_MIME_TYPE;
        request.timeoutMs = LEAF_REQUEST_TIMEOUT_MS;
        this.deviceMessageBus
            .sendRequest(request)
            .then((response) => {
            this.clearSendFailures();
            try {
                const parsed = JSON.parse(decodeReplyData(response.data, response.mimeType));
                this.onMessageReceivedEvent.invoke(parsed);
            }
            catch (e) {
                LOG.error(`Failed to parse device reply for ${message.type}: ${e}`);
            }
        })
            .catch((e) => {
            this.logSendFailure(message.type, e);
        });
    }
    /**
     * Log a send failure without flooding the Logger: retry loops repeat the same
     * failure every 100ms, so identical reasons are logged once and then counted,
     * with a periodic reminder while the failure persists.
     */
    logSendFailure(messageType, error) {
        const reason = String(error);
        if (reason === this.lastSendFailure) {
            this.suppressedSendFailures++;
            if (this.suppressedSendFailures % SEND_FAILURE_LOG_INTERVAL === 0) {
                LOG.error(`sendRequest for ${messageType} still failing after ${this.suppressedSendFailures} retries: ${reason}`);
            }
            return;
        }
        this.lastSendFailure = reason;
        this.suppressedSendFailures = 0;
        LOG.error(`sendRequest failed for ${messageType}: ${reason}`);
    }
    clearSendFailures() {
        if (this.suppressedSendFailures > 0) {
            LOG.info(`Device requests are succeeding again (after ${this.suppressedSendFailures} suppressed failures).`);
        }
        this.lastSendFailure = "";
        this.suppressedSendFailures = 0;
    }
}
