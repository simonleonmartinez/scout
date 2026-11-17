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
import { createRandomizedSessionId } from "../Common/Identifiers.js";
import { ObservablePluginModel } from "./ObservablePluginModel.js";
import { SessionModel } from "./SessionModel.js";
import { bindProperty } from "../Common/ObservableProperty.js";
/**
 * Manages the state of the Leaf plugin, storing separate sessions
 * with their own scenarios.
 */
let PluginModel = (() => {
    var _a;
    let _sessions_decorators;
    let _sessions_initializers = [];
    let _sessions_extraInitializers = [];
    let _defaultConfigs_decorators;
    let _defaultConfigs_initializers = [];
    let _defaultConfigs_extraInitializers = [];
    let _availableParameterTypes_decorators;
    let _availableParameterTypes_initializers = [];
    let _availableParameterTypes_extraInitializers = [];
    return _a = class PluginModel {
            /**
             * Custom JSON serialization method. Will be automatically called by JSON.stringify().
             * @returns The current state of the plugin serialized as {@link PluginState}.
             */
            toJSON() {
                return {
                    sessions: this.sessions
                        .map((s) => { var _b; return (_b = this.findSessionModel(s)) === null || _b === void 0 ? void 0 : _b.serialize(); })
                        .filter((s) => s !== undefined),
                    defaultConfigs: this.defaultConfigs,
                };
            }
            /**
             * Replaces the default configs with the provided scenarios.
             * Expects the full scenario list.
             * @param scenarios - Scenarios to extract default configs from.
             */
            setDefaultConfigs(scenarios) {
                var _b;
                const newDefaultConfigs = {};
                const newParameterTypes = {};
                for (const scenario of scenarios) {
                    newDefaultConfigs[scenario.id] = { ...scenario.config };
                    newParameterTypes[scenario.id] = Object.fromEntries(Object.entries((_b = scenario.parameterTypes) !== null && _b !== void 0 ? _b : {}).map(([key, type]) => [
                        key,
                        type.type === "enum" ? { ...type, options: [...type.options] } : type,
                    ]));
                }
                /* Types first: @bindProperty notifies synchronously, and the
                   defaultConfigs subscribers read availableParameterTypes while they run. */
                this.availableParameterTypes = newParameterTypes;
                this.defaultConfigs = newDefaultConfigs;
            }
            /**
             * Adds a new session with an empty scenario array.
             */
            createSession() {
                const sessionName = createRandomizedSessionId();
                const newSession = new SessionModel(this.observable.defaultConfigs, sessionName);
                this.sessionModels.push(newSession);
                this.sessions = this.sessionModels.map((s) => s.observable);
                return newSession.observable;
            }
            /**
             * Removes a session by its index.
             * @param sessionIdx - index of the session to remove
             */
            deleteSession(sessionObservable) {
                var _b;
                (_b = this.findSessionModel(sessionObservable)) === null || _b === void 0 ? void 0 : _b.deleteAllScenarios();
                this.sessionModels = this.sessionModels.filter((model) => model.observable !== sessionObservable);
                this.sessions = this.sessionModels.map((model) => model.observable);
            }
            /**
             * Load sessions from an array of SessionModels.
             * @param sessionModels - Array of SessionModels to load
             */
            loadSessions(pluginState) {
                this.sessionModels.forEach((session) => {
                    this.deleteSession(session.observable);
                });
                this.sessionModels = [];
                /* The live lens owns defaultConfigs; unavailable saved rows keep their original configuration. */
                for (const sessionJson of pluginState.sessions) {
                    const sessionModel = SessionModel.deserialize(sessionJson, this.observable.defaultConfigs);
                    this.sessionModels.push(sessionModel);
                }
                this.sessions = this.sessionModels.map((s) => s.observable);
            }
            /**
             * Set the name of a session.
             * @param sessionObservable - The observable of the session to set the name for.
             * @param name - The new name for the session.
             */
            setSessionName(sessionObservable, name) {
                var _b;
                (_b = this.findSessionModel(sessionObservable)) === null || _b === void 0 ? void 0 : _b.setName(name);
            }
            /**
             * Adds a new scenario to a given session.
             * @param sessionObservable - The observable of the session to add the scenario to.
             * @param id - The ID of the scenario to add.
             * @returns The observable of the new scenario.
             */
            addScenario(sessionObservable, id) {
                var _b;
                const scenarioObservable = (_b = this.findSessionModel(sessionObservable)) === null || _b === void 0 ? void 0 : _b.addScenario(id);
                if (!scenarioObservable) {
                    throw new Error(`Error adding scenario ${id} to session ${sessionObservable.name.value()}`);
                }
                return scenarioObservable;
            }
            /**
             * Remove a scenario from a session.
             * @param scenarioObservable - The observable of the scenario to remove.
             */
            removeScenario(scenarioObservable) {
                var _b;
                (_b = this.findSessionModelForScenario(scenarioObservable)) === null || _b === void 0 ? void 0 : _b.removeScenario(scenarioObservable);
            }
            /**
             * Set the ID of a scenario.
             * @param scenarioObservable - The observable of the scenario to set the ID for.
             * @param scenarioId - The new ID for the scenario.
             */
            setScenarioId(scenarioObservable, scenarioId) {
                var _b;
                (_b = this.findScenarioModel(scenarioObservable)) === null || _b === void 0 ? void 0 : _b.setId(scenarioId, this.defaultConfigs[scenarioId] || {});
            }
            /**
             * Set the config of a scenario.
             * @param scenarioObservable - The observable of the scenario to set the config for.
             * @param config - The new config for the scenario.
             */
            setScenarioConfig(scenarioObservable, config) {
                var _b;
                (_b = this.findScenarioModel(scenarioObservable)) === null || _b === void 0 ? void 0 : _b.setConfig(config);
            }
            /**
             * Find the session model for a given session.
             * @param observableSession - The observable of the session to find the model for.
             * @returns The session model for the session.
             */
            findSessionModel(observableSession) {
                return this.sessionModels.find((model) => model.observable === observableSession);
            }
            /**
             * Find the session model for a given scenario.
             * @param observableScenario - The observable of the scenario to find the session for.
             * @returns The session model for the scenario.
             */
            findSessionModelForScenario(observableScenario) {
                return this.sessionModels.find((sessionModel) => sessionModel.observable.scenarios.value().includes(observableScenario));
            }
            findScenarioModel(observableScenario) {
                const session = this.findSessionModelForScenario(observableScenario);
                if (!session) {
                    throw new Error(`Cannot find session model for${observableScenario.id.value()}`);
                }
                const scenarioModel = session.findScenarioModel(observableScenario);
                if (!scenarioModel) {
                    throw new Error(`Cannot find scenario model for${observableScenario.id.value()}`);
                }
                return scenarioModel;
            }
            constructor() {
                this.observable = new ObservablePluginModel();
                this.sessions = __runInitializers(this, _sessions_initializers, []);
                this.sessionModels = (__runInitializers(this, _sessions_extraInitializers), []);
                this.defaultConfigs = __runInitializers(this, _defaultConfigs_initializers, {});
                this.availableParameterTypes = (__runInitializers(this, _defaultConfigs_extraInitializers), __runInitializers(this, _availableParameterTypes_initializers, {}
                /**
                 * Custom JSON serialization method. Will be automatically called by JSON.stringify().
                 * @returns The current state of the plugin serialized as {@link PluginState}.
                 */
                ));
                __runInitializers(this, _availableParameterTypes_extraInitializers);
            }
        },
        (() => {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            _sessions_decorators = [bindProperty];
            _defaultConfigs_decorators = [bindProperty];
            _availableParameterTypes_decorators = [bindProperty];
            __esDecorate(null, null, _sessions_decorators, { kind: "field", name: "sessions", static: false, private: false, access: { has: obj => "sessions" in obj, get: obj => obj.sessions, set: (obj, value) => { obj.sessions = value; } }, metadata: _metadata }, _sessions_initializers, _sessions_extraInitializers);
            __esDecorate(null, null, _defaultConfigs_decorators, { kind: "field", name: "defaultConfigs", static: false, private: false, access: { has: obj => "defaultConfigs" in obj, get: obj => obj.defaultConfigs, set: (obj, value) => { obj.defaultConfigs = value; } }, metadata: _metadata }, _defaultConfigs_initializers, _defaultConfigs_extraInitializers);
            __esDecorate(null, null, _availableParameterTypes_decorators, { kind: "field", name: "availableParameterTypes", static: false, private: false, access: { has: obj => "availableParameterTypes" in obj, get: obj => obj.availableParameterTypes, set: (obj, value) => { obj.availableParameterTypes = value; } }, metadata: _metadata }, _availableParameterTypes_initializers, _availableParameterTypes_extraInitializers);
            if (_metadata) Object.defineProperty(_a, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        })(),
        _a;
})();
export { PluginModel };
