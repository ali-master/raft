import type { SwaggerCustomOptions } from "@nestjs/swagger";
import { DocumentBuilder } from "@nestjs/swagger";
import type { SwaggerUiOptions } from "@nestjs/swagger/dist/interfaces/swagger-ui-options.interface";

export class SwaggerConfigFactory {
  static createDocumentConfig() {
    return new DocumentBuilder()
      .setTitle("Raft KV Server")
      .setDescription(
        "Enterprise-grade Raft KV Server with encryption and CQRS support",
      )
      .setVersion("1.0")
      .addBearerAuth()
      .build();
  }

  static createSwaggerOptions(): SwaggerUiOptions {
    return {
      filter: true,
      tryItOutEnabled: true,
      displayOperationId: true,
      persistAuthorization: true,
      deepLinking: true,
      showExtensions: true,
      showCommonExtensions: true,
      apisSorter: false,
      tagsSorter: false,
      operationsSorter: false,
      requestSnippetsEnabled: true,
      requestSnippets: {
        generators: {
          curl_bash: {
            title: "cURL (bash)",
            syntax: "bash",
          },
        },
        defaultExpanded: false,
        languages: null,
      },
      withCredentials: true,
    };
  }

  static createSwaggerUiOptions(): SwaggerCustomOptions {
    return {
      explorer: false,
      jsonDocumentUrl: `api/docs/openapi.json`,
      yamlDocumentUrl: `api/docs/openapi.yaml`,
      customJsStr: `
console.log(
  "%cI wrote this script to handle the token persistence and authorization in Swagger UI",
  "color: #4CAF50; font-weight: bold; font-size: 14px;"
);
/**
 * **Appends Snackbar JS and CSS to the DOM** to enable toast notifications.
 */
(function appendSnackbarResources() {
  // **Create and append the Snackbar JS script**
  const script = document.createElement("script");
  script.src = "https://cdn.jsdelivr.net/npm/node-snackbar@latest/src/js/snackbar.min.js";
  script.type = "text/javascript";
  script.async = true;
  document.head.appendChild(script);

  // **Create and append the Snackbar CSS link**
  const cssLink = document.createElement("link");
  cssLink.rel = "stylesheet";
  cssLink.href = "https://cdn.jsdelivr.net/npm/node-snackbar@latest/dist/snackbar.min.css";
  document.head.appendChild(cssLink);
})();

/**
 * Copy text to the clipboard.
 * @param {string} text
 */
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(
    () => {
      showToast("Copied to clipboard!", "bottom-center");
    },
    () => {
      showToast("Failed to copy the text to clipboard.", "bottom-center");
    }
  );
}

/**
 * Display a toast message using Snackbar.
 * @param {string} text The text to display
 * @param {string} [pos="top-center"] Where to position the toast
 * @param {string} [actionText="Dismiss"] Label for the toast action
 */
function showToast(text, pos = "top-center", actionText = "Dismiss") {
  Snackbar.show({
    text,
    pos,
    duration: 10000,
    actionText
  });
}

/**
 * Calculates the on-screen intersection area (in px^2) for a given DOM element
 * to determine if and how much of the element is currently visible in the viewport.
 *
 * Formula:
 *   IntersectionArea = (VisibleWidth) x (VisibleHeight)
 *
 * @param {Element} element
 * @returns {number} Visible area in px^2
 */
function getVisibleAreaInViewport(element) {
  const rect = element.getBoundingClientRect();

  // If entirely off-screen, area is zero
  if (
    rect.bottom < 0 ||
    rect.top > window.innerHeight ||
    rect.right < 0 ||
    rect.left > window.innerWidth
  ) {
    return 0;
  }

  // Calculate the intersection with the viewport
  const visibleWidth = Math.min(rect.width, window.innerWidth - Math.max(0, rect.left));
  const visibleHeight = Math.min(rect.height, window.innerHeight - Math.max(0, rect.top));
  return Math.max(0, visibleWidth) * Math.max(0, visibleHeight);
}

/**
 * Finds the open ".opblock.opblock-post.is-open" element that is most visible
 * in the viewport. Among multiple open blocks, pick the largest intersection area.
 *
 * @returns {Element|null} The most visible open block, or null if none are visible
 */
function getMostVisibleOpenBlock() {
  const openBlocks = document.querySelectorAll(".opblock.is-open");

  let maxArea = 0;
  let mostVisibleBlock = null;

  openBlocks.forEach((block) => {
    const area = getVisibleAreaInViewport(block);
    if (area > maxArea) {
      maxArea = area;
      mostVisibleBlock = block;
    }
  });

  return mostVisibleBlock;
}

/**
 * Sets up a keyboard listener for ⌘ + Enter or Ctrl + Enter
 * to execute only the open operation block that is currently visible.
 *
 * 1. Identify a keydown event for Enter
 * 2. Check if Ctrl or Meta (Cmd) key is pressed
 * 3. Find the open block that's most visible
 * 4. Click the Execute button in that block
 */
function setupExecuteKeyboardShortcut() {
  document.addEventListener("keydown", (event) => {
    const isEnter = event.key === "Enter";
    const isCtrlOrCmd = event.ctrlKey || event.metaKey;

    if (isEnter && isCtrlOrCmd) {
      // Step 3: Find the most visible open block
      const visibleBlock = getMostVisibleOpenBlock();
      if (!visibleBlock) return;

      // Step 4: Query the Execute button within the most visible block
      const executeButton = visibleBlock.querySelector(".btn.execute.opblock-control__btn");
      if (executeButton) {
        executeButton.click();
      }
    }
  });
}

/**
 * Injects token into Swagger UI if found in localStorage
 * and patches the global fetch to handle login/logout flows.
 */
function setupTokenHandler() {
  // Make sure we have the instance of Swagger UI
  const ui = window.ui;
  if (!ui) return;

  // Load the token from localStorage and preauthorize if available
  const savedToken = localStorage.getItem("access_token");
  if (savedToken) {
    ui.preauthorizeApiKey("bearer", savedToken);
    showToast("Access token loaded from localStorage. You can now use it for API calls.");
  }

  // Save a reference to the original fetch
  const originalFetch = window.fetch;

  // Helper to calculate time elapsed in ms
  function calculateResponseTime(start) {
    return (Date.now() - start) + " ms";
  }

  // Override fetch to intercept login/logout responses
  window.fetch = async function (input, init) {
    const start = Date.now();
    const response = await originalFetch(input, init);

    // Show a toast with the request duration
    const responseTime = calculateResponseTime(start);
    showToast(\`Request duration \${responseTime}\`, "bottom-left", "Dismiss");

    // Clone the response for further inspection
    const clonedResponse = response.clone();
    let res;

    // If it’s a login call and successful, store token
    if (input.includes("/auth/login") && clonedResponse.ok) {
      res = await clonedResponse.json();
      const token = res?.payload?.accessToken;
      if (token) {
        // Persist the token
        localStorage.setItem("access_token", token);
        ui.preauthorizeApiKey("bearer", token);
        showToast("Access token saved. You can now use it for API calls.");
      }
    }
    // If it’s a logout call and successful, remove token
    else if (input.includes("/auth/logout") && clonedResponse.ok) {
      localStorage.removeItem("access_token");
      ui.preauthorizeApiKey("bearer", "");
      showToast("Access token removed. Please re-login.");
    }

    // If the response has a small payload with an \`id\`, copy it
    if (clonedResponse.ok) {
      if (!res) {
        res = await clonedResponse.json().catch(() => null);
      }
      const keysSize = res?.payload ? Object.keys(res.payload).length : 0;
      if (res?.payload?.id && keysSize <= 2) {
        copyToClipboard(res.payload.id);
      }
    }

    return response;
  };
}

/**
 * Waits for Swagger UI to be ready before setting up token handler
 * and the keyboard shortcut for executing the visible block.
 */
(function waitForSwaggerUI() {
  const checkInterval = 100; // Check every 100 ms
  const maxRetries = 50;     // Stop after 50 retries (5 seconds)

  let retries = 0;

  function checkUIInitialized() {
    if (window.ui) {
      setupTokenHandler();
      setupExecuteKeyboardShortcut();
      console.log(
        "Keyboard shortcut for Execute is now active! Press ⌘ + Enter or Ctrl + Enter to execute the operation."
      );
    } else if (retries < maxRetries) {
      retries++;
      setTimeout(checkUIInitialized, checkInterval);
    } else {
      showToast("Failed to initialize Swagger UI. Please refresh the page.");
    }
  }

  checkUIInitialized();
})();`,
      swaggerOptions: SwaggerConfigFactory.createSwaggerOptions(),
    };
  }
}
