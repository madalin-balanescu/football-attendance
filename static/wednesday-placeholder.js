if ("serviceWorker" in navigator) {
  if (navigator.serviceWorker.controller) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }
  navigator.serviceWorker.register("/service-worker.js").catch(() => {
    // The notice remains visible when offline support is unavailable.
  });
}
