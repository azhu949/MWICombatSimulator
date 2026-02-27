const api = {
    registerFunctions(functionMap) {
        for (const [name, fn] of Object.entries(functionMap)) {
            this[name] = fn;
            Object.defineProperty(globalThis, name, {
                configurable: true,
                enumerable: true,
                writable: true,
                value: fn,
            });
        }
    },
};

Object.defineProperty(globalThis, "api", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: api,
});

export default api;
