export var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 1] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 2] = "INFO";
    LogLevel[LogLevel["WARN"] = 3] = "WARN";
    LogLevel[LogLevel["ERROR"] = 4] = "ERROR";
})(LogLevel || (LogLevel = {}));
const LEAF_PLUGIN_PREFIX = "LeafPlugin";
export class Logger {
    constructor(tag) {
        this.tag = tag;
    }
    /**
     * Prints message, with debug prefix
     * @param msg - message to print
     */
    debug(msg) {
        this.log(LogLevel.DEBUG, msg);
    }
    /**
     * Prints message, with info prefix
     * @param msg - message to print
     */
    info(msg) {
        this.log(LogLevel.INFO, msg);
    }
    /**
     * Prints message, with warn prefix
     * @param msg - message to print
     */
    warn(msg) {
        this.log(LogLevel.WARN, msg);
    }
    /**
     * Prints message, with error prefix
     * @param msg - message to print
     */
    error(msg) {
        this.log(LogLevel.ERROR, msg);
    }
    /**
     * Prints message, formatted as [LeafPlugin][prefix][tag] msg
     * to the console
     * @param level - log level
     * @param msg - message to print
     */
    log(level, msg) {
        if (level < Logger.logLevel)
            return;
        const formatted = `[${LEAF_PLUGIN_PREFIX}][${this.tag}] ${msg}`;
        switch (level) {
            case LogLevel.ERROR:
                console.error(formatted);
                break;
            case LogLevel.WARN:
                console.warn(formatted);
                break;
            case LogLevel.INFO:
                console.info(formatted);
                break;
            case LogLevel.DEBUG:
                console.debug(formatted);
                break;
        }
    }
}
Logger.logLevel = LogLevel.INFO;
