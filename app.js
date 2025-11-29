// ==================================================================
//  GUARD: Require login session
// ==================================================================
(function ensureSession() {
  const email = sessionStorage.getItem("userEmail");
  if (!email) {
    alert("Please login to continue.");
    window.location.href = "index.html";
  }
})();

// ==================================================================
//  CONFIG: Supabase
// ==================================================================
const SUPABASE_URL = "https://hhhvjviyzevftksqsbqe.supabase.co";
const SUPABASE_KEY = "YOUR_SUPABASE_KEY";   // replace with your key
const DEVICE_ID = "esp32-local";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ==================================================================
//  DATE & TIME + IP
// ==================================================================
function updateDateTime() {
  document.getElementById("dateTime").textContent = new Date().toLocaleString();
}
setInterval(updateDateTime, 1000);
updateDateTime();

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
const debounce = { 1: 0, 2: 0, 3: 0, 4: 0 };

// ==================================================================
//  RELAY CONTROL (UI + Supabase command)
// ==================================================================
for (let i = 1; i <= 4; i++) {
  document.getElementById(`relay${i}`).addEventListener("change", async (e) => {
    const now = Date.now();
    if (now - debounce[i] < 250) {
      e.target.checked = relayStates[i];
      return;
    }
    debounce[i] = now;
    await toggleRelay(i, e.target.checked);
  });
}

async function sendCommandToSupabase(relay, state) {
  try {
    const { error } = await supabase
      .from("esp32_commands")
      .insert({ device_id: DEVICE_ID, relay, state });
    if (error) {
      addNotification(`Command error: ${error.message}`);
      return false;
    }
    return true;
  } catch (err) {
    addNotification(`Command error: ${String(err)}`);
    return false;
  }
}

async function toggleRelay(id, state) {
  relayStates[id] = state;
  document.getElementById(`s${id}`).textContent = state ? "ON" : "OFF";
  addNotification(`Load ${id} turned ${state ? "ON" : "OFF"}`);
  const ok = await sendCommandToSupabase(id, state);
  if (!ok) {
    // rollback UI if command failed
    relayStates[id] = !state;
    document.getElementById(`relay${id}`).checked = relayStates[id];
    document.getElementById(`s${id}`).textContent = relayStates[id] ? "ON" : "OFF";
  }
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
  const load = Number(document.getElementById("loadSelect").value);
  const mins = parseInt(document.getElementById("customMin").value, 10);
  if (!mins || mins <= 0) {
    alert("Enter valid minutes");
    return;
  }

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
    const val = parseFloat(document.getElementById(`limit${i}`).value);
    usageLimits[i] = isNaN(val) ? usageLimits[i] : val;
  }
  addNotification("Usage limits updated.");
});

// Tick every 2 seconds (adds 2 sec when ON). Auto-off if limit reached.
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
//  LIVE MONITORING
// ==================================================================
function updateDashboardRow(d) {
  for (let i = 1; i <= 4; i++) {
    const v = d[`v${i}`] ?? 0;
    const c = d[`c${i}`] ?? 0;
    const p = d[`p${i}`] ?? 0;
    const e = d[`e${i}`] ?? 0;

    document.getElementById(`v${i}`).textContent = `${Number(v).toFixed(2)}V`;
    document.getElementById(`c${i}`).textContent = `${Number(c).toFixed(3)}A`;
    document.getElementById(`p${i}`).textContent = `${Number(p).toFixed(2)}W`;
    document.getElementById(`e${i}`).textContent = `${Number(e).toFixed(3)}Wh`;

    document.getElementById(`s${i}`).textContent = relayStates[i] ? "ON" : "OFF";
  }
  document.getElementById("tv").textContent = `${Number(d.total_voltage ?? 0).toFixed(2)}V`;
  document.getElementById("tc").textContent = `${Number(d.total_current ?? 0).toFixed(3)}A`;
  document.getElementById("tp").textContent = `${Number(d.total_power ?? 0).toFixed(2)}W`;
  document.getElementById("te").textContent = `${Number(d.total_energy ?? 0).toFixed(3)}Wh`;
}

async function fetchLatestRow() {
  try {
    const { data, error } = await supabase
      .from("esp32_data")
      .select("*")
      .eq("device_id", DEVICE_ID)
      .order("created_at", { ascending: false })
      .limit(1);
    if (!error && data && data.length) {
      updateDashboardRow(data[0]);
    }
  } catch (err) {
    addNotification(`Fetch error: ${String(err)}`);
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

// ==================================================================
//  CHARTS + PDF REPORT (unchanged from your version)
// ==================================================================
// ... keep your chart.js and PDF logic here ...


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

// default to today for day filter
document.getElementById("singleDay").value = new Date().toISOString().slice(0, 10);

let chart;
function calculateCost(totalWh) {
  if (totalWh <= 50) return totalWh * 4;
  else if (totalWh <= 100) return totalWh * 6;
  else return totalWh * 8;
}

async function fetchRows(limit = 5000) {
  try {
    const { data, error } = await supabase
      .from("esp32_data")
      .select("created_at,total_energy,e1,e2,e3,e4")
      .eq("device_id", DEVICE_ID)
      .order("created_at", { ascending: true })
      .limit(limit);
    return error ? [] : data || [];
  } catch {
    return [];
  }
}

document.getElementById("loadCharts").addEventListener("click", async () => {
  const canvas = document.getElementById("chart");
  if (!canvas) {
    addNotification("Chart canvas missing.");
    return;
  }
  const ctx = canvas.getContext("2d");
  if (chart) chart.destroy();

  const selected = filterSelect.value;
  const rows = await fetchRows(5000);

  let chartLabels = [];
  let series = [];

  if (selected === "day") {
    const day = document.getElementById("singleDay").value || new Date().toISOString().slice(0,10);
    const filtered = rows.filter(r => (r.created_at || "").slice(0,10) === day);
    chartLabels = filtered.map(r => new Date(r.created_at).toLocaleTimeString());
    series = filtered.map(r => Number(r.total_energy ?? 0));
  } else if (selected === "month") {
    const month = document.getElementById("singleMonth").value || new Date().toISOString().slice(0,7);
    const filtered = rows.filter(r => (r.created_at || "").slice(0,7) === month);
    chartLabels = filtered.map(r => new Date(r.created_at).toLocaleDateString());
    series = filtered.map(r => Number(r.total_energy ?? 0));
  } else if (selected === "dayRange") {
    const fromStr = document.getElementById("fromDay").value;
    const toStr = document.getElementById("toDay").value;
    if (!fromStr || !toStr) {
      alert("Select From and To dates.");
      return;
    }
    const from = new Date(fromStr);
    const to = new Date(toStr);
    to.setHours(23,59,59,999);
    const grouped = {};
    rows.forEach(r => {
      const d = new Date(r.created_at);
      if (d >= from && d <= to) {
        const key = d.toISOString().slice(0,10);
        grouped[key] = (grouped[key] || 0) + (Number(r.total_energy ?? 0));
      }
    });
    chartLabels = Object.keys(grouped).sort();
    series = chartLabels.map(k => grouped[k]);
  } else if (selected === "monthRange") {
    const fromMonthStr = document.getElementById("fromMonth").value;
    const toMonthStr = document.getElementById("toMonth").value;
    if (!fromMonthStr || !toMonthStr) {
      alert("Select From and To months.");
      return;
    }
    const from = new Date(fromMonthStr + "-01");
    const to = new Date(toMonthStr + "-01");
    to.setMonth(to.getMonth() + 1, 0); // go to last day of 'to' month
    const grouped = {};
    rows.forEach(r => {
      const d = new Date(r.created_at);
      if (d >= from && d <= to) {
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
        grouped[key] = (grouped[key] || 0) + (Number(r.total_energy ?? 0));
      }
    });
    chartLabels = Object.keys(grouped).sort();
    series = chartLabels.map(k => grouped[k]);
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
    const key = (r.created_at || "").slice(0,7); // YYYY-MM
    if (key) grouped[key] = (grouped[key] || 0) + (Number(r.total_energy ?? 0));
  });

  const months = Object.entries(grouped).sort((a,b)=>a[0].localeCompare(b[0]));
  if (months.length === 0) {
    alert("No data available to generate PDF.");
    return;
  }

  months.forEach(([month, totalWh], idx) => {
    if (idx > 0) pdf.addPage();
    const [y, m] = month.split("-");
    const label = `${new Date(Number(y), Number(m)-1).toLocaleString("default", { month: "long" })} ${y}`;
    pdf.setFontSize(14);
    pdf.text(`Power Consumption Report - ${label}`, 14, 20);
    pdf.setFontSize(10);
    pdf.text("------------------------------------------", 14, 25);
    pdf.text(`Total Energy: ${Number(totalWh).toFixed(2)} Wh`, 14, 35);
    pdf.text(`Cost: ₹${calculateCost(totalWh).toFixed(2)}`, 14, 45);
  });

  pdf.save("Monthly_Report_Wh.pdf");
});


<<<<<<< HEAD

=======
>>>>>>> 24996f58e3c444965b85dba38db56d6033170ae9
// ==================================================================
//  NOTIFICATIONS + LOGOUT
// ==================================================================
document.getElementById("refreshNotifs").addEventListener("click", () => addNotification("New data updated."));
document.getElementById("clearNotifs").addEventListener("click", () => {
  document.getElementById("notifs").innerHTML = "<li>No notifications yet.</li>";
});
function addNotification(msg) {
  const list = document.getElementById("notifs");
  if (list.children[0] && list.children[0].textContent === "No notifications yet.") list.innerHTML = "";
  const li = document.createElement("li");
  li.textContent = `${new Date().toLocaleTimeString()} - ${msg}`;
  list.prepend(li);
}
function logout() {
  sessionStorage.removeItem("userEmail");
  window.location.href = "index.html";
}























