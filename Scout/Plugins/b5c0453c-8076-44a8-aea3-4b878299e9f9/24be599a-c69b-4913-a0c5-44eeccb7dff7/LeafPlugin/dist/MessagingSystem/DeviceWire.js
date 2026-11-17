/**
 * Wire-level facts about LEAF's device channel, shared by every sender of a
 * LEAF request over `IDeviceMessageBus`. Pure (no LensStudio imports) so the
 * modules that build on it stay unit-testable in node.
 */
/*
 * Routing keys agreed with the lens-side DeviceMessageReceiver, which filters
 * inbound MessageEvents by topic.
 */
export const LEAF_TOPIC = "leaf";
export const LEAF_MIME_TYPE = "application/json";
/*
 * The lens replies via the "stringified-js" transport regardless of request
 * mime. For LEAF's plain-JSON data it wraps valid JSON as an eval-able `(<expr>)`,
 * so we strip the wrapper before JSON.parse.
 */
const STRINGIFIED_JS_MIME_TYPE = "application/vnd.snap.stringified-js";
/** Unwrap a device reply payload into parseable JSON (see the transport note above). */
export function decodeReplyData(data, mimeType) {
    if (mimeType === STRINGIFIED_JS_MIME_TYPE) {
        const trimmed = data.trim();
        if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
            return trimmed.slice(1, -1);
        }
    }
    return data;
}
/**
 * Decode and parse a device reply, naming the request and quoting the payload
 * on failure — a bare SyntaxError says nothing about which exchange broke.
 */
export function parseDeviceReply(data, mimeType, requestType) {
    const decoded = decodeReplyData(data, mimeType);
    try {
        return JSON.parse(decoded);
    }
    catch (error) {
        throw new Error(`Device reply to "${requestType}" was not JSON (${mimeType}): ${decoded.slice(0, 200)}`);
    }
}
