/**
 * MessageCenter is a class that manages message subscriptions and notifications.
 * It allows different parts of the Lens and Plugin to communicate by subscribing to specific message types
 * and receiving notifications when those messages are posted.
 * @template In - The type of incoming messages from the MessageBroker.
 * @template Out - The type of outgoing messages to the MessageBroker.
 */
export class MessagePublisher {
    constructor(messageBroker) {
        this.messageBroker = messageBroker;
        this.registeredCallbacks = {};
        messageBroker.onMessageReceived.add((message) => {
            this.process(message);
        });
    }
    /**
     * Subscribes to a specific message type and registers a callback to be invoked
     * when a message of that type is posted.
     * @param messageType - The message type string (e.g., "RunScenarioMessage")
     * @param listenerCb - The callback function to be invoked when a message of the specified type is posted.
     */
    subscribe(messageType, listenerCb) {
        if (!this.registeredCallbacks[messageType]) {
            this.registeredCallbacks[messageType] = [];
        }
        this.registeredCallbacks[messageType].push(listenerCb);
        return () => {
            var _a;
            this.registeredCallbacks[messageType] = (_a = this.registeredCallbacks[messageType]) === null || _a === void 0 ? void 0 : _a.filter((cb) => cb !== listenerCb);
        };
    }
    /**
     * Processes a message object by checking its type and notifying the appropriate subscribers.
     * Used by the {@link MessageService} to handle incoming messages.
     * @param messageObject - An object representing a message, which must have a "type" property.
     * @returns
     */
    process(message) {
        var _a;
        (_a = this.registeredCallbacks[message.type]) === null || _a === void 0 ? void 0 : _a.forEach((cb) => {
            cb === null || cb === void 0 ? void 0 : cb(message);
        });
    }
    notify(message) {
        this.messageBroker.notify(message);
    }
}
