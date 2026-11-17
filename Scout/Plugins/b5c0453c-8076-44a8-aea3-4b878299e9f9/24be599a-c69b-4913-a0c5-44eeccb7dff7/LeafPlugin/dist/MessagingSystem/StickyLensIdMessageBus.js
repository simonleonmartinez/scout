import { MessageRequest } from "LensStudio:PushToDevice";
import { LEAF_TOPIC, LEAF_MIME_TYPE, parseDeviceReply } from "./DeviceWire.js";
/**
 * Decorator around {@link IDeviceMessageBus} that keeps serving the last
 * non-empty activeLensId while a device is connected but the underlying value
 * reads "". Works around a PushToDevice bug where the main-thread lens-id mirror
 * can stay "" after a USB reconnect even though a lens is running; the id still
 * routes requests, and liveness is unaffected (proven by an answered request,
 * never activeLensId). Suppressed while no device is connected, so "" still
 * means "no lens".
 */
export class StickyLensIdMessageBus {
    /**
     * @param bus - The wrapped PushToDevice message bus.
     * @param isDeviceConnected - Whether a device is connected now.
     */
    constructor(bus, isDeviceConnected) {
        this.bus = bus;
        this.isDeviceConnected = isDeviceConnected;
        /** Last non-empty lens id observed from the wrapped bus. */
        this.lastKnownLensId = "";
    }
    getActiveLensId() {
        let lensId = "";
        try {
            lensId = this.bus.activeLensId();
        }
        catch {
            // Facade can throw across a reconnect; treat as "" so the fallback applies.
        }
        if (lensId) {
            this.lastKnownLensId = lensId;
            return lensId;
        }
        return this.isDeviceConnected() ? this.lastKnownLensId : "";
    }
    sendRequest(request) {
        return this.bus.sendRequest(request);
    }
    async sendLeafRequest(payload, timeoutMs) {
        const request = new MessageRequest();
        request.lensId = this.getActiveLensId();
        request.topic = LEAF_TOPIC;
        request.data = JSON.stringify(payload);
        request.mimeType = LEAF_MIME_TYPE;
        request.timeoutMs = timeoutMs;
        const response = await this.bus.sendRequest(request);
        return parseDeviceReply(response.data, response.mimeType, payload.type);
    }
    waitForLensReady(lensId, timeoutMs) {
        return this.bus.waitForLensReady(lensId, timeoutMs);
    }
    sendMessage(message) {
        this.bus.sendMessage(message);
    }
}
