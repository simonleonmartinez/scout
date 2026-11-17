import { Logger } from "../Common/Logger";
import { JSON_INTENDATION } from "./PluginViewModel";
const LOG = new Logger("FileWriter");
export class FileWriter {
    constructor(fileSystemHandler) {
        this.fileSystemHandler = fileSystemHandler;
    }
    /**
     * Export the current state to JSON file by adding/updating a "leaf" entry.
     * @param filePath - The file path to export to
     * @param pluginModelState - The current state of the plugin to be saved
     */
    saveToFile(filePath, pluginModelState) {
        if (filePath.isEmpty) {
            LOG.error(`Error exporting file: Empty file path received.`);
            return;
        }
        try {
            this.fileSystemHandler.writeFile(filePath, JSON.stringify(pluginModelState, null, JSON_INTENDATION));
        }
        catch (error) {
            LOG.error(`Error writing file to ${filePath.toString()}: ${error}`);
        }
    }
}
