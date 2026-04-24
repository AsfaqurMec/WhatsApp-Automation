const statusBanner = document.getElementById("statusBanner");
const statusText = document.getElementById("statusText");
const statusLoader = document.getElementById("statusLoader");
const qrSection = document.getElementById("qrSection");
const qrImage = document.getElementById("qrImage");
const configForm = document.getElementById("configForm");
const popup = document.getElementById("popup");
const popupMessage = document.getElementById("popupMessage");
const closePopup = document.getElementById("closePopup");
const connectWhatsappBtn = document.getElementById("connectWhatsappBtn");
const disconnectWhatsappBtn = document.getElementById("disconnectWhatsappBtn");
const confirmPopup = document.getElementById("confirmPopup");
const confirmDisconnectBtn = document.getElementById("confirmDisconnectBtn");
const cancelDisconnectBtn = document.getElementById("cancelDisconnectBtn");
const connectionDetails = document.getElementById("connectionDetails");
const detailWhatsapp = document.getElementById("detailWhatsapp");
const detailGroupName = document.getElementById("detailGroupName");
const detailDriveFolderId = document.getElementById("detailDriveFolderId");
const detailWatcher = document.getElementById("detailWatcher");

let isConnected = false;

function showPopup(message) {
  popupMessage.textContent = message;
  popup.classList.remove("hidden");
}

function hidePopup() {
  popup.classList.add("hidden");
}

function showDisconnectConfirm() {
  confirmPopup.classList.remove("hidden");
}

function hideDisconnectConfirm() {
  confirmPopup.classList.add("hidden");
}

function setStatus(text, showLoader = false) {
  statusText.textContent = text;
  statusLoader.classList.toggle("hidden", !showLoader);
  statusLoader.setAttribute("aria-hidden", String(!showLoader));
  statusBanner.setAttribute("aria-busy", String(showLoader));
}

function updateUi(status) {
  isConnected = status.connected;
  const isFullyConfigured = Boolean(status.fullyConfigured);

  if (status.connected) {
    if (isFullyConfigured) {
      setStatus("Connected: WhatsApp and Drive watcher are fully established.");
    } else {
      setStatus("WhatsApp connected. Fill details to establish full connection.");
    }
    qrSection.classList.add("hidden");
    configForm.classList.remove("hidden");
    connectWhatsappBtn.classList.add("hidden");
    disconnectWhatsappBtn.classList.remove("hidden");
  } else {
    if (status.connecting) {
      setStatus("Connecting... scan the QR code to connect WhatsApp.", true);
    } else {
      setStatus('WhatsApp disconnected. Click "Connect WhatsApp" to generate QR.');
    }
    configForm.classList.add("hidden");
    disconnectWhatsappBtn.classList.add("hidden");
    connectWhatsappBtn.classList.remove("hidden");
    if (status.qrCodeDataUrl) {
      qrImage.src = status.qrCodeDataUrl;
      qrSection.classList.remove("hidden");
    } else {
      qrSection.classList.add("hidden");
    }
  }

  detailWhatsapp.textContent = status.connected ? "Connected" : "Not connected";
  detailGroupName.textContent = status.whatsappGroupName || "Not configured";
  detailDriveFolderId.textContent = status.driveFolderId || "Not configured";
  detailWatcher.textContent =
    status.watcherRunning && isFullyConfigured ? "Running" : "Not running";

  if (status.connected) {
    connectionDetails.classList.remove("hidden");
  } else {
    connectionDetails.classList.add("hidden");
  }

  const groupNameInput = document.getElementById("groupName");
  const driveFolderInput = document.getElementById("driveFolderId");
  if (status.whatsappGroupName && !groupNameInput.value) {
    groupNameInput.value = status.whatsappGroupName;
  }
  if (status.driveFolderId && !driveFolderInput.value) {
    driveFolderInput.value = status.driveFolderId;
  }
}

async function callJsonApi(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Request failed.");
  }
  return data;
}

async function fetchStatus() {
  try {
    const response = await fetch("/api/whatsapp/status");
    const data = await response.json();
    updateUi(data);
  } catch (error) {
    setStatus("Unable to fetch WhatsApp status.");
  }
}

configForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isConnected) {
    showPopup("Please connect WhatsApp first.");
    return;
  }

  const submitButton = configForm.querySelector("button");
  submitButton.disabled = true;

  try {
    const formData = new FormData(configForm);
    const response = await fetch("/api/connections", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        groupName: formData.get("groupName"),
        driveFolderId: formData.get("driveFolderId"),
      }),
    });
    const data = await response.json();
    showPopup(data.message || "Connection request completed.");
    await fetchStatus();
  } catch (error) {
    showPopup("Failed to establish connection.");
  } finally {
    submitButton.disabled = false;
  }
});

connectWhatsappBtn.addEventListener("click", async () => {
  connectWhatsappBtn.disabled = true;
  try {
    const data = await callJsonApi("/api/whatsapp/connect", { method: "POST" });
    showPopup(data.message || "WhatsApp connection started.");
    await fetchStatus();
  } catch (error) {
    showPopup(error.message || "Failed to connect WhatsApp.");
  } finally {
    connectWhatsappBtn.disabled = false;
  }
});

disconnectWhatsappBtn.addEventListener("click", () => {
  showDisconnectConfirm();
});

confirmDisconnectBtn.addEventListener("click", async () => {
  confirmDisconnectBtn.disabled = true;
  cancelDisconnectBtn.disabled = true;
  try {
    const data = await callJsonApi("/api/whatsapp/disconnect", { method: "POST" });
    showPopup(data.message || "WhatsApp disconnected.");
    await fetchStatus();
  } catch (error) {
    showPopup(error.message || "Failed to disconnect WhatsApp.");
  } finally {
    hideDisconnectConfirm();
    confirmDisconnectBtn.disabled = false;
    cancelDisconnectBtn.disabled = false;
  }
});

cancelDisconnectBtn.addEventListener("click", hideDisconnectConfirm);

closePopup.addEventListener("click", hidePopup);
popup.addEventListener("click", (event) => {
  if (event.target === popup) {
    hidePopup();
  }
});

confirmPopup.addEventListener("click", (event) => {
  if (event.target === confirmPopup) {
    hideDisconnectConfirm();
  }
});

fetchStatus();
setInterval(fetchStatus, 3000);
