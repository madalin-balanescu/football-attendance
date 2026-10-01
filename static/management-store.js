(() => {
  const key = "football-attendance:management-links";
  const fallbackKey = `${key}:tab-fallback`;
  const pathPattern = /^\/inscriere\/[A-Za-z0-9_-]{43,128}$/;
  let memoryLinks = [];
  let memoryOnly = false;
  let mode = "local";
  let removedPaths = new Set();

  function parseLinks(value) {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error("Invalid saved registrations");
    const seen = new Set();
    return parsed.filter((entry) => {
      if (!pathPattern.test(entry?.path || "") || seen.has(entry.path)) return false;
      seen.add(entry.path);
      return true;
    }).map(({ path, eventKey, savedAt }) => ({ path, eventKey, savedAt }));
  }

  function read() {
    if (memoryOnly) return [...memoryLinks];
    let localLinks = null;
    try {
      localLinks = parseLinks(window.localStorage.getItem(key) || "[]");
    } catch {
      // Keep trying the tab fallback without losing in-memory links.
    }
    try {
      const value = window.sessionStorage.getItem(fallbackKey);
      if (value !== null) {
        const fallback = JSON.parse(value);
        const links = parseLinks(JSON.stringify(fallback.links));
        removedPaths = new Set((fallback.removedPaths || []).filter((path) => pathPattern.test(path)));
        // Merge new submissions from other tabs while keeping expired links removed.
        memoryLinks = parseLinks(JSON.stringify([...links, ...(localLinks || [])]))
          .filter((entry) => !removedPaths.has(entry.path));
        mode = "session";
        return [...memoryLinks];
      }
    } catch {
      // Local storage or the current page can still provide saved registrations.
    }
    if (localLinks !== null) {
      memoryLinks = localLinks;
      removedPaths.clear();
      mode = "local";
      return [...memoryLinks];
    }
    mode = "memory";
    return [...memoryLinks];
  }

  function write(links, removals = []) {
    memoryLinks = links;
    removals.forEach((path) => removedPaths.add(path));
    links.forEach((entry) => removedPaths.delete(entry.path));
    const serialized = JSON.stringify(links);
    try {
      window.localStorage.setItem(key, serialized);
      mode = "local";
      memoryOnly = false;
      removedPaths.clear();
      try {
        window.sessionStorage.removeItem(fallbackKey);
      } catch {
        // The persistent copy has already been saved.
      }
      return;
    } catch {
      // Tab storage survives reloads and navigation when local storage is blocked.
    }
    try {
      window.sessionStorage.setItem(fallbackKey, JSON.stringify({ links, removedPaths: [...removedPaths] }));
      mode = "session";
      memoryOnly = false;
    } catch {
      mode = "memory";
      memoryOnly = true;
    }
  }

  function save(path, eventKey) {
    if (!pathPattern.test(path)) return;
    const links = read().filter((entry) => entry.path !== path);
    links.unshift({ path, eventKey, savedAt: new Date().toISOString() });
    write(links);
  }

  function remove(paths) {
    const removed = new Set(paths);
    write(read().filter((entry) => !removed.has(entry.path)), [...removed]);
  }

  function storageMessage() {
    if (mode === "session") {
      return "Înscrierile sunt păstrate doar în această filă. Copiază linkurile private înainte de a o închide.";
    }
    if (mode === "memory") {
      return "Browserul nu permite salvarea înscrierilor. Copiază fiecare link privat înainte de a părăsi sau reîncărca pagina.";
    }
    return "Înscrierile sunt salvate în acest browser. Le poți gestiona după reîncărcare sau după trecerea de la Wi-Fi la date mobile.";
  }

  window.footballManagementStore = {
    key, read, save, remove, storageMessage,
    get mode() { return mode; },
  };
})();
