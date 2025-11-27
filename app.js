// ==================================================================
//  CONFIG: Supabase
// ==================================================================
const SUPABASE_URL = "https://hhhvjviyzevftksqsbqe.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoaHZqdml5emV2ZnRrc3FzYnFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyMzczNzEsImV4cCI6MjA3OTgxMzM3MX0.NnGI7H9nrUcPUUgW_UCD4AieOBcOHIrdHoVRp3fFL-8";
const DEVICE_ID = "esp32-local";

// Supabase client
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ==================================================================
//  DATE & TIME
// ==================================================================
function updateDateTime() {
  document.getElementById("dateTime").textContent = new Date().toLocaleString();
}
setInterval(updateDateTime, 1000);
updateDateTime();

// Optional IP display
fetch("https://api.ipify.org?format=json")
  .then(r => r.json())
  .then(j => { document.getElementById("ip").textContent = j.ip; })
  .catch(() => {});

// ==================================================================
//  GLOBAL STATE
// ==================================================================
const relayStates = { 1: false, 2: false, 3: false, 4: false };
const usageTimers = { 1: 0, 2: 0, 3: 0, 4: 0 };
const usageLimits = { 1: 12, 2: 12, 3: 12, 4: 12 };
const autoOffTimers = {};

// ==================================================================
//  RELAY CONTROL (UI + command to Supabase)
// ==================================================================
for (let i = 1; i <= 4; i++) {
  document.getElementById(`relay${i}`).addEventListener("change", (e) =>
    toggleRelay(i, e.target.checked)
  );
}

async function sendCommandToSupabase(relay, state) {
  const { error } = await supabase
    .from("esp32_commands")
    .insert({ device_id: DEVICE_ID, relay, state });
  if (error) addNotification(`Command error: ${error.message}`);
}

function toggleRelay(id, state) {
  relayStates[id] = state;
  document.getElementById(`s${id}`).textContent = state ? "ON" : "OFF";
  addNotification(`Load ${id} turned ${state ? "ON" : "OFF"}`);
  sendCommandToSupabase(id, state);
}

// ==================================================================
//  AUTO-OFF TIMER
// ==================================================================
document.querySelectorAll(".preset").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.getElementById("customMin").value = btn.dataset.min;
  });
});

document.getElementById("applyTimer").addEventListener("click", () => {
  const load = document.getElementById("loadSelect").value;
  const mins = parseInt(document.getElementById("customMin").value);
  if (!mins || mins <= 0) return alert("Enter valid minutes");

  if (autoOffTimers[load]) clearTimeout(autoOffTimers[load]);
  autoOffTimers[load] = setTimeout(() => {
    document.getElementById(`relay${load}`).checked = false;
    toggleRelay(load, false);
    addNotification(`Auto-OFF: Load ${load} OFF after ${mins} min`);
  }, mins * 60 * 1000);

  addNotification(`Timer set for Load ${load}: ${mins} min`);
});

// ==================================================================
//  DAILY LIMIT LOGIC
// ==================================================================
document.getElementById("saveLimits").addEventListener("click", () => {
  for (let i = 1; i <= 4; i++) {
    usageLimits[i] = parseFloat(document.getElementById(`limit${i}`).value);
  }
  addNotification("Usage limits updated.");
});

setInterval(() => {
  for (let i = 1; i <= 4; i++) {
    if (relayStates[i]) {
      usageTimers[i] += 2;
      const hoursUsed = usageTimers[i] / 3600;
      if (hoursUsed >= usageLimits[i]) {
        document.getElementById(`relay${i}`).checked = false;
        toggleRelay(i, false);
        addNotification(`Limit reached: Load ${i} OFF after ${usageLimits[i]} hrs`);
      }
    }
  }
}, 2000);

// ==================================================================
//  LIVE MONITORING: real-time subscription + initial fetch
// ==================================================================
function updateDashboardRow(d) {
  for (let i = 1; i <= 4; i++) {
    const v = d[`v${i}`] ?? 0;
    const c = d[`c${i}`] ?? 0;
    const p = d[`p${i}`] ?? 0;
    const e = d[`e${i}`] ?? 0;

    document.getElementById(`v${i}`).textContent = `${v}V`;
    document.getElementById(`c${i}`).textContent = `${c}A`;
    document.getElementById(`p${i}`).textContent = `${p}W`;
    document.getElementById(`e${i}`).textContent = `${e}Wh`;
    document.getElementById(`s${i}`).textContent = c > 0 ? "ON" : "OFF";
  }
  document.getElementById("tv").textContent = `${d.total_voltage ?? 0}V`;
  document.getElementById("tc").textContent = `${d.total_current ?? 0}A`;
  document.getElementById("tp").textContent = `${d.total_power ?? 0}W`;
  document.getElementById("te").textContent = `${d.total_energy ?? 0}Wh`;
}

async function fetchLatestRow() {
  const { data, error } = await supabase
    .from("esp32_data")
    .select("*")
    .eq("device_id", DEVICE_ID)
    .order("created_at", { ascending: false })
    .limit(1);
  if (!error && data && data.length) {
    updateDashboardRow(data[0]);
  }
}

function subscribeRealtimeData() {
  supabase
    .channel("esp32-data-channel")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "esp32_data", filter: `device_id=eq.${DEVICE_ID}` },
      payload => {
        updateDashboardRow(payload.new);
        addNotification("New sensor data received in real-time.");
      }
    )
    .subscribe();
}

fetchLatestRow();
subscribeRealtimeData();

// Optional: subscribe to commands to reflect confirmed relay state (if ESP32 echoes somewhere)
// supabase
//   .channel("esp32-cmd-channel")
//   .on("postgres_changes", { event: "INSERT", schema: "public", table: "esp32_commands", filter: `device_id=eq.${DEVICE_ID}` },
//     payload => addNotification(`Command queued: Relay ${payload.new.relay} -> ${payload.new.state ? "ON" : "OFF"}`))
//   .subscribe();

// ==================================================================
//  CHARTS: aggregate real data from Supabase
// ==================================================================
const filterSelect = document.getElementById("filterSelect");
const filterInputs = {
  day: document.getElementById("singleDay"),
  month: document.getElementById("singleMonth"),
  dayRange: document.getElementById("dayRangeInputs"),
  monthRange: document.getElementById("monthRangeInputs"),
};
filterSelect.addEventListener("change", () => {
  Object.values(filterInputs).forEach((el) => el.classList.add("hidden"));
  const selected = filterSelect.value;
  if (filterInputs[selected]) filterInputs[selected].classList.remove("hidden");
});

let chart;
function calculateCost(totalWh) {
  if (totalWh <= 50) return totalWh * 4;
  else if (totalWh <= 100) return totalWh * 6;
  else return totalWh * 8;
}

async function fetchRows(limit = 1000) {
  const { data, error } = await supabase
    .from("esp32_data")
    .select("created_at,total_energy,e1,e2,e3,e4")
    .eq("device_id", DEVICE_ID)
    .order("created_at", { ascending: true })
    .limit(limit);
  return error ? [] : data;
}

document.getElementById("loadCharts").addEventListener("click", async () => {
  const ctx = document.getElementById("chart").getContext("2d");
  if (chart) chart.destroy();

  const selected = filterSelect.value;
  const rows = await fetchRows(2000);

  let chartLabels = [];
  let series = [];

  if (selected === "day") {
    const day = document.getElementById("singleDay").value || new Date().toISOString().slice(0,10);
    const filtered = rows.filter(r => r.created_at.startsWith(day));
    chartLabels = filtered.map(r => new Date(r.created_at).toLocaleTimeString());
    series = filtered.map(r => r.total_energy ?? 0);
  } else if (selected === "month") {
    const month = document.getElementById("singleMonth").value || new Date().toISOString().slice(0,7);
    const filtered = rows.filter(r => r.created_at.startsWith(month));
    chartLabels = filtered.map(r => new Date(r.created_at).toLocaleDateString());
    series = filtered.map(r => r.total_energy ?? 0);
  } else if (selected === "dayRange") {
    const from = new Date(document.getElementById("fromDay").value);
    const to = new Date(document.getElementById("toDay").value);
    const grouped = {};
    rows.forEach(r => {
      const d = new Date(r.created_at);
      if (isFinite(from) && isFinite(to) && d >= from && d <= to) {
        const key = d.toISOString().slice(0,10);
        grouped[key] = (grouped[key] || 0) + (r.total_energy ?? 0);
      }
    });
    chartLabels = Object.keys(grouped);
    series = Object.values(grouped);
  } else if (selected === "monthRange") {
    const from = new Date(document.getElementById("fromMonth").value + "-01");
    const to = new Date(document.getElementById("toMonth").value + "-01");
    const grouped = {};
    rows.forEach(r => {
      const d = new Date(r.created_at);
      if (isFinite(from) && isFinite(to) && d >= from && d <= to) {
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
        grouped[key] = (grouped[key] || 0) + (r.total_energy ?? 0);
      }
    });
    chartLabels = Object.keys(grouped);
    series = Object.values(grouped);
  }

  chart = new Chart(ctx, {
    type: document.getElementById("chartType").value,
    data: {
      labels: chartLabels,
      datasets: [{
        label: "Total Energy (Wh)",
        data: series,
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,0.4)"
      }]
    },
    options: {
      responsive: true,
      plugins: { title: { display: true, text: "Energy Consumption", color: "#e2e8f0" } },
      scales: { y: { beginAtZero: true } }
    }
  });

  const totalWh = series.reduce((a,b)=>a+(parseFloat(b)||0),0);
  const cost = calculateCost(totalWh).toFixed(2);
  document.getElementById("chartResults").textContent =
    `Total Energy: ${totalWh.toFixed(2)} Wh · Cost: ₹${cost}`;
});

// ==================================================================
//  PDF REPORT: monthly aggregation
// ==================================================================
document.getElementById("downloadPdf").addEventListener("click", async () => {
  const selected = filterSelect.value;
  if (selected !== "month" && selected !== "monthRange") {
    alert("PDF report available only for monthly or month-range data.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  const rows = await fetchRows(5000);

  const grouped = {};
  rows.forEach(r => {
    const key = r.created_at.slice(0,7); // YYYY-MM
    grouped[key] = (grouped[key] || 0) + (r.total_energy ?? 0);
  });

  const months = Object.entries(grouped);
  if (months.length === 0) {
    alert("No data available to generate PDF.");
    return;
  }

  months.forEach(([month, totalWh], idx) => {
    if (idx > 0) pdf.addPage();
    const [y, m] = month.split("-");
    const label = `${new Date(y, m-1).toLocaleString("default", { month: "long" })} ${y}`;
    pdf.setFontSize(14);
    pdf.text(`Power Consumption Report - ${label}`, 14, 20);
    pdf.setFontSize(10);
    pdf.text("------------------------------------------", 14, 25);
    pdf.text(`Total Energy: ${totalWh.toFixed(2)} Wh`, 14, 35);
    pdf.text(`Cost: ₹${calculateCost(totalWh).toFixed(2)}`, 14, 45);
  });

  pdf.save("Monthly_Report_Wh.pdf");
});

// ==================================================================
//  NOTIFICATIONS + LOGOUT
// ==================================================================
document.getElementById("refreshNotifs").addEventListener("click", () => addNotification("New data updated."));
document.getElementById("clearNotifs").addEventListener("click", () => {
  document.getElementById("notifs").innerHTML = "<li>No notifications yet.</li>";
});
function addNotification(msg) {
  const list = document.getElementById("notifs");
  if (list.children[0].textContent === "No notifications yet.") list.innerHTML = "";
  const li = document.createElement("li");
  li.textContent = `${new Date().toLocaleTimeString()} - ${msg}`;
  list.prepend(li);
}
function logout() { window.location.href = "index.html"; }
