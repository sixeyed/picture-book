(() => {
  const grid = document.querySelector("ul.grid");
  if (!grid) return;
  const items = [...grid.querySelectorAll("a.thumb")].map((a) => ({
    web: a.getAttribute("href"),
    full: a.dataset.full,
    stem: a.dataset.stem,
    alt: a.querySelector("img")?.alt ?? "",
    el: a,
  }));
  if (items.length === 0) return;
  const allowDownload = grid.dataset.download === "true";
  let current = -1;

  const wrap = (i) => ((i % items.length) + items.length) % items.length;

  function buildDialog() {
    const dialog = document.createElement("dialog");
    dialog.className = "lightbox";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "✕";

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "prev";
    prevBtn.setAttribute("aria-label", "Previous image");
    prevBtn.textContent = "‹";

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "next";
    nextBtn.setAttribute("aria-label", "Next image");
    nextBtn.textContent = "›";

    const img = document.createElement("img");
    img.draggable = false;

    const footer = document.createElement("footer");
    const counter = document.createElement("span");
    counter.className = "counter";
    footer.appendChild(counter);

    let downloadLink = null;
    if (allowDownload) {
      downloadLink = document.createElement("a");
      downloadLink.className = "download";
      downloadLink.setAttribute("download", "");
      downloadLink.textContent = "Full resolution";
      footer.appendChild(downloadLink);
    }

    dialog.append(closeBtn, prevBtn, img, nextBtn, footer);
    document.body.appendChild(dialog);

    return { dialog, img, counter, downloadLink, closeBtn, prevBtn, nextBtn };
  }

  const { dialog, img, counter, downloadLink, closeBtn, prevBtn, nextBtn } = buildDialog();

  function preload(i) {
    new Image().src = items[wrap(i)].web;
  }

  function show(i) {
    current = wrap(i);
    const item = items[current];
    dialog.setAttribute("data-loading", "");
    img.alt = item.alt;
    img.src = item.web;
    counter.textContent = `${current + 1} / ${items.length}`;
    if (downloadLink) downloadLink.href = item.full;
    history.replaceState(null, "", "#" + item.stem);
    preload(current + 1);
    preload(current - 1);
  }

  function open(index) {
    dialog.showModal();
    document.body.style.overflow = "hidden";
    show(index);
  }

  img.addEventListener("load", () => {
    dialog.removeAttribute("data-loading");
  });

  items.forEach((item, i) => {
    item.el.addEventListener("click", (e) => {
      e.preventDefault();
      open(i);
    });
  });

  closeBtn.addEventListener("click", () => {
    if (consumeSwipe()) return;
    dialog.close();
  });
  prevBtn.addEventListener("click", () => {
    if (consumeSwipe()) return;
    show(current - 1);
  });
  nextBtn.addEventListener("click", () => {
    if (consumeSwipe()) return;
    show(current + 1);
  });
  img.addEventListener("click", () => {
    if (consumeSwipe()) return;
    show(current + 1);
  });

  dialog.addEventListener("click", (e) => {
    if (e.target !== dialog) return;
    if (consumeSwipe()) return;
    dialog.close();
  });

  dialog.addEventListener("keydown", (e) => {
    swipeHandled = false; // keyboard interaction; never suppress its clicks
    if (e.key === "ArrowRight") show(current + 1);
    else if (e.key === "ArrowLeft") show(current - 1);
  });

  dialog.addEventListener("close", () => {
    document.body.style.overflow = "";
    history.replaceState(null, "", location.pathname);
    items[current]?.el.focus();
  });

  // Swipe navigation. A touch swipe also fires a trailing click on the element
  // under the finger (pointerdown -> pointerup -> click), which would double-fire
  // the image's click-to-advance (or close via the backdrop handler) — so when a
  // qualifying swipe fires, flag it and let the click handlers consume the flag.
  let startX = 0;
  let startY = 0;
  let swipeHandled = false;
  function consumeSwipe() {
    const handled = swipeHandled;
    swipeHandled = false;
    return handled;
  }
  dialog.addEventListener("pointerdown", (e) => {
    startX = e.clientX;
    startY = e.clientY;
    swipeHandled = false;
  });
  dialog.addEventListener("pointerup", (e) => {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      swipeHandled = true;
      if (dx < 0) show(current + 1);
      else show(current - 1);
    }
  });

  if (location.hash) {
    const stem = location.hash.slice(1);
    const index = items.findIndex((item) => item.stem === stem);
    if (index !== -1) open(index);
  }
})();
