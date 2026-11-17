import { Logger } from "../Common/Logger";
import { DefaultFileSystemHandler } from "../FileSystemHandler/DefaultFileSystemHandler";
const LOG = new Logger("DefaultSettingsRepository");
export class DefaultSettingsRepository {
    constructor(settingsFilePath, defaultSettings, fileSystemHandler = new DefaultFileSystemHandler()) {
        this.settingsFilePath = settingsFilePath;
        this.defaultSettings = defaultSettings;
        this.fileSystemHandler = fileSystemHandler;
        this.sessionFilePath = new Editor.Path(this.defaultSettings.fileDialogOpeningPath);
        this.jsonIndentation = this.defaultSettings.jsonIndentation;
        this.executeOnDevice = this.defaultSettings.executeOnDevice;
        this.load();
        this.save();
    }
    /** @override */
    setSessionsFilePath(path) {
        this.sessionFilePath = path;
        this.save();
    }
    /** @override */
    getSessionsFilePath() {
        return this.sessionFilePath;
    }
    /** @override */
    getjsonIndentation() {
        return this.jsonIndentation;
    }
    /** @override */
    getExecuteOnDevice() {
        return this.executeOnDevice;
    }
    /** @override */
    setExecuteOnDevice(executeOnDevice) {
        this.executeOnDevice = executeOnDevice;
        this.save();
    }
    /** @override */
    load() {
        let settings = { ...this.defaultSettings };
        if (this.fileSystemHandler.exists(this.settingsFilePath)) {
            LOG.info(`Loading settings from "${this.settingsFilePath}"`);
            const fileContents = this.fileSystemHandler.readFile(this.settingsFilePath);
            try {
                settings = { ...settings, ...JSON.parse(fileContents) };
            }
            catch (e) {
                LOG.warn(`Failed to parse settings, falling back to defaults: ${e}`);
            }
        }
        this.sessionFilePath = new Editor.Path(settings.fileDialogOpeningPath);
        this.jsonIndentation = settings.jsonIndentation;
        this.executeOnDevice = settings.executeOnDevice;
    }
    /** @override */
    save() {
        const settings = {
            fileDialogOpeningPath: this.sessionFilePath.toString(),
            jsonIndentation: this.jsonIndentation,
            executeOnDevice: this.executeOnDevice,
        };
        this.fileSystemHandler.writeFile(this.settingsFilePath, JSON.stringify(settings, null, this.jsonIndentation));
    }
}
