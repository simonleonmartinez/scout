/**
 * @param type - Declared parameter type, or undefined for an untyped key.
 * @returns The fixed set of allowed values, or empty for free-form text.
 */
export function allowedValues(type) {
    return (type === null || type === void 0 ? void 0 : type.type) === "enum" ? type.options : [];
}
/**
 * Filter and extend a config to contain exactly the same keys as the template config.
 * Missing values are filled with the values from the template config.
 * @param config - The configuration to filter and extend.
 * @param templateConfig - The template configuration for the ScenarioModel.
 * @returns The normalized configuration.
 */
export function resolveConfig(config, templateConfig) {
    /*
     * Template defaults first so a newly declared parameter shows up with its
     * default, then everything from config, so parameters the user added in the
     * panel survive. Keeping only keys present in the template deleted them on
     * the next scenario-list refresh, which is every run.
     */
    return { ...templateConfig, ...config };
}
