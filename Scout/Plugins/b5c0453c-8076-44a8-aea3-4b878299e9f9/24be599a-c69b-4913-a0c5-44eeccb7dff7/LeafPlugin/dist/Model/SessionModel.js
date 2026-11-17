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
import { ScenarioModel } from "./ScenarioModel";
import { ObservableSessionModel } from "./ObservableSessionModel.js";
import { bindProperty } from "../Common/ObservableProperty.js";
/**
 * Model representing a session containing multiple scenarios.
 */
let SessionModel = (() => {
    var _a;
    let _name_decorators;
    let _name_initializers = [];
    let _name_extraInitializers = [];
    let _scenarios_decorators;
    let _scenarios_initializers = [];
    let _scenarios_extraInitializers = [];
    return _a = class SessionModel {
            constructor(defaultConfigs, name = "", scenarios = []) {
                this.observable = new ObservableSessionModel();
                this.name = __runInitializers(this, _name_initializers, void 0);
                this.scenarios = (__runInitializers(this, _name_extraInitializers), __runInitializers(this, _scenarios_initializers, void 0));
                this.observableDefaultConfigs = __runInitializers(this, _scenarios_extraInitializers);
                this.scenarioModels = [];
                this.observableDefaultConfigs = defaultConfigs;
                this.name = name;
                this.scenarioModels = scenarios;
                this.scenarios = scenarios.map((s) => s.observable);
                // Update scenario model configs when default configs change
                this.observableDefaultConfigs.subscribe((newDefaultConfigs) => {
                    this.scenarioModels.forEach((model) => {
                        const config = newDefaultConfigs[model.observable.id.value()];
                        if (config)
                            model.changeDefaultConfig(config);
                    });
                });
            }
            /**
             * Get all scenario models in this session.
             * @returns An iterable of all scenario models.
             */
            getScenarioModels() {
                return this.scenarioModels.values();
            }
            /**
             * Find a scenario model by its observable.
             * @param observableScenario - The observable of the scenario to find.
             * @returns The scenario model if found, undefined otherwise.
             */
            findScenarioModel(observableScenario) {
                return this.scenarioModels.find((model) => model.observable === observableScenario);
            }
            /**
             * Create a SessionModel from a serialized Session.
             * @param serializedSession - The JSON object to create the SessionModel from.
             * @param defaultConfigs - The default configurations for scenarios.
             * @returns The initialized SessionModel.
             */
            static deserialize(serializedSession, defaultConfigs) {
                const scenarioModels = serializedSession.scenarios.map((scenarioJson) => { var _b; return ScenarioModel.deserialize(scenarioJson, (_b = defaultConfigs.value()[scenarioJson.id]) !== null && _b !== void 0 ? _b : scenarioJson.config); });
                return new _a(defaultConfigs, serializedSession.name, scenarioModels);
            }
            /**
             * Convert the SessionModel to a JSON object.
             * @returns The JSON object representing the SessionModel.
             */
            serialize() {
                return {
                    name: this.name,
                    scenarios: this.scenarios
                        .map((s) => { var _b; return (_b = this.getScenarioModel(s)) === null || _b === void 0 ? void 0 : _b.toJSON(); })
                        .filter((s) => s !== undefined),
                };
            }
            /**
             * Set the name of the SessionModel.
             * @param name - The new name for the SessionModel.
             */
            setName(name) {
                this.name = name;
            }
            /**
             * Add a scenario to the SessionModel.
             * @param scenarioId - The id of the scenario to add.
             * @param scenarioConfig - The configuration for the scenario to add.
             * @returns The observable of the new scenario.
             */
            addScenario(scenarioId, scenarioConfig = this.observableDefaultConfigs.value()[scenarioId] || {}) {
                const scenario = new ScenarioModel(scenarioId, scenarioConfig);
                this.scenarios = [...this.scenarios, scenario.observable];
                this.scenarioModels.push(scenario);
                return scenario.observable;
            }
            /**
             * Remove a scenario from the SessionModel.
             * @param scenario - The scenario to remove.
             */
            removeScenario(scenario) {
                const removeIdx = this.scenarios.indexOf(scenario);
                if (removeIdx < 0) {
                    throw new Error("Scenario not found in session.");
                }
                this.scenarioModels = this.scenarioModels.filter((model) => model.observable !== scenario);
                this.scenarios = this.scenarioModels.map((model) => model.observable);
            }
            /**
             * Delete all scenarios from the SessionModel.
             */
            deleteAllScenarios() {
                this.scenarioModels = [];
                // Left as mapping to emphasize the connection between scenarios and scenario models
                this.scenarios = this.scenarioModels.map((model) => model.observable);
            }
            getScenarioModel(observableScenario) {
                return this.scenarioModels.find((model) => model.observable === observableScenario);
            }
        },
        (() => {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            _name_decorators = [bindProperty];
            _scenarios_decorators = [bindProperty];
            __esDecorate(null, null, _name_decorators, { kind: "field", name: "name", static: false, private: false, access: { has: obj => "name" in obj, get: obj => obj.name, set: (obj, value) => { obj.name = value; } }, metadata: _metadata }, _name_initializers, _name_extraInitializers);
            __esDecorate(null, null, _scenarios_decorators, { kind: "field", name: "scenarios", static: false, private: false, access: { has: obj => "scenarios" in obj, get: obj => obj.scenarios, set: (obj, value) => { obj.scenarios = value; } }, metadata: _metadata }, _scenarios_initializers, _scenarios_extraInitializers);
            if (_metadata) Object.defineProperty(_a, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        })(),
        _a;
})();
export { SessionModel };
