var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
import { resolveConfig } from "../Common/Typing.js";
import { ObservableScenarioModel } from "./ObservableScenarioModel.js";
import { bindProperty } from "../Common/ObservableProperty.js";
/**
 * Model representing a single scenario within a session.
 */
let ScenarioModel = (() => {
    var _a;
    let _id_decorators;
    let _id_initializers = [];
    let _id_extraInitializers = [];
    let _config_decorators;
    let _config_initializers = [];
    let _config_extraInitializers = [];
    return _a = class ScenarioModel {
            constructor(id, config) {
                this.observable = new ObservableScenarioModel();
                this.id = __runInitializers(this, _id_initializers, "");
                this.config = (__runInitializers(this, _id_extraInitializers), __runInitializers(this, _config_initializers, {}));
                __runInitializers(this, _config_extraInitializers);
                this.id = id;
                this.config = config;
            }
            /**
             * Create a ScenarioModel from a JSON object.
             * @param json - The JSON object to create the ScenarioModel from.
             * @param defaultConfig - The default configuration for the ScenarioModel.
             * @returns The initialized ScenarioModel.
             */
            static deserialize(json, defaultConfig) {
                const config = resolveConfig({ ...json.config }, defaultConfig);
                return new _a(json.id, config);
            }
            /**
             * Update the config to be consistent with the new default config.
             * @param newDefaultConfig - The new default configuration for the ScenarioModel.
             */
            changeDefaultConfig(newDefaultConfig) {
                const filteredConfig = resolveConfig(this.config, newDefaultConfig);
                this.setConfig(filteredConfig);
            }
            /**
             * Convert the ScenarioModel to a JSON object.
             * @returns The JSON object representing the ScenarioModel.
             */
            toJSON() {
                return {
                    id: this.id,
                    config: this.config,
                };
            }
            /**
             * Delete a key from the config of the ScenarioModel.
             * @param key - The key to delete from the config.
             */
            deleteConfigKey(key) {
                delete this.config[key];
            }
            /**
             * Set the id of the ScenarioModel.
             * @param id - The new id for the ScenarioModel.
             * @param config - The new config for the ScenarioModel.
             */
            setId(id, config) {
                this.id = id;
                this.config = config;
            }
            /**
             * Set the config of the ScenarioModel.
             * @param config - The new config for the ScenarioModel.
             */
            setConfig(config) {
                this.config = config;
            }
        },
        (() => {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            _id_decorators = [bindProperty];
            _config_decorators = [bindProperty];
            __esDecorate(null, null, _id_decorators, { kind: "field", name: "id", static: false, private: false, access: { has: obj => "id" in obj, get: obj => obj.id, set: (obj, value) => { obj.id = value; } }, metadata: _metadata }, _id_initializers, _id_extraInitializers);
            __esDecorate(null, null, _config_decorators, { kind: "field", name: "config", static: false, private: false, access: { has: obj => "config" in obj, get: obj => obj.config, set: (obj, value) => { obj.config = value; } }, metadata: _metadata }, _config_initializers, _config_extraInitializers);
            if (_metadata) Object.defineProperty(_a, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        })(),
        _a;
})();
export { ScenarioModel };
