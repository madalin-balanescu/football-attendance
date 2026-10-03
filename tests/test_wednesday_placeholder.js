const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { buildAppDocument, flush, loadScript } = require("./frontend_harness");

const workerSource = fs.readFileSync(path.join(__dirname, "..", "static", "service-worker.js"), "utf8");

async function offlineNavigation(pathname) {
  const listeners = {};
  const requestedCaches = [];
  const notice = { page: "Wednesday WhatsApp notice" };
  const friday = { page: "Friday signup" };
  const context = {
    self: { addEventListener(type, handler) { listeners[type] = handler; } },
    URL,
    Promise,
    Request: class { constructor(request) { this.url = request.url; } },
    fetch: async () => { throw new Error("Offline"); },
    caches: {
      async match(request) {
        requestedCaches.push(request);
        return request === "/wednesday-placeholder.html" ? notice : request === "/" ? friday : undefined;
      },
    },
  };
  vm.runInNewContext(workerSource, context);
  let pending;
  listeners.fetch({
    request: { method: "GET", mode: "navigate", url: `https://fotbal.example${pathname}` },
    respondWith(promise) { pending = promise; },
  });
  return { response: await pending, notice, friday, requestedCaches };
}

test("offline Wednesday routes, aliases, and bookmarks show the WhatsApp notice", async () => {
  for (const pathname of ["/miercuri", "/miercuri/", "/miercuri?source=bookmark", "/wednesday", "/wednesday/", "/wednesday/?source=bookmark"]) {
    const { response, notice, requestedCaches } = await offlineNavigation(pathname);
    assert.equal(response, notice);
    assert.deepEqual(requestedCaches, ["/wednesday-placeholder.html"]);
  }
});

test("offline Friday navigation keeps its existing signup-page fallback", async () => {
  const { response, friday, requestedCaches } = await offlineNavigation("/?source=bookmark");
  assert.equal(response, friday);
  assert.equal(requestedCaches.includes("/wednesday-placeholder.html"), false);
});

test("the Wednesday notice displays without fetching attendance or requiring service-worker support", async () => {
  const { requests } = loadScript("wednesday-placeholder.js", buildAppDocument(), [], { navigator: {} });
  await flush();
  assert.equal(requests.length, 0);
});

test("the Wednesday notice registers the updated offline shell and survives a registration error", async () => {
  const registered = [];
  const listeners = {};
  const serviceWorker = {
    controller: {},
    addEventListener(type, listener) { listeners[type] = listener; },
    register(url) { registered.push(url); return Promise.reject(new Error("Unavailable")); },
  };
  const { requests, context } = loadScript("wednesday-placeholder.js", buildAppDocument(), [], { navigator: { serviceWorker } });
  await flush();
  assert.deepEqual(registered, ["/service-worker.js"]);
  assert.equal(requests.length, 0);
  let reloads = 0;
  context.window.location.reload = () => { reloads += 1; };
  listeners.controllerchange();
  listeners.controllerchange();
  assert.equal(reloads, 1);
});
