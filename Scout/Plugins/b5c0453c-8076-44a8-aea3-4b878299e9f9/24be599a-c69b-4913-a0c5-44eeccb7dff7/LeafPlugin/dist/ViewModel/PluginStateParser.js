/**
 * Parser for PluginState.
 */
export class PluginStateParser {
    /**
     * Parse a string as PluginState.
     * @param json - Input string to parse as PluginState
     * @returns Parsed PluginState or undefined if the string is not a valid PluginState
     */
    static parse(json) {
        let parsedJson;
        try {
            parsedJson = JSON.parse(json);
        }
        catch {
            // Malformed JSON is treated the same as an invalid format.
            return undefined;
        }
        if (!this.validatePluginStateFormat(parsedJson)) {
            return undefined;
        }
        return parsedJson;
    }
    /**
     * @param jsonData - Input object to validate as PluginState
     * @returns Whether the input matches the PluginState format
     */
    static validatePluginStateFormat(jsonData) {
        if (typeof jsonData !== "object" || jsonData === null) {
            return false;
        }
        const state = jsonData;
        if (!Array.isArray(state.sessions) || !state.defaultConfigs) {
            return false;
        }
        return (state.sessions.every((s) => this.validateSessionFormat(s)) &&
            this.validateDefaultConfigFormat(state.defaultConfigs));
    }
    /**
     * @param input - Input object to validate as Session
     * @returns True if the input matches the Session format, false otherwise
     */
    static validateSessionFormat(input) {
        if (typeof input !== "object" || !input) {
            return false;
        }
        const session = input;
        if (typeof session.name !== "string" || !Array.isArray(session.scenarios)) {
            return false;
        }
        return session.scenarios.every((scenario) => this.validateScenarioFormat(scenario));
    }
    /**
     * @param input - Input object to validate as Scenario
     * @returns True if the input matches the Scenario format, false otherwise
     */
    static validateScenarioFormat(input) {
        if (typeof input !== "object" || !input) {
            return false;
        }
        const scenario = input;
        if (typeof scenario.id !== "string" || !scenario.config) {
            return false;
        }
        return this.validateConfigFormat(scenario.config);
    }
    /**
     * @param input - Input object to validate as defaultConfigs (Record<string, Record<string, string>>)
     * @returns True if the input matches the defaultConfigs format, false otherwise
     */
    static validateDefaultConfigFormat(input) {
        if (typeof input !== "object" || !input || Array.isArray(input)) {
            return false;
        }
        return Object.values(input).every((cfg) => this.validateConfigFormat(cfg));
    }
    /**
     * @param input - Input object to validate as config (Record<string, string>)
     * @returns True if the input matches the config format, false otherwise
     */
    static validateConfigFormat(input) {
        if (typeof input !== "object" || !input || Array.isArray(input)) {
            return false;
        }
        return Object.entries(input).every(([key, value]) => typeof key === "string" && typeof value === "string");
    }
}
