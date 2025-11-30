// ==================================================================
//  SUPABASE CONFIG
// ==================================================================
const SUPABASE_URL = "https://hhhvjviyzevftksqsbqe.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoaHZqdml5emV2ZnRrc3FzYnFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyMzczNzEsImV4cCI6MjA3OTgxMzM3MX0.NnGI7H9nrUcPUUgW_UCD4AieOBcOHIrdHoVRp3fFL-8";
const SUPABASE_ANON_KEY = SUPABASE_KEY;  // for clarity
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==================================================================
//  GUARD: Require login session
// ==================================================================
(function ensureSession() {
  const email = sessionStorage.getItem("userEmail");
  if (!email) {
    window.location.href = "index.html";
  }
})();

// Logout
function logout() {
  sessionStorage.clear();
  window.location.href = "index.html";
}

// ==================================================================
//  DATE & TIME DISPLAY
// ==================================================================
function updateDateTime() {
  document.getElementById("dateTime").textContent = new Date().toLocaleString();
}
setInterval(updateDateTime, 1000);
updateDateTime();


// ==================================================================
//  LIVE DATA FETCH FROM SUPABASE TABLE: 'live_readings'
// ==================================================================
async function fetchLiveData() {
  const { data, error } = await supabaseClient
    .from("live_readings")           // must match your table name
    .select("*")
    .order("id", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return;

  const row = data[0];  // latest reading (ESP32 inserts continuously)

  // Individual Loads
  updateTile(1, row.v1, row.c1, row.p1, row.e1, row.s1);
  updateTile(2, row.v2, row.c2, row.p2, row.e2, row.s2);
  updateTile(3, row.v3, row.c3, row.p3, row.e3, row.s3);
  updateTile(4, row.v4, row.c4, row.p4, row.e4, row.s4);

  // Total Usage
  document.getElementById("tv").textContent = row.total_v + "V";
  document.getElementById("tc").textContent = row.total_c + "A";
  document.getElementById("tp").textContent = row.total_p + "W";
  document.getElementById("te").textContent = row.total_e + "Wh";

  limitCheck(row);  // Check if limit crossed → notification
}

// Helper to update DOM tiles
function updateTile(id, v, c, p, e, s) {
  document.getElementById(`v${id}`).textContent = v + "V";
  document.getElementById(`c${id}`).textContent = c + "A";
  document.getElementById(`p${id}`).textContent = p + "W";
  document.getElementById(`e${id}`).textContent = e + "Wh";
  document.getElementById(`s${id}`).textContent = s === 1 ? "ON" : "OFF";
}

setInterval(fetchLiveData, 4000);  // fetch live data every 4 seconds
fetchLiveData();


// ==================================================================
//  REMOTE CONTROL (Relay Control via Supabase Table: 'commands')
// ==================================================================
const relayCheckboxes = [
  document.getElementById("relay1"),
  document.getElementById("relay2"),
  document.getElementById("relay3"),
  document.getElementById("relay4")
];

relayCheckboxes.forEach((checkbox, index) => {
  checkbox.addEventListener("change", () => {
    updateRelay(index + 1, checkbox.checked ? 1 : 0);
  });
});

async function updateRelay(loadNum, state) {
  await supabaseClient.from("commands").insert([
    { load: loadNum, relay_state: state } // ESP32 reads this table → switch relays
  ]);
}


// ==================================================================
//  TIMER AUTO-OFF  (Insert into 'commands' table)
// ==================================================================
let timerInterval;

document.querySelectorAll(".preset").forEach(btn => {
  btn.addEventListener("click", () => {
    document.getElementById("customMin").value = btn.dataset.min;
  });
});

document.getElementById("applyTimer").addEventListener("click", async () => {
  const min = parseInt(document.getElementById("customMin").value);
  const load = document.getElementById("loadSelect").value;

  if (!min || min < 1) return alert("Enter valid time");

  await supabaseClient.from("commands").insert([
    { load: load, timer: min }
  ]);

  alert(`⏳ Auto OFF set for Load ${load} after ${min} mins`);
});


// ==================================================================
//  LIMIT CHECK  (Usage Limit per 24 hours)
// ==================================================================
function limitCheck(row) {
  const limits = [
    parseFloat(document.getElementById("limit1").value),
    parseFloat(document.getElementById("limit2").value),
    parseFloat(document.getElementById("limit3").value),
    parseFloat(document.getElementById("limit4").value),
  ];

  for (let i = 1; i <= 4; i++) {
    const usedHours = row[`e${i}`] / row[`p${i}`]; // Wh ÷ W ≈ hours
    if (usedHours > limits[i - 1]) {
      addNotification(`⚠ Load ${i} crossed limit: ${usedHours.toFixed(2)}hr`);
    }
  }
}

document.getElementById("saveLimits").addEventListener("click", () => {
  addNotification("✔ Limits updated successfully");
});


// ==================================================================
//  NOTIFICATION SYSTEM
// ==================================================================
function addNotification(msg) {
  const ul = document.getElementById("notifs");
  const li = document.createElement("li");
  li.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  ul.prepend(li);
}

document.getElementById("clearNotifs").addEventListener("click", () => {
  document.getElementById("notifs").innerHTML = "<li>No notifications yet.</li>";
});

document.getElementById("refreshNotifs").addEventListener("click", fetchLiveData);


// ==================================================================
//  CHARTS – Daily / Monthly / Range  (Table name: 'history')
// ==================================================================
let chartInstance;

async function loadChart() {
  const filter = document.getElementById("filterSelect").value;
  let query = supabaseClient.from("history");
  let title = "";

  if (filter === "day") {
    const day = document.getElementById("singleDay").value;
    query = query.eq("day", day);
    title = `Day: ${day}`;

  } else if (filter === "month") {
    const mon = document.getElementById("singleMonth").value;
    query = query.eq("month", mon);
    title = `Month: ${mon}`;

  } else if (filter === "dayRange") {
    const from = document.getElementById("fromDay").value;
    const to = document.getElementById("toDay").value;
    query = query.gte("day", from).lte("day", to);
    title = `${from} → ${to}`;

  } else if (filter === "monthRange") {
    const from = document.getElementById("fromMonth").value;
    const to = document.getElementById("toMonth").value;
    query = query.gte("month", from).lte("month", to);
    title = `${from} → ${to}`;
  }

  const { data } = await query.select("*");
  renderChart(data, title);
}

function renderChart(data, title) {
  const labels = data.map(r => r.day || r.month);
  const values = data.map(r => r.total_energy);

  const ctx = document.getElementById("chart").getContext("2d");
  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: document.getElementById("chartType").value,
    data: {
      labels: labels,
      datasets: [{
        label: title,
        data: values,
        borderWidth: 2
      }]
    }
  });

  document.getElementById("chartResults").textContent = `Data Points: ${data.length}`;
}

document.getElementById("loadCharts").addEventListener("click", loadChart);


// ==================================================================
//  PDF DOWNLOAD
// ==================================================================
document.getElementById("downloadPdf").addEventListener("click", () => {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  pdf.text("Power Consumption Report", 10, 10);
  pdf.text("Generated at: " + new Date().toLocaleString(), 10, 20);
  pdf.save("report.pdf");
});


// ==================================================================
//  END OF FILE
// ==================================================================
console.log("App.js Loaded Successfully!");
