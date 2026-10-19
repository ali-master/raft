(() => {
  "use strict";
  document.documentElement.classList.add("js");

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let motionPaused = reducedMotion.matches;
  let artVisible = true;
  const svg = document.querySelector("#cluster-wires");
  const nodes = [...document.querySelectorAll("[data-node]")];
  const positions = [
    [312, 194.4],
    [120, 97.2],
    [498, 118.8],
    [138, 372.6],
    [468, 399.6],
  ];
  const svgNS = "http://www.w3.org/2000/svg";

  function syncMotion() {
    document.documentElement.classList.toggle("motion-paused", motionPaused);
    document.documentElement.classList.toggle("motion-enabled", !motionPaused);
    document.querySelectorAll(".motion-toggle").forEach((button) => {
      button.setAttribute("aria-pressed", String(motionPaused));
      button.setAttribute(
        "aria-label",
        motionPaused ? "Resume animations" : "Pause animations",
      );
      const icon = button.querySelector(".motion-icon");
      const label = button.querySelector(".motion-label");
      if (icon) icon.textContent = motionPaused ? "▶" : "Ⅱ";
      if (label) label.textContent = motionPaused ? "off" : "on";
    });
    const running = !motionPaused && artVisible && !document.hidden;
    document
      .querySelector("#cluster-stage")
      .style.setProperty("--art-animation", running ? "running" : "paused");
    if (!running) svg.pauseAnimations();
    else svg.unpauseAnimations();
  }

  function connectLeader(leader, announce = true) {
    const paths = document.querySelector("#wire-paths");
    const packets = document.querySelector("#wire-packets");
    paths.replaceChildren();
    packets.replaceChildren();
    nodes.forEach((node, index) => {
      const selected = index === leader;
      node.classList.toggle("is-leader", selected);
      node.setAttribute("aria-pressed", String(selected));
      const id = String(index).padStart(2, "0");
      node.setAttribute(
        "aria-label",
        selected
          ? `Node ${id}, current illustrative leader`
          : `Make node ${id} the illustrative leader`,
      );
      node.querySelector(".node-role").textContent = selected
        ? "LEADER"
        : "FOLLOWER";
      if (selected) return;
      const [x, y] = positions[leader];
      const [endX, endY] = positions[index];
      const pathData = `M${x},${y} Q${(x + endX) / 2},${(y + endY) / 2 + 38} ${endX},${endY}`;
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", pathData);
      path.setAttribute("class", "wire-path");
      paths.append(path);
      const packet = document.createElementNS(svgNS, "circle");
      packet.setAttribute("r", "2.5");
      packet.setAttribute("class", "wire-packet");
      const animation = document.createElementNS(svgNS, "animateMotion");
      animation.setAttribute("path", pathData);
      animation.setAttribute("dur", `${2.5 + index * 0.2}s`);
      animation.setAttribute("begin", "0s");
      animation.setAttribute("repeatCount", "indefinite");
      packet.append(animation);
      packets.append(packet);
    });
    if (announce)
      document.querySelector("#cluster-message").textContent =
        `Node ${String(leader).padStart(2, "0")} leads. Four members follow.`;
    syncMotion();
  }
  nodes.forEach((node, index) =>
    node.addEventListener("click", () => connectLeader(index)),
  );
  document.querySelectorAll(".motion-toggle").forEach((button) =>
    button.addEventListener("click", () => {
      motionPaused = !motionPaused;
      syncMotion();
    }),
  );
  reducedMotion.addEventListener("change", () => {
    motionPaused = reducedMotion.matches;
    syncMotion();
  });
  document.addEventListener("visibilitychange", syncMotion);
  connectLeader(0, false);

  if ("IntersectionObserver" in window) {
    const artObserver = new IntersectionObserver(([entry]) => {
      artVisible = entry.isIntersecting;
      syncMotion();
    });
    artObserver.observe(document.querySelector(".cluster-art"));
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.08 },
    );
    document
      .querySelectorAll("[data-reveal]")
      .forEach((section) => revealObserver.observe(section));
  } else {
    document
      .querySelectorAll("[data-reveal]")
      .forEach((section) => section.classList.add("is-visible"));
  }

  let scrollFrame = 0;
  function updateProgress() {
    scrollFrame = 0;
    const height = document.documentElement.scrollHeight - window.innerHeight;
    document.querySelector(".reading-progress").style.transform =
      `scaleX(${height > 0 ? Math.min(1, Math.max(0, window.scrollY / height)) : 0})`;
  }
  window.addEventListener(
    "scroll",
    () => {
      if (!scrollFrame) scrollFrame = requestAnimationFrame(updateProgress);
    },
    { passive: true },
  );
  window.addEventListener("resize", updateProgress);
  updateProgress();

  const film = document.querySelector("#observatory-film");
  const playButton = document.querySelector("#film-play");
  async function playFilm() {
    playButton.disabled = true;
    try {
      await film.play();
      film.focus();
    } catch {
      document.querySelector("#film-message").textContent =
        "Playback could not start. Use the video controls or download the film.";
      playButton.hidden = true;
    } finally {
      playButton.disabled = false;
    }
  }
  playButton.addEventListener("click", playFilm);
  film.addEventListener("play", () => {
    playButton.hidden = true;
  });
  film.addEventListener("ended", () => {
    playButton.hidden = false;
  });
  const commands = {
    playground: {
      text: "bun install --frozen-lockfile\nbun run build\nbun run --cwd packages/raft/playground dashboard",
      context: "From a cloned checkout",
      note: "Bun 1.4.3+ and Redis on localhost:6379. Then open the Observatory at localhost:3210.",
    },
    library: {
      text: "bun add @usex/raft",
      context: "Inside your TypeScript project",
      note: "Start with the core package guide to configure a node, Redis, and your application state machine.",
    },
  };
  const tabs = [...document.querySelectorAll("[data-command]")];
  const commandCode = document.querySelector("#install-command");
  const copyLabel = document.querySelector("#copy-label");
  let copyTimer;
  function selectCommand(tab) {
    const selected = commands[tab.dataset.command];
    tabs.forEach((item) => {
      item.setAttribute("aria-selected", String(item === tab));
      item.tabIndex = item === tab ? 0 : -1;
    });
    document
      .querySelector("#command-panel")
      .setAttribute("aria-labelledby", tab.id);
    commandCode.textContent = selected.text;
    document.querySelector("#command-context").textContent = selected.context;
    document.querySelector("#command-note").textContent = selected.note;
    clearTimeout(copyTimer);
    copyLabel.textContent = "Copy commands";
    document.querySelector("#copy-status").textContent = "";
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectCommand(tab));
    tab.addEventListener("keydown", (event) => {
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft")
        next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      selectCommand(tabs[next]);
      tabs[next].focus();
    });
  });
  document
    .querySelector("#copy-command")
    .addEventListener("click", async () => {
      clearTimeout(copyTimer);
      try {
        await navigator.clipboard.writeText(commandCode.textContent);
        copyLabel.textContent = "Copied";
        document.querySelector("#copy-status").textContent =
          "Commands copied to the clipboard.";
        copyTimer = setTimeout(() => {
          copyLabel.textContent = "Copy commands";
        }, 2200);
      } catch {
        copyLabel.textContent = "Select & copy";
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(commandCode);
        selection.removeAllRanges();
        selection.addRange(range);
        document.querySelector("#copy-status").textContent =
          "Clipboard access is unavailable. The commands are selected; use your keyboard to copy them.";
      }
    });
})();
