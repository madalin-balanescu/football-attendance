const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.classes = new Set();
  }

  add(...tokens) {
    tokens.forEach((token) => this.classes.add(token));
  }

  remove(...tokens) {
    tokens.forEach((token) => this.classes.delete(token));
  }

  contains(token) {
    return this.classes.has(token);
  }

  toggle(token, force) {
    if (force === true) {
      this.add(token);
      return true;
    }
    if (force === false) {
      this.remove(token);
      return false;
    }
    if (this.contains(token)) {
      this.remove(token);
      return false;
    }
    this.add(token);
    return true;
  }

  toString() {
    return [...this.classes].join(" ");
  }
}

class FakeElement {
  constructor(tagName, ownerDocument, id = null) {
    this.tagName = tagName.toLowerCase();
    this.ownerDocument = ownerDocument;
    this.id = id;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.listeners = {};
    this.classList = new FakeClassList(this);
    this._textContent = "";
    this._innerHTML = "";
    this.value = "";
    this.disabled = false;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  querySelector(selector) {
    const matcher = (element) => {
      if (selector.startsWith(".")) {
        return element.classList.contains(selector.slice(1));
      }
      if (selector.startsWith("#")) {
        return element.id === selector.slice(1);
      }
      return element.tagName === selector.toLowerCase();
    };

    const stack = [...this.children];
    while (stack.length) {
      const current = stack.shift();
      if (matcher(current)) {
        return current;
      }
      stack.unshift(...current.children);
    }
    return null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "class") {
      this.className = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  cloneNode(deep = false) {
    const clone = new FakeElement(this.tagName, this.ownerDocument, this.id);
    clone.dataset = { ...this.dataset };
    clone.style = { ...this.style };
    clone.attributes = { ...this.attributes };
    clone.value = this.value;
    clone.disabled = this.disabled;
    clone.textContent = this.textContent;
    clone.innerHTML = this.innerHTML;
    this.classList.classes.forEach((token) => clone.classList.add(token));
    if (deep) {
      this.children.forEach((child) => clone.appendChild(child.cloneNode(true)));
    }
    return clone;
  }

  get textContent() {
    if (this.children.length) {
      return this.children.map((child) => child.textContent).join("");
    }
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    if (value === "") {
      this.children = [];
    }
  }

  get className() {
    return this.classList.toString();
  }

  set className(value) {
    this.classList = new FakeClassList(this);
    String(value)
      .split(/\s+/)
      .filter(Boolean)
      .forEach((token) => this.classList.add(token));
  }
}

class FakeTemplateElement extends FakeElement {
  constructor(ownerDocument, id) {
    super("template", ownerDocument, id);
    this.content = new FakeElement("fragment", ownerDocument);
  }
}

class FakeDocument {
  constructor() {
    this.elementsById = new Map();
    this.documentElement = new FakeElement("html", this);
    this.documentElement.dataset = { theme: "light" };
    this.body = new FakeElement("body", this);
  }

  register(element) {
    if (element.id) {
      this.elementsById.set(element.id, element);
    }
    return element;
  }

  getElementById(id) {
    return this.elementsById.get(id) || null;
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  querySelector(selector) {
    if (selector === ".form-controls-shell") {
      return this.getElementById("form-controls-shell");
    }
    return null;
  }
}

function makeElement(document, tagName, id, classNames = []) {
  const element =
    tagName === "template" ? new FakeTemplateElement(document, id) : new FakeElement(tagName, document, id);
  classNames.forEach((className) => element.classList.add(className));
  document.register(element);
  return element;
}

function buildAppDocument() {
  const document = new FakeDocument();
  const form = makeElement(document, "form", "attendance-form");
  makeElement(document, "input", "person1");
  makeElement(document, "input", "person2");
  const submitButton = makeElement(document, "button", "submit-button");
  const buttonLabel = new FakeElement("span", document);
  buttonLabel.classList.add("button-label");
  submitButton.appendChild(buttonLabel);
  makeElement(document, "div", "submission-overlay");
  makeElement(document, "p", "form-message");
  makeElement(document, "p", "signup-window-message", ["hidden"]);
  makeElement(document, "div", "form-controls-shell");
  makeElement(document, "div", "form-locked-overlay", ["hidden"]);
  makeElement(document, "tbody", "attendance-table-body");
  makeElement(document, "span", "week-label");
  makeElement(document, "strong", "match-date-display");
  const template = makeElement(document, "template", "empty-state-template");
  const row = new FakeElement("tr", document);
  const cell = new FakeElement("td", document);
  row.appendChild(cell);
  template.content.appendChild(row);
  makeElement(document, "h2", "signup-state-title");
  makeElement(document, "span", "signup-state-badge");
  makeElement(document, "strong", "confirmed-counter");
  makeElement(document, "strong", "spots-left-counter");
  makeElement(document, "strong", "waiting-counter");
  makeElement(document, "strong", "progress-caption");
  makeElement(document, "div", "progress-fill");
  const successPanel = makeElement(document, "div", "success-panel", ["hidden"]);
  successPanel.appendChild(new FakeElement("strong", document));
  successPanel.appendChild(new FakeElement("span", document));
  makeElement(document, "section", "admin-panel", ["hidden"]);
  makeElement(document, "form", "admin-login-form");
  makeElement(document, "input", "admin-password");
  makeElement(document, "button", "admin-login-button");
  makeElement(document, "div", "admin-actions", ["hidden"]);
  makeElement(document, "button", "force-open-button");
  makeElement(document, "button", "toggle-placeholder-button");
  makeElement(document, "button", "auto-mode-button");
  makeElement(document, "button", "clear-week-button");
  makeElement(document, "button", "clear-all-button");
  makeElement(document, "button", "admin-logout-button");
  makeElement(document, "p", "admin-message");
  makeElement(document, "th", "admin-actions-header", ["hidden"]);
  makeElement(document, "button", "admin-toggle");
  makeElement(document, "div", "admin-content", ["hidden"]);
  makeElement(document, "span", "admin-toggle-icon");
  makeElement(document, "button", "theme-toggle");
  makeElement(document, "span", "theme-toggle-label");
  makeElement(document, "svg", "theme-icon-sun", ["hidden"]);
  makeElement(document, "svg", "theme-icon-moon");
  form.reset = () => {
    document.getElementById("person1").value = "";
    document.getElementById("person2").value = "";
  };
  return document;
}

function buildTeamsDocument() {
  const document = new FakeDocument();
  makeElement(document, "tbody", "attendance-table-body");
  makeElement(document, "span", "week-label");
  makeElement(document, "strong", "match-date-display");
  const template = makeElement(document, "template", "empty-state-template");
  const row = new FakeElement("tr", document);
  const cell = new FakeElement("td", document);
  row.appendChild(cell);
  template.content.appendChild(row);
  makeElement(document, "section", "teams-board");
  makeElement(document, "div", "teams-grid");
  makeElement(document, "strong", "confirmed-counter");
  makeElement(document, "strong", "teams-counter");
  makeElement(document, "strong", "assigned-counter");
  makeElement(document, "h2", "builder-state-title");
  makeElement(document, "span", "builder-state-badge");
  makeElement(document, "section", "admin-panel", ["hidden"]);
  makeElement(document, "button", "admin-toggle");
  makeElement(document, "div", "admin-content", ["hidden"]);
  makeElement(document, "span", "admin-toggle-icon");
  makeElement(document, "form", "admin-login-form");
  makeElement(document, "input", "admin-password");
  makeElement(document, "button", "admin-login-button");
  makeElement(document, "div", "admin-actions", ["hidden"]);
  makeElement(document, "button", "admin-logout-button");
  makeElement(document, "button", "generate-teams-button");
  makeElement(document, "button", "reset-teams-button");
  makeElement(document, "p", "admin-message");
  makeElement(document, "button", "theme-toggle");
  makeElement(document, "span", "theme-toggle-label");
  makeElement(document, "svg", "theme-icon-sun", ["hidden"]);
  makeElement(document, "svg", "theme-icon-moon");
  return document;
}

function createFetchMock(responses) {
  return async (url) => {
    const next = responses.shift();
    if (!next) {
      throw new Error(`Unexpected fetch for ${url}`);
    }
    const body = next.body ?? {};
    return {
      ok: next.ok !== false,
      status: next.status ?? 200,
      async text() {
        return JSON.stringify(body);
      },
      async json() {
        return body;
      },
    };
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function loadScript(scriptName, document, responses) {
  const scriptPath = path.join(__dirname, "..", "static", scriptName);
  const source = fs.readFileSync(scriptPath, "utf8");
  const storage = new Map();
  const context = {
    document,
    window: {
      matchMedia: () => ({ matches: false }),
      clearTimeout,
      setTimeout,
    },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    fetch: createFetchMock([...responses]),
    console,
    JSON,
    Promise,
    setTimeout,
    clearTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: scriptName });
  return { context, document };
}

module.exports = {
  buildAppDocument,
  buildTeamsDocument,
  flush,
  loadScript,
};
