import * as FileSystem from "LensStudio:FileSystem";
/**
 * DefaultFileSystemHandler is the default implementation of the FileSystemHandler interface.
 * It uses the LensStudio:FileSystem module to read and write files.
 */
export class DefaultFileSystemHandler {
    /** @override */
    readFile(path) {
        return FileSystem.readFile(path);
    }
    /** @override */
    writeFile(path, data) {
        FileSystem.writeFile(path, data);
    }
    /** @override */
    exists(path) {
        return FileSystem.exists(path);
    }
}
