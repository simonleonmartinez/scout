import { Logger } from "../Common/Logger";
import { PluginStateParser } from "./PluginStateParser";
const LOG = new Logger("FileReader");
/** Saved content could be read, but is not a valid plugin state. */
export class InvalidPluginStateError extends Error {
}
export class FileReader {
    constructor(fileSystemHandler) {
        this.fileSystemHandler = fileSystemHandler;
    }
    /**
     * Import state from JSON file, validate the format and reports errors.
     * Only returns valid PluginState or undefined if an error occurred.
     *
     * @param filePath - The file path to import from
     */
    loadFromFile(filePath) {
        if (filePath.isEmpty) {
            LOG.error(`Error importing file: Empty file path received.`);
            return;
        }
        const fileData = this.fileSystemHandler.readFile(filePath);
        return PluginStateParser.parse(fileData);
    }
}
