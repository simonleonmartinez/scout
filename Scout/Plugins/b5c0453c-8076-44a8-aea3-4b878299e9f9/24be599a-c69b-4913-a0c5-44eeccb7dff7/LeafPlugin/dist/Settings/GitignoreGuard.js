import { Logger } from "../Common/Logger";
import { DefaultFileSystemHandler } from "../FileSystemHandler/DefaultFileSystemHandler";
const LOG = new Logger("GitignoreGuard");
/** File name of the project's .gitignore. */
const GITIGNORE_FILE_NAME = new Editor.Path(".gitignore");
/**
 * Comment marking the LEAF-managed section of the .gitignore. Kept stable so
 * the block is only ever appended once.
 */
const LEAF_SECTION_HEADER = "# Added by Lens Studio (LEAF plugin)";
/**
 * Ensures per-user LEAF plugin files are gitignored in the project.
 *
 * These files (e.g. the plugin settings) contain machine-specific absolute
 * paths and are regenerated on every plugin launch, so they must never be
 * committed. This mirrors the convention already used in the project
 * .gitignore by the Agents-Docs plugin: machine-local config is dropped in the
 * project root and ignored via a marked section.
 */
export class GitignoreGuard {
    /**
     * @param projectDirectory - The Lens Studio project root.
     * @param entries - File names (relative to the project root) to ignore.
     * @param fileSystemHandler - {@link FileSystemHandler} for file operations. Exposed for testing.
     */
    constructor(projectDirectory, entries, fileSystemHandler = new DefaultFileSystemHandler()) {
        this.entries = entries;
        this.fileSystemHandler = fileSystemHandler;
        this.gitignorePath = projectDirectory.appended(GITIGNORE_FILE_NAME);
    }
    /**
     * Append any missing entries to the project .gitignore under the LEAF
     * section, creating the file if it does not exist. Idempotent: entries
     * already present anywhere in the file are left untouched, and a
     * write failure is logged rather than blocking plugin startup.
     */
    ensureIgnored() {
        try {
            const existing = this.fileSystemHandler.exists(this.gitignorePath)
                ? this.fileSystemHandler.readFile(this.gitignorePath)
                : "";
            const ignored = new Set(existing.split("\n").map((line) => line.trim()));
            const missing = this.entries.filter((entry) => !ignored.has(entry));
            if (missing.length === 0) {
                return;
            }
            // Separate the LEAF section from any preceding content with a blank line,
            // and ensure the preceding content ends on its own line first.
            const prefix = existing.length === 0
                ? ""
                : existing.endsWith("\n")
                    ? "\n"
                    : "\n\n";
            const block = `${prefix}${LEAF_SECTION_HEADER}\n${missing.join("\n")}\n`;
            this.fileSystemHandler.writeFile(this.gitignorePath, existing + block);
            LOG.info(`Added to "${this.gitignorePath}": ${missing.join(", ")}`);
        }
        catch (e) {
            LOG.warn(`Failed to update .gitignore: ${e}`);
        }
    }
}
