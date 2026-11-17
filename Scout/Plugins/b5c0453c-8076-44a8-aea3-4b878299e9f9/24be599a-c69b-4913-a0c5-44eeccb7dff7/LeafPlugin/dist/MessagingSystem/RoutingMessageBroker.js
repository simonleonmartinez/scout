import Event from "../Common/Event.js";
/**
 * MessageBroker that forwards Leaf messages to one of two backing brokers based
 * on a runtime-switchable target. Inbound messages from the inactive broker are
 * dropped.
 *
 * @template In - The type of incoming messages.
 * @template Out - The type of outgoing messages.
 */
export class RoutingMessageBroker {
    constructor(previewBroker, deviceBroker) {
        this.previewBroker = previewBroker;
        this.deviceBroker = deviceBroker;
        this.onMessageReceivedEvent = new Event();
        this.onMessageReceived = this.onMessageReceivedEvent.publicApi();
        this.target = "preview";
        this.previewBroker.onMessageReceived.add((msg) => {
            if (this.target === "preview") {
                this.onMessageReceivedEvent.invoke(msg);
            }
        });
        this.deviceBroker.onMessageReceived.add((msg) => {
            if (this.target === "device") {
                this.onMessageReceivedEvent.invoke(msg);
            }
        });
    }
    /**
     * Switch the destination for subsequent notify() calls and inbound messages.
     * @param target - The broker to route to.
     */
    setTarget(target) {
        this.target = target;
    }
    /**
     * @returns The broker messages are currently routed to.
     */
    getTarget() {
        return this.target;
    }
    notify(message) {
        const active = this.target === "preview" ? this.previewBroker : this.deviceBroker;
        active.notify(message);
    }
}
